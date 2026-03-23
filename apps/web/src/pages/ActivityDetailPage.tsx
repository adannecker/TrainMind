import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type ActivitySummary = {
  id: number;
  external_id: string;
  name: string;
  provider: string | null;
  sport: string | null;
  started_at: string | null;
  duration_s: number | null;
  duration_label: string | null;
  distance_m: number | null;
  avg_speed_kmh: number | null;
  avg_power_w: number | null;
  avg_hr_bpm: number | null;
  max_power_w: number | null;
  max_hr_bpm: number | null;
  max_cadence_rpm: number | null;
  max_speed_kmh: number | null;
  min_altitude_m: number | null;
  max_altitude_m: number | null;
  stress_score: number | null;
  records_count: number;
  laps_count: number;
  sessions_count: number;
};

type ActivitySessionRow = {
  session_index: number;
  start_time: string | null;
  total_elapsed_time_s: number | null;
  total_timer_time_s: number | null;
  total_distance_m: number | null;
  avg_speed_kmh: number | null;
  max_speed_kmh: number | null;
  avg_power_w: number | null;
  max_power_w: number | null;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
};

type ActivityLapRow = {
  lap_index: number;
  start_time: string | null;
  total_elapsed_time_s: number | null;
  total_timer_time_s: number | null;
  total_distance_m: number | null;
  avg_speed_kmh: number | null;
  avg_power_w: number | null;
  max_power_w: number | null;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
  duration_label: string | null;
};

type ActivityRecordRow = {
  index: number;
  timestamp: string | null;
  elapsed_s: number | null;
  distance_m: number | null;
  heart_rate_bpm: number | null;
  power_w: number | null;
  speed_mps: number | null;
  speed_kmh: number | null;
  altitude_m: number | null;
  cadence_rpm: number | null;
};

type ActivityDetailResponse = {
  activity: ActivitySummary;
  sessions: ActivitySessionRow[];
  laps: ActivityLapRow[];
  records: ActivityRecordRow[];
};

type TabKey = "general" | "charts" | "laps" | "analysis";
type ZoomSelection = {
  chartKey: string;
  anchor: number;
  current: number;
};
type SmoothingMode = "raw" | "avg3" | "avg5" | "avg10" | "avg30" | "avg60";
type ChartPoint = {
  elapsed: number;
  value: number;
};

const TABS: Array<{ key: TabKey; title: string; note: string }> = [
  { key: "general", title: "Allgemeine Infos", note: "Kernwerte und Metadaten" },
  { key: "charts", title: "Diagramme", note: "HF, Watt und Verlauf" },
  { key: "laps", title: "Runden", note: "Laps und Sessions" },
  { key: "analysis", title: "Trainingsanalyse", note: "Platzhalter für den nächsten Schritt" },
];

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
}

function formatNumber(value: number | null, digits = 0, suffix = ""): string {
  if (value == null) return "-";
  return `${value.toFixed(digits)}${suffix}`;
}

function formatDistanceMeters(value: number | null): string {
  if (value == null) return "-";
  return `${(value / 1000).toFixed(1)} km`;
}

function formatSeconds(value: number | null): string {
  if (value == null) return "-";
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatAxisTime(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  }
  return `${minutes}m`;
}

type ChartRecord = ActivityRecordRow & {
  chart_elapsed_s: number;
};

function normalizeRecordTimeline(records: ActivityRecordRow[]): ChartRecord[] {
  const rawElapsed = records.map((row, index) => row.elapsed_s ?? index);
  const minElapsed = rawElapsed.length ? Math.min(...rawElapsed) : 0;
  const offset = minElapsed < 0 ? -minElapsed : 0;
  return records.map((row, index) => ({
    ...row,
    chart_elapsed_s: (row.elapsed_s ?? index) + offset,
  }));
}

