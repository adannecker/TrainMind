import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { apiFetch } from "../api";
import { API_BASE_URL, MAP_MAX_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "../config";

type EnhanceRecord = {
  offset_seconds: number;
  altitude_m: number | null;
  power_w: number | null;
  heart_rate_bpm: number | null;
  distance_m: number | null;
  speed_kmh: number | null;
  lat: number | null;
  lon: number | null;
};

type EnhanceInspect = {
  file_name: string;
  start_time: string;
  duration_seconds: number;
  record_count: number;
  records: EnhanceRecord[];
};

type MetricKey = "altitude_m" | "power_w" | "heart_rate_bpm";

type EnhanceSummary = {
  duration_seconds: number;
  segment_duration_seconds: number;
  segment_avg_power_after: number | null;
};

const metrics: Array<{ key: MetricKey; label: string; unit: string; color: string }> = [
  { key: "altitude_m", label: "Höhenprofil", unit: "m", color: "#377cc6" },
  { key: "power_w", label: "Watt", unit: "W", color: "#e18b2d" },
  { key: "heart_rate_bpm", label: "HF", unit: "bpm", color: "#d84c67" },
];

function formatSeconds(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function averagePower(records: EnhanceRecord[], start: number, end: number): number | null {
  const values = records
    .filter((record) => record.offset_seconds >= start && record.offset_seconds <= end && record.power_w !== null)
    .map((record) => Number(record.power_w));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function parseFilename(value: string | null): string | null {
  const match = /filename="([^"]+)"/i.exec(value ?? "");
  return match?.[1] ?? null;
}

function EnhanceMapViewport({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const frame = requestAnimationFrame(() => {
      map.invalidateSize();
      if (points.length > 1) map.fitBounds(points as LatLngBoundsExpression, { padding: [28, 28] });
      else map.setView(points[0], 13);
    });
    return () => cancelAnimationFrame(frame);
  }, [map, points]);
  return null;
}

function EnhanceMap({ records, start, end }: { records: EnhanceRecord[]; start: number; end: number }) {
  const points = useMemo(
    () => records.filter((row) => row.lat !== null && row.lon !== null).map((row) => [Number(row.lat), Number(row.lon)] as LatLngTuple),
    [records],
  );
  const selected = useMemo(
    () => records.filter((row) => row.offset_seconds >= start && row.offset_seconds <= end && row.lat !== null && row.lon !== null).map((row) => [Number(row.lat), Number(row.lon)] as LatLngTuple),
    [end, records, start],
  );
  if (!points.length) return <p className="training-note">Diese FIT-Datei enthält keine GPS-Daten für die Karte.</p>;
  return <MapContainer className="enhance-fit-map" center={points[0]} zoom={13} scrollWheelZoom>
    <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} />
    <EnhanceMapViewport points={points} />
    {points.length > 1 ? <Polyline positions={points} pathOptions={{ color: "#438a77", weight: 5, opacity: 0.78 }} /> : null}
    {selected.length > 1 ? <Polyline positions={selected} pathOptions={{ color: "#f18f36", weight: 8, opacity: 0.92 }} /> : null}
    <CircleMarker center={points[0]} radius={6} pathOptions={{ color: "#fff", weight: 3, fillColor: "#1f8b6f", fillOpacity: 1 }} />
    <CircleMarker center={points[points.length - 1]} radius={6} pathOptions={{ color: "#fff", weight: 3, fillColor: "#d84c67", fillOpacity: 1 }} />
  </MapContainer>;
}

type ChartDrag = { mode: "select" | "zoom" | "start-edge" | "end-edge"; anchor: number };

