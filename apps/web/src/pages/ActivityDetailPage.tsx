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
  max_cadence_rpm: number | null;
  max_speed_kmh: number | null;
  min_altitude_m: number | null;
  max_altitude_m: number | null;
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

type ActivityMetricSection = {
  title: string;
  note: string;
  items: ActivityMetricItem[];
};

type TabKey = "general" | "charts" | "laps" | "analysis" | "llm" | "achievements";
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

function ActivityMetricCard({ label, value, help }: ActivityMetricItem) {
  return (
    <div className="activity-metric-card">
      <div className="activity-metric-label-row">
        <span className="activity-metric-label">{label}</span>
        {help ? <ActivityMetricHelp title={label} description={help} /> : null}
      </div>
      <strong className="activity-metric-value">{value}</strong>
    </div>
  );
}

function ActivityMetricSectionCard({ title, note, items }: ActivityMetricSection) {
  return (
    <article className="activity-summary-section">
      <div className="activity-summary-head">
        <h3>{title}</h3>
        <span>{note}</span>
      </div>
      <div className="activity-metric-grid">
        {items.map((item) => (
          <ActivityMetricCard key={item.label} {...item} />
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
          items: [
            { label: "Quelle", value: data.activity.provider || "-" },
            { label: "Sport", value: data.activity.sport || "-" },
            { label: "Umgebung", value: data.activity.environment_label || "-" },
            { label: "Start", value: formatDateTime(data.activity.started_at) },
            { label: "Dauer", value: data.activity.duration_label || "-" },
            { label: "Distanz", value: formatDistanceMeters(data.activity.distance_m) },
          ],
        },
        {
          title: "Leistung & Tempo",
          note: "Watt, Geschwindigkeit und Referenzen",
          items: [
            { label: "Ø Watt", value: formatNumber(data.activity.avg_power_w, 0, " W") },
            {
              label: "NP",
              value: formatNumber(data.activity.normalized_power_w, 0, " W"),
              help: "Normalized Power schätzt die physiologische Belastung der Fahrt und gewichtet Leistungsspitzen stärker als den einfachen Durchschnitt.",
            },
            {
              label: "FTP Referenz",
              value: formatNumber(data.activity.ftp_reference_w, 0, " W"),
              help: "Die FTP Referenz ist der zum Aktivitätszeitpunkt gültige Schwellenwert und dient als Basis für IF, TSS und Leistungszonen.",
            },
            { label: "Max Watt", value: formatNumber(data.activity.max_power_w, 0, " W") },
            { label: "Ø km/h", value: formatNumber(data.activity.avg_speed_kmh, 1, " km/h") },
            { label: "Max km/h", value: formatNumber(data.activity.max_speed_kmh, 1, " km/h") },
            { label: "Max Kadenz", value: formatNumber(data.activity.max_cadence_rpm, 0, " rpm") },
          ],
        },
        {
          title: "Belastung & Energie",
          note: "Trainingsstress und energetische Einordnung",
          items: [
            {
              label: "IF",
              value: formatNumber(data.activity.intensity_factor, 2),
              help: "Intensity Factor setzt die Normalized Power ins Verhältnis zur FTP. Ein Wert von 1.00 entspricht ungefähr einer Stunde an FTP-Niveau.",
            },
            {
              label: "VI",
              value: formatNumber(data.activity.variability_index, 2),
              help: "Variability Index ist NP geteilt durch Ø Watt. Werte nahe 1.00 sprechen für eine sehr gleichmäßige Leistung.",
            },
            {
              label: "TSS",
              value: formatNumber(data.activity.training_stress_score, 1),
              help: "Training Stress Score kombiniert Dauer und Intensität zu einem Belastungswert. Rund 100 TSS entsprechen grob einer Stunde bei FTP.",
            },
            {
              label: "Stress",
              value: formatNumber(data.activity.stress_score, 1),
              help: "Das ist der verfügbare Belastungswert für diese Aktivität. Wenn kein externer Stresswert vorliegt, verwenden wir den berechneten TSS.",
            },
            {
              label: "Kalorien",
              value: formatNumber(data.activity.calories_kcal, 0, " kcal"),
              help: "Kalorien stammen wenn möglich direkt aus Garmin oder dem Provider. Falls sie fehlen, werden sie aus der mechanischen Arbeit geschätzt.",
            },
          ],
        },
        {
          title: "Herzfrequenz & Daten",
          note: "HF, Höhe und Datenqualität",
          items: [
            { label: "Ø HF", value: formatNumber(data.activity.avg_hr_bpm, 0, " bpm") },
            { label: "Max HF", value: formatNumber(data.activity.max_hr_bpm, 0, " bpm") },
            { label: "Höhe min", value: formatNumber(data.activity.min_altitude_m, 0, " m") },
            { label: "Höhe max", value: formatNumber(data.activity.max_altitude_m, 0, " m") },
            { label: "Runden", value: String(data.activity.laps_count) },
            { label: "Records", value: String(data.activity.records_count) },
          ],
        },
      ]
    : [];

  useEffect(() => {
    setViewRange(null);
    setDragSelection(null);
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

  async function runLlmAnalysis() {
    if (!activityId) return;
    setLlmLoading(true);
    setLlmError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/${activityId}/llm-analysis`, {
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


