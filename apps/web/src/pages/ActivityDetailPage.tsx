import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { API_BASE_URL, MAP_MAX_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "../config";
import type { LatLng, LatLngBoundsExpression, LatLngTuple, Map as LeafletMap } from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";

type ActivitySummary = {
  id: number;
  external_id: string;
  name: string;
  provider: string | null;
  sport: string | null;
  environment_label: string | null;
  is_virtual_ride: boolean;
  is_indoor_ride: boolean;
  virtual_platform: string | null;
  likely_power_controlled: boolean;
  environment_note: string | null;
  started_at: string | null;
  duration_s: number | null;
  duration_label: string | null;
  distance_m: number | null;
  avg_speed_kmh: number | null;
  avg_power_w: number | null;
  avg_hr_bpm: number | null;
  max_power_w: number | null;
  max_hr_bpm: number | null;
  normalized_power_w: number | null;
  intensity_factor: number | null;
  variability_index: number | null;
  training_stress_score: number | null;
  calories_kcal: number | null;
  ftp_reference_w: number | null;
  max_hr_reference_bpm: number | null;
  avg_cadence_rpm: number | null;
  max_cadence_rpm: number | null;
  max_speed_kmh: number | null;
  min_altitude_m: number | null;
  max_altitude_m: number | null;
  total_ascent_m: number | null;
  longest_climb_m: number | null;
  moving_time_s: number | null;
  moving_time_label: string | null;
  paused_time_s: number | null;
  paused_time_label: string | null;
  stress_score: number | null;
  achievements_checked_at: string | null;
  achievements_check_version: number | null;
  records_count: number;
  laps_count: number;
  sessions_count: number;
};

type ActivityAchievementMatch = {
  key: string;
  title: string;
  category: string;
  detail: string;
  proof: string | null;
  meta?: {
    bucket_start_w?: number;
    bucket_end_w?: number;
    bucket_label?: string;
    window_key?: string;
    window_label?: string;
    avg_hr_bpm?: number;
    avg_power_w?: number;
    activity_id?: number;
  } | null;
};

type ActivityAchievementAnalysis = {
  checked_scopes?: string[];
  matched?: ActivityAchievementMatch[];
  matched_count?: number;
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
  latitude_deg: number | null;
  longitude_deg: number | null;
  heart_rate_bpm: number | null;
  power_w: number | null;
  speed_mps: number | null;
  speed_kmh: number | null;
  altitude_m: number | null;
  cadence_rpm: number | null;
};

type ActivityDetailResponse = {
  activity: ActivitySummary;
  llm_analysis_status: ActivityLlmStatus;
  llm_analysis: ActivityLlmResponse | null;
  achievement_analysis?: ActivityAchievementAnalysis | null;
  sessions: ActivitySessionRow[];
  laps: ActivityLapRow[];
  records: ActivityRecordRow[];
};

type ActivityLlmFactRow = {
  label: string;
  value: string;
  fact: string;
};

type ActivityLlmResponse = {
  activity_id: number;
  activity_name: string;
  generated_at: string;
  model: string;
  analysis_version: number;
  current_version: number;
  from_cache: boolean;
  is_current: boolean;
  has_newer_version: boolean;
  context_snapshot: {
    records_count: number;
    laps_count: number;
    sessions_count: number;
    ftp_reference_w: number | null;
    max_hr_reference_bpm: number | null;
    environment_label: string | null;
    is_virtual_ride: boolean;
    virtual_platform: string | null;
    likely_power_controlled: boolean;
  };
  analysis: {
    headline: string;
    summary: string;
    deep_analysis: string[];
    numbers_and_facts: ActivityLlmFactRow[];
    performance_signals: string[];
    coaching_recommendations: string[];
    todo: string[];
  };
};

type ActivityLlmStatus = {
  available: boolean;
  analysis_version: number | null;
  current_version: number;
  is_current: boolean;
  has_newer_version: boolean;
  generated_at: string | null;
  model: string | null;
};

type ActivityMetricItem = {
  label: string;
  value: string;
  help?: string;
};

type ActivityMetricCardData = {
  primary: ActivityMetricItem;
  secondary?: ActivityMetricItem;
};

type ActivityMetricSection = {
  title: string;
  note: string;
  cards: ActivityMetricCardData[];
};

type TabKey = "general" | "map" | "charts" | "laps" | "analysis" | "llm" | "achievements";
type ZoomSelection = {
  chartKey: string;
  anchor: number;
  current: number;
};
type DistanceSelection = {
  anchor: number;
  current: number;
};
type DistanceRange = {
  start: number;
  end: number;
};
type SmoothingMode = "raw" | "avg3" | "avg5" | "avg10" | "avg30" | "avg60";
type ChartPoint = {
  elapsed: number;
  value: number;
};
type MapMetricKey = "power" | "hr" | "cadence" | "speed";
type RoutePoint = {
  elapsed: number;
  distanceM: number;
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  altitudeM: number | null;
  powerW: number | null;
  heartRateBpm: number | null;
  speedKmh: number | null;
  cadenceRpm: number | null;
  gradePct: number | null;
};

const ACHIEVEMENT_CATEGORY_ORDER = ["hf", "records", "distance", "weekly", "zones", "moments"] as const;
const HF_WINDOW_ORDER: Record<string, number> = {
  "5m": 0,
  "10m": 1,
  "15m": 2,
  "20m": 3,
  "30m": 4,
  "45m": 5,
  "60m": 6,
};
const MAP_METRIC_OPTIONS: Array<{ key: MapMetricKey; label: string; color: string; suffix: string; digits: number; pick: (point: RoutePoint) => number | null }> = [
  { key: "power", label: "Watt", color: "#6cc63f", suffix: " W", digits: 0, pick: (point) => point.powerW },
  { key: "hr", label: "Herzfrequenz", color: "#ff2950", suffix: " bpm", digits: 0, pick: (point) => point.heartRateBpm },
  { key: "cadence", label: "Kadenz", color: "#f39a1f", suffix: " rpm", digits: 0, pick: (point) => point.cadenceRpm },
  { key: "speed", label: "Geschwindigkeit", color: "#5ab1f3", suffix: " km/h", digits: 1, pick: (point) => point.speedKmh },
];

function achievementCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    hf: "HF",
    records: "Rekorde",
    distance: "Ausdauer",
    weekly: "Wochen",
    zones: "Zonen",
    moments: "Momente",
  };
  return labels[category] ?? category;
}

function compactHfWindowLabel(item: ActivityAchievementMatch): string {
  if (item.meta?.window_label) return item.meta.window_label;
  const match = item.title.match(/(\d+\s*(?:min|m|s))/i);
  return match?.[1] ?? item.title;
}

function compactHfValueLabel(item: ActivityAchievementMatch): string {
  if (typeof item.meta?.avg_hr_bpm === "number") {
    return `Ø ${Math.round(item.meta.avg_hr_bpm)} bpm`;
  }
  const match = (item.proof ?? "").match(/(\d+(?:[.,]\d+)?)\s*bpm/i);
  if (match) {
    return `Ø ${Math.round(Number(match[1].replace(",", ".")))} bpm`;
  }
  return "HF";
}

const TABS: Array<{ key: TabKey; title: string; note: string }> = [
  { key: "general", title: "Allgemeine Infos", note: "Kernwerte und Metadaten" },
  { key: "map", title: "Karte", note: "Track und GPS Verlauf" },
  { key: "charts", title: "Diagramme", note: "HF, Watt und Verlauf" },
  { key: "laps", title: "Runden", note: "Laps und Sessions" },
  { key: "analysis", title: "Trainingsanalyse", note: "Deterministisch und regelbasiert" },
  { key: "llm", title: "LLM Analyse", note: "Tiefenanalyse und Coaching" },
  { key: "achievements", title: "Achievements", note: "Ride-Checks und Treffer" },
];
async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function formatAnalysisVersion(value: number | null): string {
  return value == null ? "-" : `v${value}`;
}