function buildChartPoints(records: ChartRecord[], pick: (row: ActivityRecordRow) => number | null, smoothingMode: SmoothingMode): ChartPoint[] {
  const rawPoints = records
    .map((row) => ({ elapsed: row.chart_elapsed_s, value: pick(row) }))
    .filter((row): row is ChartPoint => row.value != null);
  if (rawPoints.length < 2 || smoothingMode === "raw") {
    return rawPoints;
  }

  const windowSize =
    smoothingMode === "avg3"
      ? 3
      : smoothingMode === "avg5"
        ? 5
        : smoothingMode === "avg10"
          ? 10
          : smoothingMode === "avg30"
            ? 30
            : 60;
  const startSecond = Math.round(rawPoints[0].elapsed);
  const endSecond = Math.round(rawPoints[rawPoints.length - 1].elapsed);
  const normalized: ChartPoint[] = [];
  let cursor = 0;

  for (let second = startSecond; second <= endSecond; second += 1) {
    while (cursor < rawPoints.length - 2 && rawPoints[cursor + 1].elapsed < second) {
      cursor += 1;
    }
    const left = rawPoints[cursor];
    const right = rawPoints[Math.min(cursor + 1, rawPoints.length - 1)];
    if (!left || !right) continue;
    let value = left.value;
    if (right.elapsed > left.elapsed) {
      const ratio = (second - left.elapsed) / (right.elapsed - left.elapsed);
      value = left.value + Math.max(0, Math.min(1, ratio)) * (right.value - left.value);
    }
    normalized.push({ elapsed: second, value });
  }

  const radius = Math.floor(windowSize / 2);
  return normalized.map((point, index) => {
    const from = Math.max(0, index - radius);
    const to = Math.min(normalized.length - 1, index + radius);
    const slice = normalized.slice(from, to + 1);
    const avg = slice.reduce((sum, item) => sum + item.value, 0) / slice.length;
    return { elapsed: point.elapsed, value: avg };
  });
}

