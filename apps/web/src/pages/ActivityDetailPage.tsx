import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useRef } from "react";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { apiFetch } from "../api";
import maplibregl from "maplibre-gl";
import type { FeatureCollection, GeoJsonProperties, LineString, Point } from "geojson";
import {
  API_BASE_URL,
  MAP_3D_BEARING,
  MAP_3D_DEM_ENCODING,
  MAP_3D_DEM_TILE_SIZE,
  MAP_3D_DEM_URL,
  MAP_3D_EXAGGERATION,
  MAP_3D_MAX_PITCH,
  MAP_3D_PITCH,
  MAP_3D_STYLE_URL,
  MAP_MAX_ZOOM,
  MAP_TILE_ATTRIBUTION,
  MAP_TILE_URL,
} from "../config";
import type { LatLng, LatLngBoundsExpression, LatLngTuple, Map as LeafletMap } from "leaflet";
import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
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
  aerobic_training_effect: number | null;
  anaerobic_training_effect: number | null;
  aerobic_training_effect_message: string | null;
  anaerobic_training_effect_message: string | null;
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

type AnalysisSubTabKey = "training-effect" | "hf-drift" | "power-zones" | "hr-zones";

type AnalysisSample = {
  elapsed: number;
  seconds: number;
  power: number | null;
  heartRate: number | null;
};

type TrainingEffectBarData = {
  id: string;
  title: string;
  score: number | null;
  label: string;
  accentColor: string;
  help: string;
};

type TrainingEffectFocus = {
  label: string;
  score: number;
  description: string;
};

type TrainingEffectAnalysis = {
  headline: string;
  headlineReason: string;
  bars: TrainingEffectBarData[];
  zoneBars: TrainingEffectBarData[];
};

type ZoneDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  min: number | null;
  max: number | null;
  color: string;
  description: string;
};

type ZoneDurationRow = {
  zone: ZoneDefinition;
  seconds: number;
  sharePercent: number;
};

type ZoneSegment = {
  start: number;
  end: number;
  seconds: number;
};

