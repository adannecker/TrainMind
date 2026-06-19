export type ActivityLike = {
  id?: number;
  name?: string;
  start_time?: string | null;
  started_at?: string | null;
  duration_s: number | null;
  distance_m: number | null;
  total_ascent_m?: number | null;
  avg_power_w?: number | null;
  avg_speed_kmh?: number | null;
  stress_score?: number | null;
  sport?: string | null;
  provider?: string | null;
};

export type ZoneBucket = {
  label: string;
  value: number;
  color: string;
};

export const WEEKLY_DISTANCE_TARGET_KM = 200;
export const WEEKLY_ASCENT_TARGET_M = 2500;
export const MONTHLY_HOURS_TARGET = 40;
export const MONTHLY_DISTANCE_TARGET_KM = 800;
export const MONTHLY_ASCENT_TARGET_M = 8000;
export const MONTHLY_STRESS_TARGET = 1200;
export const YEARLY_DISTANCE_TARGET_KM = 5000;
export const YEARLY_ASCENT_TARGET_M = 100000;
export const YEARLY_HOURS_TARGET = 300;
export const YEARLY_STRESS_TARGET = 15000;

export const ZONE_COLORS = ["#6f7b8b", "#3f8ac7", "#39a875", "#e3b341", "#d86a3f"];

export function numeric(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function percentOf(value: number, target: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(999, (value / target) * 100));
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Number(value).toLocaleString("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatHoursFromSeconds(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "-";
  return `${formatNumber(value / 3600, digits)} h`;
}

export function formatKilometersFromMeters(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "-";
  return `${formatNumber(value / 1000, digits)} km`;
}

export function formatMeters(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${formatNumber(value, 0)} m`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

export function formatDeltaPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 0)}%`;
}

export function formatApiErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          const location = "loc" in item && Array.isArray(item.loc) ? item.loc.join(".") : "";
          const message = String(item.msg ?? "").trim();
          return location ? `${location}: ${message}` : message;
        }
        return "";
      })
      .filter(Boolean);
    if (messages.length) {
      return messages.join(" | ");
    }
  }
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function addDays(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function addMonths(isoDate: string, months: number): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function flattenActivities<T extends { activities: ActivityLike[] }>(days: T[]): ActivityLike[] {
  return days.flatMap((day) => day.activities);
}

export function tssPerHour(activity: ActivityLike): number | null {
  const hours = numeric(activity.duration_s) / 3600;
  const stress = activity.stress_score;
  if (!hours || stress === null || stress === undefined) return null;
  return Number(stress) / hours;
}

export function buildIntensityBuckets(activities: ActivityLike[], ftp?: number | null): ZoneBucket[] {
  const buckets = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"].map((label, index) => ({
    label,
    value: 0,
    color: ZONE_COLORS[index],
  }));

  for (const activity of activities) {
    const duration = numeric(activity.duration_s);
    if (duration <= 0) continue;

    if (ftp && ftp > 0 && activity.avg_power_w) {
      const ratio = Number(activity.avg_power_w) / ftp;
      const index = ratio <= 0.55 ? 0 : ratio <= 0.75 ? 1 : ratio <= 0.9 ? 2 : ratio <= 1.05 ? 3 : 4;
      buckets[index].value += duration / 3600;
      continue;
    }

    const load = tssPerHour(activity);
    if (load === null) continue;
    const index = load < 35 ? 0 : load < 55 ? 1 : load < 75 ? 2 : load < 95 ? 3 : 4;
    buckets[index].value += duration / 3600;
  }

  return buckets;
}

export function inferActivityType(activity: ActivityLike): string {
  const source = `${activity.sport ?? ""} ${activity.provider ?? ""} ${activity.name ?? ""}`.toLowerCase();
  if (source.includes("mtb") || source.includes("mountain")) return "MTB";
  if (source.includes("gravel")) return "Gravel";
  if (source.includes("indoor") || source.includes("virtual") || source.includes("trainer") || source.includes("zwift")) return "Indoor";
  return "Rennrad";
}

export function groupActivityTypes(activities: ActivityLike[]): ZoneBucket[] {
  const colors: Record<string, string> = {
    Rennrad: "#2d8f78",
    Gravel: "#b9853a",
    MTB: "#5f7fbf",
    Indoor: "#b15c8f",
  };
  const counts = new Map<string, number>();
  for (const activity of activities) {
    const type = inferActivityType(activity);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return ["Rennrad", "Gravel", "MTB", "Indoor"].map((label) => ({
    label,
    value: counts.get(label) ?? 0,
    color: colors[label],
  }));
}

export function movingAverage(values: number[], windowSize: number): number[] {
  return values.map((_value, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, entry) => sum + entry, 0) / Math.max(1, slice.length);
  });
}

export function getComparison(current: number, previous: number): { absolute: number; percent: number | null } {
  const absolute = current - previous;
  return {
    absolute,
    percent: previous > 0 ? (absolute / previous) * 100 : current > 0 ? 100 : 0,
  };
}