function buildLlmStatusFromAnalysis(analysis: ActivityLlmResponse): ActivityLlmStatus {
  return {
    available: true,
    analysis_version: analysis.analysis_version,
    current_version: analysis.current_version,
    is_current: analysis.is_current,
    has_newer_version: analysis.has_newer_version,
    generated_at: analysis.generated_at,
    model: analysis.model,
  };
}

function ActivityMetricHelp({ title, description }: { title: string; description: string }) {
  return (
    <span className="activity-metric-help" tabIndex={0} aria-label={`${title}: ${description}`}>
      <span className="activity-metric-help-trigger" aria-hidden="true">
        ?
      </span>
      <span className="activity-metric-help-tooltip" role="tooltip">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
    </span>
  );
}

function ActivityMetricEntry({ label, value, help }: ActivityMetricItem) {
  return (
    <div className="activity-metric-entry">
      <div className="activity-metric-label-row">
        <span className="activity-metric-label">{label}</span>
        {help ? <ActivityMetricHelp title={label} description={help} /> : null}
      </div>
      <strong className="activity-metric-value">{value}</strong>
    </div>
  );
}

function ActivityMetricCard({ primary, secondary }: ActivityMetricCardData) {
  return (
    <div className="activity-metric-card">
      <ActivityMetricEntry {...primary} />
      {secondary ? (
        <>
          <div className="activity-metric-divider" />
          <ActivityMetricEntry {...secondary} />
        </>
      ) : null}
    </div>
  );
}

function ActivityMetricSectionCard({ title, note, cards }: ActivityMetricSection) {
  return (
    <article className="activity-summary-section">
      <div className="activity-summary-head">
        <h3>{title}</h3>
        <span>{note}</span>
      </div>
      <div className="activity-metric-grid">
        {cards.map((card) => (
          <ActivityMetricCard key={`${card.primary.label}-${card.secondary?.label ?? "single"}`} {...card} />
        ))}
      </div>
    </article>
  );
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

function formatAxisDistance(distanceM: number): string {
  if (!Number.isFinite(distanceM)) return "-";
  return `${(distanceM / 1000).toFixed(distanceM >= 10000 ? 0 : 1)} km`;
}

type ChartRecord = ActivityRecordRow & {
  chart_elapsed_s: number;
};

type AxisBounds = {
  min: number;
  max: number;
  axisMin: number;
  axisMax: number;
  span: number;
};

function computeAxisBounds(values: number[]): AxisBounds | null {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rawSpan = max - min;
  const axisMin = rawSpan === 0 ? min - Math.max(1, Math.abs(min) * 0.1) : min - rawSpan * 0.08;
  const axisMax = rawSpan === 0 ? max + Math.max(1, Math.abs(max) * 0.1) : max + rawSpan * 0.08;
  return {
    min,
    max,
    axisMin,
    axisMax,
    span: Math.max(1, axisMax - axisMin),
  };
}

function pointerRatioInPlot(clientX: number, element: HTMLDivElement, plotLeft: number, plotWidth: number, svgWidth = 1000): number {
  const rect = element.getBoundingClientRect();
  const plotLeftPx = rect.width * (plotLeft / svgWidth);
  const plotWidthPx = rect.width * (plotWidth / svgWidth);
  return Math.max(0, Math.min(1, (clientX - rect.left - plotLeftPx) / Math.max(1, plotWidthPx)));
}

function filterPointsByDistanceRange<T extends { distanceM: number }>(points: T[], range: DistanceRange | null): T[] {
  if (!range) return points;
  return points.filter((point) => point.distanceM >= range.start && point.distanceM <= range.end);
}

function buildRoutePoints(records: ChartRecord[]): RoutePoint[] {
  if (!records.length) return [];

  let fallbackDistanceM = 0;
  const base = records.map((row, index) => {
    const rawDistanceM = typeof row.distance_m === "number" && Number.isFinite(row.distance_m) ? row.distance_m : null;
    if (rawDistanceM != null) {
      fallbackDistanceM = rawDistanceM;
    } else if (index > 0) {
      const previous = records[index - 1];
      const elapsedDelta = Math.max(0, row.chart_elapsed_s - previous.chart_elapsed_s);
      const speedMps = row.speed_mps ?? previous.speed_mps ?? 0;
      fallbackDistanceM += Math.max(0, speedMps * elapsedDelta);
    }

    return {
      elapsed: row.chart_elapsed_s,
      distanceM: fallbackDistanceM,
      latitudeDeg: row.latitude_deg,
      longitudeDeg: row.longitude_deg,
      altitudeM: row.altitude_m,
      powerW: row.power_w,
      heartRateBpm: row.heart_rate_bpm,
      speedKmh: row.speed_kmh,
      cadenceRpm: row.cadence_rpm,
      gradePct: null,
    };
  });

  return base.map((point, index) => {
    const left = base[Math.max(0, index - 2)];
    const right = base[Math.min(base.length - 1, index + 2)];
    const altitudeLeft = left?.altitudeM;
    const altitudeRight = right?.altitudeM;
    const distanceDelta = Math.max(0, (right?.distanceM ?? point.distanceM) - (left?.distanceM ?? point.distanceM));
    let gradePct: number | null = null;

    if (altitudeLeft != null && altitudeRight != null && distanceDelta >= 20) {
      gradePct = Math.max(-20, Math.min(20, ((altitudeRight - altitudeLeft) / distanceDelta) * 100));
    }

    return {
      ...point,
      gradePct,
    };
  });
}

function findNearestPointByElapsed<T extends { elapsed: number }>(points: T[], elapsed: number | null): T | null {
  if (elapsed == null || !points.length) return null;
  return points.reduce<T | null>((best, point) => {
    if (best == null) return point;
    return Math.abs(point.elapsed - elapsed) < Math.abs(best.elapsed - elapsed) ? point : best;
  }, null);
}

function findNearestPointByDistance<T extends { distanceM: number }>(points: T[], distanceM: number): T | null {
  if (!points.length) return null;
  return points.reduce<T | null>((best, point) => {
    if (best == null) return point;
    return Math.abs(point.distanceM - distanceM) < Math.abs(best.distanceM - distanceM) ? point : best;
  }, null);
}

function gradeColor(gradePct: number | null): string {
  if (gradePct == null) return "#5c7e76";
  if (gradePct >= 8) return "#c03a2b";
  if (gradePct >= 4) return "#ef8d33";
  if (gradePct <= -8) return "#2d5b93";
  if (gradePct <= -4) return "#5a8ec7";
  return "#1f8b6f";
}

function findNearestMapHoverPoint(map: LeafletMap, points: RoutePoint[], cursorLatLng: LatLng): RoutePoint | null {
  const cursor = map.latLngToContainerPoint(cursorLatLng);
  let bestPoint: RoutePoint | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const point of points) {
    if (point.latitudeDeg == null || point.longitudeDeg == null) continue;
    const projected = map.latLngToContainerPoint([point.latitudeDeg, point.longitudeDeg]);
    const dx = projected.x - cursor.x;
    const dy = projected.y - cursor.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < bestDistanceSquared) {
      bestPoint = point;
      bestDistanceSquared = distanceSquared;
    }
  }

  return bestDistanceSquared <= 24 * 24 ? bestPoint : null;
}

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

function extractTrackPoints(points: RoutePoint[]): LatLngTuple[] {
  return points
    .filter((point) => point.latitudeDeg != null && point.longitudeDeg != null)
    .map((point) => [Number(point.latitudeDeg), Number(point.longitudeDeg)] as LatLngTuple)
    .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180);
}

function ActivityMapViewport({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [28, 28] });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bounds, map]);

  return null;
}

