import { FormEvent, useEffect, useMemo, useState } from "react";
import type { LatLngTuple } from "leaflet";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { apiFetch } from "../api";
import { API_BASE_URL, MAP_MAX_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "../config";

type HrCurveMode = "linear" | "log_fast" | "log_late";
type HrDirection = "up" | "down";

type FitIntervalDraft = {
  id: string;
  name: string;
  durationMinutes: number;
  avgPower: number;
  maxPower: number;
  minPower: number;
  avgHr: number;
  maxHr: number;
  minHr: number;
  startHr: number;
  endHr: number;
  inheritStartHr: boolean;
  hrCurve: HrCurveMode;
  avgCadence: number;
  minCadence: number;
  maxCadence: number;
};

type IncludeFields = {
  power: boolean;
  heart_rate: boolean;
  cadence: boolean;
  speed: boolean;
  distance: boolean;
  temperature: boolean;
  humidity: boolean;
  gps_position: boolean;
  calories: boolean;
  laps: boolean;
  device_info: boolean;
};

type LocationSearchResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

type SavedFitLocation = {
  id: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  savedAt: string;
};

type DerivedInterval = {
  id: string;
  name: string;
  durationSeconds: number;
  distanceM: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  workKj: number;
  calories: number;
};

type DerivedSummary = {
  totalDurationSeconds: number;
  distanceM: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  avgPower: number;
  maxPower: number;
  avgHr: number;
  maxHr: number;
  avgCadence: number;
  maxCadence: number;
  workKj: number;
  calories: number;
  records: number;
  intervals: DerivedInterval[];
};

type HeatCompensation = {
  heatIndexC: number;
  penaltyPct: number;
  multiplier: number;
  label: string;
};

type FitPreviewPoint = {
  elapsedSeconds: number;
  powerW: number;
  heartRateBpm: number;
  cadenceRpm: number;
};

type FitPreviewMetricKey = "power" | "heartRate" | "cadence";

type FitPreviewMetricRange = {
  min: number;
  max: number;
};

type FitPreviewMetric = {
  key: FitPreviewMetricKey;
  label: string;
  unit: string;
  color: string;
  includeKey: keyof IncludeFields;
  getValue: (point: FitPreviewPoint) => number;
};

type FitPreviewIntervalBand = {
  id: string;
  label: string;
  index: number;
  x: number;
  width: number;
};

type FitIntervalFieldKey =
  | "durationMinutes"
  | "avgPower"
  | "minPower"
  | "maxPower"
  | "avgHr"
  | "minHr"
  | "maxHr"
  | "startHr"
  | "endHr"
  | "avgCadence"
  | "minCadence"
  | "maxCadence";

type FitIntervalFieldErrors = Partial<Record<FitIntervalFieldKey, boolean>>;

type FitLlmInterval = {
  name?: string | null;
  duration_minutes?: number | null;
  avg_power_w?: number | null;
  max_power_w?: number | null;
  min_power_w?: number | null;
  avg_hr_bpm?: number | null;
  max_hr_bpm?: number | null;
  min_hr_bpm?: number | null;
  start_hr_bpm?: number | null;
  end_hr_bpm?: number | null;
  avg_cadence_rpm?: number | null;
  min_cadence_rpm?: number | null;
  max_cadence_rpm?: number | null;
};

type FitLlmDescriptionResponse = {
  summary?: string | null;
  date?: string | null;
  time?: string | null;
  temperature_c?: number | null;
  humidity_pct?: number | null;
  system_mass_kg?: number | null;
  power_multiplier?: number | null;
  intervals?: FitLlmInterval[] | null;
  assumptions?: string[] | null;
  model?: string | null;
};

type CreateFitDraft = {
  date: string;
  time: string;
  temperatureC: number;
  humidityPct: number;
  systemMassKg: number;
  powerMultiplier: number;
  trainingType: string;
  device: string;
  locationName: string;
  locationPoint: LatLngTuple | null;
  includeFields: IncludeFields;
  intervals: FitIntervalDraft[];
};

const DRAFT_STORAGE_KEY = "trainmind.createFitFileDraft";
const SAVED_LOCATIONS_STORAGE_KEY = "trainmind.createFitFileLocations";
const DEFAULT_MAP_CENTER: LatLngTuple = [47.3769, 8.5417];

const DEFAULT_INCLUDE_FIELDS: IncludeFields = {
  power: true,
  heart_rate: true,
  cadence: true,
  speed: true,
  distance: true,
  temperature: true,
  humidity: true,
  gps_position: false,
  calories: true,
  laps: true,
  device_info: true,
};

const INCLUDE_FIELD_OPTIONS: Array<{ key: keyof IncludeFields; label: string }> = [
  { key: "power", label: "Power Records" },
  { key: "heart_rate", label: "Herzfrequenz" },
  { key: "cadence", label: "Cadence" },
  { key: "speed", label: "Speed" },
  { key: "distance", label: "Distanz" },
  { key: "temperature", label: "Temperatur" },
  { key: "humidity", label: "Luftfeuchtigkeit" },
  { key: "gps_position", label: "GPS-Positionen" },
  { key: "calories", label: "Kalorien" },
  { key: "laps", label: "Intervalle als Laps" },
  { key: "device_info", label: "Geräteinfo" },
];

const PREVIEW_CHART_WIDTH = 820;
const PREVIEW_CHART_HEIGHT = 260;
const PREVIEW_CHART_LEFT = 34;
const PREVIEW_CHART_RIGHT = 18;
const PREVIEW_CHART_TOP = 18;
const PREVIEW_CHART_BOTTOM = 44;
const PREVIEW_CHART_PLOT_WIDTH = PREVIEW_CHART_WIDTH - PREVIEW_CHART_LEFT - PREVIEW_CHART_RIGHT;
const PREVIEW_CHART_PLOT_HEIGHT = PREVIEW_CHART_HEIGHT - PREVIEW_CHART_TOP - PREVIEW_CHART_BOTTOM;

const PREVIEW_METRICS: FitPreviewMetric[] = [
  {
    key: "heartRate",
    label: "HF",
    unit: "bpm",
    color: "#c9344b",
    includeKey: "heart_rate",
    getValue: (point) => point.heartRateBpm,
  },
  {
    key: "cadence",
    label: "Cadence",
    unit: "rpm",
    color: "#236aa6",
    includeKey: "cadence",
    getValue: (point) => point.cadenceRpm,
  },
  {
    key: "power",
    label: "Watt",
    unit: "W",
    color: "#c45b21",
    includeKey: "power",
    getValue: (point) => point.powerW,
  },
];

const HR_CURVE_OPTIONS: Array<{ key: HrCurveMode; label: string; title: string }> = [
  { key: "linear", label: "Gleichmäßig", title: "HF verändert sich gleichmäßig von Start zu Ende." },
  { key: "log_fast", label: "Log früh", title: "HF verändert sich früh stärker und flacht danach ab." },
  { key: "log_late", label: "Log spät", title: "HF bleibt anfangs ruhiger und verändert sich später stärker." },
];

function formatDateInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(11, 16);
}

function newInterval(name: string, overrides: Partial<FitIntervalDraft> = {}): FitIntervalDraft {
  const interval: FitIntervalDraft = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    durationMinutes: 10,
    avgPower: 150,
    maxPower: 175,
    minPower: 120,
    avgHr: 125,
    maxHr: 138,
    minHr: 105,
    startHr: 105,
    endHr: 135,
    inheritStartHr: true,
    hrCurve: "linear",
    avgCadence: 88,
    minCadence: 80,
    maxCadence: 96,
    ...overrides,
  };
  return withAutoAvgHr(interval);
}