function buildPolyline(points: ChartPoint[], width = 900, height = 220): string | null {
  if (points.length < 2) return null;
  const maxValue = Math.max(...points.map((item) => item.value));
  const minValue = Math.min(...points.map((item) => item.value));
  const rawSpan = maxValue - minValue;
  const paddedMin = rawSpan === 0 ? minValue - Math.max(1, Math.abs(minValue) * 0.1) : minValue - rawSpan * 0.08;
  const paddedMax = rawSpan === 0 ? maxValue + Math.max(1, Math.abs(maxValue) * 0.1) : maxValue + rawSpan * 0.08;
  const span = Math.max(1, paddedMax - paddedMin);
  const maxElapsed = Math.max(...points.map((item) => item.elapsed), 1);
  return points
    .map((point) => {
      const x = (point.elapsed / maxElapsed) * width;
      const y = height - ((point.value - paddedMin) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildAreaPath(points: ChartPoint[], width = 900, height = 220): string | null {
  if (points.length < 2) return null;
  const maxValue = Math.max(...points.map((item) => item.value));
  const minValue = Math.min(...points.map((item) => item.value));
  const rawSpan = maxValue - minValue;
  const paddedMin = rawSpan === 0 ? minValue - Math.max(1, Math.abs(minValue) * 0.1) : minValue - rawSpan * 0.08;
  const paddedMax = rawSpan === 0 ? maxValue + Math.max(1, Math.abs(maxValue) * 0.1) : maxValue + rawSpan * 0.08;
  const span = Math.max(1, paddedMax - paddedMin);
  const maxElapsed = Math.max(...points.map((item) => item.elapsed), 1);
  const linePoints = points.map((point) => {
    const x = (point.elapsed / maxElapsed) * width;
    const y = height - ((point.value - paddedMin) / span) * height;
    return { x, y };
  });
  const start = linePoints[0];
  const end = linePoints[linePoints.length - 1];
  const path = linePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  return `${path} L ${end.x.toFixed(1)} ${height.toFixed(1)} L ${start.x.toFixed(1)} ${height.toFixed(1)} Z`;
}

function MiniChart({
  chartKey,
  title,
  color,
  records,
  pick,
  suffix,
  smoothingMode,
  viewStart,
  viewEnd,
  dragSelection,
  hoverSecond,
  onHoverChange,
  onSelectionStart,
  onSelectionMove,
  onSelectionEnd,
}: {
  chartKey: string;
  title: string;
  color: string;
  records: ChartRecord[];
  pick: (row: ActivityRecordRow) => number | null;
  suffix: string;
  smoothingMode: SmoothingMode;
  viewStart: number;
  viewEnd: number;
  dragSelection: ZoomSelection | null;
  hoverSecond: number | null;
  onHoverChange: (nextSecond: number | null) => void;
  onSelectionStart: (chartKey: string, nextSecond: number) => void;
  onSelectionMove: (nextSecond: number) => void;
  onSelectionEnd: () => void;
}) {
  const visibleRecords = useMemo(
    () => records.filter((row) => row.chart_elapsed_s >= viewStart && row.chart_elapsed_s <= viewEnd),
    [records, viewEnd, viewStart],
  );
  const sourceRecords = visibleRecords.length >= 2 ? visibleRecords : records;
  const sourceStart = sourceRecords.length ? sourceRecords[0].chart_elapsed_s : viewStart;
  const sourceEnd = sourceRecords.length ? sourceRecords[sourceRecords.length - 1].chart_elapsed_s : viewEnd;
  const baseElapsed = sourceStart;
  const chartRecords = useMemo(
    () => sourceRecords.map((row) => ({ ...row, chart_elapsed_s: row.chart_elapsed_s - baseElapsed })),
    [baseElapsed, sourceRecords],
  );
  const chartPoints = useMemo(() => buildChartPoints(chartRecords, pick, smoothingMode), [chartRecords, pick, smoothingMode]);
  const points = useMemo(() => buildPolyline(chartPoints), [chartPoints]);
  const areaPath = useMemo(() => buildAreaPath(chartPoints), [chartPoints]);
  const values = chartPoints.map((point) => point.value);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const innerWidth = 900;
  const innerHeight = 220;
  const chartLeft = 64;
  const chartTop = 18;
  const chartWidth = innerWidth;
  const chartHeight = innerHeight;
  const visibleStart = sourceStart;
  const visibleEnd = sourceEnd;
  const totalDuration = Math.max(visibleEnd - visibleStart, 0);
  const gridSteps = 4;
  const yTicks =
    min != null && max != null
      ? Array.from({ length: gridSteps + 1 }, (_, index) => min + ((max - min) / gridSteps) * index)
      : [];
  const minValue = min ?? 0;
  const maxValue = max ?? 1;
  const rawSpan = maxValue - minValue;
  const axisMin = rawSpan === 0 ? minValue - Math.max(1, Math.abs(minValue) * 0.1) : minValue - rawSpan * 0.08;
  const axisMax = rawSpan === 0 ? maxValue + Math.max(1, Math.abs(maxValue) * 0.1) : maxValue + rawSpan * 0.08;
  const valueSpan = Math.max(1, axisMax - axisMin);
  const timestampTicks = Array.from({ length: 5 }, (_, index) => {
    const target = (totalDuration / 4) * index;
    return { seconds: target, absoluteSeconds: visibleStart + target };
  });
  const activeSelection =
    dragSelection && dragSelection.chartKey === chartKey
      ? {
          left: Math.min(dragSelection.anchor, dragSelection.current),
          right: Math.max(dragSelection.anchor, dragSelection.current),
        }
      : null;
  const hoveredPoint =
    hoverSecond == null
      ? null
      : chartPoints.reduce<ChartPoint | null>((best, point) => {
          const pointAbsolute = visibleStart + point.elapsed;
          if (best === null) return point;
          const bestAbsolute = visibleStart + best.elapsed;
          return Math.abs(pointAbsolute - hoverSecond) < Math.abs(bestAbsolute - hoverSecond) ? point : best;
        }, null);
  const hoverX =
    hoverSecond == null
      ? null
      : chartLeft + ((Math.max(visibleStart, Math.min(visibleEnd, hoverSecond)) - visibleStart) / Math.max(1, totalDuration)) * chartWidth;
  const hoverY =
    hoveredPoint == null
      ? null
      : chartTop + chartHeight - ((hoveredPoint.value - axisMin) / valueSpan) * chartHeight;

  function pointerToSecond(clientX: number, element: HTMLDivElement): number {
    const rect = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return sourceStart + ratio * Math.max(1, sourceEnd - sourceStart);
  }

  return (
    <div className="card">
          <div className="section-title-row">
        <h2>{title}</h2>
        <span className="training-note">
          Min {formatNumber(min, 0, suffix)} | Max {formatNumber(max, 0, suffix)}
        </span>
      </div>
      {points ? (
        <div
          style={{ position: "relative", touchAction: "none", cursor: "crosshair", userSelect: "none", WebkitUserSelect: "none" }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onSelectionStart(chartKey, pointerToSecond(event.clientX, event.currentTarget));
          }}
          onPointerMove={(event) => {
            const nextSecond = pointerToSecond(event.clientX, event.currentTarget);
            if (dragSelection?.chartKey === chartKey) {
              onSelectionMove(nextSecond);
              return;
            }
            onHoverChange(nextSecond);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            onSelectionEnd();
          }}
          onPointerLeave={() => {
            if (!dragSelection) {
              onHoverChange(null);
            }
          }}
        >
          <svg viewBox="0 0 1000 300" style={{ width: "100%", height: "300px", overflow: "visible" }} aria-label={`${title} Verlauf`}>
            <rect x="0" y="0" width="1000" height="300" rx="18" fill="#f7fcfa" />
            {yTicks.map((tick, index) => {
              const y = chartTop + chartHeight - ((tick - axisMin) / valueSpan) * chartHeight;
              return (
                <g key={`${title}-y-${index}`}>
                  <line x1={chartLeft} y1={y} x2={chartLeft + chartWidth} y2={y} stroke="#d9e8e2" strokeWidth="1" />
                  <text x={chartLeft - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#5d756f">
                    {tick.toFixed(maxValue - minValue < 10 ? 1 : 0)}
                  </text>
                </g>
              );
            })}
            {timestampTicks.map((tick, index) => {
              const x = chartLeft + (tick.seconds / Math.max(1, totalDuration)) * chartWidth;
              return (
                <g key={`${title}-x-${index}`}>
                  <line x1={x} y1={chartTop} x2={x} y2={chartTop + chartHeight} stroke="#edf4f1" strokeWidth="1" />
                  <text x={x} y={chartTop + chartHeight + 28} textAnchor="middle" fontSize="12" fill="#5d756f">
                    {formatAxisTime(tick.absoluteSeconds)}
                  </text>
                </g>
              );
            })}
            <line x1={chartLeft} y1={chartTop + chartHeight} x2={chartLeft + chartWidth} y2={chartTop + chartHeight} stroke="#8fb7ab" strokeWidth="1.4" />
            <line x1={chartLeft} y1={chartTop} x2={chartLeft} y2={chartTop + chartHeight} stroke="#8fb7ab" strokeWidth="1.4" />
            <g transform={`translate(${chartLeft}, ${chartTop})`}>
              {areaPath ? <path d={areaPath} fill={color} opacity="0.72" /> : null}
              <polyline fill="none" stroke={color} strokeOpacity="0.72" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" points={points} />
            </g>
            {hoverX != null ? <line x1={hoverX} y1={chartTop} x2={hoverX} y2={chartTop + chartHeight} stroke="#2c3e39" strokeWidth="1.2" /> : null}
            {hoverX != null && hoverY != null ? <circle cx={hoverX} cy={hoverY} r="4.5" fill="#ffffff" stroke={color} strokeWidth="2" /> : null}
            <text x={chartLeft + chartWidth / 2} y={chartTop + chartHeight + 56} textAnchor="middle" fontSize="13" fill="#3f5d57">
              Zeitachse
            </text>
          </svg>
          {hoverX != null && hoveredPoint != null ? (
            <div
              style={{
                position: "absolute",
                left: `${(hoverX / 1000) * 100}%`,
                top: "14px",
                transform: "translateX(-50%)",
                background: "#ffffff",
                border: "1px solid rgba(22, 50, 46, 0.14)",
                borderRadius: "0.55rem",
                boxShadow: "0 10px 24px rgba(12, 38, 33, 0.14)",
                padding: "0.35rem 0.5rem",
                pointerEvents: "none",
                whiteSpace: "nowrap",
                fontSize: "0.82rem",
                color: "#16322e",
              }}
            >
              {formatAxisTime(visibleStart + hoveredPoint.elapsed)} | {formatNumber(hoveredPoint.value, 0, suffix)}
            </div>
          ) : null}
          {activeSelection ? (
            <div
              style={{
                position: "absolute",
                top: "18px",
                bottom: "62px",
                left: `${((activeSelection.left - sourceStart) / Math.max(1, sourceEnd - sourceStart)) * 100}%`,
                width: `${((activeSelection.right - activeSelection.left) / Math.max(1, visibleEnd - visibleStart)) * 100}%`,
                background: "rgba(31, 139, 111, 0.14)",
                border: "1px solid rgba(31, 139, 111, 0.45)",
                borderRadius: "0.6rem",
                pointerEvents: "none",
              }}
            />
          ) : null}
        </div>
      ) : (
        <p className="training-note">Noch keine Zeitreihendaten für dieses Diagramm vorhanden.</p>
      )}
    </div>
  );
}

export function ActivityDetailPage() {
  const { activityId } = useParams<{ activityId: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [data, setData] = useState<ActivityDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewRange, setViewRange] = useState<{ start: number; end: number } | null>(null);
  const [dragSelection, setDragSelection] = useState<ZoomSelection | null>(null);
  const [smoothingMode, setSmoothingMode] = useState<SmoothingMode>("raw");
  const [hoverSecond, setHoverSecond] = useState<number | null>(null);

  useEffect(() => {
    async function loadDetail() {
      if (!activityId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`${API_BASE_URL}/activities/${activityId}`);
        const payload = await parseJsonSafely<ActivityDetailResponse | { detail?: string }>(response);
        if (!response.ok || !payload || !("activity" in payload)) {
          throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Aktivität konnte nicht geladen werden.");
        }
        setData(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      } finally {
        setLoading(false);
      }
    }

    void loadDetail();
  }, [activityId]);

  const normalizedRecords = useMemo(() => normalizeRecordTimeline(data?.records ?? []), [data?.records]);
  const totalDuration = normalizedRecords.length ? normalizedRecords[normalizedRecords.length - 1].chart_elapsed_s : 0;
  const viewStart = viewRange?.start ?? 0;
  const viewEnd = viewRange?.end ?? totalDuration;

  useEffect(() => {
    setViewRange(null);
    setDragSelection(null);
    setHoverSecond(null);
  }, [activityId, totalDuration]);

  function handleSelectionStart(chartKey: string, nextSecond: number) {
    setDragSelection({ chartKey, anchor: nextSecond, current: nextSecond });
  }

  function handleSelectionMove(nextSecond: number) {
    setDragSelection((current) => (current ? { ...current, current: nextSecond } : current));
  }

  function handleSelectionEnd() {
    if (!dragSelection) return;
    const start = Math.max(0, Math.min(dragSelection.anchor, dragSelection.current));
    const end = Math.min(totalDuration, Math.max(dragSelection.anchor, dragSelection.current));
    setDragSelection(null);
    if (end - start < 5) return;
    setViewRange({ start, end });
  }

  function resetChartZoom() {
    setViewRange(null);
    setDragSelection(null);
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Aktivität</p>
        <h1>{data?.activity.name ?? "Aktivitätsdetail"}</h1>
        <p className="lead">
          <Link to="/activities/all">Zur Aktivitätenliste</Link>
          {" | "}
          <Link to="/activities/week">Zur Wochenansicht</Link>
        </p>
      </div>

      {loading ? (
        <div className="card">
          <p>Lade Aktivität...</p>
        </div>
      ) : null}
      {error ? (
        <div className="card">
          <p className="error-text">{error}</p>
        </div>
      ) : null}

      {!loading && !error && data ? (
        <div className="settings-tabs-layout">
          <div className="settings-tabs-nav card">
            {TABS.map((tab) => (
              <button key={tab.key} className={`settings-tab-button ${activeTab === tab.key ? "active" : ""}`} type="button" onClick={() => setActiveTab(tab.key)}>
                <strong>{tab.title}</strong>
                <span>{tab.note}</span>
              </button>
            ))}
          </div>

          <div className="settings-tab-panel">
            {activeTab === "general" ? (
              <div className="card">
                <div className="section-title-row">
                  <h2>Allgemeine Infos</h2>
                  <span className="training-note">{data.activity.provider || "-"} | {data.activity.sport || "-"}</span>
                </div>
                <div className="settings-status-grid">
                  <div className="settings-static-field"><strong>Name:</strong>&nbsp;<span>{data.activity.name}</span></div>
                  <div className="settings-static-field"><strong>Start:</strong>&nbsp;<span>{formatDateTime(data.activity.started_at)}</span></div>
                  <div className="settings-static-field"><strong>Dauer:</strong>&nbsp;<span>{data.activity.duration_label || "-"}</span></div>
                  <div className="settings-static-field"><strong>Distanz:</strong>&nbsp;<span>{formatDistanceMeters(data.activity.distance_m)}</span></div>
                  <div className="settings-static-field"><strong>Ø km/h:</strong>&nbsp;<span>{formatNumber(data.activity.avg_speed_kmh, 1)}</span></div>
                  <div className="settings-static-field"><strong>Ø Watt:</strong>&nbsp;<span>{formatNumber(data.activity.avg_power_w, 0, " W")}</span></div>
                  <div className="settings-static-field"><strong>Max Watt:</strong>&nbsp;<span>{formatNumber(data.activity.max_power_w, 0, " W")}</span></div>
                  <div className="settings-static-field"><strong>Ø HF:</strong>&nbsp;<span>{formatNumber(data.activity.avg_hr_bpm, 0, " bpm")}</span></div>
                  <div className="settings-static-field"><strong>Max HF:</strong>&nbsp;<span>{formatNumber(data.activity.max_hr_bpm, 0, " bpm")}</span></div>
                  <div className="settings-static-field"><strong>Max Kadenz:</strong>&nbsp;<span>{formatNumber(data.activity.max_cadence_rpm, 0, " rpm")}</span></div>
                  <div className="settings-static-field"><strong>Max km/h:</strong>&nbsp;<span>{formatNumber(data.activity.max_speed_kmh, 1)}</span></div>
                  <div className="settings-static-field"><strong>Höhe min:</strong>&nbsp;<span>{formatNumber(data.activity.min_altitude_m, 0, " m")}</span></div>
                  <div className="settings-static-field"><strong>Höhe max:</strong>&nbsp;<span>{formatNumber(data.activity.max_altitude_m, 0, " m")}</span></div>
                  <div className="settings-static-field"><strong>Stress:</strong>&nbsp;<span>{formatNumber(data.activity.stress_score, 1)}</span></div>
                  <div className="settings-static-field"><strong>Runden:</strong>&nbsp;<span>{data.activity.laps_count}</span></div>
                  <div className="settings-static-field"><strong>Records:</strong>&nbsp;<span>{data.activity.records_count}</span></div>
                </div>
              </div>
            ) : null}

            {activeTab === "charts" ? (
              <div style={{ display: "grid", gap: "1rem" }}>
                <div className="card">
                  <div className="section-title-row">
                    <h2>Diagramm-Ausschnitt</h2>
                    <div className="settings-actions">
                      <select className="settings-input" value={smoothingMode} onChange={(event) => setSmoothingMode(event.target.value as SmoothingMode)}>
                        <option value="raw">Original</option>
                        <option value="avg3">3s geglättet</option>
                        <option value="avg5">5s geglättet</option>
                        <option value="avg10">10s geglättet</option>
                        <option value="avg30">30s geglättet</option>
                        <option value="avg60">1min geglättet</option>
                      </select>
                      <button className="secondary-button" type="button" onClick={resetChartZoom} disabled={viewRange === null}>
                        Zoom zurücksetzen
                      </button>
                    </div>
                  </div>
                  <p className="training-note">
                    Ansicht: {formatAxisTime(viewStart)} bis {formatAxisTime(viewEnd)}. Ziehe in einem Diagramm einen Bereich auf, dann zoomen alle Grafiken auf diesen Ausschnitt.
                  </p>
                </div>
                <MiniChart chartKey="hr" title="Herzfrequenz" color="#ff2950" records={normalizedRecords} pick={(row) => row.heart_rate_bpm} suffix=" bpm" smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
                <MiniChart chartKey="power" title="Watt" color="#6cc63f" records={normalizedRecords} pick={(row) => row.power_w} suffix=" W" smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
                <MiniChart chartKey="cadence" title="Trittfrequenz" color="#f39a1f" records={normalizedRecords} pick={(row) => row.cadence_rpm} suffix=" rpm" smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
                <MiniChart chartKey="speed" title="Geschwindigkeit" color="#5ab1f3" records={normalizedRecords} pick={(row) => row.speed_kmh} suffix=" km/h" smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
                <MiniChart chartKey="altitude" title="Höhe" color="#8db4e8" records={normalizedRecords} pick={(row) => row.altitude_m} suffix=" m" smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
              </div>
            ) : null}

            {activeTab === "laps" ? (
              <div style={{ display: "grid", gap: "1rem" }}>
                <div className="card rides-table-wrap">
                  <div className="table-toolbar">
                    <h2>Runden</h2>
                  </div>
                  <div className="table-scroll">
                    <table className="rides-table">
                      <thead>
                        <tr>
                          <th>Runde</th>
                          <th>Start</th>
                          <th>Dauer</th>
                          <th>Distanz</th>
                          <th>Ø km/h</th>
                          <th>Ø Watt</th>
                          <th>Max Watt</th>
                          <th>Ø HF</th>
                          <th>Max HF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.laps.length === 0 ? (
                          <tr>
                            <td colSpan={9}>Noch keine Rundendaten vorhanden.</td>
                          </tr>
                        ) : (
                          data.laps.map((lap) => (
                            <tr key={lap.lap_index}>
                              <td>{lap.lap_index}</td>
                              <td>{formatDateTime(lap.start_time)}</td>
                              <td>{lap.duration_label ?? formatSeconds(lap.total_timer_time_s ?? lap.total_elapsed_time_s)}</td>
                              <td>{formatDistanceMeters(lap.total_distance_m)}</td>
                              <td>{formatNumber(lap.avg_speed_kmh, 1)}</td>
                              <td>{formatNumber(lap.avg_power_w, 0, " W")}</td>
                              <td>{formatNumber(lap.max_power_w, 0, " W")}</td>
                              <td>{formatNumber(lap.avg_hr_bpm, 0, " bpm")}</td>
                              <td>{formatNumber(lap.max_hr_bpm, 0, " bpm")}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card rides-table-wrap">
                  <div className="table-toolbar">
                    <h2>Sessions</h2>
                  </div>
                  <div className="table-scroll">
                    <table className="rides-table">
                      <thead>
                        <tr>
                          <th>Session</th>
                          <th>Start</th>
                          <th>Dauer</th>
                          <th>Distanz</th>
                          <th>Ø km/h</th>
                          <th>Ø Watt</th>
                          <th>Ø HF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sessions.length === 0 ? (
                          <tr>
                            <td colSpan={7}>Noch keine Sessiondaten vorhanden.</td>
                          </tr>
                        ) : (
                          data.sessions.map((session) => (
                            <tr key={session.session_index}>
                              <td>{session.session_index + 1}</td>
                              <td>{formatDateTime(session.start_time)}</td>
                              <td>{formatSeconds(session.total_timer_time_s ?? session.total_elapsed_time_s)}</td>
                              <td>{formatDistanceMeters(session.total_distance_m)}</td>
                              <td>{formatNumber(session.avg_speed_kmh, 1)}</td>
                              <td>{formatNumber(session.avg_power_w, 0, " W")}</td>
                              <td>{formatNumber(session.avg_hr_bpm, 0, " bpm")}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "analysis" ? (
              <div className="card">
                <div className="section-title-row">
                  <h2>Trainingsanalyse</h2>
                </div>
                <p className="training-note">
                  Diese Sektion ist als nächster Schritt vorgesehen. Hier können wir später Zonen, Intervalle, Belastungsblöcke und eine zeitbezogene Analyse mit FTP und MaxHF einbauen.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