function ActivityMapHoverSync({ points, onHoverChange }: { points: RoutePoint[]; onHoverChange: (nextSecond: number | null) => void }) {
  const map = useMap();

  useMapEvents({
    mousemove(event) {
      const nearest = findNearestMapHoverPoint(map, points, event.latlng);
      onHoverChange(nearest?.elapsed ?? null);
    },
    mouseout() {
      onHoverChange(null);
    },
  });

  return null;
}

type DistanceSeriesPoint = {
  elapsed: number;
  distanceM: number;
  value: number;
  gradePct: number | null;
};

type ProjectedDistanceSeriesPoint = DistanceSeriesPoint & {
  x: number;
  y: number;
};

function buildDistanceSeries(points: RoutePoint[], pick: (point: RoutePoint) => number | null): DistanceSeriesPoint[] {
  return points
    .map((point) => ({
      elapsed: point.elapsed,
      distanceM: point.distanceM,
      value: pick(point),
      gradePct: point.gradePct,
    }))
    .filter((point): point is DistanceSeriesPoint => point.value != null && Number.isFinite(point.value));
}

function projectDistanceSeries(points: DistanceSeriesPoint[], bounds: AxisBounds, width = 900, height = 220): ProjectedDistanceSeriesPoint[] {
  const minDistanceM = Math.min(...points.map((point) => point.distanceM));
  const maxDistanceM = Math.max(...points.map((point) => point.distanceM), 1);
  const distanceSpan = Math.max(1, maxDistanceM - minDistanceM);
  return points.map((point) => ({
    ...point,
    x: ((point.distanceM - minDistanceM) / distanceSpan) * width,
    y: height - ((point.value - bounds.axisMin) / bounds.span) * height,
  }));
}

function buildProjectedAreaPath(points: ProjectedDistanceSeriesPoint[], height = 220): string | null {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  return `${path} L ${end.x.toFixed(1)} ${height.toFixed(1)} L ${start.x.toFixed(1)} ${height.toFixed(1)} Z`;
}