function SelectableChart({ metric, records, start, end, viewStart, viewEnd, onSelect, onZoom }: {
  metric: typeof metrics[number]; records: EnhanceRecord[]; start: number; end: number; viewStart: number; viewEnd: number;
  onSelect: (start: number, end: number) => void; onZoom: (start: number, end: number) => void;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<ChartDrag | null>(null);
  const visibleRecords = useMemo(() => records.filter((record) => record.offset_seconds >= viewStart && record.offset_seconds <= viewEnd), [records, viewEnd, viewStart]);
  const points = useMemo(() => visibleRecords.map((record) => ({ time: record.offset_seconds, value: record[metric.key] })).filter((point): point is { time: number; value: number } => typeof point.value === "number" && Number.isFinite(point.value)), [metric.key, visibleRecords]);
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const valueSpan = Math.max(1, max - min);
  const timeSpan = Math.max(1, viewEnd - viewStart);
  const line = points.map((point) => `${((point.time - viewStart) / timeSpan) * 1000},${218 - ((point.value - min) / valueSpan) * 190}`).join(" ");
  const toX = (second: number) => ((second - viewStart) / timeSpan) * 1000;
  function second(event: PointerEvent<SVGElement>): number {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return viewStart;
    return Math.round(viewStart + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * timeSpan);
  }
  function begin(event: PointerEvent<SVGSVGElement>) {
    const value = second(event); event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ mode: event.shiftKey ? "zoom" : "select", anchor: value });
    if (!event.shiftKey) onSelect(value, value);
  }
  function beginEdge(event: PointerEvent<SVGLineElement>, mode: "start-edge" | "end-edge") {
    event.stopPropagation(); ref.current?.setPointerCapture(event.pointerId); setDrag({ mode, anchor: second(event) });
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const value = second(event);
    if (drag.mode === "select") onSelect(Math.min(drag.anchor, value), Math.max(drag.anchor, value));
    if (drag.mode === "start-edge") onSelect(Math.min(value, end - 1), end);
    if (drag.mode === "end-edge") onSelect(start, Math.max(value, start + 1));
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const value = second(event);
    if (drag.mode === "zoom" && Math.abs(value - drag.anchor) >= 2) onZoom(Math.min(drag.anchor, value), Math.max(drag.anchor, value));
    else if (drag.mode === "select") onSelect(Math.min(drag.anchor, value), Math.max(drag.anchor, value));
    setDrag(null);
  }
  if (points.length < 2) return <p className="training-note">Keine {metric.label}-Daten im aktuellen Zoom-Bereich vorhanden.</p>;
  const selectedStart = Math.max(start, viewStart);
  const selectedEnd = Math.min(end, viewEnd);
  const hasVisibleSelection = selectedEnd >= selectedStart;
  return <div className="enhance-fit-chart-shell">
    <svg ref={ref} className="enhance-fit-chart" viewBox="0 0 1000 240" role="img" aria-label={`${metric.label} mit Zeitachse; ziehen zum Markieren, Shift plus Ziehen zoomt`} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => setDrag(null)}>
      <line x1="0" y1="58" x2="1000" y2="58" /><line x1="0" y1="118" x2="1000" y2="118" /><line x1="0" y1="178" x2="1000" y2="178" />
      {hasVisibleSelection ? <rect x={toX(selectedStart)} y="0" width={Math.max(2, toX(selectedEnd) - toX(selectedStart))} height="240" fill="rgba(241,143,54,.20)" /> : null}
      <polyline points={line} style={{ stroke: metric.color }} />
      {start >= viewStart && start <= viewEnd ? <line className="enhance-fit-selection-handle" x1={toX(start)} x2={toX(start)} y1="8" y2="232" onPointerDown={(event) => beginEdge(event, "start-edge")} /> : null}
      {end >= viewStart && end <= viewEnd ? <line className="enhance-fit-selection-handle" x1={toX(end)} x2={toX(end)} y1="8" y2="232" onPointerDown={(event) => beginEdge(event, "end-edge")} /> : null}
    </svg>
    <div className="enhance-fit-axis"><span>{formatSeconds(viewStart)}</span><span>{formatSeconds((viewStart + viewEnd) / 2)}</span><span>{formatSeconds(viewEnd)}</span></div>
    <small>{metric.label}: {Math.round(min)}–{Math.round(max)} {metric.unit}. Ziehen markiert; <kbd>Shift</kbd> + Ziehen zoomt. Die orangefarbenen Randgriffe verschieben die Auswahl.</small>
  </div>;
}

