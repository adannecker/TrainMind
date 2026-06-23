import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type GarminMode = "sleep" | "steps" | "stress";
type GarminMetricKey = "steps" | "sleep_hours" | "stress_avg" | "stress_max" | "body_battery_avg";

type GarminStatus = {
  email_configured: boolean;
  token_files_present: boolean;
  auth_mode: string | null;
  login_ok: boolean | null;
  detail?: string;
};

type GarminDailyRow = {
  date: string;
  steps?: number | null;
  sleep_hours?: number | null;
  stress_avg?: number | null;
  stress_max?: number | null;
  body_battery_avg?: number | null;
};

type GarminHealthPayload = {
  count: number;
  measurements: GarminDailyRow[];
  detail?: string;
};

const MODE_CONFIG: Record<GarminMode, { title: string; lead: string; metrics: Array<{ key: GarminMetricKey; label: string; unit: string; color: string }> }> = {
  sleep: {
    title: "Schlaf",
    lead: "Garmin-Schlafdaten als Verlauf und Tabelle. Wenn Garmin für einzelne Tage keine Schlafdauer liefert, bleibt der Wert leer.",
    metrics: [{ key: "sleep_hours", label: "Schlafdauer", unit: "h", color: "#5b6fc0" }],
  },
  steps: {
    title: "Schritte",
    lead: "Tägliche Bewegung aus Garmin, aggregiert aus den Schrittintervallen.",
    metrics: [{ key: "steps", label: "Schritte", unit: "", color: "#2d8f78" }],
  },
  stress: {
    title: "Stress & Erholung",
    lead: "Garmin-Stress, Maximalstress und Body Battery als Erholungsmarker im Tagesverlauf.",
    metrics: [
      { key: "stress_avg", label: "Stress Ø", unit: "", color: "#d8694f" },
      { key: "stress_max", label: "Stress Max", unit: "", color: "#b44e42" },
      { key: "body_battery_avg", label: "Body Battery", unit: "", color: "#c58a31" },
    ],
  },
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

function defaultDateTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultDateFrom(days = 30): string {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function formatValue(value: number | null | undefined, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (unit === "h") return `${value.toFixed(1)} h`;
  return unit ? `${Math.round(value).toLocaleString("de-DE")} ${unit}` : Math.round(value).toLocaleString("de-DE");
}

function valueOf(row: GarminDailyRow, key: GarminMetricKey): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildDateTicks(values: string[], width: number, maxTicks = 6): Array<{ x: number; label: string }> {
  const times = values
    .map((value) => new Date(`${value.slice(0, 10)}T12:00:00`).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!times.length) return [];
  const min = times[0];
  const max = times[times.length - 1];
  const span = Math.max(1, max - min);
  const count = Math.min(maxTicks, Math.max(2, times.length));
  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0 : index / (count - 1);
    const time = min + span * ratio;
    return { x: ratio * width, label: formatDate(new Date(time).toISOString().slice(0, 10)) };
  });
}

function isGarminConnected(status: GarminStatus | null): boolean {
  return Boolean(status && (status.login_ok || status.auth_mode === "token_reuse" || status.token_files_present || status.email_configured));
}

function garminStatusLabel(status: GarminStatus | null): string {
  if (!status) return "Garmin wird geprüft";
  if (!isGarminConnected(status)) return "Garmin nicht verbunden";
  return status.auth_mode ? `Garmin verbunden · ${status.auth_mode}` : "Garmin verbunden";
}

type GarminMetricConfig = (typeof MODE_CONFIG)[GarminMode]["metrics"][number];

type GarminChartSelection = {
  metric: GarminMetricConfig;
  row: GarminDailyRow;
  value: number;
  x: number;
  y: number;
};

type GarminChartScale = {
  min: number;
  max: number;
  span: number;
  minTime: number;
  timeSpan: number;
};

function chartScale(points: Array<{ time: number; value: number }>): GarminChartScale | null {
  if (!points.length) return null;
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const minTime = Math.min(...points.map((point) => point.time));
  const maxTime = Math.max(...points.map((point) => point.time));
  return { min, max, span: Math.max(1, max - min), minTime, timeSpan: Math.max(1, maxTime - minTime) };
}

