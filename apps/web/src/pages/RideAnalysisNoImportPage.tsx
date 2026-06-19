import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { apiFetch } from "../api";
import { API_BASE_URL, MAP_MAX_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "../config";

type RideSeriesPoint = {
  offset_seconds: number | null;
  distance_m: number | null;
  altitude_m: number | null;
  speed_kmh: number | null;
  heart_rate_bpm: number | null;
  power_w: number | null;
  cadence_rpm: number | null;
};

type RideLap = {
  index: number;
  start_time: string | null;
  duration_seconds: number | null;
  distance_m: number | null;
  avg_power_w: number | null;
  max_power_w: number | null;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
  avg_cadence_rpm: number | null;
};

type RideMapPoint = {
  lat: number;
  lon: number;
  offset_seconds: number | null;
  distance_m: number | null;
  altitude_m: number | null;
};

type RideAnalysisResponse = {
  source_file_name: string;
  analyzed_file_name: string;
  detected_format: string;
  activity: {
    name: string;
    sport: string | null;
    sub_sport: string | null;
    device: Record<string, string | number | boolean | null>;
  };
  summary: {
    start_time: string | null;
    end_time: string | null;
    duration_seconds: number | null;
    distance_m: number | null;
    avg_speed_kmh: number | null;
    max_speed_kmh: number | null;
    ascent_m: number | null;
    descent_m: number | null;
    avg_power_w: number | null;
    max_power_w: number | null;
    avg_hr_bpm: number | null;
    max_hr_bpm: number | null;
    avg_cadence_rpm: number | null;
    max_cadence_rpm: number | null;
    calories: number | null;
  };
  samples: {
    records: number;
    gps_points: number;
    altitude_points: number;
    heart_rate_points: number;
    power_points: number;
    cadence_points: number;
    laps: number;
  };
  bounds: {
    min_lat: number | null;
    max_lat: number | null;
    min_lon: number | null;
    max_lon: number | null;
  } | null;
  map_points?: RideMapPoint[];
  laps: RideLap[];
  series: RideSeriesPoint[];
};

type ChartMetric = {
  key: "altitude_m" | "heart_rate_bpm" | "power_w" | "speed_kmh";
  label: string;
  color: string;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { detail: text } as T;
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(value: number | null | undefined): string {
  if (value == null) return "-";
  const safe = Math.max(0, Math.round(value));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDistance(value: number | null | undefined): string {
  if (value == null) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(1)} km`;
  return `${Math.round(value)} m`;
}

function formatNumber(value: number | null | undefined, suffix = "", digits = 0): string {
  if (value == null) return "-";
  const formatted = new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function metricValue(point: RideSeriesPoint, key: ChartMetric["key"]): number | null {
  const value = point[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildPolyline(series: RideSeriesPoint[], metric: ChartMetric): string {
  const points = series
    .map((point, index) => ({ index, value: metricValue(point, metric.key) }))
    .filter((point): point is { index: number; value: number } => point.value !== null);
  if (points.length < 2) return "";

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const width = 1000;
  const height = 240;
  const maxIndex = Math.max(series.length - 1, 1);

  return points
    .map((point) => {
      const x = (point.index / maxIndex) * width;
      const y = height - ((point.value - min) / span) * (height - 28) - 14;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function RideSeriesChart({ series }: { series: RideSeriesPoint[] }) {
  const metrics: ChartMetric[] = [
    { key: "altitude_m", label: "Hoehe", color: "#2563eb" },
    { key: "heart_rate_bpm", label: "HF", color: "#d84c67" },
    { key: "power_w", label: "Power", color: "#0f9f8f" },
    { key: "speed_kmh", label: "Speed", color: "#9a6a18" },
  ];
  const availableMetrics = metrics
    .map((metric) => ({ ...metric, line: buildPolyline(series, metric) }))
    .filter((metric) => metric.line);

  if (availableMetrics.length === 0) {
    return <p className="training-note">Keine Verlaufsdaten fuer eine Grafik gefunden.</p>;
  }

  return (
    <div className="ride-analysis-chart-wrap">
      <svg className="ride-analysis-chart" viewBox="0 0 1000 240" role="img" aria-label="Ride Verlauf">
        <line x1="0" y1="60" x2="1000" y2="60" />
        <line x1="0" y1="120" x2="1000" y2="120" />
        <line x1="0" y1="180" x2="1000" y2="180" />
        {availableMetrics.map((metric) => (
          <polyline key={metric.key} points={metric.line} style={{ stroke: metric.color }} />
        ))}
      </svg>
      <div className="ride-analysis-legend">
        {availableMetrics.map((metric) => (
          <span key={metric.key}>
            <i style={{ background: metric.color }} />
            {metric.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function isValidMapPoint(point: RideMapPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
  );
}

function mapPointToTuple(point: RideMapPoint): LatLngTuple {
  return [point.lat, point.lon];
}

function RideMapViewport({ points }: { points: LatLngTuple[] }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize();
      if (points.length === 1) {
        map.setView(points[0], 13);
      } else {
        map.fitBounds(points as LatLngBoundsExpression, { padding: [28, 28] });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [map, points]);

  return null;
}

function RideAnalysisMap({ points }: { points: RideMapPoint[] }) {
  const routePoints = useMemo(() => points.filter(isValidMapPoint).map(mapPointToTuple), [points]);

  if (!routePoints.length) {
    return <p className="training-note">Keine GPS-Daten fuer eine Kartenansicht gefunden.</p>;
  }

  const startPoint = routePoints[0];
  const finishPoint = routePoints[routePoints.length - 1];
  return (
    <MapContainer className="ride-analysis-map" center={startPoint} zoom={13} scrollWheelZoom>
      <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} />
      <RideMapViewport points={routePoints} />
      {routePoints.length > 1 ? (
        <Polyline positions={routePoints} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.9 }} />
      ) : null}
      <CircleMarker center={startPoint} radius={7} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#0f9f8f", fillOpacity: 1 }} />
      <CircleMarker center={finishPoint} radius={7} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#d84c67", fillOpacity: 1 }} />
    </MapContainer>
  );
}

export function RideAnalysisNoImportPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<RideAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function analyzeFile(file: File) {
    setSelectedFile(file);
    setLoading(true);
    setError(null);
    setMessage(`Analysiere ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiFetch(`${API_BASE_URL}/ride-analysis/no-import/analyze`, {
        method: "POST",
        body: formData,
      });
      const payload = await parseJsonSafely<RideAnalysisResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? `${payload.detail} (${response.status})`
            : `Ride konnte nicht analysiert werden (${response.status}).`,
        );
      }
      const next = payload as RideAnalysisResponse;
      setAnalysis(next);
      setMessage(`Analyse fertig: ${next.analyzed_file_name}`);
    } catch (err) {
      setAnalysis(null);
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    await analyzeFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void analyzeFile(file);
  }

  const metricCards = useMemo(() => {
    if (!analysis) return [];
    return [
      { label: "Start", value: formatDateTime(analysis.summary.start_time) },
      { label: "Dauer", value: formatDuration(analysis.summary.duration_seconds) },
      { label: "Distanz", value: formatDistance(analysis.summary.distance_m) },
      { label: "Hoehenmeter", value: formatNumber(analysis.summary.ascent_m, "m") },
      { label: "Avg Speed", value: formatNumber(analysis.summary.avg_speed_kmh, "km/h", 1) },
      { label: "Max Speed", value: formatNumber(analysis.summary.max_speed_kmh, "km/h", 1) },
      { label: "Avg HF", value: formatNumber(analysis.summary.avg_hr_bpm, "bpm") },
      { label: "Max HF", value: formatNumber(analysis.summary.max_hr_bpm, "bpm") },
      { label: "Avg Power", value: formatNumber(analysis.summary.avg_power_w, "W") },
      { label: "Max Power", value: formatNumber(analysis.summary.max_power_w, "W") },
      { label: "Avg Cadence", value: formatNumber(analysis.summary.avg_cadence_rpm, "rpm") },
      { label: "Kalorien", value: formatNumber(analysis.summary.calories, "kcal") },
    ];
  }, [analysis]);
  const mapPoints = analysis?.map_points ?? [];

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Tools</p>
        <h1>Analyse Ride (no import)</h1>
        <p className="lead">
          FIT, GPX oder TCX hochladen und nur eine Uebersicht ansehen. Es wird nichts importiert oder gespeichert.
        </p>
      </div>

      <div className="ride-analysis-layout">
        <div className="card">
          <div className="section-title-row">
            <h2>Datei</h2>
          </div>
          <div
            className={`ride-analysis-dropzone ${dragActive ? "is-drag-active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              className="ride-analysis-file-input"
              type="file"
              accept=".fit,.gpx,.tcx,.zip,.gz,application/zip,application/gzip"
              onChange={(event) => void handleFileChange(event)}
            />
            <div className="ride-analysis-dropzone-copy">
              <strong>{selectedFile ? selectedFile.name : "Ride-Datei ablegen"}</strong>
              <span>FIT, GPX, TCX, ZIP oder GZIP</span>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Auswaehlen
            </button>
          </div>
          <div className="settings-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={!selectedFile || loading}
              onClick={() => (selectedFile ? void analyzeFile(selectedFile) : undefined)}
            >
              {loading ? "Analysiere..." : "Datei erneut analysieren"}
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {message ? <p className="info-text">{message}</p> : null}
        </div>

        {analysis ? (
          <>
            <div className="card">
              <div className="section-title-row fit-section-head">
                <div>
                  <h2>{analysis.activity.name}</h2>
                  <p className="training-note">
                    {analysis.detected_format} - {analysis.activity.sub_sport || analysis.activity.sport || "Sport unbekannt"}
                  </p>
                </div>
                <span className="fit-repair-pill fit-file-pill" title={analysis.analyzed_file_name}>
                  {analysis.analyzed_file_name}
                </span>
              </div>
              <div className="training-mini-grid ride-analysis-summary-grid">
                {metricCards.map((item) => (
                  <div className="training-mini-card" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="section-title-row">
                <h2>Karte</h2>
                <span className="fit-repair-pill">{mapPoints.length} GPS Punkte</span>
              </div>
              <RideAnalysisMap points={mapPoints} />
            </div>

            <div className="card">
              <div className="section-title-row">
                <h2>Verlauf</h2>
                <span className="fit-repair-pill">{analysis.series.length} Punkte</span>
              </div>
              <RideSeriesChart series={analysis.series} />
            </div>

            <div className="card">
              <div className="section-title-row">
                <h2>Datei & Daten</h2>
              </div>
              <div className="ride-analysis-detail-grid">
                <div className="settings-status-chip">
                  <span>Quelle</span>
                  <strong>{analysis.source_file_name}</strong>
                  <small>{analysis.detected_format}</small>
                </div>
                <div className="settings-status-chip">
                  <span>Records</span>
                  <strong>{analysis.samples.records}</strong>
                  <small>{analysis.samples.gps_points} GPS Punkte</small>
                </div>
                <div className="settings-status-chip">
                  <span>Sensoren</span>
                  <strong>
                    {analysis.samples.heart_rate_points > 0 ? "HF " : ""}
                    {analysis.samples.power_points > 0 ? "Power " : ""}
                    {analysis.samples.cadence_points > 0 ? "Cadence" : ""}
                    {analysis.samples.heart_rate_points + analysis.samples.power_points + analysis.samples.cadence_points === 0 ? "-" : ""}
                  </strong>
                  <small>{analysis.samples.altitude_points} Hoehenpunkte</small>
                </div>
                <div className="settings-status-chip">
                  <span>Bounds</span>
                  <strong>{analysis.bounds ? `${analysis.bounds.min_lat} / ${analysis.bounds.min_lon}` : "-"}</strong>
                  <small>{analysis.bounds ? `${analysis.bounds.max_lat} / ${analysis.bounds.max_lon}` : "Keine GPS Bounds"}</small>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-title-row">
                <h2>Laps</h2>
                <span className="fit-repair-pill">{analysis.laps.length}</span>
              </div>
              {analysis.laps.length === 0 ? (
                <p className="training-note">Keine Lap-Daten in der Datei gefunden.</p>
              ) : (
                <div className="table-scroll">
                  <table className="ride-analysis-lap-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Start</th>
                        <th>Dauer</th>
                        <th>Distanz</th>
                        <th>Avg HF</th>
                        <th>Avg W</th>
                        <th>Cadence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.laps.map((lap) => (
                        <tr key={`${lap.index}-${lap.start_time ?? "lap"}`}>
                          <td>{lap.index}</td>
                          <td>{formatDateTime(lap.start_time)}</td>
                          <td>{formatDuration(lap.duration_seconds)}</td>
                          <td>{formatDistance(lap.distance_m)}</td>
                          <td>{formatNumber(lap.avg_hr_bpm, "bpm")}</td>
                          <td>{formatNumber(lap.avg_power_w, "W")}</td>
                          <td>{formatNumber(lap.avg_cadence_rpm, "rpm")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