type DriftSignal = {
  key: string;
  title: string;
  direction: "positive" | "negative";
  directionLabel: string;
  timeLabel: string;
  powerLabel: string;
  heartRateLabel: string;
  driftLabel: string;
  summary: string;
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
type RouteStageMode = "map" | "flyover";
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
type RouteGeoPoint = RoutePoint & {
  latitudeDeg: number;
  longitudeDeg: number;
};

type GeoJsonLineCollection = FeatureCollection<LineString, GeoJsonProperties>;
type GeoJsonPointCollection = FeatureCollection<Point, GeoJsonProperties>;

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

function ActivityInfoDialog({
  title,
  description,
  onClose,
}: {
  title: string;
  description: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="activity-info-dialog-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="activity-info-dialog-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-title-row">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Info schließen">
            x
          </button>
        </div>
        <div className="activity-info-dialog-body">
          {description.split("\n\n").map((block, index) => (
            <div key={`${title}-block-${index}`} className="activity-info-dialog-section">
              {block.split("\n").map((line, lineIndex) => (
                <p key={`${title}-line-${index}-${lineIndex}`}>{line}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TRAINING_EFFECT_COLORS = ["#9aa7a2", "#b7c1bc", "#58a7ff", "#5fd07b", "#f1aa4a", "#ea5b52"] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatSignedNumber(value: number, digits = 1, suffix = ""): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}${suffix}`;
}

function buildAnalysisSamples(records: ChartRecord[]): AnalysisSample[] {
  return records.map((row, index) => {
    const next = records[index + 1];
    const rawSeconds = next ? next.chart_elapsed_s - row.chart_elapsed_s : 1;
    const seconds = Number.isFinite(rawSeconds) && rawSeconds > 0 ? clamp(Math.round(rawSeconds), 1, 10) : 1;
    return {
      elapsed: row.chart_elapsed_s,
      seconds,
      power: row.power_w,
      heartRate: row.heart_rate_bpm,
    };
  });
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number | null {
  const usable = values.filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0);
  if (!usable.length) return null;
  const weightSum = usable.reduce((sum, item) => sum + item.weight, 0);
  if (weightSum <= 0) return null;
  return usable.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum;
}

function weightedSecondsForRange(
  samples: AnalysisSample[],
  predicate: (sample: AnalysisSample) => boolean,
): number {
  return samples.reduce((sum, sample) => (predicate(sample) ? sum + sample.seconds : sum), 0);
}

function countBurstRepeats(samples: AnalysisSample[], predicate: (sample: AnalysisSample) => boolean, minSeconds = 12): number {
  let repeats = 0;
  let currentSeconds = 0;
  let coolingDown = false;

  for (const sample of samples) {
    if (predicate(sample)) {
      currentSeconds += sample.seconds;
      coolingDown = false;
      continue;
    }
    if (!coolingDown && currentSeconds >= minSeconds) {
      repeats += 1;
      coolingDown = true;
    }
    currentSeconds = 0;
  }

  if (currentSeconds >= minSeconds) {
    repeats += 1;
  }

  return repeats;
}

function countRecoveryTransitions(samples: AnalysisSample[], ftpReferenceW: number | null): number {
  if (!ftpReferenceW || ftpReferenceW <= 0) return 0;
  let transitions = 0;
  let hardSeconds = 0;
  let easySeconds = 0;
  let armed = false;

  for (const sample of samples) {
    const powerRatio = sample.power != null ? sample.power / ftpReferenceW : null;
    if (powerRatio != null && powerRatio >= 1.05) {
      hardSeconds += sample.seconds;
      easySeconds = 0;
      if (hardSeconds >= 45) {
        armed = true;
      }
      continue;
    }
    if (armed && powerRatio != null && powerRatio <= 0.7) {
      easySeconds += sample.seconds;
      if (easySeconds >= 60) {
        transitions += 1;
        armed = false;
        hardSeconds = 0;
        easySeconds = 0;
      }
      continue;
    }
    if (powerRatio != null && powerRatio > 0.7) {
      easySeconds = 0;
    }
    if (powerRatio == null || powerRatio < 0.95) {
      hardSeconds = 0;
    }
  }

  return transitions;
}

function effectLevelLabel(score: number | null): string {
  if (score == null) return "Nicht verfügbar";
  if (score < 1) return "Kaum Reiz";
  if (score < 2) return "Erhaltend";
  if (score < 3) return "Aufbauend";
  if (score < 4) return "Deutlich";
  if (score < 4.7) return "Stark";
  return "Sehr hoch";
}

function buildEffectHelpText({
  score,
  formulaText,
  meaningText,
  sourceText,
  nextTrainingText,
}: {
  score: number | null;
  formulaText: string;
  meaningText: string;
  sourceText?: string;
  nextTrainingText?: string;
}): string {
  const scoreText = score == null ? "Kein belastbarer Wert" : `Aktueller Wert ${score.toFixed(1)} von 5.0`;
  return `Wert\n${scoreText}

Quelle\n${sourceText ?? "Kein importierter Garmin-Wert vorhanden, daher aus unseren Regeln abgeleitet."}

Herleitung\n${formulaText}

Bedeutung\n${meaningText}

Hinweis für spätere Trainings\n${nextTrainingText ?? "Der Wert ist als Einordnung dieses Rides gedacht. Für die weitere Trainingssteuerung sollte er immer zusammen mit Gesamtmüdigkeit, Wochenlast und geplantem Zielreiz gelesen werden."}

Farben\nGrau = kaum oder nur erhaltender Reiz
Blau = leichter Reiz
Grün = klarer Aufbau
Orange = starker Reiz
Rot = sehr hohe Beanspruchung`;
}

function humanizeTrainingEffectMessage(message: string | null): string | null {
  if (!message) return null;
  const raw = message.trim();
  if (!raw) return null;
  const normalized = raw.replace(/_\d+$/, "");
  const mapping: Record<string, string> = {
    NO_AEROBIC_BENEFIT: "Kein nennenswerter aerober Nutzen",
    NO_ANAEROBIC_BENEFIT: "Kein nennenswerter anaerober Nutzen",
    RECOVERY: "Erholung",
    MAINTAINING_AEROBIC_BASE: "Aerobe Grundlage erhalten",
    IMPROVING_AEROBIC_BASE: "Aerobe Grundlage verbessert",
    MAINTAINING_ANAEROBIC_BASE: "Anaerobe Grundlage erhalten",
    IMPACTING_TEMPO: "Tempo-Bereich wirksam belastet",
    IMPROVING_LACTATE_THRESHOLD: "Laktatschwelle verbessert",
    HIGHLY_IMPROVING_LACTATE_THRESHOLD: "Laktatschwelle stark verbessert",
    IMPROVING_VO2_MAX: "VO2max verbessert",
    HIGHLY_IMPROVING_VO2_MAX: "VO2max stark verbessert",
    OVERREACHING: "Sehr hohe Beanspruchung / Overreaching",
  };
  return mapping[normalized] ?? normalized.replace(/_/g, " ").toLowerCase().replace(/^\w/, (letter: string) => letter.toUpperCase());
}

function formatZoneRange(min: number | null, max: number | null, suffix: string): string {
  if (min == null && max == null) return "-";
  if (min == null) return `bis ${Math.round(max!)}${suffix}`;
  if (max == null) return `ab ${Math.round(min)}${suffix}`;
  return `${Math.round(min)}-${Math.round(max)}${suffix}`;
}

function buildPowerZones(ftpReferenceW: number | null): ZoneDefinition[] {
  if (!ftpReferenceW || ftpReferenceW <= 0) return [];
  const ftp = ftpReferenceW;
  return [
    { id: "z1", shortLabel: "Z1", label: "Active Recovery", min: null, max: ftp * 0.55, color: "#c5d1cb", description: "Sehr locker, Entlastung und aktive Erholung." },
    { id: "z2", shortLabel: "Z2", label: "Endurance", min: ftp * 0.56, max: ftp * 0.75, color: "#6fcf97", description: "Ruhige bis solide Grundlage, lange kontrollierte Dauerarbeit." },
    { id: "z3", shortLabel: "Z3", label: "Tempo", min: ftp * 0.76, max: ftp * 0.90, color: "#f2c94c", description: "Zügige Dauerarbeit, schon deutlich fordernder als reine Grundlage." },
    { id: "z4", shortLabel: "Z4", label: "Lactate Threshold", min: ftp * 0.91, max: ftp * 1.05, color: "#f2994a", description: "Schwellenbereich rund um FTP." },
    { id: "z5", shortLabel: "Z5", label: "VO2max", min: ftp * 1.06, max: ftp * 1.20, color: "#5aa9ff", description: "Sehr harte aerobe Spitzenarbeit oberhalb der Schwelle." },
    { id: "z6", shortLabel: "Z6", label: "Anaerobic Capacity", min: ftp * 1.21, max: ftp * 1.50, color: "#2f80ed", description: "Kurze sehr harte Belastungen mit klar anaerobem Anteil." },
    { id: "z7", shortLabel: "Z7", label: "Sprint Open End", min: ftp * 1.51, max: null, color: "#9b51e0", description: "Sprint- und Peakbereich ohne feste Obergrenze." },
    { id: "sweetspot", shortLabel: "SS", label: "Sweetspot", min: ftp * 0.88, max: ftp * 0.94, color: "#d4a72c", description: "Knapp unter der Schwelle, ökonomisch hart und sehr trainingswirksam." },
    { id: "kraftausdauer", shortLabel: "KA", label: "Kraftausdauer", min: ftp * 0.82, max: ftp * 0.98, color: "#8c6d3f", description: "Breiter Bereich für zähe, druckvolle Dauerarbeit, oft mit niedrigerer Kadenz gedacht." },
  ];
}

function buildHeartRateZones(maxHrReferenceBpm: number | null): ZoneDefinition[] {
  if (!maxHrReferenceBpm || maxHrReferenceBpm <= 0) return [];
  const maxHr = maxHrReferenceBpm;
  return [
    { id: "z1", shortLabel: "Z1", label: "Recovery", min: 0.50 * maxHr, max: 0.60 * maxHr, color: "#c5d1cb", description: "Erholung und sehr geringe kardiovaskuläre Last." },
    { id: "z2", shortLabel: "Z2", label: "Grundlage", min: 0.61 * maxHr, max: 0.72 * maxHr, color: "#6fcf97", description: "Ruhige aerobe Grundlage." },
    { id: "z3", shortLabel: "Z3", label: "Tempo", min: 0.73 * maxHr, max: 0.82 * maxHr, color: "#f2c94c", description: "Zügiger Ausdauerbereich mit merklich höherer Beanspruchung." },
    { id: "z4", shortLabel: "Z4", label: "Schwelle", min: 0.83 * maxHr, max: 0.90 * maxHr, color: "#f2994a", description: "Hoher Bereich rund um Schwellenarbeit." },
    { id: "z5", shortLabel: "Z5", label: "Hoch", min: 0.91 * maxHr, max: 1.00 * maxHr, color: "#eb5757", description: "Sehr hohe Herzfrequenz, meist nur in harten Belastungen erreichbar." },
  ];
}

function findZoneForValue(value: number | null, zones: ZoneDefinition[]): ZoneDefinition | null {
  if (value == null || !Number.isFinite(value)) return null;
  return zones.find((zone) => (zone.min == null || value >= zone.min) && (zone.max == null || value <= zone.max)) ?? null;
}

function summarizeZoneDurations(samples: AnalysisSample[], zones: ZoneDefinition[], pick: (sample: AnalysisSample) => number | null): ZoneDurationRow[] {
  const totalSeconds = samples.reduce((sum, sample) => sum + sample.seconds, 0);
  const secondsByZone = new Map<string, number>();
  for (const zone of zones) {
    secondsByZone.set(zone.id, 0);
  }
  for (const sample of samples) {
    const zone = findZoneForValue(pick(sample), zones);
    if (!zone) continue;
    secondsByZone.set(zone.id, (secondsByZone.get(zone.id) ?? 0) + sample.seconds);
  }
  return zones.map((zone) => {
    const seconds = secondsByZone.get(zone.id) ?? 0;
    return {
      zone,
      seconds,
      sharePercent: totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0,
    };
  });
}

function buildZoneSegments(samples: AnalysisSample[], zones: ZoneDefinition[], pick: (sample: AnalysisSample) => number | null, selectedZoneId: string | null): ZoneSegment[] {
  if (!selectedZoneId) return [];
  const perSecond: Array<{ second: number; value: number }> = [];
  for (const sample of samples) {
    const value = pick(sample);
    if (value == null || !Number.isFinite(value)) continue;
    for (let offset = 0; offset < sample.seconds; offset += 1) {
      perSecond.push({ second: Math.round(sample.elapsed) + offset, value });
    }
  }
  if (perSecond.length < 300) return [];

  const matches: Array<{ second: number; inZone: boolean }> = [];
  const windowSize = 300;
  let rollingSum = 0;
  for (let index = 0; index < perSecond.length; index += 1) {
    rollingSum += perSecond[index].value;
    if (index >= windowSize) {
      rollingSum -= perSecond[index - windowSize].value;
    }
    if (index < windowSize - 1) continue;
    const avg = rollingSum / windowSize;
    const zone = findZoneForValue(avg, zones);
    matches.push({
      second: perSecond[index].second,
      inZone: zone?.id === selectedZoneId,
    });
  }

  const segments: ZoneSegment[] = [];
  let currentStart: number | null = null;
  let lastSecond: number | null = null;
  for (const match of matches) {
    if (match.inZone) {
      if (currentStart == null) {
        currentStart = match.second - windowSize + 1;
      }
      lastSecond = match.second;
      continue;
    }
    if (currentStart != null && lastSecond != null) {
      const seconds = lastSecond - currentStart + 1;
      if (seconds >= windowSize) {
        segments.push({ start: currentStart, end: lastSecond, seconds });
      }
    }
    currentStart = null;
    lastSecond = null;
  }
  if (currentStart != null && lastSecond != null) {
    const seconds = lastSecond - currentStart + 1;
    if (seconds >= windowSize) {
      segments.push({ start: currentStart, end: lastSecond, seconds });
    }
  }
  return segments;
}

function deriveTrainingEffectAnalysis({
  activity,
  samples,
}: {
  activity: ActivitySummary;
  samples: AnalysisSample[];
}): TrainingEffectAnalysis {
  const ftpReferenceW = activity.ftp_reference_w;
  const movingHours = (activity.moving_time_s ?? activity.duration_s ?? 0) / 3600;
  const intensityFactor =
    activity.intensity_factor ??
    (activity.normalized_power_w != null && ftpReferenceW != null && ftpReferenceW > 0 ? activity.normalized_power_w / ftpReferenceW : null);
  const stressScore =
    activity.training_stress_score ??
    (movingHours > 0 && intensityFactor != null ? movingHours * intensityFactor * intensityFactor * 100 : null);
  const zoneSeconds = (minRatio: number | null, maxRatio: number | null) =>
    weightedSecondsForRange(samples, (sample) => {
      if (sample.power == null || ftpReferenceW == null || ftpReferenceW <= 0) return false;
      const ratio = sample.power / ftpReferenceW;
      if (minRatio != null && ratio < minRatio) return false;
      if (maxRatio != null && ratio > maxRatio) return false;
      return true;
    });

  const enduranceSeconds = zoneSeconds(0.56, 0.75);
  const tempoSeconds = zoneSeconds(0.76, 0.9);
  const thresholdSeconds = zoneSeconds(0.91, 1.05);
  const vo2Seconds = zoneSeconds(1.06, 1.2);
  const anaerobicSeconds = zoneSeconds(1.21, null);
  const lateStart = Math.max(0, (activity.moving_time_s ?? activity.duration_s ?? 0) * (2 / 3));
  const lateTempoSeconds = weightedSecondsForRange(samples, (sample) => {
    if (sample.elapsed < lateStart || sample.power == null || ftpReferenceW == null || ftpReferenceW <= 0) return false;
    const ratio = sample.power / ftpReferenceW;
    return ratio >= 0.8 && ratio <= 1.05;
  });
  const burstCount = countBurstRepeats(samples, (sample) => sample.power != null && ftpReferenceW != null && ftpReferenceW > 0 && sample.power / ftpReferenceW >= 1.35, 15);
  const recoveryTransitions = countRecoveryTransitions(samples, ftpReferenceW ?? null);
  const maxPowerRatio = ftpReferenceW && ftpReferenceW > 0 && activity.max_power_w != null ? activity.max_power_w / ftpReferenceW : null;
  const variability = activity.variability_index ?? 1;

  const aerobicScore =
    ftpReferenceW && ftpReferenceW > 0
      ? clamp(
          movingHours * 0.42 +
            enduranceSeconds / 2400 +
            tempoSeconds / 1800 +
            thresholdSeconds / 1200 +
            (stressScore ?? 0) / 65 +
            Math.max(0, (intensityFactor ?? 0) - 0.65) * 1.3,
          0,
          5,
        )
      : stressScore != null
        ? clamp(stressScore / 38, 0, 5)
        : null;

  const anaerobicScore =
    ftpReferenceW && ftpReferenceW > 0
      ? clamp(
          vo2Seconds / 420 +
            anaerobicSeconds / 180 +
            burstCount * 0.28 +
            Math.max(0, (maxPowerRatio ?? 0) - 1.25) * 0.8 +
            Math.max(0, variability - 1.03) * 3.2,
          0,
          5,
        )
      : null;

  const focusCandidates: TrainingEffectFocus[] = [
    {
      label: "Grundlage",
      score: ftpReferenceW && ftpReferenceW > 0 ? movingHours * 0.7 + enduranceSeconds / 2400 + Math.max(0, 1.12 - variability) * 0.8 : movingHours * 0.75,
      description: "Längerer Anteil in ruhiger bis zügiger Ausdauer. Das spricht für einen stabilen, aeroben Dauerreiz.",
    },
    {
      label: "Tempo / Sweetspot",
      score: tempoSeconds / 1500 + thresholdSeconds / 2400 + Math.max(0, (intensityFactor ?? 0) - 0.75) * 1.8,
      description: "Viele Minuten knapp unter Schwelle. Typisch für zügige Dauerarbeit und ökonomische Belastung im mittleren bis oberen Dauerbereich.",
    },
    {
      label: "Schwelle",
      score: thresholdSeconds / 900 + Math.max(0, (intensityFactor ?? 0) - 0.88) * 2.4,
      description: "Relevante Zeit an oder nahe FTP. Das setzt eher einen Schwellenreiz als reine Grundlage.",
    },
    {
      label: "VO2max",
      score: vo2Seconds / 300 + burstCount * 0.14,
      description: "Mehrere Abschnitte deutlich über Schwelle. Das deutet auf Sauerstofftransport und hohe aerobe Spitzenleistung als Trainingsreiz hin.",
    },
    {
      label: "Anaerob",
      score: anaerobicSeconds / 150 + burstCount * 0.2 + Math.max(0, (maxPowerRatio ?? 0) - 1.35) * 0.9,
      description: "Kurze sehr harte Belastungen und Spitzenleistung prägen den Ride. Das belastet anaerobe Kapazität und Laktatverträglichkeit stärker.",
    },
    {
      label: "Ermüdungsresistenz",
      score: movingHours * 0.8 + lateTempoSeconds / 1200 + Math.max(0, (stressScore ?? 0) - 85) / 55,
      description: "Späte, noch saubere Dauerarbeit spricht dafür, dass Belastung auch unter Vorermüdung gehalten wurde.",
    },
    {
      label: "Laktatabbau / Erholung",
      score: recoveryTransitions * 0.55 + weightedSecondsForRange(samples, (sample) => sample.power != null && ftpReferenceW != null && ftpReferenceW > 0 && sample.power / ftpReferenceW <= 0.68) / 2400,
      description: "Mehrere harte Phasen mit klaren Entlastungsfenstern. Das kann auf einen guten Wechsel zwischen Belastung und Abbau hindeuten.",
    },
  ]
    .filter((item) => item.score > 0.35)
    .sort((left, right) => right.score - left.score);

  const topFocus = focusCandidates[0] ?? {
    label: "Gemischter Reiz",
    score: 0,
    description: "Die Fahrt verteilt den Reiz recht breit, ohne dass ein einzelner Schwerpunkt klar dominiert.",
  };

  const aerobicFormula = ftpReferenceW && ftpReferenceW > 0
    ? `Berechnet aus Dauer, TSS/IF und Zeit in den Bereichen Grundlage, Tempo und Schwelle relativ zur FTP ${Math.round(ftpReferenceW)} W.`
    : "Berechnet aus verfügbarer Dauer- und Belastungsinformation. Für eine feinere Einordnung fehlt die FTP Referenz.";
  const anaerobicFormula = ftpReferenceW && ftpReferenceW > 0
    ? `Berechnet aus Zeit oberhalb der Schwelle, sehr harten Spitzen über FTP und der Häufigkeit kurzer Belastungs-Bursts.`
    : "Für einen belastbaren anaeroben Wert fehlt die FTP Referenz oder ausreichende Power-Spitzendaten.";
  const garminAerobic = activity.aerobic_training_effect;
  const garminAnaerobic = activity.anaerobic_training_effect;
  const aerobicDisplayScore = garminAerobic ?? aerobicScore;
  const anaerobicDisplayScore = garminAnaerobic ?? anaerobicScore;
  const aerobicMessage = humanizeTrainingEffectMessage(activity.aerobic_training_effect_message);
  const anaerobicMessage = humanizeTrainingEffectMessage(activity.anaerobic_training_effect_message);

  return {
    headline: aerobicMessage ?? topFocus.label,
    headlineReason: aerobicMessage
      ? `Garmin ordnet den Hauptreiz hier als "${aerobicMessage}" ein. Die ergänzende eigene Heuristik sieht den stärksten Schwerpunkt bei ${topFocus.label.toLowerCase()}.`
      : topFocus.description,
    bars: [
      {
        id: "aerobic",
        title: "Aerob",
        score: aerobicDisplayScore == null ? null : Number(aerobicDisplayScore.toFixed(1)),
        label: aerobicMessage ?? effectLevelLabel(aerobicDisplayScore),
        accentColor: "#5fd07b",
        help: buildEffectHelpText({
          score: aerobicDisplayScore,
          sourceText: garminAerobic != null ? `Der sichtbare Wert kommt direkt aus Garmin (${garminAerobic.toFixed(1)}). Unsere Heuristik dient hier nur zur Einordnung.` : undefined,
          formulaText: `${aerobicFormula} Konkret schauen wir auf die Fahrtdauer, auf IF und TSS als Verdichtung der Gesamtlast und darauf, wie viel Zeit wirklich in ruhiger Grundlage, im Tempo-Bereich und rund um die Schwelle verbracht wurde. Längere zusammenhängende Phasen in diesen Bereichen heben den aeroben Wert stärker an als kurze zufällige Spitzen.`,
          meaningText: "Ein höherer Wert bedeutet, dass dieser Ride eher die aerobe Ausdauer, nachhaltige Dauerleistung und Langzeitbelastbarkeit adressiert.",
          nextTrainingText: "Ein hoher aerober Wert spricht eher dafür, dass der Ride eine solide Ausdauer- oder Schwellenbasis gesetzt hat. In den Folgetagen passen dann je nach Ermüdung entweder lockere Einheiten zur Aufnahme des Reizes oder ein gezielter Qualitätsreiz auf einer anderen Ebene, statt denselben Reiz direkt wieder zu stapeln.",
        }),
      },
      {
        id: "anaerobic",
        title: "Anaerob",
        score: anaerobicDisplayScore == null ? null : Number(anaerobicDisplayScore.toFixed(1)),
        label: anaerobicMessage ?? effectLevelLabel(anaerobicDisplayScore),
        accentColor: "#58a7ff",
        help: buildEffectHelpText({
          score: anaerobicDisplayScore,
          sourceText: garminAnaerobic != null ? `Der sichtbare Wert kommt direkt aus Garmin (${garminAnaerobic.toFixed(1)}). Unsere Heuristik dient hier nur zur Einordnung.` : undefined,
          formulaText: `${anaerobicFormula} Dafür zählen wir vor allem Minuten deutlich oberhalb der Schwelle, wiederholte harte Bursts und die maximale Peakleistung relativ zur FTP. Einzelne Sprints reichen allein nicht, mehrere klar harte Abschnitte oder stark wiederholte Spitzen treiben den Wert deutlich stärker.`,
          meaningText: "Ein höherer Wert bedeutet mehr Reiz für Spitzenleistung, kurze harte Wiederholungen und die Fähigkeit, hohe Laktatlast zu tolerieren.",
          nextTrainingText: "Ein hoher anaerober Wert belastet meist stärker als die reine Dauer vermuten lässt. Danach sind oft lockere oder technisch saubere Tage sinnvoll, bevor erneut sehr hohe Spitzen oder harte Intervallblöcke folgen.",
        }),
      },
    ],
    zoneBars: [
      {
        id: "ga1",
        title: "GA1",
        score: Number(clamp(movingHours * 0.35 + enduranceSeconds / 3000 + weightedSecondsForRange(samples, (sample) => sample.power != null && ftpReferenceW != null && ftpReferenceW > 0 && sample.power / ftpReferenceW <= 0.75) / 3600, 0, 5).toFixed(1)),
        label: "Lockere bis ruhige Grundlage",
        accentColor: "#6fcf97",
        help: buildEffectHelpText({
          score: clamp(movingHours * 0.35 + enduranceSeconds / 3000 + weightedSecondsForRange(samples, (sample) => sample.power != null && ftpReferenceW != null && ftpReferenceW > 0 && sample.power / ftpReferenceW <= 0.75) / 3600, 0, 5),
          formulaText: ftpReferenceW && ftpReferenceW > 0 ? "Gewichtet aus Dauer und Zeit bis etwa 75 % FTP. Wir schauen dabei besonders darauf, wie viel echte zusammenhängende ruhige Dauerarbeit vorliegt und ob der Ride überwiegend kontrolliert statt sprunghaft war. Je länger und sauberer diese Anteile sind, desto höher fällt der GA1-Reiz aus." : "Für eine genaue GA1-Einordnung fehlt die FTP-Referenz; der Wert nutzt dann nur grobe Dauerinformation.",
          meaningText: "GA1 steht für ruhige Grundlagenausdauer mit geringer bis moderater metabolischer Last.",
          nextTrainingText: "Ein hoher GA1-Reiz ist meist gut verträglich und lässt sich oft mit weiteren lockeren oder moderaten Einheiten kombinieren. Für spätere harte Tage ist das häufig ein guter Basisreiz, ohne sofort viel Spitzenfrische zu kosten.",
        }),
      },
      {
        id: "ga2",
        title: "GA2",
        score: Number(clamp(tempoSeconds / 1800 + thresholdSeconds / 3000 + Math.max(0, (intensityFactor ?? 0) - 0.72) * 1.8, 0, 5).toFixed(1)),
        label: "Zügige Ausdauer",
        accentColor: "#34c759",
        help: buildEffectHelpText({
          score: clamp(tempoSeconds / 1800 + thresholdSeconds / 3000 + Math.max(0, (intensityFactor ?? 0) - 0.72) * 1.8, 0, 5),
          formulaText: "Gewichtet aus Zeit im oberen Dauerbereich bis knapp unter Schwelle. Entscheidend ist hier nicht nur die reine Minutenanzahl, sondern ob längere stabile Blöcke im zügigen Bereich gefahren wurden. Solche Blöcke zählen stärker als unruhige Spitzen mit viel Leerlauf dazwischen.",
          meaningText: "GA2 beschreibt zügige, aber noch kontrollierte Dauerarbeit mit klarer aerob-ökonomischer Belastung.",
          nextTrainingText: "Nach starkem GA2-Reiz passen oft lockere Folgetage oder eine klare Trennung zum nächsten harten Schlüsselreiz. Mehrere GA2-Tage hintereinander können schnell in graue Müdigkeit kippen, wenn keine Frische mehr da ist.",
        }),
      },
      {
        id: "sweetspot",
        title: "Sweetspot",
        score: Number(clamp(weightedSecondsForRange(samples, (sample) => sample.power != null && ftpReferenceW != null && ftpReferenceW > 0 && sample.power / ftpReferenceW >= 0.84 && sample.power / ftpReferenceW <= 0.97) / 1200 + thresholdSeconds / 3600, 0, 5).toFixed(1)),
        label: "Effizient knapp unter Schwelle",
        accentColor: "#f7c948",
        help: buildEffectHelpText({
          score: clamp(weightedSecondsForRange(samples, (sample) => sample.power != null && ftpReferenceW != null && ftpReferenceW > 0 && sample.power / ftpReferenceW >= 0.84 && sample.power / ftpReferenceW <= 0.97) / 1200 + thresholdSeconds / 3600, 0, 5),
          formulaText: "Gewichtet aus Zeit in einem Sweetspot-Fenster knapp unter FTP. Wir zählen vor allem stabile Minuten zwischen ungefähr 84 und 97 % FTP. Je länger diese Zeit ohne große Unterbrechungen gehalten wird, desto klarer ist der Sweetspot-Reiz.",
          meaningText: "Sweetspot steht für ökonomisch harte Dauerarbeit knapp unter der Schwelle.",
          nextTrainingText: "Ein hoher Sweetspot-Reiz ist oft effektiv, aber nicht kostenlos. Für spätere Trainings ist meist sinnvoll, danach entweder bewusst locker zu fahren oder den nächsten Qualitätsreiz deutlich anders zu setzen, statt sofort wieder knapp unter Schwelle zu arbeiten.",
        }),
      },
      {
        id: "threshold",
        title: "Schwelle",
        score: Number(clamp(thresholdSeconds / 900 + Math.max(0, (intensityFactor ?? 0) - 0.88) * 2.4, 0, 5).toFixed(1)),
        label: "Arbeit an FTP / Laktatschwelle",
        accentColor: "#ff9f43",
        help: buildEffectHelpText({
          score: clamp(thresholdSeconds / 900 + Math.max(0, (intensityFactor ?? 0) - 0.88) * 2.4, 0, 5),
          formulaText: "Gewichtet aus Zeit nahe 100 % FTP und der gesamten Belastungsdichte im Schwellenbereich. Dabei zählen zusammenhängende Minuten um die Schwelle besonders stark, weil sie physiologisch deutlich anders wirken als kurze Überschreitungen oder ein nur hoher Durchschnitt über den gesamten Ride.",
          meaningText: "Ein hoher Schwellenwert spricht für viel Arbeit an der Laktatschwelle und nahe FTP.",
          nextTrainingText: "Nach einem starken Schwellenreiz lohnt sich meist ein Blick auf Frische und Beine, bevor erneut FTP-nahe Arbeit geplant wird. Häufig ist zuerst ein lockerer oder klar anders gelagerter Reiz sinnvoll.",
        }),
      },
      {
        id: "vo2max",
        title: "VO2max",
        score: Number(clamp(vo2Seconds / 300 + burstCount * 0.14, 0, 5).toFixed(1)),
        label: "Hohe aerobe Spitzenarbeit",
        accentColor: "#5aa9ff",
        help: buildEffectHelpText({
          score: clamp(vo2Seconds / 300 + burstCount * 0.14, 0, 5),
          formulaText: "Gewichtet aus Minuten oberhalb der Schwelle bis etwa 120 % FTP und wiederholten harten Intervallen. Einzelne harte Momente zählen, aber besonders stark wirken mehrere wiederholte Intervalle oder Belastungen, die wirklich im VO2max-nahen Bereich lagen.",
          meaningText: "VO2max steht für sehr harte Belastungen, die Sauerstoffaufnahme und aerobe Spitzenleistung reizen.",
          nextTrainingText: "Ein starker VO2max-Reiz braucht meist mehr Erholung als ein normaler GA-Tag. In späteren Trainings ist dann oft sinnvoll, Qualität und Frische bewusst zu schützen und nicht zu früh erneut dieselbe Härte anzusetzen.",
        }),
      },
      {
        id: "anaerobic-peak",
        title: "Anaerob+",
        score: Number(clamp(anaerobicSeconds / 150 + burstCount * 0.2 + Math.max(0, (maxPowerRatio ?? 0) - 1.35) * 0.9, 0, 5).toFixed(1)),
        label: "Sehr harte, kurze Spitzen",
        accentColor: "#2f80ed",
        help: buildEffectHelpText({
          score: clamp(anaerobicSeconds / 150 + burstCount * 0.2 + Math.max(0, (maxPowerRatio ?? 0) - 1.35) * 0.9, 0, 5),
          formulaText: "Gewichtet aus sehr harter Zeit deutlich über FTP, Wiederholungen und Peakleistung. Der Wert steigt besonders dann, wenn es nicht nur einzelne kurze Spitzen gab, sondern mehrere klare harte Belastungen mit echter anaerober Beanspruchung.",
          meaningText: "Dieser Wert beschreibt den Reiz auf anaerobe Kapazität, Sprintnähe und hohe Laktatlast.",
          nextTrainingText: "Ein hoher Anaerob+-Reiz spricht eher für vorsichtige Steuerung in den Folgetagen. Häufig lohnt es sich, erst wieder Frische aufzubauen, bevor neue Sprints, Attacken oder harte Kurzintervalle geplant werden.",
        }),
      },
    ],
  };
}

function buildMinuteBuckets(samples: AnalysisSample[]): Array<{ start: number; end: number; avgPower: number | null; avgHr: number | null; seconds: number }> {
  const buckets = new Map<number, { power: number; hr: number; powerSeconds: number; hrSeconds: number; totalSeconds: number }>();

  for (const sample of samples) {
    const minute = Math.floor(sample.elapsed / 60);
    const bucket = buckets.get(minute) ?? { power: 0, hr: 0, powerSeconds: 0, hrSeconds: 0, totalSeconds: 0 };
    bucket.totalSeconds += sample.seconds;
    if (sample.power != null) {
      bucket.power += sample.power * sample.seconds;
      bucket.powerSeconds += sample.seconds;
    }
    if (sample.heartRate != null) {
      bucket.hr += sample.heartRate * sample.seconds;
      bucket.hrSeconds += sample.seconds;
    }
    buckets.set(minute, bucket);
  }

  return Array.from(buckets.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([minute, bucket]) => ({
      start: minute * 60,
      end: minute * 60 + 60,
      avgPower: bucket.powerSeconds > 0 ? bucket.power / bucket.powerSeconds : null,
      avgHr: bucket.hrSeconds > 0 ? bucket.hr / bucket.hrSeconds : null,
      seconds: bucket.totalSeconds,
    }))
    .filter((bucket) => bucket.seconds >= 30);
}

function deriveDriftSignals(samples: AnalysisSample[]): DriftSignal[] {
  const buckets = buildMinuteBuckets(samples);
  if (buckets.length < 6) return [];

  const candidates: Array<DriftSignal & { start: number; end: number; magnitude: number }> = [];

  for (let index = 0; index <= buckets.length - 6; index += 1) {
    const segment = buckets.slice(index, index + 6);
    const startBlock = segment.slice(0, 3);
    const endBlock = segment.slice(3);
    const startPower = weightedAverage(startBlock.map((item) => ({ value: item.avgPower ?? NaN, weight: item.seconds })));
    const endPower = weightedAverage(endBlock.map((item) => ({ value: item.avgPower ?? NaN, weight: item.seconds })));
    const startHr = weightedAverage(startBlock.map((item) => ({ value: item.avgHr ?? NaN, weight: item.seconds })));
    const endHr = weightedAverage(endBlock.map((item) => ({ value: item.avgHr ?? NaN, weight: item.seconds })));

    if (startPower == null || endPower == null || startHr == null || endHr == null || startPower <= 0 || endPower <= 0) {
      continue;
    }

    const powerDeltaPct = ((endPower / startPower) - 1) * 100;
    const hrDelta = endHr - startHr;
    const driftPct = (((endHr / endPower) / (startHr / startPower)) - 1) * 100;
    const absDrift = Math.abs(driftPct);
    if (absDrift < 3.5) continue;

    let direction: "positive" | "negative" | null = null;
    let title = "";
    let summary = "";

    if (Math.abs(powerDeltaPct) <= 6 && hrDelta >= 4 && driftPct > 0) {
      direction = "positive";
      title = "Stetiger Anstieg bei stabiler Leistung";
      summary = `Die Herzfrequenz stieg trotz nahezu gleicher Leistung um ${Math.round(hrDelta)} bpm. Das ist ein klassisches positives Drift-Signal und kann auf thermische Last, Ermüdung oder sinkende Effizienz hindeuten.`;
    } else if (Math.abs(powerDeltaPct) <= 6 && hrDelta <= -4 && driftPct < 0) {
      direction = "negative";
      title = "Beruhigung bei ähnlicher Leistung";
      summary = `Die Herzfrequenz fiel bei fast gleicher Leistung um ${Math.round(Math.abs(hrDelta))} bpm. Das spricht eher für Stabilisierung, gutes Einrollen oder Erholung innerhalb des Blocks.`;
    } else if (powerDeltaPct >= 8 && hrDelta >= 5 && driftPct > 0) {
      direction = "positive";
      title = "HF zieht nach Power-Peak nach";
      summary = `Die Leistung wurde deutlich angehoben und die Herzfrequenz zog spürbar nach. Das ist eine interessante Drift-Stelle, weil die metabolische Last noch anstieg, während der Block härter wurde.`;
    } else if (powerDeltaPct <= -8 && hrDelta <= -5 && driftPct < 0) {
      direction = "negative";
      title = "Erholung nach Peak";
      summary = `Nach einem härteren Abschnitt fielen Leistung und Herzfrequenz wieder gemeinsam ab. Die negative Drift zeigt hier vor allem das Runterkommen nach einem Peak.`;
    }

    if (!direction) continue;

    candidates.push({
      key: `${direction}-${segment[0].start}-${segment[segment.length - 1].end}`,
      direction,
      directionLabel: direction === "positive" ? "Positiver Drift" : "Negativer Drift",
      title,
      timeLabel: `${formatSeconds(segment[0].start)} - ${formatSeconds(segment[segment.length - 1].end)}`,
      powerLabel: `${Math.round(startPower)} -> ${Math.round(endPower)} W (${formatSignedNumber(powerDeltaPct, 1, " %")})`,
      heartRateLabel: `${Math.round(startHr)} -> ${Math.round(endHr)} bpm (${formatSignedNumber(hrDelta, 0, " bpm")})`,
      driftLabel: `${formatSignedNumber(driftPct, 1, " %")}`,
      summary,
      start: segment[0].start,
      end: segment[segment.length - 1].end,
      magnitude: absDrift,
    });
  }

  const selected: Array<DriftSignal & { start: number; end: number; magnitude: number }> = [];
  for (const candidate of candidates.sort((left, right) => right.magnitude - left.magnitude)) {
    const overlaps = selected.some((item) => candidate.start < item.end - 120 && candidate.end > item.start + 120);
    if (overlaps) continue;
    selected.push(candidate);
    if (selected.length >= 4) break;
  }

  return selected
    .sort((left, right) => left.start - right.start)
    .map(({ start: _start, end: _end, magnitude: _magnitude, ...signal }) => signal);
}

function ActivityEffectGauge({
  title,
  score,
  label,
  accentColor,
  help,
  onOpenHelp,
}: TrainingEffectBarData & { onOpenHelp: (title: string, description: string) => void }) {
  const markerLeft = score == null ? 0 : clamp((score / 5) * 100, 0, 100);

  return (
    <article className="activity-effect-card">
      <div className="activity-effect-head">
        <div>
          <span className="activity-effect-value">{score == null ? "-" : score.toFixed(1)}</span>
          <div className="activity-effect-label-row">
            <strong>{title}</strong>
            <button className="activity-effect-help-button" type="button" onClick={() => onOpenHelp(`${title} Analyse`, help)} aria-label={`${title} Erklärung öffnen`}>
              ?
            </button>
          </div>
          <small>{label}</small>
        </div>
      </div>
      <div className="activity-effect-bar" aria-hidden="true">
        {TRAINING_EFFECT_COLORS.map((segmentColor, index) => (
          <span key={`${title}-segment-${index}`} style={{ background: segmentColor }} />
        ))}
        {score != null ? <i style={{ left: `calc(${markerLeft}% - 0.5rem)`, borderColor: accentColor }} /> : null}
      </div>
    </article>
  );
}

function ZoneDurationChart({
  title,
  rows,
  suffix,
}: {
  title: string;
  rows: ZoneDurationRow[];
  suffix: string;
}) {
  return (
    <div className="activity-zone-duration-list" aria-label={title}>
      {rows.map((row) => (
        <div key={`${title}-${row.zone.id}`} className="activity-zone-duration-row">
          <div className="activity-zone-duration-meta">
            <strong>{row.zone.shortLabel} {row.zone.label}</strong>
            <span>{formatZoneRange(row.zone.min, row.zone.max, suffix)}</span>
          </div>
          <div className="activity-zone-duration-bar">
            <div style={{ width: `${row.sharePercent}%`, background: row.zone.color }} />
          </div>
          <div className="activity-zone-duration-value">
            <strong>{formatSeconds(row.seconds)}</strong>
            <span>{row.sharePercent.toFixed(1)} %</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function buildRollingAverageChartPoints(samples: AnalysisSample[], pick: (sample: AnalysisSample) => number | null, windowSeconds = 300): ChartPoint[] {
  const perSecond: Array<{ elapsed: number; value: number }> = [];
  for (const sample of samples) {
    const value = pick(sample);
    if (value == null || !Number.isFinite(value)) continue;
    for (let offset = 0; offset < sample.seconds; offset += 1) {
      perSecond.push({ elapsed: Math.round(sample.elapsed) + offset, value });
    }
  }
  if (perSecond.length < 2) return [];

  const points: ChartPoint[] = [];
  let rollingSum = 0;
  for (let index = 0; index < perSecond.length; index += 1) {
    rollingSum += perSecond[index].value;
    if (index >= windowSeconds) {
      rollingSum -= perSecond[index - windowSeconds].value;
    }
    const divisor = Math.min(index + 1, windowSeconds);
    points.push({
      elapsed: perSecond[index].elapsed,
      value: rollingSum / divisor,
    });
  }
  return points;
}

function ZoneTimelineChart({
  title,
  samples,
  pick,
  zones,
  segments,
  totalDuration,
  zone,
  selectedZoneId,
  onSelectZone,
  suffix,
  digits,
}: {
  title: string;
  samples: AnalysisSample[];
  pick: (sample: AnalysisSample) => number | null;
  zones: ZoneDefinition[];
  segments: ZoneSegment[];
  totalDuration: number;
  zone: ZoneDefinition | null;
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string | null) => void;
  suffix: string;
  digits: number;
}) {
  const chartPoints = useMemo(() => buildRollingAverageChartPoints(samples, pick, 300), [pick, samples]);
  const values = chartPoints.map((point) => point.value);
  const bounds = useMemo(() => computeAxisBounds(values), [values]);
  const [chartContainerRef, svgWidth] = useResponsiveChartWidth();
  const chartLeft = 64;
  const chartRight = 36;
  const chartTop = 56;
  const chartHeight = 220;
  const chartWidth = Math.max(240, svgWidth - chartLeft - chartRight);
  const ticks = Array.from({ length: 5 }, (_, index) => (totalDuration / 4) * index);
  const yTicks =
    bounds != null
      ? Array.from({ length: 5 }, (_, index) => bounds.min + ((bounds.max - bounds.min) / 4) * index)
      : [];
  const linePoints = useMemo(() => buildPolyline(chartPoints, totalDuration, chartWidth, chartHeight), [chartPoints, chartHeight, chartWidth, totalDuration]);
  const areaPath = useMemo(() => buildAreaPath(chartPoints, totalDuration, chartWidth, chartHeight), [chartPoints, chartHeight, chartWidth, totalDuration]);

  return (
    <div className="card">
      <div className="section-title-row">
        <h2>{title}</h2>
        <span className="training-note">
          {zone ? `${zone.shortLabel} ${zone.label} | 5-Minuten-Schnitt | ${segments.length} Segment${segments.length === 1 ? "" : "e"}` : "Bitte eine Zone auswählen"}
        </span>
      </div>
      <p className="training-note">
        Angezeigt werden nur zusammenhängende Zeitblöcke, in denen der gleitende 5-Minuten-Schnitt vollständig in der gewählten Zone lag. Sobald dieser Schnitt in eine andere Zone kippt, wird der Block beendet.
      </p>
      <div ref={chartContainerRef}>
        <svg viewBox={`0 0 ${svgWidth} 360`} style={{ width: "100%", height: "360px", display: "block" }} aria-label={title}>
          <rect x="0" y="0" width={svgWidth} height="360" rx="18" fill="#f7fcfa" />
          <foreignObject x={chartLeft} y="10" width={chartWidth} height="34">
            <div className="activity-zone-inline-selector">
              {zones.map((item) => (
                <button
                  key={`${title}-${item.id}`}
                  className={`activity-zone-inline-chip ${selectedZoneId === item.id ? "selected" : ""}`}
                  type="button"
                  onClick={() => onSelectZone(selectedZoneId === item.id ? null : item.id)}
                >
                  {item.shortLabel}
                </button>
              ))}
            </div>
          </foreignObject>
          {yTicks.map((tick, index) => {
            const y = chartTop + chartHeight - ((tick - (bounds?.axisMin ?? 0)) / Math.max(1, bounds?.span ?? 1)) * chartHeight;
            return (
              <g key={`${title}-y-${index}`}>
                <line x1={chartLeft} y1={y} x2={chartLeft + chartWidth} y2={y} stroke="#d9e8e2" strokeWidth="1" />
                <text x={chartLeft - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#5d756f">
                  {formatNumber(tick, digits, suffix)}
                </text>
              </g>
            );
          })}
          <line x1={chartLeft} y1={chartTop + chartHeight} x2={chartLeft + chartWidth} y2={chartTop + chartHeight} stroke="#8fb7ab" strokeWidth="1.4" />
          <line x1={chartLeft} y1={chartTop} x2={chartLeft} y2={chartTop + chartHeight} stroke="#8fb7ab" strokeWidth="1.4" />
          {ticks.map((tick, index) => {
            const x = chartLeft + (tick / Math.max(1, totalDuration)) * chartWidth;
            return (
              <g key={`${title}-tick-${index}`}>
                <line x1={x} y1={chartTop} x2={x} y2={chartTop + chartHeight} stroke="#e2efe9" strokeWidth="1" />
                <text x={x} y={chartTop + chartHeight + 28} textAnchor="middle" fontSize="12" fill="#5d756f">
                  {formatAxisTime(tick)}
                </text>
              </g>
            );
          })}
          <g transform={`translate(${chartLeft}, ${chartTop})`}>
            {areaPath ? <path d={areaPath} fill={zone?.color ?? "#8fc7b8"} opacity="0.12" /> : null}
            {linePoints ? <polyline fill="none" stroke={zone?.color ?? "#1f8b6f"} strokeOpacity="0.86" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={linePoints} /> : null}
          </g>
          {segments.map((segment, index) => {
            const x = chartLeft + (segment.start / Math.max(1, totalDuration)) * chartWidth;
            const width = Math.max(4, (segment.seconds / Math.max(1, totalDuration)) * chartWidth);
            return <rect key={`${title}-segment-${index}`} x={x} y={chartTop} width={width} height={chartHeight} rx="10" fill={zone?.color ?? "#1f8b6f"} opacity="0.16" />;
          })}
          {segments.map((segment, index) => {
            const x = chartLeft + (segment.start / Math.max(1, totalDuration)) * chartWidth;
            const width = Math.max(60, (segment.seconds / Math.max(1, totalDuration)) * chartWidth);
            const labelX = Math.min(chartLeft + chartWidth - 32, x + width / 2);
            return (
              <text key={`${title}-label-${index}`} x={labelX} y={chartTop + 18} textAnchor="middle" fontSize="12" fill="#20463f">
                {formatAxisTime(segment.start)} - {formatAxisTime(segment.end)} | {formatSeconds(segment.seconds)}
              </text>
            );
          })}
          {!segments.length ? (
            <text x={chartLeft + chartWidth / 2} y={chartTop + 110} textAnchor="middle" fontSize="14" fill="#58716b">
              Keine zusammenhängenden 5-Minuten-Blöcke in dieser Zone gefunden.
            </text>
          ) : null}
          <text x={chartLeft + chartWidth / 2} y={chartTop + chartHeight + 56} textAnchor="middle" fontSize="13" fill="#3f5d57">
            Zeitachse
          </text>
        </svg>
      </div>
    </div>
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

function interpolateElapsedAtDistance(points: Array<{ distanceM: number; elapsed: number }>, distanceM: number): number | null {
  if (!points.length || !Number.isFinite(distanceM)) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (distanceM <= first.distanceM) return first.elapsed;
  if (distanceM >= last.distanceM) return last.elapsed;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const lower = Math.min(previous.distanceM, current.distanceM);
    const upper = Math.max(previous.distanceM, current.distanceM);
    if (distanceM < lower || distanceM > upper) continue;
    const span = current.distanceM - previous.distanceM;
    if (span === 0) return current.elapsed;
    const ratio = (distanceM - previous.distanceM) / span;
    return previous.elapsed + (current.elapsed - previous.elapsed) * ratio;
  }

  return findNearestPointByDistance(points, distanceM)?.elapsed ?? null;
}

function formatAxisDistanceWithTime(points: Array<{ distanceM: number; elapsed: number }>, distanceM: number): { distance: string; time: string } {
  const elapsed = interpolateElapsedAtDistance(points, distanceM);
  return {
    distance: formatAxisDistance(distanceM),
    time: elapsed == null ? "-" : formatAxisTime(elapsed),
  };
}

function formatDistanceTimeRange(points: Array<{ distanceM: number; elapsed: number }>, range: DistanceRange | null): string {
  if (!points.length) return "Distanz: - | Zeit: -";
  const first = points[0];
  const last = points[points.length - 1];
  const startDistance = range ? range.start : first.distanceM;
  const endDistance = range ? range.end : last.distanceM;
  const startTime = interpolateElapsedAtDistance(points, startDistance);
  const endTime = interpolateElapsedAtDistance(points, endDistance);
  return `Distanz: ${formatAxisDistance(startDistance)} bis ${formatAxisDistance(endDistance)} | Zeit: ${startTime == null ? "-" : formatAxisTime(startTime)} bis ${endTime == null ? "-" : formatAxisTime(endTime)}`;
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

function useResponsiveChartWidth(minWidth = 360): [(element: HTMLDivElement | null) => void, number] {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [svgWidth, setSvgWidth] = useState(1000);

  useEffect(() => {
    if (!containerElement) return;
    const element = containerElement;

    function updateWidth(nextWidth?: number) {
      const measuredWidth = nextWidth ?? element.getBoundingClientRect().width;
      setSvgWidth(Math.max(minWidth, Math.round(measuredWidth)));
    }

    updateWidth();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      updateWidth(entry?.contentRect.width);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [containerElement, minWidth]);

  return [setContainerElement, svgWidth];
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

function buildPolyline(points: ChartPoint[], duration = 0, width = 900, height = 220): string | null {
  if (points.length < 2) return null;
  const maxValue = Math.max(...points.map((item) => item.value));
  const minValue = Math.min(...points.map((item) => item.value));
  const rawSpan = maxValue - minValue;
  const paddedMin = rawSpan === 0 ? minValue - Math.max(1, Math.abs(minValue) * 0.1) : minValue - rawSpan * 0.08;
  const paddedMax = rawSpan === 0 ? maxValue + Math.max(1, Math.abs(maxValue) * 0.1) : maxValue + rawSpan * 0.08;
  const span = Math.max(1, paddedMax - paddedMin);
  const maxElapsed = Math.max(duration, ...points.map((item) => item.elapsed), 1);
  return points
    .map((point) => {
      const x = (point.elapsed / maxElapsed) * width;
      const y = height - ((point.value - paddedMin) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildAreaPath(points: ChartPoint[], duration = 0, width = 900, height = 220): string | null {
  if (points.length < 2) return null;
  const maxValue = Math.max(...points.map((item) => item.value));
  const minValue = Math.min(...points.map((item) => item.value));
  const rawSpan = maxValue - minValue;
  const paddedMin = rawSpan === 0 ? minValue - Math.max(1, Math.abs(minValue) * 0.1) : minValue - rawSpan * 0.08;
  const paddedMax = rawSpan === 0 ? maxValue + Math.max(1, Math.abs(maxValue) * 0.1) : maxValue + rawSpan * 0.08;
  const span = Math.max(1, paddedMax - paddedMin);
  const maxElapsed = Math.max(duration, ...points.map((item) => item.elapsed), 1);
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

function isRouteGeoPoint(point: RoutePoint): point is RouteGeoPoint {
  return (
    point.latitudeDeg != null &&
    Number.isFinite(point.latitudeDeg) &&
    Math.abs(point.latitudeDeg) <= 90 &&
    point.longitudeDeg != null &&
    Number.isFinite(point.longitudeDeg) &&
    Math.abs(point.longitudeDeg) <= 180
  );
}

function findNearestPointIndexByElapsed<T extends { elapsed: number }>(points: T[], elapsed: number | null): number {
  if (!points.length || elapsed == null) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  points.forEach((point, index) => {
    const distance = Math.abs(point.elapsed - elapsed);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function buildPlaybackDurationMs(pointCount: number): number {
  return clamp(pointCount * 22, 14000, 42000);
}

type MutableGeoJsonSource = {
  setData: (data: GeoJsonLineCollection | GeoJsonPointCollection) => void;
};

function extractTrackGeoJsonCoordinates(points: RoutePoint[]): Array<[number, number]> {
  return points
    .filter(
      (point): point is RoutePoint & { latitudeDeg: number; longitudeDeg: number } =>
        point.latitudeDeg != null && Number.isFinite(point.latitudeDeg) && point.longitudeDeg != null && Number.isFinite(point.longitudeDeg),
    )
    .map((point) => [point.longitudeDeg, point.latitudeDeg] as [number, number])
    .filter(([lng, lat]) => Number.isFinite(lng) && Math.abs(lng) <= 180 && Number.isFinite(lat) && Math.abs(lat) <= 90);
}

function buildLineFeatureCollection(coordinates: Array<[number, number]>): GeoJsonLineCollection {
  if (coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates,
        },
      },
    ],
  };
}

function buildPointFeatureCollection(coordinate: [number, number] | null): GeoJsonPointCollection {
  if (!coordinate) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Point",
          coordinates: coordinate,
        },
      },
    ],
  };
}

function buildTrackBounds(coordinates: Array<[number, number]>): LngLatBoundsLike | null {
  if (!coordinates.length) return null;
  const lngs = coordinates.map((point) => point[0]);
  const lats = coordinates.map((point) => point[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

function expandMapLibreTileUrls(tileUrl: string): string[] {
  if (!tileUrl.includes("{s}")) return [tileUrl];
  return ["a", "b", "c"].map((subdomain) => tileUrl.split("{s}").join(subdomain));
}

function buildActivityMap3dStyle(): StyleSpecification | string {
  if (MAP_3D_STYLE_URL) return MAP_3D_STYLE_URL;

  return {
    version: 8,
    name: "TrainMind Terrain Raster",
    sources: {
      "trainmind-raster": {
        type: "raster",
        tiles: expandMapLibreTileUrls(MAP_TILE_URL),
        tileSize: 256,
        attribution: MAP_TILE_ATTRIBUTION,
        maxzoom: MAP_MAX_ZOOM,
      },
    },
    layers: [
      {
        id: "trainmind-background",
        type: "background",
        paint: {
          "background-color": "#edf5f1",
        },
      },
      {
        id: "trainmind-raster",
        type: "raster",
        source: "trainmind-raster",
        minzoom: 0,
        maxzoom: MAP_MAX_ZOOM,
        paint: {
          "raster-opacity": 1,
          "raster-saturation": -0.08,
          "raster-contrast": 0.08,
        },
      },
    ],
  };
}

function bearingBetweenRoutePoints(from: RouteGeoPoint, to: RouteGeoPoint): number {
  const fromLat = (from.latitudeDeg * Math.PI) / 180;
  const toLat = (to.latitudeDeg * Math.PI) / 180;
  const deltaLon = ((to.longitudeDeg - from.longitudeDeg) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

function normalizeBearingForAnimation(nextBearing: number, currentBearing: number): number {
  const delta = ((((nextBearing - currentBearing) % 360) + 540) % 360) - 180;
  return currentBearing + delta;
}

type PlaybackCameraState = {
  center: [number, number];
  bearing: number;
  pitch: number;
  zoom: number;
  offset: [number, number];
};

type PlaybackCameraMode = "preview" | "playback";

type OverviewCameraState = {
  bounds: LngLatBoundsLike | null;
  bearing: number;
  pitch: number;
  maxZoom: number;
  offset: [number, number];
  padding: number;
  focusAltitudeM?: number;
};

type StartViewCalibrationSnapshot = {
  center: [number, number];
  terrainHeightM: number | null;
  zoom: number;
  pitch: number;
  bearing: number;
};

type StartViewCalibrationSample = {
  activityReference: string;
  start: StartViewCalibrationSnapshot;
  best: StartViewCalibrationSnapshot;
};

type StartViewCalibration = {
  sampleCount: number;
  forwardMeters: number;
  rightMeters: number;
  zoomDelta: number;
  pitchDelta: number;
  bearingDelta: number;
};

const START_VIEW_CALIBRATION_SAMPLES: StartViewCalibrationSample[] = [
  {
    activityReference: "22619403357",
    start: {
      center: [7.699941, 47.632433],
      terrainHeightM: 0,
      zoom: 15.75,
      pitch: 58,
      bearing: -28.5,
    },
    best: {
      center: [7.700526, 47.632696],
      terrainHeightM: 407.8,
      zoom: 18.74,
      pitch: 58,
      bearing: -28.5,
    },
  },
];

function metersPerLongitudeDegree(latitudeDeg: number): number {
  return Math.cos((latitudeDeg * Math.PI) / 180) * 111_320;
}

function normalizeBearingDelta(nextBearing: number, currentBearing: number): number {
  return ((((nextBearing - currentBearing) % 360) + 540) % 360) - 180;
}

function resolveCalibrationOffsetsMeters(
  start: StartViewCalibrationSnapshot,
  best: StartViewCalibrationSnapshot,
): { forwardMeters: number; rightMeters: number } {
  const referenceLatitude = (start.center[1] + best.center[1]) / 2;
  const eastMeters = (best.center[0] - start.center[0]) * metersPerLongitudeDegree(referenceLatitude);
  const northMeters = (best.center[1] - start.center[1]) * 111_320;
  const bearingRad = (start.bearing * Math.PI) / 180;
  const forwardMeters = eastMeters * Math.sin(bearingRad) + northMeters * Math.cos(bearingRad);
  const rightMeters = eastMeters * Math.cos(bearingRad) - northMeters * Math.sin(bearingRad);
  return { forwardMeters, rightMeters };
}

function buildStartViewCalibration(samples: StartViewCalibrationSample[]): StartViewCalibration {
  if (!samples.length) {
    return {
      sampleCount: 0,
      forwardMeters: 0,
      rightMeters: 0,
      zoomDelta: 0,
      pitchDelta: 0,
      bearingDelta: 0,
    };
  }

  const totals = samples.reduce(
    (accumulator, sample) => {
      const offsets = resolveCalibrationOffsetsMeters(sample.start, sample.best);
      accumulator.forwardMeters += offsets.forwardMeters;
      accumulator.rightMeters += offsets.rightMeters;
      accumulator.zoomDelta += sample.best.zoom - sample.start.zoom;
      accumulator.pitchDelta += sample.best.pitch - sample.start.pitch;
      accumulator.bearingDelta += normalizeBearingDelta(sample.best.bearing, sample.start.bearing);
      return accumulator;
    },
    {
      forwardMeters: 0,
      rightMeters: 0,
      zoomDelta: 0,
      pitchDelta: 0,
      bearingDelta: 0,
    },
  );

  return {
    sampleCount: samples.length,
    forwardMeters: totals.forwardMeters / samples.length,
    rightMeters: totals.rightMeters / samples.length,
    zoomDelta: totals.zoomDelta / samples.length,
    pitchDelta: totals.pitchDelta / samples.length,
    bearingDelta: totals.bearingDelta / samples.length,
  };
}

function offsetCoordinateByMeters(
  center: [number, number],
  bearing: number,
  forwardMeters: number,
  rightMeters: number,
): [number, number] {
  const bearingRad = (bearing * Math.PI) / 180;
  const eastMeters = forwardMeters * Math.sin(bearingRad) + rightMeters * Math.cos(bearingRad);
  const northMeters = forwardMeters * Math.cos(bearingRad) - rightMeters * Math.sin(bearingRad);
  const latitudeDeg = center[1] + northMeters / 111_320;
  const longitudeScale = Math.max(1, metersPerLongitudeDegree(center[1]));
  const longitudeDeg = center[0] + eastMeters / longitudeScale;
  return [longitudeDeg, latitudeDeg];
}

const START_VIEW_CALIBRATION = buildStartViewCalibration(START_VIEW_CALIBRATION_SAMPLES);

const START_VIEW_ZOOM_LIMITS = {
  min: 15.2,
  max: 19.25,
};

function moveMapToPlaybackCamera(map: MapLibreMap, playbackCameraState: PlaybackCameraState, currentBearing: number, duration: number) {
  const animatedBearing = normalizeBearingForAnimation(playbackCameraState.bearing, currentBearing);
  map.easeTo({
    center: playbackCameraState.center,
    bearing: animatedBearing,
    pitch: playbackCameraState.pitch,
    zoom: playbackCameraState.zoom,
    offset: playbackCameraState.offset,
    duration,
    essential: true,
  });
  return animatedBearing;
}

function moveMapToOverviewCamera(
  map: MapLibreMap,
  overviewCameraState: OverviewCameraState,
  currentBearing: number,
  duration: number,
) {
  if (overviewCameraState.bounds) {
    map.fitBounds(overviewCameraState.bounds, {
      padding: overviewCameraState.padding,
      duration: 0,
      maxZoom: overviewCameraState.maxZoom,
    });
  }

  const targetBearing = overviewCameraState.bearing + START_VIEW_CALIBRATION.bearingDelta;
  const calibratedCenter = offsetCoordinateByMeters(
    [map.getCenter().lng, map.getCenter().lat],
    targetBearing,
    START_VIEW_CALIBRATION.forwardMeters,
    START_VIEW_CALIBRATION.rightMeters,
  );
  const calibratedZoom = clamp(
    Math.min(map.getZoom(), overviewCameraState.maxZoom) + START_VIEW_CALIBRATION.zoomDelta,
    START_VIEW_ZOOM_LIMITS.min,
    START_VIEW_ZOOM_LIMITS.max,
  );
  const calibratedPitch = clamp(
    overviewCameraState.pitch + START_VIEW_CALIBRATION.pitchDelta,
    46,
    MAP_3D_MAX_PITCH - 6,
  );
  const animatedBearing = normalizeBearingForAnimation(targetBearing, currentBearing);
  window.requestAnimationFrame(() => {
    map.easeTo({
      center: calibratedCenter,
      elevation: overviewCameraState.focusAltitudeM,
      bearing: animatedBearing,
      pitch: calibratedPitch,
      zoom: calibratedZoom,
      offset: overviewCameraState.offset,
      duration,
      essential: true,
    });
  });
  return animatedBearing;
}

function buildOverviewCameraState(points: RouteGeoPoint[], activePoint: RoutePoint | null): OverviewCameraState | null {
  if (!points.length) return null;

  const anchorPoint = activePoint && isRouteGeoPoint(activePoint) ? activePoint : points[0];
  const activeIndex = findNearestPointIndexByElapsed(points, anchorPoint.elapsed);
  const lookBehindPoint = points[Math.max(0, activeIndex - 2)] ?? points[activeIndex];
  const lookAheadPoint = points[Math.min(points.length - 1, activeIndex + 6)] ?? points[activeIndex];
  const overviewFocusPoint = points[Math.min(points.length - 1, activeIndex + 2)] ?? anchorPoint;
  const rawBearing =
    lookAheadPoint === lookBehindPoint
      ? MAP_3D_BEARING
      : bearingBetweenRoutePoints(lookBehindPoint, lookAheadPoint);
  const bearingDelta = ((((rawBearing - MAP_3D_BEARING) % 360) + 540) % 360) - 180;
  const climbGrade = Math.max(0, anchorPoint.gradePct ?? 0);
  const overviewWindowEnd = Math.min(points.length, activeIndex + 22);
  const overviewWindowCoordinates = points
    .slice(Math.max(0, activeIndex - 2), overviewWindowEnd)
    .map((point) => [point.longitudeDeg, point.latitudeDeg] as [number, number]);

  return {
    bounds: buildTrackBounds(overviewWindowCoordinates),
    bearing: MAP_3D_BEARING + bearingDelta * 0.72,
    pitch: clamp(58 - climbGrade * 0.1, 55, Math.min(64, MAP_3D_MAX_PITCH - 10)),
    maxZoom: clamp(15.75 - climbGrade * 0.02, 15.45, 15.95),
    offset: [0, Math.round(clamp(56 - climbGrade * 0.7, 46, 60))] as [number, number],
    padding: 56,
    focusAltitudeM: overviewFocusPoint.altitudeM ?? anchorPoint.altitudeM ?? undefined,
  };
}

function buildPlaybackCameraState(
  points: RouteGeoPoint[],
  activePoint: RoutePoint | null,
  mode: PlaybackCameraMode = "playback",
): PlaybackCameraState | null {
  if (!points.length || !activePoint || !isRouteGeoPoint(activePoint)) return null;

  const activeIndex = findNearestPointIndexByElapsed(points, activePoint.elapsed);
  const speedKmh =
    activePoint.speedKmh ??
    points[Math.min(points.length - 1, activeIndex + 1)]?.speedKmh ??
    points[Math.max(0, activeIndex - 1)]?.speedKmh ??
    24;
  const lookAheadSteps = clamp(Math.round(speedKmh / 7), 3, 12);
  const lookBehindSteps = clamp(Math.round(speedKmh / 18), 1, 4);
  const previewAheadSteps = clamp(lookAheadSteps + 4, 6, 18);
  const lookBehindPoint = points[Math.max(0, activeIndex - lookBehindSteps)] ?? points[activeIndex];
  const lookAheadPoint =
    points[Math.min(points.length - 1, activeIndex + (mode === "preview" ? previewAheadSteps : lookAheadSteps))] ?? points[activeIndex];
  const rawBearing =
    lookAheadPoint === lookBehindPoint
      ? MAP_3D_BEARING
      : bearingBetweenRoutePoints(lookBehindPoint, lookAheadPoint);
  const previewBearingDelta = ((((rawBearing - MAP_3D_BEARING) % 360) + 540) % 360) - 180;
  const previewBearing = MAP_3D_BEARING + previewBearingDelta * 0.72;
  const climbGrade = Math.max(0, activePoint.gradePct ?? 0);
  const descentGrade = Math.max(0, -(activePoint.gradePct ?? 0));
  const gradeBoost = climbGrade * 0.06;
  const previewCenterPoint =
    points[Math.min(points.length - 1, activeIndex + clamp(Math.round(previewAheadSteps * 0.14), 0, 2))] ?? points[activeIndex];
  const isStartSequence = mode === "playback" && activeIndex < 8;
  const playbackCenterSteps = clamp(Math.round(lookAheadSteps * 0.4 + climbGrade / 3.5), 1, 8);
  const playbackCenterPoint = points[Math.min(points.length - 1, activeIndex + playbackCenterSteps)] ?? points[activeIndex];
  const climbPitchReduction = clamp(climbGrade * 0.82, 0, 12);
  const climbZoomReduction = clamp(climbGrade * 0.055, 0, 0.92);
  const zoom =
    mode === "preview"
      ? clamp(15.78 - speedKmh / 280 - climbZoomReduction * 0.16 + descentGrade * 0.01 + gradeBoost * 0.05, 15.45, 16.05)
      : isStartSequence
        ? clamp(15.6 - speedKmh / 240 - climbZoomReduction * 0.2 + descentGrade * 0.01, 15.3, 15.9)
      : clamp(16.15 - speedKmh / 92 - climbZoomReduction + descentGrade * 0.02, 15.05, 16.4);
  const pitch =
    mode === "preview"
      ? clamp(59 + speedKmh / 34 - climbPitchReduction * 0.1, 56, Math.min(66, MAP_3D_MAX_PITCH - 9))
      : isStartSequence
        ? clamp(58 + speedKmh / 26 - climbPitchReduction * 0.16, 55, Math.min(64, MAP_3D_MAX_PITCH - 10))
      : clamp(73 + speedKmh / 13 - climbPitchReduction, 62, MAP_3D_MAX_PITCH - 3);

  return {
    center:
      mode === "preview"
        ? ([previewCenterPoint.longitudeDeg, previewCenterPoint.latitudeDeg] as [number, number])
        : isStartSequence
          ? ([points[Math.min(points.length - 1, activeIndex + 1)]?.longitudeDeg ?? playbackCenterPoint.longitudeDeg, points[Math.min(points.length - 1, activeIndex + 1)]?.latitudeDeg ?? playbackCenterPoint.latitudeDeg] as [number, number])
          : ([playbackCenterPoint.longitudeDeg, playbackCenterPoint.latitudeDeg] as [number, number]),
    bearing: mode === "preview" ? previewBearing : rawBearing,
    pitch,
    zoom,
    offset:
      mode === "preview"
        ? ([0, Math.round(clamp(58 - climbGrade * 1.15 + descentGrade * 0.4, 44, 64))] as [number, number])
        : isStartSequence
          ? ([0, Math.round(clamp(74 - climbGrade * 1.6 + descentGrade * 0.5, 58, 82))] as [number, number])
        : ([0, Math.round(clamp(165 - climbGrade * 4.2 + descentGrade * 1.4, 128, 168))] as [number, number]),
  };
}

function resolvePreviewRoutePoint(routePoints: RoutePoint[], selectedRange: DistanceRange | null, hoverSecond: number | null): RoutePoint | null {
  const hoveredPoint = findNearestPointByElapsed(routePoints, hoverSecond);
  if (hoveredPoint) return hoveredPoint;
  if (selectedRange) {
    return routePoints.find((point) => point.distanceM >= selectedRange.start) ?? routePoints[0] ?? null;
  }
  return routePoints[0] ?? null;
}

function updateGeoJsonSource(map: MapLibreMap | null, sourceId: string, data: GeoJsonLineCollection | GeoJsonPointCollection) {
  const source = map?.getSource(sourceId) as MutableGeoJsonSource | undefined;
  source?.setData(data);
}

type FlyoverCameraDebugState = {
  centerLng: number;
  centerLat: number;
  targetElevationM: number | null;
  zoom: number;
  pitch: number;
  bearing: number;
};

function readFlyoverCameraDebugState(map: MapLibreMap): FlyoverCameraDebugState {
  const center = map.getCenter();
  const queriedTerrainElevation = map.queryTerrainElevation(center);
  const targetElevation = queriedTerrainElevation ?? map.getCameraTargetElevation();
  return {
    centerLng: center.lng,
    centerLat: center.lat,
    targetElevationM: Number.isFinite(targetElevation) ? targetElevation : null,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  };
}

function buildFlyoverCameraDebugText(camera: FlyoverCameraDebugState | null, activityReference: string | null): string {
  if (!camera) {
    return activityReference ? `Ride: ${activityReference}` : "Ride: -";
  }

  return [
    activityReference ? `Ride: ${activityReference}` : "Ride: -",
    `x: ${camera.centerLng.toFixed(6)}`,
    `y: ${camera.centerLat.toFixed(6)}`,
    `terrain_hoehe_m: ${camera.targetElevationM == null ? "-" : camera.targetElevationM.toFixed(1)}`,
    `zoom: ${camera.zoom.toFixed(2)}`,
    `pitch: ${camera.pitch.toFixed(1)}`,
    `bearing: ${camera.bearing.toFixed(1)}`,
  ].join("\n");
}

function findNearestMapLibreHoverPoint(map: MapLibreMap, points: RoutePoint[], x: number, y: number): RoutePoint | null {
  let bestPoint: RoutePoint | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const point of points) {
    if (point.latitudeDeg == null || point.longitudeDeg == null) continue;
    const projected = map.project([point.longitudeDeg, point.latitudeDeg]);
    const dx = projected.x - x;
    const dy = projected.y - y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < bestDistanceSquared) {
      bestPoint = point;
      bestDistanceSquared = distanceSquared;
    }
  }

  return bestDistanceSquared <= 28 * 28 ? bestPoint : null;
}

function ActivityRouteFlyover({
  routePoints,
  hoverSecond,
  selectedRange,
  isPlaying,
  onHoverChange,
  activityReference,
}: {
  routePoints: RoutePoint[];
  hoverSecond: number | null;
  selectedRange: DistanceRange | null;
  isPlaying: boolean;
  onHoverChange: (nextSecond: number | null) => void;
  activityReference: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hasFittedViewRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  const wasPlayingRef = useRef(isPlaying);
  const routePointsRef = useRef(routePoints);
  const onHoverChangeRef = useRef(onHoverChange);
  const overviewCameraStateRef = useRef<OverviewCameraState | null>(null);
  const lastCameraUpdateRef = useRef(0);
  const lastCameraBearingRef = useRef<number | null>(null);
  const cameraDebugFrameRef = useRef<number | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [terrainMessage, setTerrainMessage] = useState<string | null>(null);
  const [cameraDebug, setCameraDebug] = useState<FlyoverCameraDebugState | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const routeGeoPoints = useMemo(() => routePoints.filter(isRouteGeoPoint), [routePoints]);
  const trackCoordinates = useMemo(() => routeGeoPoints.map((point) => [point.longitudeDeg, point.latitudeDeg] as [number, number]), [routeGeoPoints]);
  const overviewRoutePoint = useMemo(
    () => (selectedRange == null ? routePoints[0] ?? null : routePoints.find((point) => point.distanceM >= selectedRange.start) ?? routePoints[0] ?? null),
    [routePoints, selectedRange],
  );
  const activeRoutePoint = useMemo(() => resolvePreviewRoutePoint(routePoints, selectedRange, hoverSecond), [hoverSecond, routePoints, selectedRange]);
  const activeCoordinate =
    activeRoutePoint?.longitudeDeg != null && activeRoutePoint?.latitudeDeg != null
      ? ([activeRoutePoint.longitudeDeg, activeRoutePoint.latitudeDeg] as [number, number])
      : null;
  const travelledCoordinates = useMemo(
    () =>
      activeRoutePoint == null
        ? []
        : extractTrackGeoJsonCoordinates(routePoints.filter((point) => point.elapsed <= activeRoutePoint.elapsed)),
    [activeRoutePoint, routePoints],
  );
  const selectedCoordinates = useMemo(
    () =>
      selectedRange == null
        ? []
        : extractTrackGeoJsonCoordinates(routePoints.filter((point) => point.distanceM >= selectedRange.start && point.distanceM <= selectedRange.end)),
    [routePoints, selectedRange],
  );
  const startCoordinate = trackCoordinates[0] ?? null;
  const endCoordinate = trackCoordinates[trackCoordinates.length - 1] ?? null;
  const overviewCameraState = useMemo(() => buildOverviewCameraState(routeGeoPoints, overviewRoutePoint), [overviewRoutePoint, routeGeoPoints]);
  const playbackCameraState = useMemo(() => buildPlaybackCameraState(routeGeoPoints, activeRoutePoint, "playback"), [routeGeoPoints, activeRoutePoint]);

  useEffect(() => {
    const previousPlaying = isPlayingRef.current;
    isPlayingRef.current = isPlaying;
    if (previousPlaying && !isPlaying) {
      wasPlayingRef.current = true;
    } else if (isPlaying) {
      wasPlayingRef.current = false;
    }
  }, [isPlaying]);

  useEffect(() => {
    routePointsRef.current = routePoints;
  }, [routePoints]);

  useEffect(() => {
    onHoverChangeRef.current = onHoverChange;
  }, [onHoverChange]);

  useEffect(() => {
    overviewCameraStateRef.current = overviewCameraState;
  }, [overviewCameraState]);

  useEffect(() => {
    return () => {
      if (cameraDebugFrameRef.current != null) {
        window.cancelAnimationFrame(cameraDebugFrameRef.current);
      }
      if (copyFeedbackTimeoutRef.current != null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || trackCoordinates.length < 2) return;
    setMapReady(false);
    setCameraDebug(null);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildActivityMap3dStyle(),
      center: trackCoordinates[0],
      zoom: 12,
      pitch: MAP_3D_PITCH,
      bearing: MAP_3D_BEARING,
      maxPitch: MAP_3D_MAX_PITCH,
      maxTileCacheSize: 256,
      maxTileCacheZoomLevels: 8,
      refreshExpiredTiles: false,
      cancelPendingTileRequestsWhileZooming: false,
      fadeDuration: 0,
      attributionControl: false,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const syncCameraDebug = () => {
      if (cameraDebugFrameRef.current != null) return;
      cameraDebugFrameRef.current = window.requestAnimationFrame(() => {
        cameraDebugFrameRef.current = null;
        setCameraDebug(readFlyoverCameraDebugState(map));
      });
    };

    map.on("load", () => {
      setTerrainMessage(null);

      if (!map.getSource("terrainSource")) {
        map.addSource("terrainSource", {
          type: "raster-dem",
          url: MAP_3D_DEM_URL,
          encoding: MAP_3D_DEM_ENCODING,
          tileSize: MAP_3D_DEM_TILE_SIZE,
        });
      }
      map.setTerrain({
        source: "terrainSource",
        exaggeration: MAP_3D_EXAGGERATION,
      });
      map.setSourceTileLodParams(5, 4);

      map.addSource("activity-route", { type: "geojson", data: buildLineFeatureCollection(trackCoordinates) });
      map.addSource("activity-selected", { type: "geojson", data: buildLineFeatureCollection([]) });
      map.addSource("activity-progress", { type: "geojson", data: buildLineFeatureCollection([]) });
      map.addSource("activity-start", { type: "geojson", data: buildPointFeatureCollection(startCoordinate) });
      map.addSource("activity-finish", { type: "geojson", data: buildPointFeatureCollection(endCoordinate) });
      map.addSource("activity-active", { type: "geojson", data: buildPointFeatureCollection(null) });

      map.addLayer({
        id: "activity-route-shadow",
        type: "line",
        source: "activity-route",
        paint: {
          "line-color": "#12352e",
          "line-opacity": 0.18,
          "line-width": 10,
        },
      });
      map.addLayer({
        id: "activity-route-line",
        type: "line",
        source: "activity-route",
        paint: {
          "line-color": "#1f8b6f",
          "line-width": 6,
        },
      });
      map.addLayer({
        id: "activity-selected-line",
        type: "line",
        source: "activity-selected",
        paint: {
          "line-color": "#f5c086",
          "line-opacity": 0.76,
          "line-width": 8,
        },
      });
      map.addLayer({
        id: "activity-progress-line",
        type: "line",
        source: "activity-progress",
        paint: {
          "line-color": "#ef8d33",
          "line-width": 6,
        },
      });
      map.addLayer({
        id: "activity-start-marker",
        type: "circle",
        source: "activity-start",
        paint: {
          "circle-radius": 6,
          "circle-color": "#1f8b6f",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "activity-finish-marker",
        type: "circle",
        source: "activity-finish",
        paint: {
          "circle-radius": 6,
          "circle-color": "#ef8d33",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "activity-active-marker",
        type: "circle",
        source: "activity-active",
        paint: {
          "circle-radius": 8,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#163d35",
          "circle-stroke-width": 3,
        },
      });

      if (!hasFittedViewRef.current) {
        const overview = overviewCameraStateRef.current;
        if (overview) {
          const currentBearing = lastCameraBearingRef.current ?? map.getBearing();
          lastCameraBearingRef.current = moveMapToOverviewCamera(map, overview, currentBearing, 900);
        } else if (trackCoordinates.length > 1) {
          map.fitBounds(buildTrackBounds(trackCoordinates)!, { padding: 48, duration: 0 });
          window.requestAnimationFrame(() => {
            map.easeTo({
              pitch: MAP_3D_PITCH,
              bearing: MAP_3D_BEARING,
              duration: 1200,
              essential: true,
            });
          });
        }
        hasFittedViewRef.current = true;
      }

      syncCameraDebug();
      setMapReady(true);
    });

    map.on("mousemove", (event) => {
      if (isPlayingRef.current) return;
      const nearest = findNearestMapLibreHoverPoint(map, routePointsRef.current, event.point.x, event.point.y);
      onHoverChangeRef.current(nearest?.elapsed ?? null);
    });

    map.on("mouseleave", () => {
      if (isPlayingRef.current) return;
      onHoverChangeRef.current(null);
    });

    map.on("move", syncCameraDebug);
    map.on("zoom", syncCameraDebug);
    map.on("pitch", syncCameraDebug);
    map.on("rotate", syncCameraDebug);
    map.on("idle", syncCameraDebug);
    map.on("data", (event) => {
      const sourceId = "sourceId" in event ? event.sourceId : undefined;
      if (event.dataType === "source" && sourceId === "terrainSource") {
        syncCameraDebug();
      }
    });

    map.on("error", (event) => {
      const message = event.error instanceof Error ? event.error.message : "";
      const loweredMessage = message.toLowerCase();
      if (loweredMessage.includes("terrain") || loweredMessage.includes("dem") || loweredMessage.includes("source")) {
        setTerrainMessage("Terrain-Daten konnten nicht vollständig geladen werden. Prüfe VITE_MAP_3D_DEM_URL und bei Bedarf auch VITE_MAP_3D_DEM_ENCODING.");
      }
    });

    return () => {
      hasFittedViewRef.current = false;
      setMapReady(false);
      if (cameraDebugFrameRef.current != null) {
        window.cancelAnimationFrame(cameraDebugFrameRef.current);
        cameraDebugFrameRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [endCoordinate, overviewRoutePoint, routeGeoPoints, startCoordinate, trackCoordinates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    updateGeoJsonSource(map, "activity-route", buildLineFeatureCollection(trackCoordinates));
    updateGeoJsonSource(map, "activity-selected", buildLineFeatureCollection(selectedCoordinates));
    updateGeoJsonSource(map, "activity-progress", buildLineFeatureCollection(travelledCoordinates));
    updateGeoJsonSource(map, "activity-start", buildPointFeatureCollection(startCoordinate));
    updateGeoJsonSource(map, "activity-finish", buildPointFeatureCollection(endCoordinate));
    updateGeoJsonSource(map, "activity-active", buildPointFeatureCollection(activeCoordinate));
  }, [activeCoordinate, endCoordinate, mapReady, selectedCoordinates, startCoordinate, trackCoordinates, travelledCoordinates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overviewCameraState || !map.isStyleLoaded() || isPlaying || !wasPlayingRef.current) return;

    const currentBearing = lastCameraBearingRef.current ?? map.getBearing();
    lastCameraBearingRef.current = moveMapToOverviewCamera(map, overviewCameraState, currentBearing, 1100);
    wasPlayingRef.current = false;
  }, [isPlaying, mapReady, overviewCameraState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !isPlaying || !playbackCameraState) return;

    const now = window.performance.now();
    if (now - lastCameraUpdateRef.current < 140) return;
    lastCameraUpdateRef.current = now;

    const currentBearing = lastCameraBearingRef.current ?? map.getBearing();
    lastCameraBearingRef.current = moveMapToPlaybackCamera(map, playbackCameraState, currentBearing, 260);
  }, [isPlaying, mapReady, playbackCameraState]);

  async function handleCopyCameraDebug() {
    const text = buildFlyoverCameraDebugText(cameraDebug, activityReference);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("error");
    }

    if (copyFeedbackTimeoutRef.current != null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }
    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopyFeedback("idle");
      copyFeedbackTimeoutRef.current = null;
    }, 2200);
  }

  if (trackCoordinates.length < 2) {
    return (
      <div className="activity-flyover-stage-empty">
        Für die 3D-Ansicht brauchen wir GPS-Punkte. Sobald der Track Positionsdaten enthält, erscheint hier automatisch die Terrain-Karte.
      </div>
    );
  }

  return (
    <div className="activity-flyover-stage">
      <div ref={containerRef} className="activity-maplibre-map" aria-label="3D Terrain-Karte der Strecke" />
      {cameraDebug ? (
        <div className="activity-flyover-debug">
          <div className="activity-flyover-debug-head">
            <strong>3D Kamera</strong>
            <button className="activity-flyover-debug-copy" type="button" onClick={handleCopyCameraDebug}>
              {copyFeedback === "copied" ? "Kopiert" : copyFeedback === "error" ? "Kopieren fehlgeschlagen" : "Kamera kopieren"}
            </button>
          </div>
          <div className="activity-flyover-debug-grid">
            <span>Ride</span>
            <strong>{activityReference ?? "-"}</strong>
            <span>x</span>
            <strong>{cameraDebug.centerLng.toFixed(6)}</strong>
            <span>y</span>
            <strong>{cameraDebug.centerLat.toFixed(6)}</strong>
            <span>Terrain</span>
            <strong>{cameraDebug.targetElevationM == null ? "-" : `${cameraDebug.targetElevationM.toFixed(1)} m`}</strong>
            <span>Zoom</span>
            <strong>{cameraDebug.zoom.toFixed(2)}</strong>
            <span>Pitch</span>
            <strong>{cameraDebug.pitch.toFixed(1)}°</strong>
            <span>Bearing</span>
            <strong>{cameraDebug.bearing.toFixed(1)}°</strong>
          </div>
          <small>Karte einmal passend ausrichten und mir diese Werte mit der Ride-ID schicken.</small>
        </div>
      ) : null}
      <div className="activity-flyover-caption">3D Terrain mit MapLibre und DEM</div>
      {terrainMessage ? <div className="activity-flyover-warning">{terrainMessage}</div> : null}
    </div>
  );
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
  const [chartContainerRef, svgWidth] = useResponsiveChartWidth();
  const chartLeft = 64;
  const chartTop = 18;
  const chartRight = 36;
  const chartWidth = Math.max(160, svgWidth - chartLeft - chartRight);
  const chartHeight = 220;
  const svgHeight = 326;
  const plotLeftPercent = (chartLeft / svgWidth) * 100;
  const plotWidthPercent = (chartWidth / svgWidth) * 100;
  const minDistanceM = points.length ? Math.min(...points.map((point) => point.distanceM)) : 0;
  const maxDistanceM = points.length ? Math.max(...points.map((point) => point.distanceM), 1) : 1;
  const distanceSpan = Math.max(1, maxDistanceM - minDistanceM);
  const projectedPoints = useMemo(() => (bounds ? projectDistanceSeries(points, bounds, chartWidth, chartHeight) : []), [bounds, chartHeight, chartWidth, points]);
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
  const xTickLabels = xTicks.map((tick) => ({ distanceM: tick, ...formatAxisDistanceWithTime(points, tick) }));
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
    const ratio = pointerRatioInPlot(clientX, element, chartLeft, chartWidth, svgWidth);
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
        ref={chartContainerRef}
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
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: `${svgHeight}px`, overflow: "visible", display: "block" }} aria-label={`${title} Verlauf auf Distanz- und Zeitbasis`}>
          <rect x="0" y="0" width={svgWidth} height={svgHeight} rx="18" fill="#f7fcfa" />
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
          {xTickLabels.map((tick, index) => {
            const x = chartLeft + ((tick.distanceM - minDistanceM) / distanceSpan) * chartWidth;
            return (
              <g key={`${title}-x-distance-${index}`}>
                <line x1={x} y1={chartTop} x2={x} y2={chartTop + chartHeight} stroke="#edf4f1" strokeWidth="1" />
                <text textAnchor="middle" fontSize="12" fill="#5d756f">
                  <tspan x={x} y={chartTop + chartHeight + 27}>
                    {tick.distance}
                  </tspan>
                  <tspan x={x} y={chartTop + chartHeight + 43} fill="#7a918a">
                    {tick.time}
                  </tspan>
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
          <text x={chartLeft + chartWidth / 2} y={chartTop + chartHeight + 75} textAnchor="middle" fontSize="13" fill="#3f5d57">
            Distanz und Zeit
          </text>
        </svg>
        {hoveredPoint ? (
          <div
            style={{
              position: "absolute",
              left: `${(hoverX! / svgWidth) * 100}%`,
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
            {formatAxisDistance(hoveredPoint.distanceM)} | {formatAxisTime(hoveredPoint.elapsed)} | {formatNumber(hoveredPoint.value, digits, suffix)}
          </div>
        ) : null}
        {visibleSelection && visibleSelection.right - visibleSelection.left >= 10 ? (
          <div
            style={{
              position: "absolute",
              top: "18px",
              bottom: "88px",
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
  activityReference,
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
  activityReference: string | null;
}) {
  const [stageMode, setStageMode] = useState<RouteStageMode>("map");
  const [isPlaying, setIsPlaying] = useState(false);
  const hoverSecondRef = useRef<number | null>(hoverSecond);

  useEffect(() => {
    hoverSecondRef.current = hoverSecond;
  }, [hoverSecond]);

  useEffect(() => {
    setIsPlaying(false);
  }, [distanceRange, routePoints]);

  const trackPoints = useMemo(() => extractTrackPoints(routePoints), [routePoints]);
  const bounds = useMemo<LatLngBoundsExpression>(() => trackPoints, [trackPoints]);
  const startPoint = trackPoints[0] ?? null;
  const endPoint = trackPoints[trackPoints.length - 1] ?? null;
  const activeRoutePoint = useMemo(() => findNearestPointByElapsed(routePoints, hoverSecond), [hoverSecond, routePoints]);
  const displayRoutePoint = activeRoutePoint ?? routePoints[0] ?? null;
  const activeMapPoint =
    activeRoutePoint && activeRoutePoint.latitudeDeg != null && activeRoutePoint.longitudeDeg != null
      ? ([activeRoutePoint.latitudeDeg, activeRoutePoint.longitudeDeg] as LatLngTuple)
      : null;
  const selectedMetric = MAP_METRIC_OPTIONS.find((option) => option.key === mapMetricKey) ?? MAP_METRIC_OPTIONS[0];
  const chartRoutePoints = useMemo(() => {
    const rangedPoints = distanceRange != null ? filterPointsByDistanceRange(routePoints, distanceRange) : routePoints;
    return rangedPoints.length >= 2 ? rangedPoints : routePoints;
  }, [distanceRange, routePoints]);
  const elevationPoints = useMemo(() => buildDistanceSeries(chartRoutePoints, (point) => point.altitudeM), [chartRoutePoints]);
  const metricPoints = useMemo(() => buildDistanceSeries(chartRoutePoints, selectedMetric.pick), [chartRoutePoints, selectedMetric]);
  const playbackPoints = useMemo(() => {
    const rangedPoints = distanceRange != null ? filterPointsByDistanceRange(routePoints, distanceRange) : routePoints;
    return rangedPoints.length >= 2 ? rangedPoints : routePoints;
  }, [distanceRange, routePoints]);
  const playbackStartPoint = playbackPoints[0] ?? routePoints[0] ?? null;
  const playbackEndPoint = playbackPoints[playbackPoints.length - 1] ?? routePoints[routePoints.length - 1] ?? null;
  const playbackIndex = useMemo(() => findNearestPointIndexByElapsed(playbackPoints, hoverSecond), [hoverSecond, playbackPoints]);
  const playbackProgress = playbackPoints.length > 1 ? playbackIndex / (playbackPoints.length - 1) : 0;
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
  const travelledTrackPoints = useMemo(() => {
    if (!displayRoutePoint) return [];
    return extractTrackPoints(
      routePoints.filter(
        (point) =>
          point.elapsed <= displayRoutePoint.elapsed &&
          point.latitudeDeg != null &&
          point.longitudeDeg != null,
      ),
    );
  }, [displayRoutePoint, routePoints]);
  const distanceRangeLabel =
    distanceRange != null ? formatDistanceTimeRange(routePoints, distanceRange) : "kein Ausschnitt gesetzt";
  const currentRouteRangeLabel = formatDistanceTimeRange(routePoints, distanceRange);
  const replayLabel = distanceRange != null ? "Ausschnitt" : "Gesamte Fahrt";

  useEffect(() => {
    if (!isPlaying || playbackPoints.length < 2) return;

    const firstElapsed = playbackPoints[0].elapsed;
    const lastElapsed = playbackPoints[playbackPoints.length - 1].elapsed;
    const currentHover = hoverSecondRef.current;
    const startIndex =
      currentHover != null && currentHover >= firstElapsed && currentHover < lastElapsed
        ? findNearestPointIndexByElapsed(playbackPoints, currentHover)
        : 0;
    const maxIndex = playbackPoints.length - 1;
    const remainingRatio = (maxIndex - startIndex) / Math.max(1, maxIndex);
    const durationMs = Math.max(1, buildPlaybackDurationMs(playbackPoints.length) * remainingRatio);
    let lastRenderedIndex = -1;
    let frame = 0;
    const startedAt = window.performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const nextIndex = Math.min(maxIndex, startIndex + Math.round((maxIndex - startIndex) * progress));
      if (nextIndex !== lastRenderedIndex) {
        lastRenderedIndex = nextIndex;
        onHoverChange(playbackPoints[nextIndex]?.elapsed ?? null);
      }
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      setIsPlaying(false);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [isPlaying, onHoverChange, playbackPoints]);

  function handleTogglePlayback() {
    if (playbackPoints.length < 2) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const firstElapsed = playbackPoints[0].elapsed;
    const lastElapsed = playbackPoints[playbackPoints.length - 1].elapsed;
    const currentHover = hoverSecondRef.current;
    if (currentHover == null || currentHover < firstElapsed || currentHover >= lastElapsed) {
      onHoverChange(firstElapsed);
    }
    setIsPlaying(true);
  }

  function handleResetPlayback() {
    setIsPlaying(false);
    onHoverChange(playbackStartPoint?.elapsed ?? null);
  }

  function handleStageModeChange(nextMode: RouteStageMode) {
    if (nextMode === stageMode) return;
    if (nextMode === "flyover") {
      setIsPlaying(false);
      onHoverChange(playbackStartPoint?.elapsed ?? routePoints[0]?.elapsed ?? null);
    }
    setStageMode(nextMode);
  }

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
          <span className="training-note">{stageMode === "map" ? "OpenStreetMap" : "MapLibre 3D Terrain"} | {trackPoints.length} GPS-Punkte</span>
        </div>
        <div className="activity-map-shell">
          <div className="activity-map-stage">
            <div className="activity-map-toolbar">
              <div className="activity-map-mode-toggle" role="tablist" aria-label="Ansicht wechseln">
                <button className={`activity-map-toggle-button ${stageMode === "map" ? "active" : ""}`} type="button" onClick={() => handleStageModeChange("map")}>
                  2D Karte
                </button>
                <button className={`activity-map-toggle-button ${stageMode === "flyover" ? "active" : ""}`} type="button" onClick={() => handleStageModeChange("flyover")}>
                  3D Terrain
                </button>
              </div>
              <div className="activity-map-replay-controls">
                <button className="primary-button" type="button" onClick={handleTogglePlayback} disabled={playbackPoints.length < 2}>
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button className="secondary-button" type="button" onClick={handleResetPlayback} disabled={playbackStartPoint == null}>
                  Zum Anfang
                </button>
              </div>
            </div>

            <div className="activity-map-stage-shell">
              {stageMode === "map" ? (
                <MapContainer className="activity-leaflet-map" center={trackPoints[0]} zoom={13} scrollWheelZoom>
                  <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} />
                  <Polyline positions={trackPoints} pathOptions={{ color: "#1f8b6f", weight: 5, opacity: 0.9 }} />
                  {selectedTrackPoints.length >= 2 ? <Polyline positions={selectedTrackPoints} pathOptions={{ color: "#f5c086", weight: 8, opacity: 0.72 }} /> : null}
                  {travelledTrackPoints.length >= 2 ? <Polyline positions={travelledTrackPoints} pathOptions={{ color: "#ef8d33", weight: 7, opacity: 0.92 }} /> : null}
                  {startPoint ? <CircleMarker center={startPoint} radius={7} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#1f8b6f", fillOpacity: 1 }} /> : null}
                  {endPoint ? <CircleMarker center={endPoint} radius={7} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#ef8d33", fillOpacity: 1 }} /> : null}
                  {activeMapPoint ? <CircleMarker center={activeMapPoint} radius={8} pathOptions={{ color: "#16322e", weight: 2, fillColor: "#ffffff", fillOpacity: 0.98 }} /> : null}
                  <ActivityMapViewport bounds={bounds} />
                  <ActivityMapHoverSync points={routePoints} onHoverChange={onHoverChange} />
                </MapContainer>
              ) : (
                <ActivityRouteFlyover
                  routePoints={routePoints}
                  hoverSecond={hoverSecond}
                  selectedRange={previewRange}
                  isPlaying={isPlaying}
                  onHoverChange={onHoverChange}
                  activityReference={activityReference}
                />
              )}
            </div>
          </div>

          <aside className="activity-map-sidebar">
            <div className="activity-map-marker-grid">
              <div className="activity-map-marker-card start">
                <span>Start</span>
                <strong>{startPoint ? formatAxisTime(routePoints[0]?.elapsed ?? 0) : "-"}</strong>
                <small>{routePoints[0] ? formatAxisDistance(routePoints[0].distanceM) : "-"}</small>
              </div>
              <div className="activity-map-marker-card finish">
                <span>Ziel</span>
                <strong>{endPoint ? formatAxisTime(routePoints[routePoints.length - 1]?.elapsed ?? 0) : "-"}</strong>
                <small>{routePoints[routePoints.length - 1] ? formatAxisDistance(routePoints[routePoints.length - 1].distanceM) : "-"}</small>
              </div>
            </div>

            <div className="settings-status-chip activity-map-replay-chip">
              <span>Replay</span>
              <strong>{isPlaying ? "Läuft" : "Bereit"}</strong>
              <small>
                {replayLabel} | {Math.round(playbackProgress * 100)}%
              </small>
              <div className="activity-map-progress-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(playbackProgress * 100)}%` }} />
              </div>
              <small>
                {playbackStartPoint && playbackEndPoint
                  ? `${formatAxisTime(playbackStartPoint.elapsed)} bis ${formatAxisTime(playbackEndPoint.elapsed)}`
                  : "-"}
              </small>
            </div>

            <div className="settings-note-card activity-map-note-card">
              <strong>{stageMode === "map" ? "Kartenquelle" : "3D-Terrain"}</strong>
              <span className="activity-map-note">
                {stageMode === "map"
                  ? "Aktuell werden die Tiles direkt von OpenStreetMap geladen. Bei größerer Nutzung kannst du die Quelle per .env umstellen."
                  : "Die 3D-Ansicht nutzt jetzt einen offenen Stack mit MapLibre, OpenFreeMap als Vektor-Basiskarte und Mapterhorn als Terrainquelle für Höhenprofil und Kamerafahrt."}
              </span>
              <small>
                {distanceRange != null ? `Play fährt den gewählten Ausschnitt ab: ${distanceRangeLabel}.` : `Play fährt die komplette Strecke ab: ${currentRouteRangeLabel}.`}
              </small>
            </div>

            <div className="activity-map-point-grid">
              <div className="training-mini-card">
                <span>Trackpunkt</span>
                <strong>{displayRoutePoint ? formatAxisDistance(displayRoutePoint.distanceM) : "-"}</strong>
              </div>
              <div className="training-mini-card">
                <span>Höhe</span>
                <strong>{displayRoutePoint ? formatNumber(displayRoutePoint.altitudeM, 0, " m") : "-"}</strong>
              </div>
              <div className="training-mini-card">
                <span>Steigung</span>
                <strong>{displayRoutePoint ? formatNumber(displayRoutePoint.gradePct, 1, " %") : "-"}</strong>
              </div>
              <div className="training-mini-card">
                <span>{selectedMetric.label}</span>
                <strong>{displayRoutePoint ? formatNumber(selectedMetric.pick(displayRoutePoint), selectedMetric.digits, selectedMetric.suffix) : "-"}</strong>
              </div>
            </div>
          </aside>
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
        <p className="training-note">Wähle aus, welche Größe direkt unter der Karte entlang der Strecke dargestellt werden soll. Hover auf Karte oder Diagramm synchronisiert den Trackpunkt. Aktuelle Ansicht: {currentRouteRangeLabel}.</p>
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
        <div className="training-info-point">Die 2D-Karte bleibt bei `Leaflet`, die 3D-Ansicht läuft jetzt mit `MapLibre GL JS` und einer DEM-Terrainquelle.</div>
        <div className="training-info-point">Standardmäßig verwendet 3D jetzt `OpenFreeMap` für die offene Vektor-Basiskarte und `Mapterhorn` für das offene Terrain. Beides passt deutlich besser zu 3D als gestreckte Rastertiles.</div>
        <div className="training-info-point">Wenn du die 3D-Quellen später selbst hosten willst, kannst du in der `.env` `VITE_MAP_3D_STYLE_URL`, `VITE_MAP_3D_DEM_URL`, `VITE_MAP_3D_DEM_ENCODING` und bei Bedarf `VITE_MAP_3D_PITCH`, `VITE_MAP_3D_BEARING` sowie `VITE_MAP_3D_EXAGGERATION` setzen.</div>
        <div className="training-info-point">Ganz ohne Lizenzhinweise geht es trotzdem nicht: OpenStreetMap- und OpenMapTiles-Attribution bleibt notwendig. Technisch bleiben wir aber offen, vendorfrei und ohne proprietären API-Key.</div>
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
  const chartDuration = Math.max(0, sourceEnd - sourceStart);
  const values = chartPoints.map((point) => point.value);
  const bounds = useMemo(() => computeAxisBounds(values), [values]);
  const min = bounds?.min ?? null;
  const max = bounds?.max ?? null;
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const [chartContainerRef, svgWidth] = useResponsiveChartWidth();
  const innerHeight = 220;
  const chartLeft = 64;
  const chartTop = 18;
  const chartRight = 36;
  const chartWidth = Math.max(160, svgWidth - chartLeft - chartRight);
  const chartHeight = innerHeight;
  const points = useMemo(
    () => buildPolyline(chartPoints, chartDuration, chartWidth, chartHeight),
    [chartDuration, chartHeight, chartPoints, chartWidth],
  );
  const areaPath = useMemo(
    () => buildAreaPath(chartPoints, chartDuration, chartWidth, chartHeight),
    [chartDuration, chartHeight, chartPoints, chartWidth],
  );
  const plotLeftPercent = (chartLeft / svgWidth) * 100;
  const plotWidthPercent = (chartWidth / svgWidth) * 100;
  const visibleStart = sourceStart;
  const visibleEnd = sourceEnd;
  const totalDuration = chartDuration;
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
    const ratio = pointerRatioInPlot(clientX, element, chartLeft, chartWidth, svgWidth);
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
          ref={chartContainerRef}
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
          <svg viewBox={`0 0 ${svgWidth} 300`} style={{ width: "100%", height: "300px", overflow: "visible", display: "block" }} aria-label={`${title} Verlauf`}>
            <rect x="0" y="0" width={svgWidth} height="300" rx="18" fill="#f7fcfa" />
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
                left: `${(hoverX / svgWidth) * 100}%`,
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
  const [activeAnalysisSubTab, setActiveAnalysisSubTab] = useState<AnalysisSubTabKey>("training-effect");
  const [analysisInfoDialog, setAnalysisInfoDialog] = useState<{ title: string; description: string } | null>(null);
  const [selectedPowerZoneId, setSelectedPowerZoneId] = useState<string | null>(null);
  const [selectedHrZoneId, setSelectedHrZoneId] = useState<string | null>(null);
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
  const analysisSamples = useMemo(() => buildAnalysisSamples(normalizedRecords), [normalizedRecords]);
  const powerZones = useMemo(() => buildPowerZones(data?.activity.ftp_reference_w ?? null), [data?.activity.ftp_reference_w]);
  const heartRateZones = useMemo(() => buildHeartRateZones(data?.activity.max_hr_reference_bpm ?? data?.activity.max_hr_bpm ?? null), [data?.activity.max_hr_bpm, data?.activity.max_hr_reference_bpm]);
  const powerZoneDurations = useMemo(() => summarizeZoneDurations(analysisSamples, powerZones, (sample) => sample.power), [analysisSamples, powerZones]);
  const heartRateZoneDurations = useMemo(() => summarizeZoneDurations(analysisSamples, heartRateZones, (sample) => sample.heartRate), [analysisSamples, heartRateZones]);
  const powerZoneSegments = useMemo(() => buildZoneSegments(analysisSamples, powerZones, (sample) => sample.power, selectedPowerZoneId), [analysisSamples, powerZones, selectedPowerZoneId]);
  const heartRateZoneSegments = useMemo(() => buildZoneSegments(analysisSamples, heartRateZones, (sample) => sample.heartRate, selectedHrZoneId), [analysisSamples, heartRateZones, selectedHrZoneId]);
  const selectedPowerZone = useMemo(() => powerZones.find((zone) => zone.id === selectedPowerZoneId) ?? null, [powerZones, selectedPowerZoneId]);
  const selectedHeartRateZone = useMemo(() => heartRateZones.find((zone) => zone.id === selectedHrZoneId) ?? null, [heartRateZones, selectedHrZoneId]);
  const trainingEffectAnalysis = useMemo(
    () => (data ? deriveTrainingEffectAnalysis({ activity: data.activity, samples: analysisSamples }) : null),
    [analysisSamples, data],
  );
  const driftSignals = useMemo(() => deriveDriftSignals(analysisSamples), [analysisSamples]);
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
    setSelectedPowerZoneId((current) => (current && powerZones.some((zone) => zone.id === current) ? current : powerZones[0]?.id ?? null));
  }, [powerZones]);

  useEffect(() => {
    setSelectedHrZoneId((current) => (current && heartRateZones.some((zone) => zone.id === current) ? current : heartRateZones[0]?.id ?? null));
  }, [heartRateZones]);

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

  function openAnalysisInfo(title: string, description: string) {
    setAnalysisInfoDialog({ title, description });
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
                activityReference={data.activity.external_id || activityId || String(data.activity.id)}
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
              <div className="activity-analysis-layout">
                <div className="card">
                  <div className="section-title-row">
                    <h2>Trainingsanalyse</h2>
                  </div>
                  <p className="training-note">
                    Dieser Bereich ist bewusst deterministisch und regelbasiert. Wenn im importierten Ride originale Garmin-Werte vorhanden sind, zeigen wir sie direkt an. Eigene Regeln und Heuristiken erklären dann nur noch, wie sich der Reiz fachlich einordnen lässt.
                  </p>
                </div>

                <div className="activity-analysis-toggle" role="tablist" aria-label="Analyse-Bereiche">
                  <button
                    className={`settings-tab-button ${activeAnalysisSubTab === "training-effect" ? "active" : ""}`}
                    type="button"
                    onClick={() => setActiveAnalysisSubTab("training-effect")}
                  >
                    <strong>Trainingseffekt</strong>
                    <span>Aerob, anaerob und Hauptnutzen</span>
                  </button>
                  <button
                    className={`settings-tab-button ${activeAnalysisSubTab === "hf-drift" ? "active" : ""}`}
                    type="button"
                    onClick={() => setActiveAnalysisSubTab("hf-drift")}
                  >
                    <strong>HF Drift</strong>
                    <span>Positive und negative Drift-Stellen</span>
                  </button>
                  <button
                    className={`settings-tab-button ${activeAnalysisSubTab === "power-zones" ? "active" : ""}`}
                    type="button"
                    onClick={() => setActiveAnalysisSubTab("power-zones")}
                  >
                    <strong>Wattzonen</strong>
                    <span>Zonenzeit und stabile Leistungsblöcke</span>
                  </button>
                  <button
                    className={`settings-tab-button ${activeAnalysisSubTab === "hr-zones" ? "active" : ""}`}
                    type="button"
                    onClick={() => setActiveAnalysisSubTab("hr-zones")}
                  >
                    <strong>HF Zonen</strong>
                    <span>Zonenzeit und stabile HF-Blöcke</span>
                  </button>
                </div>

                {activeAnalysisSubTab === "training-effect" ? (
                  <div className="card">
                    <div className="section-title-row">
                      <h2>Trainingseffekt</h2>
                    </div>
                    <p className="training-note">
                      Jede Analyse sitzt in einer eigenen Box mit Wert und Balken. Über das Fragezeichen bekommst du die Herleitung, die Bedeutung des Wertes und die Farbskala ausführlich erklärt.
                    </p>

                    <div className="training-mini-grid">
                      <div className="training-mini-card">
                        <span>Hauptnutzen</span>
                        <strong>{trainingEffectAnalysis?.headline ?? "-"}</strong>
                        <small>{trainingEffectAnalysis?.headlineReason ?? "Noch keine belastbare Einordnung möglich."}</small>
                      </div>
                    </div>

                    <div className="activity-effect-grid">
                      {(trainingEffectAnalysis?.bars ?? []).map((bar) => (
                        <ActivityEffectGauge key={bar.id} {...bar} onOpenHelp={openAnalysisInfo} />
                      ))}
                    </div>

                    <div className="section-title-row" style={{ marginTop: "1rem" }}>
                      <h2>Trainingszonen-Reize</h2>
                    </div>
                    <p className="training-note">
                      Zusätzlich zum Garmin-Trainingseffekt schätzen wir hier die Reizstärke in typischen Bereichen wie GA1, GA2, Sweetspot, Schwelle und VO2max aus der tatsächlichen Leistungsverteilung.
                    </p>

                    <div className="activity-effect-grid">
                      {(trainingEffectAnalysis?.zoneBars ?? []).map((bar) => (
                        <ActivityEffectGauge key={bar.id} {...bar} onOpenHelp={openAnalysisInfo} />
                      ))}
                    </div>
                  </div>
                ) : null}

                {activeAnalysisSubTab === "hf-drift" ? (
                  <div className="card">
                    <div className="section-title-row">
                      <h2>HF Drift</h2>
                    </div>
                    <p className="training-note">
                      Hier werden auffällige Stellen aus dem Verhältnis von Herzfrequenz und Leistung markiert. Interessant sind sowohl positiver Drift bei gleicher oder steigender Leistung als auch negative Drift beim Runterkommen nach Peaks oder bei einer klaren Stabilisierung.
                    </p>

                    {driftSignals.length ? (
                      <div className="activity-drift-list">
                        {driftSignals.map((signal) => (
                          <article key={signal.key} className="activity-drift-card">
                            <div className="activity-drift-head">
                              <div>
                                <h3>{signal.title}</h3>
                                <small>{signal.timeLabel}</small>
                              </div>
                              <span className={`activity-drift-badge ${signal.direction}`}>
                                {signal.directionLabel} {signal.driftLabel}
                              </span>
                            </div>
                            <div className="activity-drift-metrics">
                              <div>
                                <span>Leistung</span>
                                <strong>{signal.powerLabel}</strong>
                              </div>
                              <div>
                                <span>Herzfrequenz</span>
                                <strong>{signal.heartRateLabel}</strong>
                              </div>
                            </div>
                            <p>{signal.summary}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="training-note">
                        Noch keine markanten Drift-Stellen gefunden. Dafür brauchen wir genug zusammenhängende Herzfrequenz- und Power-Daten über mehrere Minuten.
                      </p>
                    )}
                  </div>
                ) : null}

                {activeAnalysisSubTab === "power-zones" ? (
                  <div className="card">
                    <div className="section-title-row">
                      <h2>Wattzonen</h2>
                    </div>
                    <p className="training-note">
                      Hier siehst du alle Wattzonen auf Basis der aktuellen FTP-Referenz, wie lange du darin unterwegs warst und welche zusammenhängenden Zeitblöcke in der gewählten Zone wirklich stabil waren.
                    </p>
                    {powerZones.length ? (
                      <>
                        <ZoneDurationChart title="Wattzonen Dauer" rows={powerZoneDurations} suffix=" W" />
                        <ZoneTimelineChart
                          title="Wattzonen Grafik"
                          samples={analysisSamples}
                          pick={(sample) => sample.power}
                          zones={powerZones}
                          segments={powerZoneSegments}
                          totalDuration={totalDuration}
                          zone={selectedPowerZone}
                          selectedZoneId={selectedPowerZoneId}
                          onSelectZone={setSelectedPowerZoneId}
                          suffix=" W"
                          digits={0}
                        />
                      </>
                    ) : (
                      <p className="training-note">Für Wattzonen fehlt aktuell eine FTP-Referenz oder ausreichende Leistungsdaten.</p>
                    )}
                  </div>
                ) : null}

                {activeAnalysisSubTab === "hr-zones" ? (
                  <div className="card">
                    <div className="section-title-row">
                      <h2>HF Zonen</h2>
                    </div>
                    <p className="training-note">
                      Herzfrequenzzonen zeigen die interne Belastung. Die Grafik markiert nur längere, stabile Aufenthalte einer Zone auf Basis eines gleitenden 5-Minuten-Schnitts.
                    </p>
                    {heartRateZones.length ? (
                      <>
                        <ZoneDurationChart title="HF Zonen Dauer" rows={heartRateZoneDurations} suffix=" bpm" />
                        <ZoneTimelineChart
                          title="HF Zonen Grafik"
                          samples={analysisSamples}
                          pick={(sample) => sample.heartRate}
                          zones={heartRateZones}
                          segments={heartRateZoneSegments}
                          totalDuration={totalDuration}
                          zone={selectedHeartRateZone}
                          selectedZoneId={selectedHrZoneId}
                          onSelectZone={setSelectedHrZoneId}
                          suffix=" bpm"
                          digits={0}
                        />
                      </>
                    ) : (
                      <p className="training-note">Für HF-Zonen fehlt aktuell eine MaxHF-Referenz oder ausreichende Herzfrequenzdaten.</p>
                    )}
                  </div>
                ) : null}
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

      {analysisInfoDialog ? <ActivityInfoDialog title={analysisInfoDialog.title} description={analysisInfoDialog.description} onClose={() => setAnalysisInfoDialog(null)} /> : null}
    </section>
  );
}