function chartY(value: number, scale: GarminChartScale, height: number): number {
  return height - ((value - scale.min) / scale.span) * height;
}

function garminSeriesPoints(rows: GarminDailyRow[], key: GarminMetricKey, width: number, height: number) {
  const points = rows
    .map((row) => ({ row, time: new Date(`${row.date}T12:00:00`).getTime(), value: valueOf(row, key) }))
    .filter((point): point is { row: GarminDailyRow; time: number; value: number } => Number.isFinite(point.time) && point.value != null)
    .sort((a, b) => a.time - b.time);
  const scale = chartScale(points);
  if (!scale) return [];
  return points.map((point) => ({
    ...point,
    x: ((point.time - scale.minTime) / scale.timeSpan) * width,
    y: chartY(point.value, scale, height),
  }));
}

function garminMetricScale(rows: GarminDailyRow[], key: GarminMetricKey): GarminChartScale | null {
  const points = rows
    .map((row) => ({ time: new Date(`${row.date}T12:00:00`).getTime(), value: valueOf(row, key) }))
    .filter((point): point is { time: number; value: number } => Number.isFinite(point.time) && point.value != null);
  return chartScale(points);
}

function buildPath(rows: GarminDailyRow[], key: GarminMetricKey, width: number, height: number): string {
  const points = garminSeriesPoints(rows, key, width, height);
  if (points.length < 2) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function formatAxisValue(value: number, unit: string): string {
  if (unit === "h") return `${value.toFixed(1)} h`;
  if (unit) return `${Math.round(value).toLocaleString("de-DE")} ${unit}`;
  return Math.round(value).toLocaleString("de-DE");
}

function IconRefresh() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5" /><path d="M19 11a7 7 0 1 0-2 5" /></svg>;
}