function defaultIntervals(): FitIntervalDraft[] {
  return syncInheritedStartHrs([
    newInterval("Warmup", {
      durationMinutes: 10,
      avgPower: 125,
      maxPower: 155,
      minPower: 85,
      avgHr: 112,
      maxHr: 126,
      minHr: 92,
      startHr: 92,
      endHr: 124,
      avgCadence: 86,
      minCadence: 78,
      maxCadence: 94,
    }),
    newInterval("Main", {
      durationMinutes: 30,
      avgPower: 185,
      maxPower: 220,
      minPower: 155,
      avgHr: 145,
      maxHr: 162,
      minHr: 124,
      startHr: 124,
      endHr: 158,
      avgCadence: 91,
      minCadence: 84,
      maxCadence: 100,
    }),
    newInterval("Cooldown", {
      durationMinutes: 8,
      avgPower: 115,
      maxPower: 145,
      minPower: 75,
      avgHr: 122,
      maxHr: 152,
      minHr: 104,
      startHr: 152,
      endHr: 108,
      avgCadence: 84,
      minCadence: 76,
      maxCadence: 92,
    }),
  ]);
}

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function parseDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  return match?.[1] ?? null;
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatNumber(value: number, digits = 0, suffix = ""): string {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(digits)}${suffix}`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, numberValue));
}

function isDateInputValue(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isTimeInputValue(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{2}:\d{2}$/.test(value));
}

function normalizeTriplet(
  avgValue: unknown,
  minValue: unknown,
  maxValue: unknown,
  fallbackAvg: number,
  minLimit: number,
  maxLimit: number,
  lowSpread: number,
  highSpread: number,
) {
  let avg = clampNumber(avgValue, minLimit, maxLimit, fallbackAvg);
  let min = clampNumber(minValue, minLimit, maxLimit, avg * (1 - lowSpread));
  let max = clampNumber(maxValue, minLimit, maxLimit, avg * (1 + highSpread));
  if (min > max) [min, max] = [max, min];
  avg = Math.max(min, Math.min(max, avg));
  return {
    avg: Math.round(avg),
    min: Math.round(min),
    max: Math.round(max),
  };
}

function intervalFromLlm(interval: FitLlmInterval, index: number): FitIntervalDraft {
  const power = normalizeTriplet(interval.avg_power_w, interval.min_power_w, interval.max_power_w, 150, 0, 2500, 0.2, 0.18);
  const hr = normalizeTriplet(interval.avg_hr_bpm, interval.min_hr_bpm, interval.max_hr_bpm, 128, 0, 260, 0.12, 0.1);
  const cadence = normalizeTriplet(interval.avg_cadence_rpm, interval.min_cadence_rpm, interval.max_cadence_rpm, 88, 0, 250, 0.1, 0.1);
  const startHr = clampNumber(interval.start_hr_bpm, hr.min, hr.max, hr.min);
  const endHr = clampNumber(interval.end_hr_bpm, hr.min, hr.max, hr.avg);
  return newInterval(interval.name?.trim() || `Intervall ${index + 1}`, {
    durationMinutes: Number(clampNumber(interval.duration_minutes, 0.5, 480, 10).toFixed(2)),
    avgPower: power.avg,
    maxPower: power.max,
    minPower: power.min,
    avgHr: hr.avg,
    maxHr: hr.max,
    minHr: hr.min,
    startHr: Math.round(startHr),
    endHr: Math.round(endHr),
    avgCadence: cadence.avg,
    minCadence: cadence.min,
    maxCadence: cadence.max,
  });
}

function airDensity(tempC: number, humidityPct: number): number {
  const dryAir = 1.225 * (288.15 / (273.15 + tempC));
  return dryAir * (1 - 0.0009 * Math.max(0, Math.min(100, humidityPct)));
}

function heatIndexCelsius(tempC: number, humidityPct: number): number {
  if (tempC < 26.7 || humidityPct < 40) return tempC;
  const tempF = tempC * 1.8 + 32;
  const rh = Math.max(0, Math.min(100, humidityPct));
  const heatIndexF =
    -42.379 +
    2.04901523 * tempF +
    10.14333127 * rh -
    0.22475541 * tempF * rh -
    0.00683783 * tempF * tempF -
    0.05481717 * rh * rh +
    0.00122874 * tempF * tempF * rh +
    0.00085282 * tempF * rh * rh -
    0.00000199 * tempF * tempF * rh * rh;
  return (heatIndexF - 32) / 1.8;
}

function heatCompensationSuggestion(tempC: number, humidityPct: number): HeatCompensation {
  const heatIndexC = heatIndexCelsius(tempC, humidityPct);
  const heatStress = Math.max(0, heatIndexC - 26);
  const humidityStress = Math.max(0, humidityPct - 60);
  const dryHeatStress = Math.max(0, tempC - 30);
  const penaltyPct = Math.min(18, heatStress * 0.45 + humidityStress * 0.03 + dryHeatStress * 0.3);
  const multiplier = penaltyPct <= 0 ? 1 : 1 / (1 - penaltyPct / 100);
  const roundedMultiplier = Math.min(1.22, Math.max(1, multiplier));
  const label = penaltyPct < 2 ? "normal" : penaltyPct < 7 ? "warm" : penaltyPct < 13 ? "heiss" : "extrem";
  return {
    heatIndexC,
    penaltyPct,
    multiplier: roundedMultiplier,
    label,
  };
}

function powerToSpeedFlat(powerW: number, massKg: number, rho: number): number {
  if (powerW <= 0) return 0;
  const gravity = 9.80665;
  const cda = 0.32;
  const crr = 0.004;
  const drivetrainEfficiency = 0.975;
  const wheelPower = powerW * drivetrainEfficiency;

  function resistivePower(speedMps: number): number {
    const rolling = speedMps * crr * massKg * gravity;
    const aero = 0.5 * rho * cda * speedMps ** 3;
    return rolling + aero;
  }

  let lo = 0;
  let hi = 25;
  while (resistivePower(hi) < wheelPower && hi < 60) {
    hi *= 1.5;
  }
  for (let index = 0; index < 60; index += 1) {
    const mid = (lo + hi) / 2;
    if (resistivePower(mid) > wheelPower) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function adjustedPower(value: number, multiplier: number): number {
  return Math.max(0, Math.round(value * Math.max(1, multiplier)));
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function durationSecondsForPreview(interval: FitIntervalDraft): number {
  return Math.max(30, Math.round(finiteNumber(interval.durationMinutes, 0) * 60));
}

function clampToRange(value: number, minValue: number, maxValue: number): number {
  const low = Math.min(minValue, maxValue);
  const high = Math.max(minValue, maxValue);
  return Math.max(low, Math.min(high, value));
}

function normalizeHrCurveMode(value: unknown): HrCurveMode {
  return HR_CURVE_OPTIONS.some((option) => option.key === value) ? (value as HrCurveMode) : "linear";
}

function hrCurveProgress(phase: number, mode: HrCurveMode): number {
  const clamped = Math.max(0, Math.min(1, phase));
  if (mode === "log_fast") return Math.log1p(clamped * 9) / Math.log1p(9);
  if (mode === "log_late") return 1 - Math.log1p((1 - clamped) * 9) / Math.log1p(9);
  return clamped;
}

function hrBaselineValue(interval: FitIntervalDraft, phase: number): number {
  const fallback = finiteNumber(interval.avgHr, finiteNumber(interval.startHr, 0));
  const minHr = finiteNumber(interval.minHr, fallback);
  const maxHr = finiteNumber(interval.maxHr, fallback);
  const startHr = clampToRange(finiteNumber(interval.startHr, fallback), minHr, maxHr);
  const endHr = clampToRange(finiteNumber(interval.endHr, fallback), minHr, maxHr);
  const progress = hrCurveProgress(phase, normalizeHrCurveMode(interval.hrCurve));
  return clampToRange(startHr + (endHr - startHr) * progress, minHr, maxHr);
}

function calculateAutoAvgHr(interval: FitIntervalDraft): number {
  const sampleCount = 121;
  let total = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    total += hrBaselineValue(interval, index / (sampleCount - 1));
  }
  return Math.max(0, Math.round(total / sampleCount));
}

function withAutoAvgHr(interval: FitIntervalDraft): FitIntervalDraft {
  const next = { ...interval, hrCurve: normalizeHrCurveMode(interval.hrCurve) };
  return { ...next, avgHr: calculateAutoAvgHr(next) };
}

function syncInheritedStartHrs(intervals: FitIntervalDraft[]): FitIntervalDraft[] {
  return intervals.map((interval, index) => {
    const next =
      index > 0 && interval.inheritStartHr
        ? {
            ...interval,
            startHr: intervals[index - 1].endHr,
          }
        : interval;
    return withAutoAvgHr(next);
  });
}

function intervalFieldErrors(interval: FitIntervalDraft): FitIntervalFieldErrors {
  const errors: FitIntervalFieldErrors = {};
  if (interval.durationMinutes <= 0) errors.durationMinutes = true;

  if (interval.minPower > interval.avgPower) {
    errors.minPower = true;
    errors.avgPower = true;
  }
  if (interval.avgPower > interval.maxPower) {
    errors.avgPower = true;
    errors.maxPower = true;
  }

  if (interval.minHr > interval.maxHr) {
    errors.minHr = true;
    errors.maxHr = true;
  } else {
    if (interval.avgHr < interval.minHr) {
      errors.avgHr = true;
      errors.minHr = true;
    }
    if (interval.avgHr > interval.maxHr) {
      errors.avgHr = true;
      errors.maxHr = true;
    }
    if (interval.startHr < interval.minHr || interval.startHr > interval.maxHr) errors.startHr = true;
    if (interval.endHr < interval.minHr || interval.endHr > interval.maxHr) errors.endHr = true;
  }

  if (interval.minCadence > interval.avgCadence) {
    errors.minCadence = true;
    errors.avgCadence = true;
  }
  if (interval.avgCadence > interval.maxCadence) {
    errors.avgCadence = true;
    errors.maxCadence = true;
  }

  return errors;
}

function inputClass(hasError: boolean | undefined): string {
  return `settings-input${hasError ? " is-error" : ""}`;
}

function normalizeStoredIntervalDraft(value: unknown, index: number): FitIntervalDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<FitIntervalDraft>;
  const fallback = newInterval(`Interval ${index + 1}`);
  const interval: FitIntervalDraft = {
    id: typeof raw.id === "string" && raw.id ? raw.id : fallback.id,
    name: typeof raw.name === "string" ? raw.name : fallback.name,
    durationMinutes: clampNumber(raw.durationMinutes, 0.5, 480, fallback.durationMinutes),
    avgPower: clampNumber(raw.avgPower, 0, 2500, fallback.avgPower),
    maxPower: clampNumber(raw.maxPower, 0, 2500, fallback.maxPower),
    minPower: clampNumber(raw.minPower, 0, 2500, fallback.minPower),
    avgHr: clampNumber(raw.avgHr, 0, 260, fallback.avgHr),
    maxHr: clampNumber(raw.maxHr, 0, 260, fallback.maxHr),
    minHr: clampNumber(raw.minHr, 0, 260, fallback.minHr),
    startHr: clampNumber(raw.startHr, 0, 260, fallback.startHr),
    endHr: clampNumber(raw.endHr, 0, 260, fallback.endHr),
    inheritStartHr: typeof raw.inheritStartHr === "boolean" ? raw.inheritStartHr : true,
    hrCurve: normalizeHrCurveMode(raw.hrCurve),
    avgCadence: clampNumber(raw.avgCadence, 0, 250, fallback.avgCadence),
    minCadence: clampNumber(raw.minCadence, 0, 250, fallback.minCadence),
    maxCadence: clampNumber(raw.maxCadence, 0, 250, fallback.maxCadence),
  };
  return withAutoAvgHr(interval);
}

function hrCurveSparklinePoints(mode: HrCurveMode, rising: boolean, flat: boolean): string {
  const width = 86;
  const height = 34;
  const padding = 5;
  return Array.from({ length: 18 }, (_, index) => {
    const phase = index / 17;
    const progress = hrCurveProgress(phase, mode);
    const x = padding + phase * (width - padding * 2);
    const y = flat ? height / 2 : rising ? height - padding - progress * (height - padding * 2) : padding + progress * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function hrDirectionSparklinePoints(direction: HrDirection): string {
  const startY = direction === "up" ? 27 : 7;
  const endY = direction === "up" ? 7 : 27;
  return `6,${startY} 34,${endY}`;
}

function buildHrDirectionUpdate(interval: FitIntervalDraft, direction: HrDirection): Pick<FitIntervalDraft, "startHr" | "endHr"> {
  const minHr = Math.min(finiteNumber(interval.minHr, 0), finiteNumber(interval.maxHr, 0));
  const maxHr = Math.max(finiteNumber(interval.minHr, 0), finiteNumber(interval.maxHr, 0));
  const span = Math.max(0, maxHr - minHr);
  const step = Math.max(4, Math.round(span * 0.25));
  let startHr = clampToRange(finiteNumber(interval.startHr, minHr), minHr, maxHr);
  let endHr = clampToRange(finiteNumber(interval.endHr, maxHr), minHr, maxHr);

  if (direction === "up") {
    if (endHr < startHr) [startHr, endHr] = [endHr, startHr];
    if (endHr === startHr && span > 0) {
      endHr = clampToRange(startHr + step, minHr, maxHr);
      if (endHr === startHr) startHr = clampToRange(endHr - step, minHr, maxHr);
    }
  } else {
    if (endHr > startHr) [startHr, endHr] = [endHr, startHr];
    if (endHr === startHr && span > 0) {
      endHr = clampToRange(startHr - step, minHr, maxHr);
      if (endHr === startHr) startHr = clampToRange(endHr + step, minHr, maxHr);
    }
  }

  return {
    startHr: Math.round(startHr),
    endHr: Math.round(endHr),
  };
}

function previewPhaseOffset(intervalIndex: number, metricSeed: number, componentIndex: number): number {
  const raw = Math.sin((intervalIndex + 1) * 12.9898 + metricSeed * 78.233 + (componentIndex + 1) * 37.719) * 43758.5453;
  return raw - Math.floor(raw);
}

function previewTimeWaveValue(
  avg: number,
  minValue: number,
  maxValue: number,
  elapsedSeconds: number,
  durationSeconds: number,
  intervalIndex: number,
  metricSeed: number,
  periodsSeconds: number[],
  weights: number[],
): number {
  const safeAvg = finiteNumber(avg, 0);
  const values = [safeAvg, finiteNumber(minValue, safeAvg), finiteNumber(maxValue, safeAvg)];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const duration = Math.max(1, durationSeconds);
  const baseWave = periodsSeconds.reduce((sum, period, componentIndex) => {
    const dampening = Math.min(1, Math.max(0.18, duration / Math.max(1, period)));
    const phase = elapsedSeconds / Math.max(1, period) + previewPhaseOffset(intervalIndex, metricSeed, componentIndex);
    return sum + (weights[componentIndex] ?? 0) * dampening * Math.sin(2 * Math.PI * phase);
  }, 0);
  const clampedWave = Math.max(-0.92, Math.min(0.92, baseWave));
  if (clampedWave >= 0) return safeAvg + (high - safeAvg) * Math.min(clampedWave, 1);
  return safeAvg + (safeAvg - low) * Math.max(clampedWave, -1);
}

function previewHrValue(
  interval: FitIntervalDraft,
  phase: number,
  elapsedSeconds: number,
  durationSeconds: number,
  intervalIndex: number,
  isFirst: boolean,
  isLast: boolean,
): number {
  const avgHr = finiteNumber(interval.avgHr, 0);
  const values = [avgHr, finiteNumber(interval.minHr, avgHr), finiteNumber(interval.maxHr, avgHr)];
  const minHr = Math.min(...values);
  const maxHr = Math.max(...values);
  if (isFirst) return hrBaselineValue(interval, 0);
  if (isLast) return hrBaselineValue(interval, 1);

  const baseline = hrBaselineValue(interval, phase);
  const baselineAvg = calculateAutoAvgHr(interval);
  const bell = Math.sin(Math.PI * phase);
  const correction = (avgHr - baselineAvg) * bell * 1.35;
  const duration = Math.max(1, durationSeconds);
  const ripple = [
    { period: 95, weight: 0.8 },
    { period: 43, weight: 0.45 },
    { period: 17, weight: 0.18 },
  ].reduce((sum, component, componentIndex) => {
    const dampening = Math.min(1, Math.max(0.12, duration / component.period));
    const wavePhase = elapsedSeconds / component.period + previewPhaseOffset(intervalIndex, 3, componentIndex);
    return sum + component.weight * dampening * Math.sin(2 * Math.PI * wavePhase);
  }, 0);
  return clampToRange(baseline + correction + ripple, minHr, maxHr);
}

function buildFitPreviewPoints(intervals: FitIntervalDraft[], powerMultiplier: number): FitPreviewPoint[] {
  const totalDurationSeconds = intervals.reduce((sum, interval) => sum + durationSecondsForPreview(interval), 0);
  if (!intervals.length || totalDurationSeconds <= 0) return [];

  const sampleStep = Math.max(1, Math.ceil(totalDurationSeconds / 1600));
  const points: FitPreviewPoint[] = [];
  let elapsedSeconds = 0;

  intervals.forEach((interval, intervalIndex) => {
    const durationSeconds = durationSecondsForPreview(interval);
    const stepCount = Math.max(2, Math.ceil(durationSeconds / sampleStep) + 1);

    for (let step = 0; step < stepCount; step += 1) {
      const isFirst = step === 0;
      const isLast = step === stepCount - 1;
      const localSecond = isLast ? durationSeconds : Math.round((durationSeconds * step) / (stepCount - 1));
      const activitySecond = elapsedSeconds + localSecond;
      const phase = durationSeconds <= 0 ? 0 : Math.max(0, Math.min(1, localSecond / durationSeconds));

      points.push({
        elapsedSeconds: activitySecond,
        powerW: adjustedPower(
          previewTimeWaveValue(
            interval.avgPower,
            interval.minPower,
            interval.maxPower,
            activitySecond,
            durationSeconds,
            intervalIndex,
            1,
            [75, 28, 11, 5.5],
            [0.26, 0.32, 0.18, 0.06],
          ),
          powerMultiplier,
        ),
        heartRateBpm: Math.max(
          0,
          Math.round(previewHrValue(interval, phase, activitySecond, durationSeconds, intervalIndex, isFirst, isLast)),
        ),
        cadenceRpm: Math.max(
          0,
          Math.round(
            previewTimeWaveValue(
              interval.avgCadence,
              interval.minCadence,
              interval.maxCadence,
              activitySecond,
              durationSeconds,
              intervalIndex,
              2,
              [95, 38, 16, 7],
              [0.22, 0.22, 0.11, 0.04],
            ),
          ),
        ),
      });
    }

    elapsedSeconds += durationSeconds;
  });

  return points;
}

function previewMetricRange(points: FitPreviewPoint[], metric: FitPreviewMetric): FitPreviewMetricRange {
  const values = points.map(metric.getValue).filter((value) => Number.isFinite(value));
  if (!values.length) return { min: 0, max: 1 };

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue;
  const padding = span > 0 ? Math.max(span * 0.08, 2) : Math.max(Math.abs(maxValue) * 0.08, 2);
  return {
    min: Math.max(0, minValue - padding),
    max: maxValue + padding,
  };
}

function previewChartX(elapsedSeconds: number, totalSeconds: number): number {
  const safeTotal = Math.max(1, totalSeconds);
  const ratio = Math.max(0, Math.min(1, elapsedSeconds / safeTotal));
  return PREVIEW_CHART_LEFT + ratio * PREVIEW_CHART_PLOT_WIDTH;
}

function previewChartY(value: number, range: FitPreviewMetricRange): number {
  const span = Math.max(1, range.max - range.min);
  const ratio = Math.max(0, Math.min(1, (value - range.min) / span));
  return PREVIEW_CHART_TOP + (1 - ratio) * PREVIEW_CHART_PLOT_HEIGHT;
}

function formatPreviewCoord(value: number): string {
  return value.toFixed(1);
}

function buildPreviewPolyline(points: FitPreviewPoint[], metric: FitPreviewMetric, range: FitPreviewMetricRange, totalSeconds: number): string {
  return points
    .map((point) => {
      const x = previewChartX(point.elapsedSeconds, totalSeconds);
      const y = previewChartY(metric.getValue(point), range);
      return `${formatPreviewCoord(x)},${formatPreviewCoord(y)}`;
    })
    .join(" ");
}

function buildPreviewIntervalBands(intervals: FitIntervalDraft[], totalSeconds: number): FitPreviewIntervalBand[] {
  let elapsedSeconds = 0;
  return intervals.map((interval, index) => {
    const durationSeconds = durationSecondsForPreview(interval);
    const x = previewChartX(elapsedSeconds, totalSeconds);
    const endX = previewChartX(elapsedSeconds + durationSeconds, totalSeconds);
    elapsedSeconds += durationSeconds;
    return {
      id: interval.id,
      label: interval.name || `Interval ${index + 1}`,
      index,
      x,
      width: Math.max(0, endX - x),
    };
  });
}

function trimPreviewLabel(value: string, maxLength = 16): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

function normalizeSavedLocations(value: unknown): SavedFitLocation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): SavedFitLocation | null => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Partial<SavedFitLocation>;
      const latitudeDeg = Number(raw.latitudeDeg);
      const longitudeDeg = Number(raw.longitudeDeg);
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!name || !Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) return null;
      if (latitudeDeg < -90 || latitudeDeg > 90 || longitudeDeg < -180 || longitudeDeg > 180) return null;
      return {
        id: typeof raw.id === "string" && raw.id ? raw.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        latitudeDeg,
        longitudeDeg,
        savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString(),
      };
    })
    .filter((entry): entry is SavedFitLocation => Boolean(entry))
    .slice(0, 50);
}

function loadSavedFitLocations(): SavedFitLocation[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(SAVED_LOCATIONS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return normalizeSavedLocations(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persistSavedFitLocations(locations: SavedFitLocation[]) {
  window.localStorage.setItem(SAVED_LOCATIONS_STORAGE_KEY, JSON.stringify(locations));
}

function deriveSummary(intervals: FitIntervalDraft[], systemMassKg: number, temperatureC: number, humidityPct: number, powerMultiplier: number): DerivedSummary {
  const rho = airDensity(temperatureC, humidityPct);
  const rows = intervals.map((interval) => {
    const durationSeconds = Math.max(30, Math.round(interval.durationMinutes * 60));
    const avgPower = adjustedPower(interval.avgPower, powerMultiplier);
    const maxPower = adjustedPower(interval.maxPower, powerMultiplier);
    const avgSpeedMps = powerToSpeedFlat(avgPower, systemMassKg, rho);
    const maxSpeedMps = powerToSpeedFlat(maxPower, systemMassKg, rho);
    const distanceM = avgSpeedMps * durationSeconds;
    const workKj = (avgPower * durationSeconds) / 1000;
    const calories = workKj / 0.24 / 4.184;
    return {
      id: interval.id,
      name: interval.name,
      durationSeconds,
      distanceM,
      avgSpeedKmh: avgSpeedMps * 3.6,
      maxSpeedKmh: maxSpeedMps * 3.6,
      workKj,
      calories,
    };
  });

  const totalDurationSeconds = rows.reduce((sum, row) => sum + row.durationSeconds, 0);
  const distanceM = rows.reduce((sum, row) => sum + row.distanceM, 0);
  const weighted = (selector: (interval: FitIntervalDraft) => number) =>
    totalDurationSeconds <= 0
      ? 0
      : intervals.reduce((sum, interval) => sum + selector(interval) * Math.max(30, Math.round(interval.durationMinutes * 60)), 0) / totalDurationSeconds;

  return {
    totalDurationSeconds,
    distanceM,
    avgSpeedKmh: totalDurationSeconds > 0 ? (distanceM / totalDurationSeconds) * 3.6 : 0,
    maxSpeedKmh: Math.max(0, ...rows.map((row) => row.maxSpeedKmh)),
    avgPower: weighted((interval) => adjustedPower(interval.avgPower, powerMultiplier)),
    maxPower: Math.max(0, ...intervals.map((interval) => adjustedPower(interval.maxPower, powerMultiplier))),
    avgHr: weighted((interval) => interval.avgHr),
    maxHr: Math.max(0, ...intervals.map((interval) => interval.maxHr)),
    avgCadence: weighted((interval) => interval.avgCadence),
    maxCadence: Math.max(0, ...intervals.map((interval) => interval.maxCadence)),
    workKj: rows.reduce((sum, row) => sum + row.workKj, 0),
    calories: rows.reduce((sum, row) => sum + row.calories, 0),
    records: totalDurationSeconds,
    intervals: rows,
  };
}

function buildValidationMessages(intervals: FitIntervalDraft[]): string[] {
  const messages: string[] = [];
  intervals.forEach((interval, index) => {
    const label = interval.name.trim() || `Intervall ${index + 1}`;
    if (interval.durationMinutes <= 0) messages.push(`${label}: Dauer muss größer 0 sein.`);
    if (interval.minPower > interval.avgPower || interval.avgPower > interval.maxPower) messages.push(`${label}: Watt muss min <= avg <= max sein.`);
    if (interval.minHr > interval.maxHr) {
      messages.push(`${label}: HF muss min <= max sein.`);
    } else {
      if (interval.avgHr < interval.minHr || interval.avgHr > interval.maxHr) messages.push(`${label}: HF avg liegt außerhalb min/max.`);
      if (interval.startHr < interval.minHr || interval.startHr > interval.maxHr) messages.push(`${label}: Start-HF muss innerhalb min/max liegen.`);
      if (interval.endHr < interval.minHr || interval.endHr > interval.maxHr) messages.push(`${label}: End-HF muss innerhalb min/max liegen.`);
    }
    if (interval.minCadence > interval.avgCadence || interval.avgCadence > interval.maxCadence) messages.push(`${label}: Cadence muss min <= avg <= max sein.`);
  });
  return messages;
}

function FitCreateMapViewport({ point }: { point: LatLngTuple | null }) {
  const map = useMap();
  useEffect(() => {
    const nextPoint = point ?? DEFAULT_MAP_CENTER;
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize();
      map.setView(nextPoint, point ? 14 : 8);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [map, point]);
  return null;
}

function FitCreateMapPicker({ onPick }: { onPick: (point: LatLngTuple) => void }) {
  useMapEvents({
    click(event) {
      onPick([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

function HrCurveSelector({
  interval,
  onCurveChange,
  onDirectionChange,
}: {
  interval: FitIntervalDraft;
  onCurveChange: (mode: HrCurveMode) => void;
  onDirectionChange: (direction: HrDirection) => void;
}) {
  const flat = finiteNumber(interval.endHr, 0) === finiteNumber(interval.startHr, 0);
  const rising = finiteNumber(interval.endHr, 0) >= finiteNumber(interval.startHr, 0);
  const directionLabel = flat ? "flach" : rising ? "steigend" : "fallend";
  const canChangeDirection = finiteNumber(interval.maxHr, 0) > finiteNumber(interval.minHr, 0);

  return (
    <div className="create-fit-hr-curve">
      <div className="create-fit-hr-curve-head">
        <span>HF Verlauf</span>
        <strong>{directionLabel}</strong>
      </div>
      <div className="create-fit-hr-direction-options" role="group" aria-label="HF Richtung">
        {([
          { key: "up" as HrDirection, label: "Ansteigend" },
          { key: "down" as HrDirection, label: "Abfallend" },
        ]).map((option) => {
          const active = !flat && ((option.key === "up" && rising) || (option.key === "down" && !rising));
          return (
            <button
              className={`create-fit-hr-direction-button ${active ? "active" : ""}`}
              type="button"
              key={option.key}
              aria-pressed={active}
              disabled={!canChangeDirection}
              onClick={() => onDirectionChange(option.key)}
            >
              <svg viewBox="0 0 40 34" aria-hidden="true" focusable="false">
                <polyline points={hrDirectionSparklinePoints(option.key)} />
              </svg>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      <div className="create-fit-hr-curve-options" role="group" aria-label="HF Verlauf">
        {HR_CURVE_OPTIONS.map((option) => {
          const active = interval.hrCurve === option.key;
          return (
            <button
              className={`create-fit-hr-curve-button ${active ? "active" : ""}`}
              type="button"
              key={option.key}
              title={option.title}
              aria-pressed={active}
              aria-label={`${option.label}: ${option.title}`}
              onClick={() => onCurveChange(option.key)}
            >
              <svg viewBox="0 0 86 34" aria-hidden="true" focusable="false">
                <polyline points={hrCurveSparklinePoints(option.key, rising, flat)} />
              </svg>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CreateFitOverlayPreview({
  points,
  intervals,
  totalDurationSeconds,
  includeFields,
  onOpen,
}: {
  points: FitPreviewPoint[];
  intervals: FitIntervalDraft[];
  totalDurationSeconds: number;
  includeFields: IncludeFields;
  onOpen: () => void;
}) {
  if (points.length === 0) return null;

  const totalSeconds = Math.max(1, totalDurationSeconds);
  const ranges = PREVIEW_METRICS.reduce(
    (result, metric) => ({
      ...result,
      [metric.key]: previewMetricRange(points, metric),
    }),
    {} as Record<FitPreviewMetricKey, FitPreviewMetricRange>,
  );
  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const timeTicks = [0, totalSeconds / 2, totalSeconds];
  const intervalBands = buildPreviewIntervalBands(intervals, totalSeconds);

  return (
    <button className="create-fit-overlay-preview" type="button" onClick={onOpen} aria-label="Verlauf Preview als Overlay öffnen">
      <div className="create-fit-overlay-head">
        <h3>Verlauf Preview</h3>
        <span>{formatDuration(totalSeconds)} | öffnen</span>
      </div>
      <div className="create-fit-overlay-legend">
        {PREVIEW_METRICS.map((metric) => {
          const range = ranges[metric.key];
          const included = includeFields[metric.includeKey];
          return (
            <div className={`create-fit-overlay-legend-item ${included ? "" : "is-disabled"}`} key={metric.key}>
              <span className="create-fit-overlay-dot" style={{ backgroundColor: metric.color }} />
              <span className="create-fit-overlay-legend-copy">
                <strong>{metric.label}</strong>
                <small>
                  {formatNumber(range.min, 0)}-{formatNumber(range.max, 0)} {metric.unit}
                  {included ? "" : " / aus"}
                </small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="create-fit-overlay-chart-wrap">
        <svg
          viewBox={`0 0 ${PREVIEW_CHART_WIDTH} ${PREVIEW_CHART_HEIGHT}`}
          className="create-fit-overlay-chart"
          role="img"
          aria-label="FIT Verlauf Preview für Watt, Herzfrequenz und Cadence"
        >
          <title>FIT Verlauf Preview</title>
          <rect
            className="create-fit-chart-panel"
            x={PREVIEW_CHART_LEFT}
            y={PREVIEW_CHART_TOP}
            width={PREVIEW_CHART_PLOT_WIDTH}
            height={PREVIEW_CHART_PLOT_HEIGHT}
          />
          {intervalBands.map((band) => (
            <g key={band.id}>
              <rect
                className={`create-fit-chart-band ${band.index % 2 === 1 ? "is-alt" : ""}`}
                x={band.x}
                y={PREVIEW_CHART_TOP}
                width={band.width}
                height={PREVIEW_CHART_PLOT_HEIGHT}
              />
              <line className="create-fit-chart-boundary" x1={band.x} x2={band.x} y1={PREVIEW_CHART_TOP} y2={PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT} />
              {band.width > 82 ? (
                <text className="create-fit-chart-interval-label" x={band.x + band.width / 2} y={PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT + 18} textAnchor="middle">
                  {trimPreviewLabel(band.label)}
                </text>
              ) : null}
            </g>
          ))}
          <line
            className="create-fit-chart-boundary"
            x1={PREVIEW_CHART_LEFT + PREVIEW_CHART_PLOT_WIDTH}
            x2={PREVIEW_CHART_LEFT + PREVIEW_CHART_PLOT_WIDTH}
            y1={PREVIEW_CHART_TOP}
            y2={PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT}
          />
          {gridFractions.map((fraction) => {
            const y = PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT * fraction;
            return <line className="create-fit-chart-grid" key={fraction} x1={PREVIEW_CHART_LEFT} x2={PREVIEW_CHART_LEFT + PREVIEW_CHART_PLOT_WIDTH} y1={y} y2={y} />;
          })}
          {PREVIEW_METRICS.map((metric) => {
            const included = includeFields[metric.includeKey];
            return (
              <polyline
                key={metric.key}
                fill="none"
                stroke={metric.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={included ? 0.95 : 0.3}
                strokeWidth={included ? 3.1 : 2.2}
                strokeDasharray={included ? undefined : "6 7"}
                points={buildPreviewPolyline(points, metric, ranges[metric.key], totalSeconds)}
              />
            );
          })}
          {timeTicks.map((tick, index) => {
            const x = previewChartX(tick, totalSeconds);
            return (
              <g key={`${index}-${tick}`}>
                <line className="create-fit-chart-tick" x1={x} x2={x} y1={PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT} y2={PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT + 6} />
                <text className="create-fit-chart-time-label" x={x} y={PREVIEW_CHART_HEIGHT - 8} textAnchor={index === 0 ? "start" : index === timeTicks.length - 1 ? "end" : "middle"}>
                  {formatDuration(tick)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </button>
  );
}

function CreateFitSinglePreviewChart({
  metric,
  points,
  intervals,
  totalDurationSeconds,
  includeFields,
}: {
  metric: FitPreviewMetric;
  points: FitPreviewPoint[];
  intervals: FitIntervalDraft[];
  totalDurationSeconds: number;
  includeFields: IncludeFields;
}) {
  if (points.length === 0) return null;

  const totalSeconds = Math.max(1, totalDurationSeconds);
  const range = previewMetricRange(points, metric);
  const intervalBands = buildPreviewIntervalBands(intervals, totalSeconds);
  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const timeTicks = [0, totalSeconds / 2, totalSeconds];
  const included = includeFields[metric.includeKey];

  return (
    <article className={`create-fit-preview-chart-card ${included ? "" : "is-disabled"}`}>
      <div className="create-fit-preview-chart-head">
        <div>
          <h3>{metric.label}</h3>
          <span>
            {formatNumber(range.min, 0)}-{formatNumber(range.max, 0)} {metric.unit}
          </span>
        </div>
        <strong>{included ? "Im Export aktiv" : "Im Export aus"}</strong>
      </div>
      <div className="create-fit-overlay-chart-wrap">
        <svg
          viewBox={`0 0 ${PREVIEW_CHART_WIDTH} ${PREVIEW_CHART_HEIGHT}`}
          className="create-fit-overlay-chart create-fit-single-chart"
          role="img"
          aria-label={`${metric.label} Verlauf`}
        >
          <title>{`${metric.label} Verlauf`}</title>
          <rect
            className="create-fit-chart-panel"
            x={PREVIEW_CHART_LEFT}
            y={PREVIEW_CHART_TOP}
            width={PREVIEW_CHART_PLOT_WIDTH}
            height={PREVIEW_CHART_PLOT_HEIGHT}
          />
          {intervalBands.map((band) => (
            <g key={band.id}>
              <rect
                className={`create-fit-chart-band ${band.index % 2 === 1 ? "is-alt" : ""}`}
                x={band.x}
                y={PREVIEW_CHART_TOP}
                width={band.width}
                height={PREVIEW_CHART_PLOT_HEIGHT}
              />
              <line className="create-fit-chart-boundary" x1={band.x} x2={band.x} y1={PREVIEW_CHART_TOP} y2={PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT} />
              {band.width > 94 ? (
                <text className="create-fit-chart-interval-label" x={band.x + band.width / 2} y={PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT + 18} textAnchor="middle">
                  {trimPreviewLabel(band.label, 18)}
                </text>
              ) : null}
            </g>
          ))}
          {gridFractions.map((fraction) => {
            const y = PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT * fraction;
            const value = range.max - (range.max - range.min) * fraction;
            return (
              <g key={fraction}>
                <line className="create-fit-chart-grid" x1={PREVIEW_CHART_LEFT} x2={PREVIEW_CHART_LEFT + PREVIEW_CHART_PLOT_WIDTH} y1={y} y2={y} />
                {fraction === 0 || fraction === 0.5 || fraction === 1 ? (
                  <text className="create-fit-chart-axis-label" x={PREVIEW_CHART_LEFT - 8} y={y + 4} textAnchor="end">
                    {formatNumber(value, 0)}
                  </text>
                ) : null}
              </g>
            );
          })}
          <polyline
            fill="none"
            stroke={metric.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={included ? 0.96 : 0.34}
            strokeWidth={3.3}
            strokeDasharray={included ? undefined : "6 7"}
            points={buildPreviewPolyline(points, metric, range, totalSeconds)}
          />
          {timeTicks.map((tick, index) => {
            const x = previewChartX(tick, totalSeconds);
            return (
              <g key={`${metric.key}-${index}-${tick}`}>
                <line className="create-fit-chart-tick" x1={x} x2={x} y1={PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT} y2={PREVIEW_CHART_TOP + PREVIEW_CHART_PLOT_HEIGHT + 6} />
                <text className="create-fit-chart-time-label" x={x} y={PREVIEW_CHART_HEIGHT - 8} textAnchor={index === 0 ? "start" : index === timeTicks.length - 1 ? "end" : "middle"}>
                  {formatDuration(tick)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </article>
  );
}

function CreateFitPreviewModal({
  points,
  intervals,
  totalDurationSeconds,
  includeFields,
  onClose,
}: {
  points: FitPreviewPoint[];
  intervals: FitIntervalDraft[];
  totalDurationSeconds: number;
  includeFields: IncludeFields;
  onClose: () => void;
}) {
  return (
    <div className="confirm-overlay create-fit-modal-backdrop" role="dialog" aria-modal="true" aria-label="Verlauf Preview" onClick={onClose}>
      <div className="confirm-card create-fit-preview-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="training-overlay-head create-fit-modal-head">
          <div>
            <h2>Verlauf Preview</h2>
            <p className="training-overlay-lead">HF, Cadence und Watt als einzelne Grafiken vor dem FIT-Export.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Overlay schließen">
            x
          </button>
        </div>
        <div className="create-fit-preview-chart-grid">
          {PREVIEW_METRICS.map((metric) => (
            <CreateFitSinglePreviewChart
              key={metric.key}
              metric={metric}
              points={points}
              intervals={intervals}
              totalDurationSeconds={totalDurationSeconds}
              includeFields={includeFields}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateFitLocationPickerModal({
  locations,
  onSelect,
  onDelete,
  onClose,
}: {
  locations: SavedFitLocation[];
  onSelect: (location: SavedFitLocation) => void;
  onDelete: (locationId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="confirm-overlay create-fit-modal-backdrop" role="dialog" aria-modal="true" aria-label="Gespeicherte Orte auswählen" onClick={onClose}>
      <div className="confirm-card create-fit-location-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="training-overlay-head create-fit-modal-head">
          <div>
            <h2>Gespeicherte Orte</h2>
            <p className="training-overlay-lead">Wähle einen gespeicherten Ort für den FIT-Export aus.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Popup schließen">
            x
          </button>
        </div>
        {locations.length === 0 ? <p className="training-note">Noch keine Orte gespeichert.</p> : null}
        {locations.length > 0 ? (
          <div className="create-fit-saved-location-list">
            {locations.map((location) => (
              <article className="create-fit-saved-location" key={location.id}>
                <button className="create-fit-saved-location-select" type="button" onClick={() => onSelect(location)}>
                  <strong>{location.name}</strong>
                  <span>
                    {location.latitudeDeg.toFixed(5)}, {location.longitudeDeg.toFixed(5)}
                  </span>
                </button>
                <button className="icon-button danger" type="button" onClick={() => onDelete(location.id)} aria-label={`${location.name} entfernen`}>
                  x
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CreateFitFilePage() {
  const now = useMemo(() => new Date(), []);
  const [date, setDate] = useState(formatDateInput(now));
  const [time, setTime] = useState(formatTimeInput(now));
  const [temperatureC, setTemperatureC] = useState(20);
  const [humidityPct, setHumidityPct] = useState(45);
  const [systemMassKg, setSystemMassKg] = useState(85);
  const [powerMultiplier, setPowerMultiplier] = useState(1);
  const [trainingType, setTrainingType] = useState("indoor");
  const [device, setDevice] = useState("technogym_indoor_trainer");
  const [activityDescription, setActivityDescription] = useState("");
  const [describingActivity, setDescribingActivity] = useState(false);
  const [llmAssumptions, setLlmAssumptions] = useState<string[]>([]);
  const [locationName, setLocationName] = useState("");
  const [locationPoint, setLocationPoint] = useState<LatLngTuple | null>(null);
  const [locationSearch, setLocationSearch] = useState("");
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [savedLocations, setSavedLocations] = useState<SavedFitLocation[]>(loadSavedFitLocations);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [intervals, setIntervals] = useState<FitIntervalDraft[]>(defaultIntervals);
  const [includeFields, setIncludeFields] = useState<IncludeFields>(DEFAULT_INCLUDE_FIELDS);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewOverlayOpen, setPreviewOverlayOpen] = useState(false);
  const [hasDraft, setHasDraft] = useState(() => (typeof window === "undefined" ? false : Boolean(window.localStorage.getItem(DRAFT_STORAGE_KEY))));

  const heatCompensation = useMemo(() => heatCompensationSuggestion(temperatureC, humidityPct), [humidityPct, temperatureC]);
  const derived = useMemo(
    () => deriveSummary(intervals, systemMassKg, temperatureC, humidityPct, powerMultiplier),
    [humidityPct, intervals, powerMultiplier, systemMassKg, temperatureC],
  );
  const previewPoints = useMemo(() => buildFitPreviewPoints(intervals, powerMultiplier), [intervals, powerMultiplier]);
  const validationMessages = useMemo(() => buildValidationMessages(intervals), [intervals]);

  useEffect(() => {
    if (!previewOverlayOpen && !locationPickerOpen) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPreviewOverlayOpen(false);
      setLocationPickerOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [locationPickerOpen, previewOverlayOpen]);

  function updateInterval(id: string, updates: Partial<FitIntervalDraft>) {
    setIntervals((current) => syncInheritedStartHrs(current.map((interval) => (interval.id === id ? { ...interval, ...updates } : interval))));
  }

  function addInterval() {
    setIntervals((current) =>
      syncInheritedStartHrs([
        ...current,
        newInterval(`Interval ${current.length + 1}`, {
          startHr: current.length > 0 ? current[current.length - 1].endHr : 105,
        }),
      ]),
    );
  }

  function duplicateInterval(interval: FitIntervalDraft) {
    setIntervals((current) =>
      syncInheritedStartHrs([
        ...current,
        {
          ...interval,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: `${interval.name || "Interval"} Copy`,
          inheritStartHr: true,
        },
      ]),
    );
  }

  function removeInterval(id: string) {
    setIntervals((current) => (current.length <= 1 ? current : syncInheritedStartHrs(current.filter((interval) => interval.id !== id))));
  }

  function moveInterval(id: string, direction: -1 | 1) {
    setIntervals((current) => {
      const index = current.findIndex((interval) => interval.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = current.slice();
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return syncInheritedStartHrs(next);
    });
  }

  function handleMapPick(point: LatLngTuple) {
    setLocationPoint(point);
    setLocationName(locationName.trim() || `${point[0].toFixed(5)}, ${point[1].toFixed(5)}`);
    setLocationError(null);
    setSearchResults([]);
  }

  async function searchLocation() {
    const query = locationSearch.trim();
    if (!query) {
      setLocationError("Bitte einen Ort eingeben.");
      return;
    }
    setSearching(true);
    setLocationError(null);
    try {
      const params = new URLSearchParams({ format: "jsonv2", limit: "5", q: query });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Ortssuche fehlgeschlagen.");
      const payload = (await response.json()) as LocationSearchResult[];
      setSearchResults(payload);
      if (payload.length === 0) setLocationError("Kein Ort gefunden.");
    } catch (nextError) {
      setSearchResults([]);
      setLocationError(nextError instanceof Error ? nextError.message : "Ortssuche fehlgeschlagen.");
    } finally {
      setSearching(false);
    }
  }

  function selectSearchResult(result: LocationSearchResult) {
    const point: LatLngTuple = [Number(result.lat), Number(result.lon)];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
    setLocationPoint(point);
    setLocationName(result.display_name);
    setLocationSearch(result.display_name);
    setSearchResults([]);
    setLocationError(null);
  }

  function saveCurrentLocation() {
    if (!locationPoint) {
      setLocationError("Bitte zuerst einen Ort suchen oder auf der Karte setzen.");
      return;
    }
    const name = locationName.trim();
    if (!name) {
      setLocationError("Bitte einen Namen für den Ort eintragen.");
      return;
    }

    const nextLocation: SavedFitLocation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      latitudeDeg: locationPoint[0],
      longitudeDeg: locationPoint[1],
      savedAt: new Date().toISOString(),
    };
    setSavedLocations((current) => {
      const normalizedName = name.toLowerCase();
      const filtered = current.filter((location) => location.name.toLowerCase() !== normalizedName);
      const next = [nextLocation, ...filtered].slice(0, 50);
      persistSavedFitLocations(next);
      return next;
    });
    setLocationError(null);
    setMessage(`Ort gespeichert: ${name}`);
  }

  function selectSavedLocation(location: SavedFitLocation) {
    const point: LatLngTuple = [location.latitudeDeg, location.longitudeDeg];
    setLocationPoint(point);
    setLocationName(location.name);
    setLocationSearch(location.name);
    setSearchResults([]);
    setLocationError(null);
    setLocationPickerOpen(false);
    setMessage(`Ort ausgewählt: ${location.name}`);
  }

  function deleteSavedLocation(locationId: string) {
    setSavedLocations((current) => {
      const next = current.filter((location) => location.id !== locationId);
      persistSavedFitLocations(next);
      return next;
    });
  }

  async function describeActivityForLlm() {
    const description = activityDescription.trim();
    if (!description) {
      setError("Bitte zuerst beschreiben, wie das Training war.");
      return;
    }

    setDescribingActivity(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/fit-create/describe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          date,
          time,
          temperature_c: temperatureC,
          humidity_pct: humidityPct,
          system_mass_kg: systemMassKg,
        }),
      });

      if (!response.ok) {
        const payload = await parseJsonSafely<{ detail?: string }>(response);
        throw new Error(payload?.detail || "Aktivität konnte nicht aus der Beschreibung erstellt werden.");
      }

      const payload = await parseJsonSafely<FitLlmDescriptionResponse>(response);
      if (!payload) throw new Error("Leere LLM-Antwort erhalten.");

      const nextIntervals = (payload.intervals ?? []).map((interval, index) => intervalFromLlm(interval, index));
      if (nextIntervals.length === 0) throw new Error("Die LLM-Antwort enthielt keine Intervalle.");

      setIntervals(syncInheritedStartHrs(nextIntervals));
      if (isDateInputValue(payload.date)) setDate(payload.date);
      if (isTimeInputValue(payload.time)) setTime(payload.time);
      if (typeof payload.temperature_c === "number") setTemperatureC(clampNumber(payload.temperature_c, -40, 60, temperatureC));
      if (typeof payload.humidity_pct === "number") setHumidityPct(clampNumber(payload.humidity_pct, 0, 100, humidityPct));
      if (typeof payload.system_mass_kg === "number") setSystemMassKg(clampNumber(payload.system_mass_kg, 40, 180, systemMassKg));
      if (typeof payload.power_multiplier === "number") setPowerMultiplier(clampNumber(payload.power_multiplier, 1, 1.3, powerMultiplier));
      setLlmAssumptions((payload.assumptions ?? []).filter(Boolean).slice(0, 6));
      const modelText = payload.model ? ` (${payload.model})` : "";
      setMessage(`${payload.summary || "Beschreibung übernommen."}${modelText}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unbekannter LLM-Fehler");
    } finally {
      setDescribingActivity(false);
    }
  }

  function buildDraft(): CreateFitDraft {
    return {
      date,
      time,
      temperatureC,
      humidityPct,
      systemMassKg,
      powerMultiplier,
      trainingType,
      device,
      locationName,
      locationPoint,
      includeFields,
      intervals,
    };
  }

  function saveDraft() {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(buildDraft()));
    setHasDraft(true);
    setMessage("Entwurf gespeichert.");
    setError(null);
  }

  function loadDraft() {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Partial<CreateFitDraft>;
      if (draft.date) setDate(draft.date);
      if (draft.time) setTime(draft.time);
      if (typeof draft.temperatureC === "number") setTemperatureC(draft.temperatureC);
      if (typeof draft.humidityPct === "number") setHumidityPct(draft.humidityPct);
      if (typeof draft.systemMassKg === "number") setSystemMassKg(draft.systemMassKg);
      if (typeof draft.powerMultiplier === "number") setPowerMultiplier(Math.max(1, draft.powerMultiplier));
      if (draft.trainingType) setTrainingType(draft.trainingType);
      if (draft.device) setDevice(draft.device);
      if (typeof draft.locationName === "string") setLocationName(draft.locationName);
      if (Array.isArray(draft.locationPoint) && draft.locationPoint.length === 2) setLocationPoint(draft.locationPoint as LatLngTuple);
      if (draft.includeFields) setIncludeFields({ ...DEFAULT_INCLUDE_FIELDS, ...draft.includeFields });
      if (Array.isArray(draft.intervals) && draft.intervals.length > 0) {
        const nextIntervals = draft.intervals
          .map((interval, index) => normalizeStoredIntervalDraft(interval, index))
          .filter((interval): interval is FitIntervalDraft => Boolean(interval));
        if (nextIntervals.length > 0) setIntervals(syncInheritedStartHrs(nextIntervals));
      }
      setMessage("Entwurf geladen.");
      setError(null);
    } catch {
      setError("Entwurf konnte nicht geladen werden.");
    }
  }

  function resetForm() {
    setDate(formatDateInput(new Date()));
    setTime(formatTimeInput(new Date()));
    setTemperatureC(20);
    setHumidityPct(45);
    setSystemMassKg(85);
    setPowerMultiplier(1);
    setTrainingType("indoor");
    setDevice("technogym_indoor_trainer");
    setActivityDescription("");
    setLlmAssumptions([]);
    setLocationName("");
    setLocationPoint(null);
    setLocationSearch("");
    setSearchResults([]);
    setIncludeFields(DEFAULT_INCLUDE_FIELDS);
    setIntervals(defaultIntervals());
    setMessage("Formular zurückgesetzt.");
    setError(null);
  }

  async function downloadFitFile() {
    if (validationMessages.length > 0) {
      setError(validationMessages[0]);
      return;
    }
    const startTime = new Date(`${date}T${time || "00:00"}:00`);
    if (Number.isNaN(startTime.getTime())) {
      setError("Bitte Datum und Zeit prüfen.");
      return;
    }

    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/fit-create/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time: startTime.toISOString(),
          temperature_c: temperatureC,
          humidity_pct: humidityPct,
          location: locationPoint
            ? {
                name: locationName.trim() || `${locationPoint[0].toFixed(5)}, ${locationPoint[1].toFixed(5)}`,
                latitude_deg: locationPoint[0],
                longitude_deg: locationPoint[1],
              }
            : null,
          training_type: trainingType,
          device,
          system_mass_kg: systemMassKg,
          include: includeFields,
          intervals: intervals.map((interval, index) => ({
            name: interval.name.trim() || `Interval ${index + 1}`,
            duration_seconds: Math.max(30, Math.round(interval.durationMinutes * 60)),
            avg_power_w: adjustedPower(interval.avgPower, powerMultiplier),
            max_power_w: adjustedPower(interval.maxPower, powerMultiplier),
            min_power_w: adjustedPower(interval.minPower, powerMultiplier),
            avg_hr_bpm: interval.avgHr,
            max_hr_bpm: interval.maxHr,
            min_hr_bpm: interval.minHr,
            start_hr_bpm: interval.startHr,
            end_hr_bpm: interval.endHr,
            hr_curve: interval.hrCurve,
            avg_cadence_rpm: interval.avgCadence,
            min_cadence_rpm: interval.minCadence,
            max_cadence_rpm: interval.maxCadence,
          })),
        }),
      });

      if (!response.ok) {
        const payload = await parseJsonSafely<{ detail?: string }>(response);
        throw new Error(payload?.detail || "FIT-Datei konnte nicht erstellt werden.");
      }

      const blob = await response.blob();
      const downloadName = parseDownloadFilename(response.headers.get("Content-Disposition")) || "trainmind_indoor_bike.fit";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const distanceM = response.headers.get("X-TrainMind-Distance-M");
      const avgSpeed = response.headers.get("X-TrainMind-Avg-Speed-KMH");
      const records = response.headers.get("X-TrainMind-Records");
      setMessage(`FIT erstellt: ${downloadName}. Distanz ${distanceM ? `${(Number(distanceM) / 1000).toFixed(2)} km` : "-"}, Speed ${avgSpeed ?? "-"} km/h, Records ${records ?? "-"}.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Tools</p>
        <h1>Create FIT File</h1>
        <p className="lead">
          Indoor-Bike-Training manuell aus Intervallen rekonstruieren, Kennzahlen berechnen und als FIT-Datei herunterladen.
          Der Export wird nicht als Aktivität in TrainMind gespeichert.
        </p>
      </div>

      <div className="create-fit-layout">
        <div className="create-fit-main">
          <div className="card">
            <div className="section-title-row">
              <h2>Rahmendaten</h2>
            </div>
            <div className="create-fit-form-grid">
              <label className="settings-label">
                Datum
                <input className="settings-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <label className="settings-label">
                Startzeit
                <input className="settings-input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
              <label className="settings-label">
                Temperatur (°C)
                <input className="settings-input" type="number" value={temperatureC} onChange={(event) => setTemperatureC(Number(event.target.value))} />
              </label>
              <label className="settings-label">
                Luftfeuchtigkeit (%)
                <input className="settings-input" type="number" min="0" max="100" value={humidityPct} onChange={(event) => setHumidityPct(Number(event.target.value))} />
              </label>
              <label className="settings-label">
                Trainingsart
                <select className="settings-input" value={trainingType} onChange={(event) => setTrainingType(event.target.value)}>
                  <option value="indoor">Indoor</option>
                </select>
              </label>
              <label className="settings-label">
                Gerät
                <select className="settings-input" value={device} onChange={(event) => setDevice(event.target.value)}>
                  <option value="technogym_indoor_trainer">Technogym Indoor Trainer</option>
                </select>
              </label>
              <label className="settings-label">
                Systemgewicht (kg)
                <input className="settings-input" type="number" min="40" max="180" value={systemMassKg} onChange={(event) => setSystemMassKg(Number(event.target.value))} />
              </label>
              <label className="settings-label">
                Watt-Multiplikator
                <input
                  className="settings-input"
                  type="number"
                  min="1"
                  max="1.3"
                  step="0.001"
                  value={Number(powerMultiplier.toFixed(3))}
                  onChange={(event) => setPowerMultiplier(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
            </div>
            <div className={`create-fit-heat-box heat-${heatCompensation.label}`}>
              <div>
                <span>Wetter-Vorschlag</span>
                <strong>
                  +{formatNumber((heatCompensation.multiplier - 1) * 100, 1, " %")} · x{heatCompensation.multiplier.toFixed(3)}
                </strong>
                <p>
                  Gefühlt {formatNumber(heatCompensation.heatIndexC, 1, " °C")} bei {formatNumber(temperatureC, 1, " °C")} und {formatNumber(humidityPct, 0, " %")} RH.
                  Der Multiplikator erhöht nur min/avg/max Watt im Export.
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={heatCompensation.multiplier <= 1.001}
                onClick={() => {
                  setPowerMultiplier(Number(heatCompensation.multiplier.toFixed(3)));
                  setMessage("Wetter-Multiplikator übernommen.");
                  setError(null);
                }}
              >
                Vorschlag übernehmen
              </button>
            </div>
          </div>

          <div className="card create-fit-llm-card">
            <div className="section-title-row">
              <h2>Aktivität beschreiben</h2>
            </div>
            <label className="settings-label">
              Beschreibung
              <textarea
                className="settings-input create-fit-description"
                value={activityDescription}
                onChange={(event) => setActivityDescription(event.target.value)}
                placeholder="z. B. 10 Minuten locker warmgefahren, dann 4x5 Minuten hart bei etwa 260 Watt mit 3 Minuten locker dazwischen, danach 8 Minuten cooldown. HF ging von 105 auf 165, Cadence meist um 90."
              />
            </label>
            <div className="settings-actions create-fit-llm-actions">
              <button className="primary-button" type="button" disabled={describingActivity || !activityDescription.trim()} onClick={() => void describeActivityForLlm()}>
                {describingActivity ? "LLM strukturiert..." : "Beschreibe Aktivität für LLM"}
              </button>
            </div>
            {llmAssumptions.length > 0 ? (
              <div className="create-fit-assumption-list">
                {llmAssumptions.map((assumption) => (
                  <span key={assumption}>{assumption}</span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="card">
            <div className="section-title-row">
              <h2>Ort</h2>
              <div className="create-fit-location-title-actions">
                <span className="fit-repair-pill">{locationPoint ? `${locationPoint[0].toFixed(4)}, ${locationPoint[1].toFixed(4)}` : "Kein Ort gesetzt"}</span>
                <button className="secondary-button" type="button" onClick={() => setLocationPickerOpen(true)}>
                  Gespeicherte Orte
                </button>
              </div>
            </div>
            <form className="create-fit-location-search" onSubmit={(event: FormEvent) => { event.preventDefault(); void searchLocation(); }}>
              <label className="settings-label">
                Ort suchen
                <input className="settings-input" value={locationSearch} onChange={(event) => setLocationSearch(event.target.value)} placeholder="z. B. Zürich" />
              </label>
              <button className="secondary-button" type="submit" disabled={searching}>
                {searching ? "Suche..." : "Suchen"}
              </button>
            </form>
            {searchResults.length > 0 ? (
              <div className="create-fit-search-results">
                {searchResults.map((result) => (
                  <button key={result.place_id} type="button" onClick={() => selectSearchResult(result)}>
                    {result.display_name}
                  </button>
                ))}
              </div>
            ) : null}
            {locationError ? <p className="error-text">{locationError}</p> : null}
            <label className="settings-label create-fit-location-name">
              Ortsname im Export
              <input className="settings-input" value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="Indoor Studio, Hotel Gym, Zuhause..." />
            </label>
            <div className="settings-actions create-fit-location-actions">
              <button className="secondary-button" type="button" onClick={saveCurrentLocation} disabled={!locationPoint || !locationName.trim()}>
                Aktuellen Ort speichern
              </button>
              <button className="secondary-button" type="button" onClick={() => setLocationPickerOpen(true)}>
                Aus Popup wählen ({savedLocations.length})
              </button>
            </div>
            <div className="create-fit-map-shell">
              <MapContainer className="create-fit-map" center={locationPoint ?? DEFAULT_MAP_CENTER} zoom={locationPoint ? 14 : 8} scrollWheelZoom>
                <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} />
                <FitCreateMapViewport point={locationPoint} />
                <FitCreateMapPicker onPick={handleMapPick} />
                {locationPoint ? <CircleMarker center={locationPoint} radius={9} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#236aa6", fillOpacity: 1 }} /> : null}
              </MapContainer>
            </div>
          </div>

          <div className="card">
            <div className="section-title-row">
              <h2>FIT-Felder</h2>
            </div>
            <div className="create-fit-checkbox-grid">
              {INCLUDE_FIELD_OPTIONS.map((option) => (
                <label className="create-fit-check" key={option.key}>
                  <input
                    type="checkbox"
                    checked={includeFields[option.key]}
                    onChange={(event) => setIncludeFields((current) => ({ ...current, [option.key]: event.target.checked }))}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="section-title-row">
              <h2>Intervalle</h2>
              <button className="secondary-button" type="button" onClick={addInterval}>
                Intervall hinzufügen
              </button>
            </div>
            <div className="create-fit-interval-list">
              {intervals.map((interval, index) => {
                const fieldErrors = intervalFieldErrors(interval);
                const canInheritStartHr = index > 0;
                const startHrInherited = canInheritStartHr && interval.inheritStartHr;
                return (
                <article className="create-fit-interval" key={interval.id}>
                  <div className="create-fit-interval-head">
                    <strong>{index + 1}. {interval.name || "Interval"}</strong>
                    <div className="create-fit-interval-actions">
                      <button className="icon-button" type="button" onClick={() => moveInterval(interval.id, -1)} disabled={index === 0} aria-label="Intervall nach oben">
                        ^
                      </button>
                      <button className="icon-button" type="button" onClick={() => moveInterval(interval.id, 1)} disabled={index === intervals.length - 1} aria-label="Intervall nach unten">
                        v
                      </button>
                      <button className="secondary-button" type="button" onClick={() => duplicateInterval(interval)}>
                        Kopieren
                      </button>
                      <button className="icon-button danger" type="button" onClick={() => removeInterval(interval.id)} disabled={intervals.length <= 1} aria-label="Intervall entfernen">
                        x
                      </button>
                    </div>
                  </div>
                  <div className="create-fit-interval-fields">
                    <div className="create-fit-interval-row create-fit-interval-row-main">
                      <label className="settings-label">
                        Name
                        <input className="settings-input" value={interval.name} onChange={(event) => updateInterval(interval.id, { name: event.target.value })} />
                      </label>
                      <label className="settings-label">
                        Dauer (min)
                        <input className={inputClass(fieldErrors.durationMinutes)} type="number" min="0.5" step="0.5" value={interval.durationMinutes} onChange={(event) => updateInterval(interval.id, { durationMinutes: Number(event.target.value) })} />
                      </label>
                    </div>

                    <div className="create-fit-metric-section">
                      <div className="create-fit-interval-row create-fit-interval-row-3">
                        <label className="settings-label">
                          Watt avg
                          <input className={inputClass(fieldErrors.avgPower)} type="number" value={interval.avgPower} onChange={(event) => updateInterval(interval.id, { avgPower: Number(event.target.value) })} />
                        </label>
                        <label className="settings-label">
                          Watt min
                          <input className={inputClass(fieldErrors.minPower)} type="number" value={interval.minPower} onChange={(event) => updateInterval(interval.id, { minPower: Number(event.target.value) })} />
                        </label>
                        <label className="settings-label">
                          Watt max
                          <input className={inputClass(fieldErrors.maxPower)} type="number" value={interval.maxPower} onChange={(event) => updateInterval(interval.id, { maxPower: Number(event.target.value) })} />
                        </label>
                      </div>
                    </div>

                    <div className="create-fit-metric-section">
                      <div className="create-fit-interval-row create-fit-interval-row-3">
                        <label className="settings-label">
                          Cadence avg
                          <input className={inputClass(fieldErrors.avgCadence)} type="number" value={interval.avgCadence} onChange={(event) => updateInterval(interval.id, { avgCadence: Number(event.target.value) })} />
                        </label>
                        <label className="settings-label">
                          Cadence min
                          <input className={inputClass(fieldErrors.minCadence)} type="number" value={interval.minCadence} onChange={(event) => updateInterval(interval.id, { minCadence: Number(event.target.value) })} />
                        </label>
                        <label className="settings-label">
                          Cadence max
                          <input className={inputClass(fieldErrors.maxCadence)} type="number" value={interval.maxCadence} onChange={(event) => updateInterval(interval.id, { maxCadence: Number(event.target.value) })} />
                        </label>
                      </div>
                    </div>

                    <div className="create-fit-metric-section">
                      <div className="create-fit-interval-row create-fit-interval-row-5">
                        <div className="settings-label create-fit-hf-start-field">
                          HF Start
                          <div className="create-fit-hf-start-control">
                            <input
                              className="create-fit-inherit-checkbox"
                              type="checkbox"
                              checked={startHrInherited}
                              disabled={!canInheritStartHr}
                              aria-label="Start-HF vom vorherigen Intervall übernehmen"
                              onChange={(event) => updateInterval(interval.id, { inheritStartHr: event.target.checked })}
                            />
                            <input
                              className={inputClass(fieldErrors.startHr)}
                              type="number"
                              value={interval.startHr}
                              readOnly={startHrInherited}
                              onChange={(event) => updateInterval(interval.id, { startHr: Number(event.target.value) })}
                            />
                          </div>
                        </div>
                        <label className="settings-label">
                          HF End
                          <input className={inputClass(fieldErrors.endHr)} type="number" value={interval.endHr} onChange={(event) => updateInterval(interval.id, { endHr: Number(event.target.value) })} />
                        </label>
                        <label className="settings-label">
                          HF min
                          <input className={inputClass(fieldErrors.minHr)} type="number" value={interval.minHr} onChange={(event) => updateInterval(interval.id, { minHr: Number(event.target.value) })} />
                        </label>
                        <label className="settings-label">
                          HF max
                          <input className={inputClass(fieldErrors.maxHr)} type="number" value={interval.maxHr} onChange={(event) => updateInterval(interval.id, { maxHr: Number(event.target.value) })} />
                        </label>
                        <div className="settings-label">
                          HF avg auto
                          <div className={`${inputClass(fieldErrors.avgHr)} create-fit-static-input`}>{formatNumber(interval.avgHr, 0)}</div>
                        </div>
                      </div>
                      <HrCurveSelector
                        interval={interval}
                        onCurveChange={(mode) => updateInterval(interval.id, { hrCurve: mode })}
                        onDirectionChange={(direction) => updateInterval(interval.id, buildHrDirectionUpdate(interval, direction))}
                      />
                    </div>
                  </div>
                </article>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="create-fit-side">
          <div className="card create-fit-summary-card">
            <div className="section-title-row">
              <h2>Übersicht</h2>
            </div>
            <div className="create-fit-summary-grid">
              <div className="create-fit-summary-chip">
                <span>Dauer</span>
                <strong>{formatDuration(derived.totalDurationSeconds)}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Distanz</span>
                <strong>{formatNumber(derived.distanceM / 1000, 2, " km")}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Speed avg</span>
                <strong>{formatNumber(derived.avgSpeedKmh, 1, " km/h")}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Speed max</span>
                <strong>{formatNumber(derived.maxSpeedKmh, 1, " km/h")}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Watt avg</span>
                <strong>{formatNumber(derived.avgPower, 0, " W")}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Watt max</span>
                <strong>{formatNumber(derived.maxPower, 0, " W")}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Watt-Multiplikator</span>
                <strong>x{powerMultiplier.toFixed(3)}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Wetter-Vorschlag</span>
                <strong>x{heatCompensation.multiplier.toFixed(3)}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>HF avg/max</span>
                <strong>{formatNumber(derived.avgHr, 0)} / {formatNumber(derived.maxHr, 0)}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Cad avg/max</span>
                <strong>{formatNumber(derived.avgCadence, 0)} / {formatNumber(derived.maxCadence, 0)}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Arbeit</span>
                <strong>{formatNumber(derived.workKj, 0, " kJ")}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Kalorien</span>
                <strong>{formatNumber(derived.calories, 0, " kcal")}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Records</span>
                <strong>{derived.records}</strong>
              </div>
              <div className="create-fit-summary-chip">
                <span>Ort</span>
                <strong>{locationName.trim() || (locationPoint ? "Koordinaten" : "-")}</strong>
              </div>
            </div>

            <CreateFitOverlayPreview
              points={previewPoints}
              intervals={intervals}
              totalDurationSeconds={derived.totalDurationSeconds}
              includeFields={includeFields}
              onOpen={() => setPreviewOverlayOpen(true)}
            />

            <div className="create-fit-interval-preview">
              {derived.intervals.map((row) => (
                <div className="create-fit-preview-row" key={row.id}>
                  <strong>{row.name || "Interval"}</strong>
                  <span>{formatDuration(row.durationSeconds)}</span>
                  <span>{formatNumber(row.distanceM / 1000, 2, " km")}</span>
                  <span>{formatNumber(row.avgSpeedKmh, 1, " km/h")}</span>
                </div>
              ))}
            </div>

            {validationMessages.length > 0 ? (
              <div className="create-fit-validation">
                {validationMessages.slice(0, 4).map((entry) => (
                  <p className="error-text" key={entry}>{entry}</p>
                ))}
              </div>
            ) : null}
          </div>

          <div className="card create-fit-export-card">
            <div className="section-title-row">
              <h2>Speichern & Export</h2>
            </div>
            <p className="training-note">Der Download erzeugt nur eine Datei. Es wird keine Aktivität importiert oder angelegt.</p>
            <div className="settings-actions create-fit-export-actions">
              <button className="secondary-button" type="button" onClick={saveDraft}>
                Entwurf speichern
              </button>
              <button className="secondary-button" type="button" onClick={loadDraft} disabled={!hasDraft}>
                Entwurf laden
              </button>
              <button className="secondary-button" type="button" onClick={resetForm}>
                Zurücksetzen
              </button>
              <button className="primary-button" type="button" disabled={exporting || validationMessages.length > 0} onClick={() => void downloadFitFile()}>
                {exporting ? "Erstelle FIT..." : "FIT herunterladen"}
              </button>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
            {message ? <p className="info-text">{message}</p> : null}
          </div>
        </aside>
      </div>
      {previewOverlayOpen ? (
        <CreateFitPreviewModal
          points={previewPoints}
          intervals={intervals}
          totalDurationSeconds={derived.totalDurationSeconds}
          includeFields={includeFields}
          onClose={() => setPreviewOverlayOpen(false)}
        />
      ) : null}
      {locationPickerOpen ? (
        <CreateFitLocationPickerModal
          locations={savedLocations}
          onSelect={selectSavedLocation}
          onDelete={deleteSavedLocation}
          onClose={() => setLocationPickerOpen(false)}
        />
      ) : null}
    </section>
  );
}