export function EnhanceFitFilePage() {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<EnhanceInspect | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(0);
  const [percent, setPercent] = useState(80);
  const [mass, setMass] = useState(83);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savedStats, setSavedStats] = useState<{ duration: number; segment: number; power: number | null } | null>(null);
  const [preview, setPreview] = useState<EnhanceSummary | null>(null);

  async function inspect(nextFile: File) {
    setLoading(true); setError(null); setMessage(null); setSavedStats(null); setPreview(null);
    try {
      const form = new FormData(); form.append("file", nextFile);
      const response = await apiFetch(`${API_BASE_URL}/fit-enhance/inspect`, { method: "POST", body: form });
      const payload = await response.json().catch(() => null) as EnhanceInspect | { detail?: string } | null;
      if (!response.ok) throw new Error(payload && "detail" in payload && payload.detail ? payload.detail : "FIT-Datei konnte nicht gelesen werden.");
      const inspected = payload as EnhanceInspect;
      setFile(nextFile); setData(inspected); setStart(Math.round(inspected.duration_seconds * .25)); setEnd(Math.round(inspected.duration_seconds * .5)); setViewStart(0); setViewEnd(inspected.duration_seconds);
      setMessage(`FIT-Datei geladen: ${inspected.file_name}`);
    } catch (err) { setFile(null); setData(null); setError(err instanceof Error ? err.message : "Unbekannter Fehler"); }
    finally { setLoading(false); }
  }
  async function refreshPreview() {
    if (!file || !data || end <= start) return;
    setLoading(true); setError(null);
    try {
      const form = new FormData(); form.append("file", file); form.append("segment_json", JSON.stringify({ start_second: start, end_second: end, duration_percent: percent })); form.append("system_mass_kg", String(mass));
      const response = await apiFetch(`${API_BASE_URL}/fit-enhance/preview`, { method: "POST", body: form });
      const payload = await response.json().catch(() => null) as EnhanceSummary | { detail?: string } | null;
      if (!response.ok) throw new Error(payload && "detail" in payload && payload.detail ? payload.detail : "Vorschau konnte nicht berechnet werden.");
      setPreview(payload as EnhanceSummary); setMessage("Exakte Vorschau berechnet.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unbekannter Fehler"); } finally { setLoading(false); }
  }

  async function download() {
    if (!file || !data || end <= start) return;
    setSaving(true); setError(null);
    try {
      const form = new FormData(); form.append("file", file); form.append("segment_json", JSON.stringify({ start_second: start, end_second: end, duration_percent: percent })); form.append("system_mass_kg", String(mass));
      const response = await apiFetch(`${API_BASE_URL}/fit-enhance/apply`, { method: "POST", body: form });
      if (!response.ok) { const body = await response.json().catch(() => null) as { detail?: string } | null; throw new Error(body?.detail ?? "FIT-Datei konnte nicht gespeichert werden."); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = parseFilename(response.headers.get("Content-Disposition")) ?? "ride_enhanced.fit"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      const powerValue = Number(response.headers.get("X-TrainMind-Segment-Avg-Power-After"));
      setSavedStats({ duration: Number(response.headers.get("X-TrainMind-Duration-Seconds")), segment: Number(response.headers.get("X-TrainMind-Segment-Duration-Seconds")), power: Number.isFinite(powerValue) ? powerValue : null });
      setMessage("Enhance-FIT gespeichert und heruntergeladen.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unbekannter Fehler"); } finally { setSaving(false); }
  }
  const beforePower = data ? averagePower(data.records, start, end) : null;
  const changedSegment = Math.round(Math.max(0, end - start) * percent / 100);
  const changedDuration = data ? Math.round(data.duration_seconds + changedSegment - (end - start)) : 0;
  return <section className="page"><div className="hero"><p className="eyebrow">Tools · Fit Fixer</p><h1>Enhance FIT File</h1><p className="lead">Einen Abschnitt in der Zeit strecken oder stauchen. Strecke, Höhenmeter und übrige FIT-Daten bleiben erhalten; Geschwindigkeit, Watt und Zusammenfassungen werden passend synchronisiert.</p></div>
    <div className="fit-repair-layout"><div className="card"><h2>FIT-Datei laden</h2><input type="file" accept=".fit,application/octet-stream" onChange={(event: ChangeEvent<HTMLInputElement>) => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void inspect(selected); }} />
      {file ? <p className="training-note">{file.name}</p> : null}{loading ? <p className="info-text">Lade Ride…</p> : null}{error ? <p className="error-text">{error}</p> : null}{message ? <p className="info-text">{message}</p> : null}</div>
    {data ? <><div className="card"><div className="section-title-row"><h2>Ride-Karte</h2><span className="fit-repair-pill">orange = Auswahl</span></div><EnhanceMap records={data.records} start={start} end={end} /></div>
      <div className="card"><div className="section-title-row"><div><h2>Bereich auswählen</h2><p className="training-note">Ansicht: {formatSeconds(viewStart)} – {formatSeconds(viewEnd)}</p></div><div className="enhance-fit-chart-actions"><span className="fit-repair-pill">Auswahl: {formatSeconds(start)} – {formatSeconds(end)}</span><button className="secondary-button" type="button" disabled={viewStart === 0 && viewEnd === data.duration_seconds} onClick={() => { setViewStart(0); setViewEnd(data.duration_seconds); }}>Zoom zurücksetzen</button></div></div>{metrics.map((metric) => <SelectableChart key={metric.key} metric={metric} records={data.records} start={start} end={end} viewStart={viewStart} viewEnd={viewEnd} onSelect={(nextStart, nextEnd) => { setStart(nextStart); setEnd(Math.max(nextStart + 1, nextEnd)); setPreview(null); setSavedStats(null); }} onZoom={(nextStart, nextEnd) => { setViewStart(nextStart); setViewEnd(nextEnd); }} />)}</div>
      <div className="card"><h2>Enhance</h2><div className="enhance-fit-controls"><label>Dauer des Bereichs<input type="number" min="25" max="400" value={percent} onChange={(event) => { setPercent(Math.max(25, Math.min(400, Number(event.target.value) || 25))); setPreview(null); setSavedStats(null); }} /><span>%</span></label><label>Systemgewicht<input type="number" min="40" max="180" value={mass} onChange={(event) => { setMass(Number(event.target.value) || 83); setPreview(null); setSavedStats(null); }} /><span>kg</span></label></div><p className="training-note">{percent} % macht die aktuelle Auswahl von {formatSeconds(end - start)} zu {formatSeconds(changedSegment)}. Mit „Vorschau aktualisieren“ werden Watt unter Einbezug von Geschwindigkeit, Steigung und Fahrwiderstand exakt berechnet.</p>
        <div className="enhance-fit-comparison"><div><span>Kompletter Ride</span><strong>{formatSeconds(data.duration_seconds)} → {formatSeconds(savedStats?.duration ?? preview?.duration_seconds ?? changedDuration)}</strong></div><div><span>Ausgewähltes Segment</span><strong>{formatSeconds(end - start)} → {formatSeconds(savedStats?.segment ?? preview?.segment_duration_seconds ?? changedSegment)}</strong></div><div><span>Ø Segment Watt</span><strong>{beforePower === null ? "–" : `${Math.round(beforePower)} W`} → {(savedStats?.power ?? preview?.segment_avg_power_after) === null ? "Vorschau aktualisieren" : `${Math.round(savedStats?.power ?? preview?.segment_avg_power_after ?? 0)} W`}</strong></div></div>
        <div className="settings-actions"><button className="secondary-button" type="button" disabled={loading || saving || end <= start} onClick={() => void refreshPreview()}>{loading ? "Berechne…" : "Vorschau aktualisieren"}</button><button className="primary-button" type="button" disabled={saving || end <= start || !preview} onClick={() => void download()}>{saving ? "Speichere…" : preview ? "Enhance FIT speichern" : "Zuerst Vorschau aktualisieren"}</button></div></div></> : null}</div></section>;
}