function GarminChart({ rows, metrics }: { rows: GarminDailyRow[]; metrics: GarminMetricConfig[] }) {
  const width = 1180;
  const height = 380;
  const plotLeft = 78;
  const plotTop = 28;
  const plotWidth = width - 118;
  const plotHeight = height - 92;
  const primaryMetric = metrics[0];
  const primaryScale = primaryMetric ? garminMetricScale(rows, primaryMetric.key) : null;
  const yTicks = primaryScale ? [0, 1, 2, 3, 4].map((tick) => primaryScale.max - (tick / 4) * primaryScale.span) : [];
  const dateTicks = buildDateTicks(rows.map((row) => row.date), plotWidth);
  const [selected, setSelected] = useState<GarminChartSelection | null>(null);

  useEffect(() => {
    if (selected && !metrics.some((metric) => metric.key === selected.metric.key)) setSelected(null);
  }, [selected, metrics]);

  function selectPoint(metric: GarminMetricConfig, point: ReturnType<typeof garminSeriesPoints>[number]) {
    setSelected({ metric, row: point.row, value: point.value, x: point.x, y: point.y });
  }

  return (
    <div className="health-weight-chart health-weight-chart-wide">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Garmin Verlauf">
        <rect x="0" y="0" width={width} height={height} rx="8" />
        {[0, 1, 2, 3, 4].map((tick) => <line key={tick} x1={plotLeft} x2={plotLeft + plotWidth} y1={plotTop + (tick / 4) * plotHeight} y2={plotTop + (tick / 4) * plotHeight} className="health-chart-grid" />)}
        <line x1={plotLeft} x2={plotLeft + plotWidth} y1={plotTop + plotHeight} y2={plotTop + plotHeight} className="health-chart-axis" />
        <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotTop + plotHeight} className="health-chart-axis" />
        {primaryMetric ? <text x={plotLeft} y={18} className="health-chart-unit-label">{primaryMetric.label}{primaryMetric.unit ? ` (${primaryMetric.unit})` : ""}</text> : null}
        {primaryMetric ? yTicks.map((value, index) => (
          <text key={`${primaryMetric.key}-${index}`} x={plotLeft - 12} y={plotTop + (index / 4) * plotHeight + 4} textAnchor="end" className="health-chart-axis-label">
            {formatAxisValue(value, primaryMetric.unit)}
          </text>
        )) : null}
        {dateTicks.map((tick) => (
          <g key={`${tick.x}-${tick.label}`}>
            <line x1={plotLeft + tick.x} x2={plotLeft + tick.x} y1={plotTop + plotHeight} y2={plotTop + plotHeight + 6} className="health-chart-axis" />
            <text x={plotLeft + tick.x} y={plotTop + plotHeight + 30} textAnchor="middle" className="health-chart-date-label">{tick.label}</text>
          </g>
        ))}
        {rows.length >= 2 ? (
          <g transform={`translate(${plotLeft}, ${plotTop})`}>
            {metrics.map((metric) => {
              const path = buildPath(rows, metric.key, plotWidth, plotHeight);
              const points = garminSeriesPoints(rows, metric.key, plotWidth, plotHeight);
              return (
                <g key={metric.key}>
                  {path ? <path d={path} className="health-weight-line" style={{ stroke: metric.color }} /> : null}
                  {points.map((point) => {
                    const isSelected = selected?.metric.key === metric.key && selected.row.date === point.row.date;
                    return (
                      <g key={`${metric.key}-${point.row.date}`}>
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r="11"
                          className="health-chart-point-hit"
                          tabIndex={0}
                          role="button"
                          aria-label={`${metric.label} am ${formatDate(point.row.date)}: ${formatValue(point.value, metric.unit)}`}
                          onClick={() => selectPoint(metric, point)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") selectPoint(metric, point); }}
                        />
                        <circle cx={point.x} cy={point.y} r={isSelected ? 5.5 : 3.5} className="health-chart-point" style={{ fill: metric.color, stroke: isSelected ? "#173530" : "#ffffff" }} />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        ) : <text x={width / 2} y={height / 2} textAnchor="middle" className="health-chart-empty">Noch zu wenig Garmin-Daten</text>}
      </svg>
      {selected ? (
        <div className="health-chart-selection" role="status" aria-live="polite">
          <span style={{ backgroundColor: selected.metric.color }} />
          <strong>{selected.metric.label}: {formatValue(selected.value, selected.metric.unit)}</strong>
          <small>{formatDate(selected.row.date)}</small>
        </div>
      ) : null}
    </div>
  );
}

export function GarminHealthPage({ mode }: { mode: GarminMode }) {
  const config = MODE_CONFIG[mode];
  const [status, setStatus] = useState<GarminStatus | null>(null);
  const [rows, setRows] = useState<GarminDailyRow[]>([]);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom(30));
  const [dateTo, setDateTo] = useState(defaultDateTo());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = rows[rows.length - 1] ?? null;
  const rangeText = rows.length ? `${formatDate(rows[0].date)} bis ${formatDate(rows[rows.length - 1].date)}` : "Keine Daten im Zeitraum";

  async function loadData(showLoading = false, syncProvider = false) {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const statusRes = await apiFetch(`${API_BASE_URL}/garmin/session-status`);
      const statusBody = await parseJsonSafely<GarminStatus>(statusRes);
      if (!statusRes.ok) throw new Error(statusBody?.detail || "Garmin-Status konnte nicht geladen werden.");
      setStatus(statusBody);

      const syncParam = syncProvider ? "&sync=true" : "";
      const dataRes = await apiFetch(`${API_BASE_URL}/garmin/health-daily?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}${syncParam}`);
      const dataBody = await parseJsonSafely<GarminHealthPayload>(dataRes);
      if (!dataRes.ok) throw new Error(dataBody?.detail || "Garmin-Daten konnten nicht geladen werden.");
      setRows(dataBody?.measurements ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function applyDateRange() {
    if (applying || refreshing) return;
    setApplying(true);
    try {
      await loadData(false, true);
    } finally {
      setApplying(false);
    }
  }

  async function refresh() {
    if (refreshing || applying) return;
    setRefreshing(true);
    try {
      await loadData(false, true);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { void loadData(true); }, [mode]);

  const metricCards = useMemo(() => config.metrics.map((metric) => ({ ...metric, value: latest ? valueOf(latest, metric.key) : null })), [config.metrics, latest]);
  const connected = isGarminConnected(status);

  return (
    <section className="page health-page health-page-visual">
      <div className="hero health-hero">
        <div><p className="eyebrow">Gesundheit</p><h1>{config.title}</h1><p className="lead">{config.lead}</p></div>
        <div className="health-top-actions"><span className={`health-connected-marker ${connected ? "connected" : ""}`}>{garminStatusLabel(status)}</span><button className="icon-button health-refresh-button" type="button" onClick={() => void refresh()} disabled={refreshing || applying || !connected} aria-label="Garmin Daten aktualisieren" title="Garmin Daten aktualisieren"><IconRefresh /></button></div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p>Garmin-Daten werden geladen...</p> : null}
      {loading || refreshing || applying ? (
        <div className="health-loading-overlay" role="status" aria-live="polite" aria-label="Gesundheitsdaten werden geladen">
          <div className="health-loading-card">
            <div className="waiting-spinner" aria-hidden="true" />
            <strong>{refreshing || applying ? `${config.title} wird mit Garmin synchronisiert` : "Garmin-Daten werden geladen"}</strong>
            <span>{refreshing || applying ? "Tageswerte werden von Garmin geholt und in der Datenbank gespeichert." : "Gespeicherte Werte werden aus der Datenbank geladen."}</span>
          </div>
        </div>
      ) : null}
      <article className="card health-filter-card"><div className="health-filter-row"><div><strong>Zeitraum</strong><span>{rangeText} · {rows.length} Tage</span></div><div className="health-date-controls"><button type="button" className="secondary-button" onClick={() => { setDateFrom(defaultDateFrom(7)); setDateTo(defaultDateTo()); }}>7 Tage</button><button type="button" className="secondary-button" onClick={() => { setDateFrom(defaultDateFrom(30)); setDateTo(defaultDateTo()); }}>30 Tage</button><button type="button" className="secondary-button" onClick={() => { setDateFrom(defaultDateFrom(90)); setDateTo(defaultDateTo()); }}>90 Tage</button><label>Von<input className="settings-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>Bis<input className="settings-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button type="button" className="primary-button" onClick={() => void applyDateRange()} disabled={applying || refreshing}>Anwenden</button></div></div><div className="health-timeline"><span>{formatDate(dateFrom)}</span><div><i /></div><span>{formatDate(dateTo)}</span></div></article>
      <div className="health-metric-grid">{metricCards.map((metric) => <article className="health-metric-card" key={metric.key}><span>{metric.label}</span><strong>{formatValue(metric.value, metric.unit)}</strong><small>{latest ? formatDate(latest.date) : "Kein Messpunkt"}</small></article>)}</div>
      <article className="card health-chart-card health-wide-card"><div className="section-title-row"><h2>Entwicklung</h2><small>{rangeText}</small></div><GarminChart rows={rows} metrics={config.metrics} /><div className="health-chart-legend">{config.metrics.map((metric) => <span key={metric.key}><i style={{ backgroundColor: metric.color }} />{metric.label}: {formatValue(latest ? valueOf(latest, metric.key) : null, metric.unit)}</span>)}</div></article>
      <article className="card"><div className="section-title-row"><h2>Tabelle</h2><small>{rows.length} Tage</small></div><div className="health-table-wrap"><table className="health-table"><thead><tr><th>Datum</th>{config.metrics.map((metric) => <th key={metric.key}>{metric.label}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={config.metrics.length + 1}>Keine Garmin-Daten im Zeitraum.</td></tr> : rows.slice().reverse().map((row) => <tr key={row.date}><td>{formatDate(row.date)}</td>{config.metrics.map((metric) => <td key={metric.key}>{formatValue(valueOf(row, metric.key), metric.unit)}</td>)}</tr>)}</tbody></table></div></article>
    </section>
  );
}
