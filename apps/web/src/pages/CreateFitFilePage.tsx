import { FormEvent, useEffect, useMemo, useState } from "react";
import type { LatLngTuple } from "leaflet";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { apiFetch } from "../api";
import { API_BASE_URL, MAP_MAX_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "../config";

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
  { key: "device_info", label: "Geraeteinfo" },
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
  return {
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
    avgCadence: 88,
    minCadence: 80,
    maxCadence: 96,
    ...overrides,
  };
}

function defaultIntervals(): FitIntervalDraft[] {
  return [
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
  ];
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
    if (interval.durationMinutes <= 0) messages.push(`${label}: Dauer muss groesser 0 sein.`);
    if (interval.minPower > interval.avgPower || interval.avgPower > interval.maxPower) messages.push(`${label}: Watt muss min <= avg <= max sein.`);
    if (interval.minHr > interval.avgHr || interval.avgHr > interval.maxHr) messages.push(`${label}: HF muss min <= avg <= max sein.`);
    if (interval.startHr < interval.minHr || interval.startHr > interval.maxHr) messages.push(`${label}: Start-HF muss innerhalb min/max liegen.`);
    if (interval.endHr < interval.minHr || interval.endHr > interval.maxHr) messages.push(`${label}: End-HF muss innerhalb min/max liegen.`);
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
  const [intervals, setIntervals] = useState<FitIntervalDraft[]>(defaultIntervals);
  const [includeFields, setIncludeFields] = useState<IncludeFields>(DEFAULT_INCLUDE_FIELDS);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(() => (typeof window === "undefined" ? false : Boolean(window.localStorage.getItem(DRAFT_STORAGE_KEY))));

  const heatCompensation = useMemo(() => heatCompensationSuggestion(temperatureC, humidityPct), [humidityPct, temperatureC]);
  const derived = useMemo(
    () => deriveSummary(intervals, systemMassKg, temperatureC, humidityPct, powerMultiplier),
    [humidityPct, intervals, powerMultiplier, systemMassKg, temperatureC],
  );
  const validationMessages = useMemo(() => buildValidationMessages(intervals), [intervals]);

  function updateInterval(id: string, updates: Partial<FitIntervalDraft>) {
    setIntervals((current) => current.map((interval) => (interval.id === id ? { ...interval, ...updates } : interval)));
  }

  function addInterval() {
    setIntervals((current) => [...current, newInterval(`Interval ${current.length + 1}`)]);
  }

  function duplicateInterval(interval: FitIntervalDraft) {
    setIntervals((current) => [...current, { ...interval, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: `${interval.name || "Interval"} Copy` }]);
  }

  function removeInterval(id: string) {
    setIntervals((current) => (current.length <= 1 ? current : current.filter((interval) => interval.id !== id)));
  }

  function moveInterval(id: string, direction: -1 | 1) {
    setIntervals((current) => {
      const index = current.findIndex((interval) => interval.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = current.slice();
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
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
        throw new Error(payload?.detail || "Aktivitaet konnte nicht aus der Beschreibung erstellt werden.");
      }

      const payload = await parseJsonSafely<FitLlmDescriptionResponse>(response);
      if (!payload) throw new Error("Leere LLM-Antwort erhalten.");

      const nextIntervals = (payload.intervals ?? []).map((interval, index) => intervalFromLlm(interval, index));
      if (nextIntervals.length === 0) throw new Error("Die LLM-Antwort enthielt keine Intervalle.");

      setIntervals(nextIntervals);
      if (isDateInputValue(payload.date)) setDate(payload.date);
      if (isTimeInputValue(payload.time)) setTime(payload.time);
      if (typeof payload.temperature_c === "number") setTemperatureC(clampNumber(payload.temperature_c, -40, 60, temperatureC));
      if (typeof payload.humidity_pct === "number") setHumidityPct(clampNumber(payload.humidity_pct, 0, 100, humidityPct));
      if (typeof payload.system_mass_kg === "number") setSystemMassKg(clampNumber(payload.system_mass_kg, 40, 180, systemMassKg));
      if (typeof payload.power_multiplier === "number") setPowerMultiplier(clampNumber(payload.power_multiplier, 1, 1.3, powerMultiplier));
      setLlmAssumptions((payload.assumptions ?? []).filter(Boolean).slice(0, 6));
      const modelText = payload.model ? ` (${payload.model})` : "";
      setMessage(`${payload.summary || "Beschreibung uebernommen."}${modelText}`);
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
      if (Array.isArray(draft.intervals) && draft.intervals.length > 0) setIntervals(draft.intervals);
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
    setMessage("Formular zurueckgesetzt.");
    setError(null);
  }

  async function downloadFitFile() {
    if (validationMessages.length > 0) {
      setError(validationMessages[0]);
      return;
    }
    const startTime = new Date(`${date}T${time || "00:00"}:00`);
    if (Number.isNaN(startTime.getTime())) {
      setError("Bitte Datum und Zeit pruefen.");
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
          Der Export wird nicht als Aktivitaet in TrainMind gespeichert.
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
                Temperatur (C)
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
                Geraet
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
                  Gefuehlt {formatNumber(heatCompensation.heatIndexC, 1, " C")} bei {formatNumber(temperatureC, 1, " C")} und {formatNumber(humidityPct, 0, " %")} RH.
                  Der Multiplikator erhoeht nur min/avg/max Watt im Export.
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={heatCompensation.multiplier <= 1.001}
                onClick={() => {
                  setPowerMultiplier(Number(heatCompensation.multiplier.toFixed(3)));
                  setMessage("Wetter-Multiplikator uebernommen.");
                  setError(null);
                }}
              >
                Vorschlag uebernehmen
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
              <span className="fit-repair-pill">{locationPoint ? `${locationPoint[0].toFixed(4)}, ${locationPoint[1].toFixed(4)}` : "Kein Ort gesetzt"}</span>
            </div>
            <form className="create-fit-location-search" onSubmit={(event: FormEvent) => { event.preventDefault(); void searchLocation(); }}>
              <label className="settings-label">
                Ort suchen
                <input className="settings-input" value={locationSearch} onChange={(event) => setLocationSearch(event.target.value)} placeholder="z. B. Zuerich" />
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
                Intervall hinzufuegen
              </button>
            </div>
            <div className="create-fit-interval-list">
              {intervals.map((interval, index) => (
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
                  <div className="create-fit-interval-grid">
                    <label className="settings-label create-fit-span-2">
                      Name
                      <input className="settings-input" value={interval.name} onChange={(event) => updateInterval(interval.id, { name: event.target.value })} />
                    </label>
                    <label className="settings-label">
                      Dauer (min)
                      <input className="settings-input" type="number" min="0.5" step="0.5" value={interval.durationMinutes} onChange={(event) => updateInterval(interval.id, { durationMinutes: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      Watt avg
                      <input className="settings-input" type="number" value={interval.avgPower} onChange={(event) => updateInterval(interval.id, { avgPower: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      Watt max
                      <input className="settings-input" type="number" value={interval.maxPower} onChange={(event) => updateInterval(interval.id, { maxPower: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      Watt min
                      <input className="settings-input" type="number" value={interval.minPower} onChange={(event) => updateInterval(interval.id, { minPower: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      HF avg
                      <input className="settings-input" type="number" value={interval.avgHr} onChange={(event) => updateInterval(interval.id, { avgHr: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      HF max
                      <input className="settings-input" type="number" value={interval.maxHr} onChange={(event) => updateInterval(interval.id, { maxHr: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      HF min
                      <input className="settings-input" type="number" value={interval.minHr} onChange={(event) => updateInterval(interval.id, { minHr: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      Start HF
                      <input className="settings-input" type="number" value={interval.startHr} onChange={(event) => updateInterval(interval.id, { startHr: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      End HF
                      <input className="settings-input" type="number" value={interval.endHr} onChange={(event) => updateInterval(interval.id, { endHr: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      Cadence avg
                      <input className="settings-input" type="number" value={interval.avgCadence} onChange={(event) => updateInterval(interval.id, { avgCadence: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      Cadence min
                      <input className="settings-input" type="number" value={interval.minCadence} onChange={(event) => updateInterval(interval.id, { minCadence: Number(event.target.value) })} />
                    </label>
                    <label className="settings-label">
                      Cadence max
                      <input className="settings-input" type="number" value={interval.maxCadence} onChange={(event) => updateInterval(interval.id, { maxCadence: Number(event.target.value) })} />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        <aside className="create-fit-side">
          <div className="card create-fit-summary-card">
            <div className="section-title-row">
              <h2>Uebersicht</h2>
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
            <p className="training-note">Der Download erzeugt nur eine Datei. Es wird keine Aktivitaet importiert oder angelegt.</p>
            <div className="settings-actions create-fit-export-actions">
              <button className="secondary-button" type="button" onClick={saveDraft}>
                Entwurf speichern
              </button>
              <button className="secondary-button" type="button" onClick={loadDraft} disabled={!hasDraft}>
                Entwurf laden
              </button>
              <button className="secondary-button" type="button" onClick={resetForm}>
                Zuruecksetzen
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
    </section>
  );
}