function DistanceChart({
  title,
  subtitle,
  color,
  suffix,
  digits,
  points,
  hoverSecond,
  onHoverChange,
  colorByGrade = false,
  selectedRange = null,
  dragSelection = null,
  selectable = false,
  onSelectionStart,
  onSelectionMove,
  onSelectionEnd,
}: {
  title: string;
  subtitle?: string;
  color: string;
  suffix: string;
  digits: number;
  points: DistanceSeriesPoint[];
  hoverSecond: number | null;
  onHoverChange: (nextSecond: number | null) => void;
  colorByGrade?: boolean;
  selectedRange?: DistanceRange | null;
  dragSelection?: DistanceSelection | null;
  selectable?: boolean;
  onSelectionStart?: (distanceM: number) => void;
  onSelectionMove?: (distanceM: number) => void;
  onSelectionEnd?: () => void;
}) {
  const values = points.map((point) => point.value);
  const bounds = useMemo(() => computeAxisBounds(values), [values]);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const chartLeft = 64;
  const chartTop = 18;
  const chartWidth = 900;
  const chartHeight = 220;
  const plotLeftPercent = (chartLeft / 1000) * 100;
  const plotWidthPercent = (chartWidth / 1000) * 100;
  const minDistanceM = points.length ? Math.min(...points.map((point) => point.distanceM)) : 0;
  const maxDistanceM = points.length ? Math.max(...points.map((point) => point.distanceM), 1) : 1;
  const distanceSpan = Math.max(1, maxDistanceM - minDistanceM);
  const projectedPoints = useMemo(() => (bounds ? projectDistanceSeries(points, bounds, chartWidth, chartHeight) : []), [bounds, points]);
  const areaPath = useMemo(() => buildProjectedAreaPath(projectedPoints, chartHeight), [projectedPoints]);
  const hoveredPoint = useMemo(() => {
    if (hoverSecond == null || !points.length) return null;
    const minElapsed = Math.min(...points.map((point) => point.elapsed));
    const maxElapsed = Math.max(...points.map((point) => point.elapsed));
    if (hoverSecond < minElapsed || hoverSecond > maxElapsed) return null;
    return findNearestPointByElapsed(points, hoverSecond);
  }, [hoverSecond, points]);
  const hoverX = hoveredPoint ? chartLeft + ((hoveredPoint.distanceM - minDistanceM) / distanceSpan) * chartWidth : null;
  const hoverY = hoveredPoint && bounds ? chartTop + chartHeight - ((hoveredPoint.value - bounds.axisMin) / bounds.span) * chartHeight : null;
  const averageY = average != null && bounds ? chartTop + chartHeight - ((average - bounds.axisMin) / bounds.span) * chartHeight : null;
  const yTicks =
    bounds != null
      ? Array.from({ length: 5 }, (_, index) => bounds.min + ((bounds.max - bounds.min) / 4) * index)
      : [];
  const xTicks = Array.from({ length: 5 }, (_, index) => minDistanceM + (distanceSpan / 4) * index);
  const activeSelection =
    dragSelection != null
      ? {
          left: Math.max(minDistanceM, Math.min(dragSelection.anchor, dragSelection.current)),
          right: Math.min(maxDistanceM, Math.max(dragSelection.anchor, dragSelection.current)),
        }
      : null;
  const committedSelection =
    selectedRange != null
      ? {
          left: Math.max(minDistanceM, selectedRange.start),
          right: Math.min(maxDistanceM, selectedRange.end),
        }
      : null;
  const visibleSelection = activeSelection ?? committedSelection;

  function pointerToDistance(clientX: number, element: HTMLDivElement): number {
    const ratio = pointerRatioInPlot(clientX, element, chartLeft, chartWidth);
    return minDistanceM + ratio * distanceSpan;
  }

  if (!points.length || !bounds) {
    return (
      <div className="card">
        <div className="section-title-row">
          <h2>{title}</h2>
        </div>
        <p className="training-note">Für dieses Diagramm sind noch keine ausreichenden Streckendaten vorhanden.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="section-title-row">
        <h2>{title}</h2>
        <span className="training-note">
          Min {formatNumber(bounds.min, digits, suffix)} | Ø {formatNumber(average, digits, suffix)} | Max {formatNumber(bounds.max, digits, suffix)}
        </span>
      </div>
      {subtitle ? <p className="training-note">{subtitle}</p> : null}
      <div
        style={{ position: "relative", touchAction: "none", cursor: "crosshair", userSelect: "none", WebkitUserSelect: "none" }}
        onPointerDown={(event) => {
          if (!selectable || !onSelectionStart) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          onSelectionStart(pointerToDistance(event.clientX, event.currentTarget));
        }}
        onPointerMove={(event) => {
          const nextDistance = pointerToDistance(event.clientX, event.currentTarget);
          if (selectable && dragSelection && onSelectionMove) {
            onSelectionMove(nextDistance);
            return;
          }
          const nearest = findNearestPointByDistance(points, nextDistance);
          onHoverChange(nearest?.elapsed ?? null);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (selectable && onSelectionEnd) {
            onSelectionEnd();
          }
        }}
        onPointerLeave={() => {
          if (!(selectable && dragSelection)) {
            onHoverChange(null);
          }
        }}
      >
        <svg viewBox="0 0 1000 300" style={{ width: "100%", height: "300px", overflow: "visible" }} aria-label={`${title} Verlauf auf Distanzbasis`}>
          <rect x="0" y="0" width="1000" height="300" rx="18" fill="#f7fcfa" />
          {yTicks.map((tick, index) => {
            const y = chartTop + chartHeight - ((tick - bounds.axisMin) / bounds.span) * chartHeight;
            return (
              <g key={`${title}-y-distance-${index}`}>
                <line x1={chartLeft} y1={y} x2={chartLeft + chartWidth} y2={y} stroke="#d9e8e2" strokeWidth="1" />
                <text x={chartLeft - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#5d756f">
                  {tick.toFixed(digits)}
                </text>
              </g>
            );
          })}
          {xTicks.map((tick, index) => {
            const x = chartLeft + (tick / Math.max(1, maxDistanceM)) * chartWidth;
            return (
              <g key={`${title}-x-distance-${index}`}>
                <line x1={x} y1={chartTop} x2={x} y2={chartTop + chartHeight} stroke="#edf4f1" strokeWidth="1" />
                <text x={x} y={chartTop + chartHeight + 28} textAnchor="middle" fontSize="12" fill="#5d756f">
                  {formatAxisDistance(tick)}
                </text>
              </g>
            );
          })}
          <line x1={chartLeft} y1={chartTop + chartHeight} x2={chartLeft + chartWidth} y2={chartTop + chartHeight} stroke="#8fb7ab" strokeWidth="1.4" />
          <line x1={chartLeft} y1={chartTop} x2={chartLeft} y2={chartTop + chartHeight} stroke="#8fb7ab" strokeWidth="1.4" />
          {averageY != null ? (
            <>
              <line x1={chartLeft} y1={averageY} x2={chartLeft + chartWidth} y2={averageY} stroke={color} strokeWidth="1.5" strokeDasharray="8 6" opacity="0.9" />
              <text x={chartLeft + chartWidth - 6} y={averageY - 8} textAnchor="end" fontSize="12" fill="#16322e">
                Ø {formatNumber(average, digits, suffix)}
              </text>
            </>
          ) : null}
          <g transform={`translate(${chartLeft}, ${chartTop})`}>
            {areaPath ? <path d={areaPath} fill={color} opacity={colorByGrade ? 0.1 : 0.16} /> : null}
            {colorByGrade
              ? projectedPoints.slice(0, -1).map((point, index) => {
                  const next = projectedPoints[index + 1];
                  const segmentGrade = ((point.gradePct ?? 0) + (next.gradePct ?? 0)) / 2;
                  return (
                    <line
                      key={`${title}-segment-${index}`}
                      x1={point.x}
                      y1={point.y}
                      x2={next.x}
                      y2={next.y}
                      stroke={gradeColor(segmentGrade)}
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                  );
                })
              : (
                <polyline
                  fill="none"
                  stroke={color}
                  strokeOpacity="0.82"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={projectedPoints.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
                />
              )}
          </g>
          {hoverX != null ? <line x1={hoverX} y1={chartTop} x2={hoverX} y2={chartTop + chartHeight} stroke="#2c3e39" strokeWidth="1.2" /> : null}
          {hoverX != null && hoverY != null ? <circle cx={hoverX} cy={hoverY} r="4.5" fill="#ffffff" stroke={color} strokeWidth="2" /> : null}
          <text x={chartLeft + chartWidth / 2} y={chartTop + chartHeight + 56} textAnchor="middle" fontSize="13" fill="#3f5d57">
            Distanzachse
          </text>
        </svg>
        {hoveredPoint ? (
          <div
            style={{
              position: "absolute",
              left: `${(hoverX! / 1000) * 100}%`,
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
            {formatAxisDistance(hoveredPoint.distanceM)} | {formatNumber(hoveredPoint.value, digits, suffix)}
          </div>
        ) : null}
        {visibleSelection && visibleSelection.right - visibleSelection.left >= 10 ? (
          <div
            style={{
              position: "absolute",
              top: "18px",
              bottom: "62px",
              left: `${plotLeftPercent + ((visibleSelection.left - minDistanceM) / distanceSpan) * plotWidthPercent}%`,
              width: `${((visibleSelection.right - visibleSelection.left) / distanceSpan) * plotWidthPercent}%`,
              background: "rgba(31, 139, 111, 0.12)",
              border: "1px solid rgba(31, 139, 111, 0.45)",
              borderRadius: "0.6rem",
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function ActivityTrackMap({
  routePoints,
  hoverSecond,
  onHoverChange,
  mapMetricKey,
  onMetricChange,
  distanceRange,
  dragSelection,
  onDistanceSelectionStart,
  onDistanceSelectionMove,
  onDistanceSelectionEnd,
  onDistanceSelectionReset,
}: {
  routePoints: RoutePoint[];
  hoverSecond: number | null;
  onHoverChange: (nextSecond: number | null) => void;
  mapMetricKey: MapMetricKey;
  onMetricChange: (nextKey: MapMetricKey) => void;
  distanceRange: DistanceRange | null;
  dragSelection: DistanceSelection | null;
  onDistanceSelectionStart: (distanceM: number) => void;
  onDistanceSelectionMove: (distanceM: number) => void;
  onDistanceSelectionEnd: () => void;
  onDistanceSelectionReset: () => void;
}) {
  const trackPoints = useMemo(() => extractTrackPoints(routePoints), [routePoints]);
  const bounds = useMemo<LatLngBoundsExpression>(() => trackPoints, [trackPoints]);
  const startPoint = trackPoints[0] ?? null;
  const endPoint = trackPoints[trackPoints.length - 1] ?? null;
  const activeRoutePoint = useMemo(() => findNearestPointByElapsed(routePoints, hoverSecond), [hoverSecond, routePoints]);
  const activeMapPoint =
    activeRoutePoint && activeRoutePoint.latitudeDeg != null && activeRoutePoint.longitudeDeg != null
      ? ([activeRoutePoint.latitudeDeg, activeRoutePoint.longitudeDeg] as LatLngTuple)
      : null;
  const selectedMetric = MAP_METRIC_OPTIONS.find((option) => option.key === mapMetricKey) ?? MAP_METRIC_OPTIONS[0];
  const elevationPoints = useMemo(() => buildDistanceSeries(routePoints, (point) => point.altitudeM), [routePoints]);
  const selectedMetricRoutePoints = useMemo(() => filterPointsByDistanceRange(routePoints, distanceRange), [distanceRange, routePoints]);
  const metricPoints = useMemo(() => buildDistanceSeries(selectedMetricRoutePoints, selectedMetric.pick), [selectedMetricRoutePoints, selectedMetric]);
  const previewRange =
    dragSelection != null
      ? {
          start: Math.min(dragSelection.anchor, dragSelection.current),
          end: Math.max(dragSelection.anchor, dragSelection.current),
        }
      : distanceRange;
  const selectedTrackPoints = useMemo(() => {
    if (!previewRange) return [];
    return extractTrackPoints(
      routePoints.filter(
        (point) =>
          point.distanceM >= previewRange.start &&
          point.distanceM <= previewRange.end &&
          point.latitudeDeg != null &&
          point.longitudeDeg != null,
      ),
    );
  }, [previewRange, routePoints]);
  const distanceRangeLabel =
    distanceRange != null ? `${formatAxisDistance(distanceRange.start)} bis ${formatAxisDistance(distanceRange.end)}` : "kein Ausschnitt gesetzt";

  if (trackPoints.length < 2) {
    return (
      <div className="card">
        <div className="section-title-row">
          <h2>Karte</h2>
          <span className="training-note">Noch keine GPS-Punkte für diese Aktivität vorhanden</span>
        </div>
        <p className="training-note">
          Für die OpenStreetMap-Einbettung brauchen wir Positionsdaten in den Records. Sobald Latitude und Longitude aus dem FIT oder vom Provider vorliegen, wird hier automatisch die Strecke angezeigt.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="card">
        <div className="section-title-row">
          <h2>Karte</h2>
          <span className="training-note">OpenStreetMap | {trackPoints.length} GPS-Punkte</span>
        </div>
        <div className="activity-map-shell">
          <MapContainer className="activity-leaflet-map" center={trackPoints[0]} zoom={13} scrollWheelZoom>
            <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} />
            <Polyline positions={trackPoints} pathOptions={{ color: "#1f8b6f", weight: 5, opacity: 0.92 }} />
            {selectedTrackPoints.length >= 2 ? <Polyline positions={selectedTrackPoints} pathOptions={{ color: "#ef8d33", weight: 7, opacity: 0.88 }} /> : null}
            {startPoint ? <CircleMarker center={startPoint} radius={7} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#1f8b6f", fillOpacity: 1 }} /> : null}
            {endPoint ? <CircleMarker center={endPoint} radius={7} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#ef8d33", fillOpacity: 1 }} /> : null}
            {activeMapPoint ? <CircleMarker center={activeMapPoint} radius={8} pathOptions={{ color: "#16322e", weight: 2, fillColor: "#ffffff", fillOpacity: 0.98 }} /> : null}
            <ActivityMapViewport bounds={bounds} />
            <ActivityMapHoverSync points={routePoints} onHoverChange={onHoverChange} />
          </MapContainer>
        </div>
        <div className="activity-map-meta-row">
          <span className="activity-map-badge">Start</span>
          <span className="activity-map-badge activity-map-badge-finish">Ziel</span>
          <span className="activity-map-note">Aktuell werden die Tiles direkt von OpenStreetMap geladen. Bei größerer Nutzung kannst du die Quelle per `.env` umstellen.</span>
        </div>
        <div className="training-mini-grid activity-map-point-grid">
          <div className="training-mini-card">
            <span>Trackpunkt</span>
            <strong>{activeRoutePoint ? formatAxisDistance(activeRoutePoint.distanceM) : "-"}</strong>
          </div>
          <div className="training-mini-card">
            <span>Höhe</span>
            <strong>{activeRoutePoint ? formatNumber(activeRoutePoint.altitudeM, 0, " m") : "-"}</strong>
          </div>
          <div className="training-mini-card">
            <span>Steigung</span>
            <strong>{activeRoutePoint ? formatNumber(activeRoutePoint.gradePct, 1, " %") : "-"}</strong>
          </div>
          <div className="training-mini-card">
            <span>{selectedMetric.label}</span>
            <strong>{activeRoutePoint ? formatNumber(selectedMetric.pick(activeRoutePoint), selectedMetric.digits, selectedMetric.suffix) : "-"}</strong>
          </div>
        </div>
      </div>

      <DistanceChart
        title="Höhenprofil"
        subtitle="Strecke in der Höhe, farblich nach lokaler Steigung eingefärbt. Ziehe hier einen Ausschnitt auf, dann wird die Strecke auf der Karte markiert."
        color="#8db4e8"
        suffix=" m"
        digits={0}
        points={elevationPoints}
        hoverSecond={hoverSecond}
        onHoverChange={onHoverChange}
        colorByGrade
        selectedRange={distanceRange}
        dragSelection={dragSelection}
        selectable
        onSelectionStart={onDistanceSelectionStart}
        onSelectionMove={onDistanceSelectionMove}
        onSelectionEnd={onDistanceSelectionEnd}
      />

      <div className="card">
        <div className="section-title-row">
          <h2>Streckendiagramm</h2>
          <div className="settings-actions">
            <select className="settings-input" value={mapMetricKey} onChange={(event) => onMetricChange(event.target.value as MapMetricKey)}>
              {MAP_METRIC_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className="secondary-button" type="button" onClick={onDistanceSelectionReset} disabled={distanceRange == null}>
              Ausschnitt zurücksetzen
            </button>
          </div>
        </div>
        <p className="training-note">Wähle aus, welche Größe direkt unter der Karte entlang der Strecke dargestellt werden soll. Hover auf Karte oder Diagramm synchronisiert den Trackpunkt. Aktueller Ausschnitt: {distanceRangeLabel}.</p>
      </div>

      <DistanceChart
        title={`${selectedMetric.label} entlang der Strecke`}
        color={selectedMetric.color}
        suffix={selectedMetric.suffix}
        digits={selectedMetric.digits}
        points={metricPoints}
        hoverSecond={hoverSecond}
        onHoverChange={onHoverChange}
      />

      <div className="training-info-stack">
        <div className="training-info-point">Die Karte läuft jetzt mit `Leaflet` und OpenStreetMap ganz ohne zusätzlichen API-Key.</div>
        <div className="training-info-point">Wenn du später einen anderen Tile-Provider einsetzen willst, kannst du in der `.env` `VITE_MAP_TILE_URL`, `VITE_MAP_TILE_ATTRIBUTION` und optional `VITE_MAP_MAX_ZOOM` setzen.</div>
        <div className="training-info-point">Für öffentliche oder stark genutzte Installationen würde ich langfristig eher einen eigenen Tile-Provider wie MapTiler oder Stadia eintragen, statt dauerhaft den freien Standard-Tile-Server zu belasten.</div>
      </div>
    </div>
  );
}

function MiniChart({
  chartKey,
  title,
  color,
  records,
  pick,
  suffix,
  digits,
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
  digits: number;
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
  const bounds = useMemo(() => computeAxisBounds(values), [values]);
  const min = bounds?.min ?? null;
  const max = bounds?.max ?? null;
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const innerWidth = 900;
  const innerHeight = 220;
  const chartLeft = 64;
  const chartTop = 18;
  const chartWidth = innerWidth;
  const chartHeight = innerHeight;
  const plotLeftPercent = (chartLeft / 1000) * 100;
  const plotWidthPercent = (chartWidth / 1000) * 100;
  const visibleStart = sourceStart;
  const visibleEnd = sourceEnd;
  const totalDuration = Math.max(visibleEnd - visibleStart, 0);
  const gridSteps = 4;
  const yTicks =
    bounds != null
      ? Array.from({ length: gridSteps + 1 }, (_, index) => bounds.min + ((bounds.max - bounds.min) / gridSteps) * index)
      : [];
  const axisMin = bounds?.axisMin ?? 0;
  const valueSpan = bounds?.span ?? 1;
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
  const averageY =
    average == null
      ? null
      : chartTop + chartHeight - ((average - axisMin) / valueSpan) * chartHeight;

  function pointerToSecond(clientX: number, element: HTMLDivElement): number {
    const ratio = pointerRatioInPlot(clientX, element, chartLeft, chartWidth);
    return sourceStart + ratio * Math.max(1, sourceEnd - sourceStart);
  }

  return (
    <div className="card">
      <div className="section-title-row">
        <h2>{title}</h2>
        <span className="training-note">
          Min {formatNumber(min, digits, suffix)} | Ø {formatNumber(average, digits, suffix)} | Max {formatNumber(max, digits, suffix)}
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
                    {tick.toFixed(digits)}
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
            {averageY != null ? (
              <>
                <line x1={chartLeft} y1={averageY} x2={chartLeft + chartWidth} y2={averageY} stroke={color} strokeWidth="1.5" strokeDasharray="8 6" opacity="0.9" />
                <text x={chartLeft + chartWidth - 6} y={averageY - 8} textAnchor="end" fontSize="12" fill="#16322e">
                  Ø {formatNumber(average, digits, suffix)}
                </text>
              </>
            ) : null}
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
              {formatAxisTime(visibleStart + hoveredPoint.elapsed)} | {formatNumber(hoveredPoint.value, digits, suffix)}
            </div>
          ) : null}
          {activeSelection ? (
            <div
              style={{
                position: "absolute",
                top: "18px",
                bottom: "62px",
                left: `${plotLeftPercent + ((activeSelection.left - sourceStart) / Math.max(1, sourceEnd - sourceStart)) * plotWidthPercent}%`,
                width: `${((activeSelection.right - activeSelection.left) / Math.max(1, visibleEnd - visibleStart)) * plotWidthPercent}%`,
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
  const [mapMetricKey, setMapMetricKey] = useState<MapMetricKey>("power");
  const [mapDistanceRange, setMapDistanceRange] = useState<DistanceRange | null>(null);
  const [mapDragSelection, setMapDragSelection] = useState<DistanceSelection | null>(null);
  const [hoverSecond, setHoverSecond] = useState<number | null>(null);
  const [activeAchievementCategory, setActiveAchievementCategory] = useState<string>("all");
  const [llmAnalysis, setLlmAnalysis] = useState<ActivityLlmResponse | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);

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
        setLlmAnalysis(payload.llm_analysis ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      } finally {
        setLoading(false);
      }
    }

    void loadDetail();
  }, [activityId]);

  const normalizedRecords = useMemo(() => normalizeRecordTimeline(data?.records ?? []), [data?.records]);
  const routePoints = useMemo(() => buildRoutePoints(normalizedRecords), [normalizedRecords]);
  const totalDuration = normalizedRecords.length ? normalizedRecords[normalizedRecords.length - 1].chart_elapsed_s : 0;
  const viewStart = viewRange?.start ?? 0;
  const viewEnd = viewRange?.end ?? totalDuration;
  const llmStatus = data?.llm_analysis_status ?? null;
  const llmNeedsUpdate = Boolean(llmStatus?.has_newer_version);
  const llmButtonClassName = llmNeedsUpdate ? "primary-button analysis-stale" : "primary-button";
  const llmButtonLabel = llmLoading
    ? "Analysiere..."
    : llmNeedsUpdate
      ? `Analyse auf ${formatAnalysisVersion(llmStatus?.current_version ?? null)} aktualisieren`
      : llmStatus?.available
        ? "Gespeicherte Analyse laden"
        : "Ausführliche Analyse starten";
  const generalInfoSections: ActivityMetricSection[] = data
    ? [
        {
          title: "Stammdaten",
          note: "Kontext und Rahmendaten",
          cards: [
            {
              primary: { label: "Quelle", value: data.activity.provider || "-" },
              secondary: { label: "Sport", value: data.activity.sport || "-" },
            },
            {
              primary: { label: "Umgebung", value: data.activity.environment_label || "-" },
              secondary: { label: "Start", value: formatDateTime(data.activity.started_at) },
            },
            {
              primary: { label: "Dauer", value: data.activity.duration_label || "-" },
              secondary: { label: "Distanz", value: formatDistanceMeters(data.activity.distance_m) },
            },
            {
              primary: { label: "Runden", value: String(data.activity.laps_count) },
              secondary: { label: "Records", value: String(data.activity.records_count) },
            },
          ],
        },
        {
          title: "Leistung & Tempo",
          note: "Watt, Geschwindigkeit und Referenzen",
          cards: [
            {
              primary: { label: "Ø Watt", value: formatNumber(data.activity.avg_power_w, 0, " W") },
              secondary: { label: "Max Watt", value: formatNumber(data.activity.max_power_w, 0, " W") },
            },
            {
              primary: {
                label: "FTP Referenz",
                value: formatNumber(data.activity.ftp_reference_w, 0, " W"),
                help: "Die FTP Referenz ist der zum Aktivitätszeitpunkt gültige Schwellenwert und dient als Basis für IF, TSS und Leistungszonen.",
              },
              secondary: {
                label: "NP",
                value: formatNumber(data.activity.normalized_power_w, 0, " W"),
                help: "Normalized Power schätzt die physiologische Belastung der Fahrt und gewichtet Leistungsspitzen stärker als den einfachen Durchschnitt.",
              },
            },
            {
              primary: { label: "Ø km/h", value: formatNumber(data.activity.avg_speed_kmh, 1, " km/h") },
              secondary: { label: "Max km/h", value: formatNumber(data.activity.max_speed_kmh, 1, " km/h") },
            },
            {
              primary: { label: "Ø Kadenz", value: formatNumber(data.activity.avg_cadence_rpm, 0, " rpm") },
              secondary: { label: "Max Kadenz", value: formatNumber(data.activity.max_cadence_rpm, 0, " rpm") },
            },
            {
              primary: { label: "Zeit in Bewegung", value: data.activity.moving_time_label ?? formatSeconds(data.activity.moving_time_s) },
              secondary: { label: "Zeit in Pausen", value: data.activity.paused_time_label ?? formatSeconds(data.activity.paused_time_s) },
            },
          ],
        },
        {
          title: "Belastung & Energie",
          note: "Trainingsstress und energetische Einordnung",
          cards: [
            {
              primary: {
                label: "IF",
                value: formatNumber(data.activity.intensity_factor, 2),
                help: "Intensity Factor setzt die Normalized Power ins Verhältnis zur FTP. Ein Wert von 1.00 entspricht ungefähr einer Stunde an FTP-Niveau.",
              },
            },
            {
              primary: {
                label: "VI",
                value: formatNumber(data.activity.variability_index, 2),
                help: "Variability Index ist NP geteilt durch Ø Watt. Werte nahe 1.00 sprechen für eine sehr gleichmäßige Leistung.",
              },
            },
            {
              primary: {
                label: "TSS",
                value: formatNumber(data.activity.training_stress_score, 1),
                help: "Training Stress Score kombiniert Dauer und Intensität zu einem Belastungswert. Rund 100 TSS entsprechen grob einer Stunde bei FTP.",
              },
            },
            {
              primary: {
                label: "Stress",
                value: formatNumber(data.activity.stress_score, 1),
                help: "Das ist der verfügbare Belastungswert für diese Aktivität. Wenn kein externer Stresswert vorliegt, verwenden wir den berechneten TSS.",
              },
            },
            {
              primary: {
                label: "Kalorien",
                value: formatNumber(data.activity.calories_kcal, 0, " kcal"),
                help: "Kalorien stammen wenn möglich direkt aus Garmin oder dem Provider. Falls sie fehlen, werden sie aus der mechanischen Arbeit geschätzt.",
              },
            },
          ],
        },
        {
          title: "Herzfrequenz & Daten",
          note: "HF, Höhe und Datenqualität",
          cards: [
            {
              primary: { label: "Ø HF", value: formatNumber(data.activity.avg_hr_bpm, 0, " bpm") },
              secondary: { label: "Max HF", value: formatNumber(data.activity.max_hr_bpm, 0, " bpm") },
            },
            {
              primary: { label: "Höhe min", value: formatNumber(data.activity.min_altitude_m, 0, " m") },
              secondary: { label: "Höhe max", value: formatNumber(data.activity.max_altitude_m, 0, " m") },
            },
            {
              primary: { label: "Anstieg gesamt", value: formatNumber(data.activity.total_ascent_m, 0, " m") },
              secondary: { label: "Längster Anstieg", value: formatNumber(data.activity.longest_climb_m, 0, " m") },
            },
          ],
        },
      ]
    : [];

  useEffect(() => {
    setViewRange(null);
    setDragSelection(null);
    setMapDistanceRange(null);
    setMapDragSelection(null);
    setHoverSecond(null);
  }, [activityId, totalDuration]);

  useEffect(() => {
    setLlmAnalysis(null);
    setLlmError(null);
    setLlmLoading(false);
  }, [activityId]);

  const matchedAchievements = data?.achievement_analysis?.matched ?? [];
  const availableAchievementCategories = useMemo(() => {
    const present = new Set(matchedAchievements.map((item) => item.category));
    return ACHIEVEMENT_CATEGORY_ORDER.filter((category) => present.has(category));
  }, [matchedAchievements]);

  useEffect(() => {
    setActiveAchievementCategory((current) => {
      if (current !== "all" && availableAchievementCategories.includes(current as (typeof ACHIEVEMENT_CATEGORY_ORDER)[number])) {
        return current;
      }
      return availableAchievementCategories[0] ?? "all";
    });
  }, [availableAchievementCategories]);

  const filteredAchievements = useMemo(() => {
    if (activeAchievementCategory === "all") return matchedAchievements;
    return matchedAchievements.filter((item) => item.category === activeAchievementCategory);
  }, [activeAchievementCategory, matchedAchievements]);

  const hfAchievementBuckets = useMemo(() => {
    const buckets = new Map<string, { bucketLabel: string; items: ActivityAchievementMatch[] }>();
    matchedAchievements
      .filter((item) => item.category === "hf")
      .forEach((item) => {
        const bucketLabel = item.meta?.bucket_label ?? item.title.split("|")[1]?.trim() ?? "HF";
        const current = buckets.get(bucketLabel) ?? { bucketLabel, items: [] };
        current.items.push(item);
        buckets.set(bucketLabel, current);
      });
    return Array.from(buckets.values()).map((bucket) => ({
      ...bucket,
      items: bucket.items.sort((left, right) => (HF_WINDOW_ORDER[left.meta?.window_key ?? ""] ?? 999) - (HF_WINDOW_ORDER[right.meta?.window_key ?? ""] ?? 999)),
    }));
  }, [matchedAchievements]);

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

  function handleMapSelectionStart(distanceM: number) {
    setMapDragSelection({ anchor: distanceM, current: distanceM });
  }

  function handleMapSelectionMove(distanceM: number) {
    setMapDragSelection((current) => (current ? { ...current, current: distanceM } : current));
  }

  function handleMapSelectionEnd() {
    if (!mapDragSelection) return;
    const start = Math.min(mapDragSelection.anchor, mapDragSelection.current);
    const end = Math.max(mapDragSelection.anchor, mapDragSelection.current);
    setMapDragSelection(null);
    if (end - start < 50) return;
    setMapDistanceRange({ start, end });
  }

  function resetMapSelection() {
    setMapDistanceRange(null);
    setMapDragSelection(null);
  }

  async function runLlmAnalysis(forceRefresh = false) {
    if (!activityId) return;
    setLlmLoading(true);
    setLlmError(null);
    try {
      const query = forceRefresh ? "?force_refresh=true" : "";
      const response = await apiFetch(`${API_BASE_URL}/activities/${activityId}/llm-analysis${query}`, {
        method: "POST",
      });
      const payload = await parseJsonSafely<ActivityLlmResponse | { detail?: string }>(response);
      if (!response.ok || !payload || !("analysis" in payload)) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "LLM Analyse konnte nicht erstellt werden.");
      }
      setLlmAnalysis(payload);
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          llm_analysis: payload,
          llm_analysis_status: buildLlmStatusFromAnalysis(payload),
        };
      });
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : "Unbekannter Fehler bei der LLM Analyse");
    } finally {
      setLlmLoading(false);
    }
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
              <button
                key={tab.key}
                className={`settings-tab-button ${activeTab === tab.key ? "active" : ""} ${tab.key === "llm" && llmNeedsUpdate ? "needs-attention" : ""}`}
                type="button"
                onClick={() => setActiveTab(tab.key)}
              >
                <strong>{tab.title}</strong>
                <span>{tab.note}</span>
                {tab.key === "llm" && llmNeedsUpdate ? <small className="settings-tab-alert">Neuere Analyse-Version verfügbar</small> : null}
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
                <div className="activity-summary-grid">
                  {generalInfoSections.map((section) => (
                    <ActivityMetricSectionCard key={section.title} {...section} />
                  ))}
                </div>
                {data.activity.environment_note ? <div className="activity-info-callout">{data.activity.environment_note}</div> : null}
              </div>
            ) : null}

            {activeTab === "map" ? (
              <ActivityTrackMap
                routePoints={routePoints}
                hoverSecond={hoverSecond}
                onHoverChange={setHoverSecond}
                mapMetricKey={mapMetricKey}
                onMetricChange={setMapMetricKey}
                distanceRange={mapDistanceRange}
                dragSelection={mapDragSelection}
                onDistanceSelectionStart={handleMapSelectionStart}
                onDistanceSelectionMove={handleMapSelectionMove}
                onDistanceSelectionEnd={handleMapSelectionEnd}
                onDistanceSelectionReset={resetMapSelection}
              />
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
                <MiniChart chartKey="hr" title="Herzfrequenz" color="#ff2950" records={normalizedRecords} pick={(row) => row.heart_rate_bpm} suffix=" bpm" digits={0} smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
                <MiniChart chartKey="power" title="Watt" color="#6cc63f" records={normalizedRecords} pick={(row) => row.power_w} suffix=" W" digits={0} smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
                <MiniChart chartKey="cadence" title="Trittfrequenz" color="#f39a1f" records={normalizedRecords} pick={(row) => row.cadence_rpm} suffix=" rpm" digits={0} smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
                <MiniChart chartKey="speed" title="Geschwindigkeit" color="#5ab1f3" records={normalizedRecords} pick={(row) => row.speed_kmh} suffix=" km/h" digits={1} smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
                <MiniChart chartKey="altitude" title="Höhe" color="#8db4e8" records={normalizedRecords} pick={(row) => row.altitude_m} suffix=" m" digits={0} smoothingMode={smoothingMode} viewStart={viewStart} viewEnd={viewEnd} dragSelection={dragSelection} hoverSecond={hoverSecond} onHoverChange={setHoverSecond} onSelectionStart={handleSelectionStart} onSelectionMove={handleSelectionMove} onSelectionEnd={handleSelectionEnd} />
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
                  Hier kommt die deterministische Analyse hinein. Dieser Bereich ist für regelbasierte Auswertungen wie Pacing, Zonenzeit, Drift, Effizienz, Intervall-Erkennung und Belastungsstruktur ohne LLM vorgesehen.
                </p>
                <div className="training-info-stack">
                  <div className="training-info-point">Deterministische Analyse: nachvollziehbar, reproduzierbar und ohne Modellinterpretation.</div>
                  <div className="training-info-point">LLM Analyse: textuelle Tiefenanalyse, Einordnung und Coaching-Hinweise auf Basis derselben Daten.</div>
                  <div className="training-info-point">Beide Bereiche sollen später zusammenarbeiten, bleiben aber bewusst getrennt.</div>
                </div>
              </div>
            ) : null}

            {activeTab === "llm" ? (
              <div style={{ display: "grid", gap: "1rem" }}>
                <div className="card">
                  <div className="section-title-row">
                    <h2>LLM Analyse</h2>
                    <div className="settings-actions">
                      <button className={llmButtonClassName} type="button" onClick={() => void runLlmAnalysis()} disabled={llmLoading}>
                        {llmButtonLabel}
                      </button>
                      {llmStatus?.available || llmAnalysis ? (
                        <button className="secondary-button" type="button" onClick={() => void runLlmAnalysis(true)} disabled={llmLoading}>
                          Analyse neu machen
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <p className="training-note">
                    Erstellt eine ausführliche Textanalyse mit Daten, Fakten und Coaching-Hinweisen auf Basis dieser Aktivität. FTP, MaxHF, Sessions, Runden und abgeleitete Kennzahlen werden dafür mit in die Anfrage gegeben. Gespeicherte Analysen werden wiederverwendet, solange ihre Version noch aktuell ist.
                  </p>
                  <div className="training-mini-grid">
                    <div className="training-mini-card">
                      <span>Analyse Version</span>
                      <strong>{formatAnalysisVersion(llmAnalysis?.analysis_version ?? llmStatus?.analysis_version ?? null)}</strong>
                      <small>Aktuell: {formatAnalysisVersion(llmAnalysis?.current_version ?? llmStatus?.current_version ?? null)}</small>
                    </div>
                    <div className="training-mini-card">
                      <span>Umgebung</span>
                      <strong>{llmAnalysis?.context_snapshot.environment_label ?? data.activity.environment_label ?? "-"}</strong>
                      {llmAnalysis?.context_snapshot.virtual_platform ?? data.activity.virtual_platform ? (
                        <small>{llmAnalysis?.context_snapshot.virtual_platform ?? data.activity.virtual_platform}</small>
                      ) : null}
                    </div>
                    <div className="training-mini-card">
                      <span>FTP Referenz</span>
                      <strong>{formatNumber(llmAnalysis?.context_snapshot.ftp_reference_w ?? data.activity.ftp_reference_w, 0, " W")}</strong>
                    </div>
                    <div className="training-mini-card">
                      <span>MaxHF Referenz</span>
                      <strong>{formatNumber(llmAnalysis?.context_snapshot.max_hr_reference_bpm ?? data.activity.max_hr_reference_bpm, 0, " bpm")}</strong>
                    </div>
                    <div className="training-mini-card">
                      <span>Runden</span>
                      <strong>{llmAnalysis?.context_snapshot.laps_count ?? data.activity.laps_count}</strong>
                    </div>
                    <div className="training-mini-card">
                      <span>Records</span>
                      <strong>{llmAnalysis?.context_snapshot.records_count ?? data.activity.records_count}</strong>
                    </div>
                  </div>
                  <div className="training-info-stack">
                    {llmStatus?.available ? (
                      <div className="training-info-point">
                        Gespeichert ist {formatAnalysisVersion(llmStatus.analysis_version)} vom {formatDateTime(llmStatus.generated_at)}.
                        {llmStatus.has_newer_version ? ` Aktuell verfügbar ist ${formatAnalysisVersion(llmStatus.current_version)}.` : " Diese Analyse ist aktuell."}
                      </div>
                    ) : (
                      <div className="training-info-point">Für diese Aktivität ist noch keine gespeicherte LLM Analyse vorhanden.</div>
                    )}
                    <div className="training-info-point">Die Analyse läuft über die konfigurierte OpenAI-API und wird im LLM-Usage-Log mitprotokolliert.</div>
                    <div className="training-info-point">Die Antwort kombiniert textuelle Tiefenanalyse mit Zahlen, Fakten und konkreten Coaching-Hinweisen.</div>
                    {llmAnalysis ? <div className="training-info-point">{llmAnalysis.from_cache ? "Aktuell angezeigt wird die gespeicherte Cache-Version." : "Die Analyse wurde in dieser Version frisch berechnet und im Cache gespeichert."}</div> : null}
                    {data.activity.environment_note ? <div className="training-info-point">{data.activity.environment_note}</div> : null}
                    <div className="training-info-point">TODO: Diese Analyse muss künftig zusätzlich auf das Trainingsziel aus dem Trainingsplan angepasst werden.</div>
                  </div>
                  {llmError ? <p className="error-text">{llmError}</p> : null}
                </div>

                {llmAnalysis ? (
                  <>
                    <div className="card">
                      <div className="section-title-row">
                        <h2>{llmAnalysis.analysis.headline}</h2>
                        <span className="training-note">
                          {formatAnalysisVersion(llmAnalysis.analysis_version)} | {llmAnalysis.model} | {formatDateTime(llmAnalysis.generated_at)}
                        </span>
                      </div>
                      <p className="lead">{llmAnalysis.analysis.summary}</p>
                    </div>

                    {llmAnalysis.analysis.numbers_and_facts.length ? (
                      <div className="training-config-detail-grid">
                        {llmAnalysis.analysis.numbers_and_facts.map((item) => (
                          <article key={`${item.label}-${item.value}`} className="training-config-detail-card">
                            <h3>{item.label}</h3>
                            <strong>{item.value}</strong>
                            <p className="training-note">{item.fact}</p>
                          </article>
                        ))}
                      </div>
                    ) : null}

                    <div className="training-config-detail-grid">
                      {llmAnalysis.analysis.deep_analysis.length ? (
                        <article className="training-config-detail-card">
                          <h3>Textuelle Tiefenanalyse</h3>
                          <ul className="training-config-list">
                            {llmAnalysis.analysis.deep_analysis.map((item, index) => (
                              <li key={`deep-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </article>
                      ) : null}

                      {llmAnalysis.analysis.performance_signals.length ? (
                        <article className="training-config-detail-card">
                          <h3>Leistungssignale</h3>
                          <ul className="training-config-list">
                            {llmAnalysis.analysis.performance_signals.map((item, index) => (
                              <li key={`signal-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </article>
                      ) : null}

                      {llmAnalysis.analysis.coaching_recommendations.length ? (
                        <article className="training-config-detail-card">
                          <h3>Coaching Empfehlungen</h3>
                          <ul className="training-config-list">
                            {llmAnalysis.analysis.coaching_recommendations.map((item, index) => (
                              <li key={`recommendation-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </article>
                      ) : null}

                      {llmAnalysis.analysis.todo.length ? (
                        <article className="training-config-detail-card">
                          <h3>TODO</h3>
                          <ul className="training-config-list">
                            {llmAnalysis.analysis.todo.map((item, index) => (
                              <li key={`todo-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </article>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="card">
                    <p className="training-note">
                      Starte die LLM Analyse per Button, dann bekommst du hier eine datenbasierte Tiefenanalyse mit Text, Zahlen und konkreten Handlungshinweisen.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {activeTab === "achievements" ? (
              <div className="card">
                <div className="section-title-row">
                  <h2>Achievements</h2>
                </div>
                <div className="training-history-block">
                  <div className="training-history-head">
                    <div>
                      <h3>Ride-Checks und Treffer</h3>
                      <p className="training-note">
                        Hier siehst du, welche Achievement-Prüfungen für diese Aktivität bereits gelaufen sind und welche Treffer daraus entstanden sind.
                      </p>
                    </div>
                  </div>
                  <div className="training-mini-grid">
                    <div className="training-mini-card">
                      <span>Geprüft am</span>
                      <strong>{formatDateTime(data.activity.achievements_checked_at)}</strong>
                    </div>
                    <div className="training-mini-card">
                      <span>Check-Version</span>
                      <strong>{data.activity.achievements_check_version ?? "-"}</strong>
                    </div>
                    <div className="training-mini-card">
                      <span>Treffer</span>
                      <strong>{data.achievement_analysis?.matched_count ?? 0}</strong>
                    </div>
                  </div>
                  {data.achievement_analysis?.checked_scopes?.length ? (
                    <p className="training-note">
                      <strong>Geprüfte Bereiche:</strong> {data.achievement_analysis.checked_scopes.join(", ")}
                    </p>
                  ) : null}
                  {matchedAchievements.length ? (
                    <>
                      {availableAchievementCategories.length ? (
                        <div className="training-profile-order-preview">
                          {availableAchievementCategories.map((category) => (
                            <button
                              key={category}
                              className={`settings-tab-button ${activeAchievementCategory === category ? "active" : ""}`}
                              type="button"
                              onClick={() => setActiveAchievementCategory(category)}
                            >
                              {achievementCategoryLabel(category)}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {activeAchievementCategory === "hf" ? (
                        <div className="achievement-ride-hf-groups">
                          {hfAchievementBuckets.map((bucket) => (
                            <section key={bucket.bucketLabel} className="achievement-ride-hf-group">
                              <div className="achievement-ride-hf-group-head">
                                <strong>{bucket.bucketLabel}</strong>
                                <span>{bucket.items.length} Treffer</span>
                              </div>
                              <div className="achievement-ride-hf-list">
                                {bucket.items.map((item) => (
                                  <div key={item.key} className="achievement-ride-hf-row">
                                    <strong>{compactHfWindowLabel(item)}</strong>
                                    <small>{compactHfValueLabel(item)}</small>
                                  </div>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                      ) : (
                        <div className="training-history-list">
                          {filteredAchievements.map((item) => (
                            <div key={item.key} className="training-history-item">
                              <div className="training-history-top">
                                <div className="training-history-main">
                                  <strong>{item.title}</strong>
                                  <span>{achievementCategoryLabel(item.category)}</span>
                                </div>
                                <span className="training-history-badge">{achievementCategoryLabel(item.category)}</span>
                              </div>
                              <p className="training-note">{item.detail}</p>
                              {item.proof ? (
                                <p className="training-note">
                                  <strong>Nachweis:</strong> {item.proof}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="training-note">
                      Für diese Aktivität wurden bisher noch keine konkreten Achievement-Treffer gefunden. Die Checks selbst können trotzdem schon gespeichert sein.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}


