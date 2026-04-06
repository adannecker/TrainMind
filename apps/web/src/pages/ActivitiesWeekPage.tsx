import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type WeekActivity = {
  id: number;
  name: string;
  provider: string;
  start_time: string | null;
  end_time: string | null;
  duration_s: number | null;
  duration_label: string | null;
  distance_m: number | null;
  avg_power_w: number | null;
  avg_speed_kmh: number | null;
  stress_score: number | null;
};

type DayBundle = {
  date: string;
  weekday_short: string;
  activities: WeekActivity[];
  summary: {
    activities_count: number;
    moving_time_s: number;
    moving_time_label: string | null;
    distance_m: number;
    stress_total: number | null;
    stress_avg: number | null;
  };
};

type WeekGoal = {
  target_hours: number;
  target_stress: number;
  is_custom: boolean;
};

type WeekResponse = {
  week_start: string;
  week_end: string;
  days: DayBundle[];
  summary: {
    activities_count: number;
    moving_time_s: number;
    moving_time_label: string | null;
    distance_m: number;
    stress_total: number | null;
    stress_avg: number | null;
    goal: WeekGoal;
  };
};

type AvailableWeek = {
  week_start: string;
  week_end: string;
  activities_count: number;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text) as T;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDateParts(isoDate: string): { y: number; m: number; d: number } | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function addDays(isoDate: string, days: number): string {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) {
    return isoDate;
  }
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addMonths(isoDate: string, months: number): string {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) {
    return isoDate;
  }
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDate(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return value;
  }
  return dt.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return "-";
  }
  return dt.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

function formatDistanceMeters(value: number | null): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${(value / 1000).toFixed(1)} km`;
}

function formatNumber(value: number | null, digits = 0): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return value.toFixed(digits);
}

export function ActivitiesWeekPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<WeekResponse | null>(null);
  const [availableWeeks, setAvailableWeeks] = useState<AvailableWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayIsoDate());

  async function loadWeeksAvailable() {
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/weeks-available`);
      const payload = await parseJsonSafely<{ weeks?: AvailableWeek[] }>(response);
      if (response.ok && payload) {
        setAvailableWeeks(payload.weeks ?? []);
      }
    } catch {
      // Keep view usable when auxiliary endpoint fails.
    }
  }

  async function loadWeek(referenceDate: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/week?reference_date=${referenceDate}`);
      const payload = await parseJsonSafely<WeekResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Wochenansicht konnte nicht geladen werden.",
        );
      }
      if (!payload) {
        throw new Error("Wochenansicht konnte nicht geladen werden: leere Antwort von der API.");
      }
      setData(payload as WeekResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWeeksAvailable();
  }, []);

  useEffect(() => {
    void loadWeek(selectedDate);
  }, [selectedDate]);

  const weekTitle = useMemo(() => {
    if (!data) {
      return "Woche -";
    }
    return `Woche ${formatDate(data.week_start)} - ${formatDate(data.week_end)}`;
  }, [data]);

  const weekDistanceKm = useMemo(() => ((data?.summary.distance_m ?? 0) / 1000), [data]);
  const weekHours = useMemo(() => ((data?.summary.moving_time_s ?? 0) / 3600), [data]);
  const weekStress = useMemo(() => (data?.summary.stress_total ?? 0), [data]);
  const targetHours = data?.summary.goal?.target_hours ?? 10;
  const targetStress = data?.summary.goal?.target_stress ?? 300;
  const timeProgress = Math.max(0, Math.min(100, (weekHours / Math.max(0.1, targetHours)) * 100));
  const stressProgress = Math.max(0, Math.min(100, (weekStress / Math.max(1, targetStress)) * 100));
  const loadScore = Math.round((timeProgress + stressProgress) / 2);

  function goToPreviousWeek() {
    const base = data?.week_start ?? selectedDate;
    setSelectedDate(addDays(base, -7));
  }

  function goToNextWeek() {
    const base = data?.week_start ?? selectedDate;
    setSelectedDate(addDays(base, 7));
  }

  function goToPreviousMonth() {
    const base = data?.week_start ?? selectedDate;
    setSelectedDate(addMonths(base, -1));
  }

  function goToNextMonth() {
    const base = data?.week_start ?? selectedDate;
    setSelectedDate(addMonths(base, 1));
  }

  return (
    <section className="page">
      <div className="hero week-hero-layout">
        <div className="week-hero-main">
          <p className="eyebrow">Aktivitäten</p>
          <h1>Wochenansicht</h1>
          <p className="week-title-line">
            <span className="week-data-indicator has-data" />
            <span>{weekTitle}</span>
          </p>

          <div className="week-controls">
            <button
              className="secondary-button week-nav-btn"
              type="button"
              onClick={goToPreviousMonth}
              title="Einen Monat zurück"
            >
              {"<<"}
            </button>
            <button className="secondary-button week-nav-btn" type="button" onClick={goToPreviousWeek} title="Eine Woche zurück">
              {"<"}
            </button>
            <select
              className="week-data-select"
              value={data?.week_start ?? ""}
              onChange={(event) => setSelectedDate(event.target.value)}
              aria-label="Woche auswählen"
            >
              <option value="" disabled>
                Woche auswählen...
              </option>
              {availableWeeks.map((week) => (
                <option key={week.week_start} value={week.week_start}>
                  {week.week_start} - {week.week_end} ({week.activities_count})
                </option>
              ))}
            </select>
            <button className="secondary-button week-nav-btn" type="button" onClick={goToNextWeek} title="Eine Woche vor">
              {">"}
            </button>
            <button
              className="secondary-button week-nav-btn"
              type="button"
              onClick={goToNextMonth}
              title="Einen Monat vor"
            >
              {">>"}
            </button>
          </div>
        </div>

        <div className="week-hero-right">
          <div className="week-hero-summary card">
            <h2>Wochenüberblick</h2>
            {loading ? <p>Lade Wochenansicht...</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
            {!loading && !error && data ? (
              <div className="stats-line">
                <span>Aktivitäten: {data.summary.activities_count}</span>
                <span>Zeit in Bewegung: {data.summary.moving_time_label ?? "-"}</span>
                <span>Distanz: {formatDistanceMeters(data.summary.distance_m)}</span>
                <span>TSS gesamt: {formatNumber(data.summary.stress_total, 1)}</span>
              </div>
            ) : null}
          </div>

          <div className="week-visualizer card">
            <h2>Wochenziel</h2>
            <p className="week-visualizer-target">
              Ziel: {formatNumber(targetHours, 1)} h auf dem Rad / {formatNumber(targetStress, 0)} Trainingsreiz pro Woche
              {data?.summary.goal?.is_custom ? "" : " (Standardziel)"}
            </p>
            <p className="week-visualizer-note">Der Trainingsreiz orientiert sich an TSS und ergänzt die reine Radzeit.</p>
            <div
              className="week-load-gauge"
              style={{ ["--progress" as any]: `${loadScore}%` }}
              aria-label={`Weekly load score ${loadScore}%`}
            >
              <div className="week-load-gauge-inner">{loadScore}%</div>
            </div>
            <div className="week-progress-bars">
              <div className="week-progress-row">
                <span>Zeit auf dem Rad</span>
                <span>{formatNumber(weekHours, 1)} / {formatNumber(targetHours, 1)} h</span>
                <div className="week-progress-track">
                  <div className="week-progress-fill time" style={{ width: `${timeProgress}%` }} />
                </div>
              </div>
              <div className="week-progress-row">
                <span>Trainingsreiz (TSS)</span>
                <span>{formatNumber(weekStress, 1)} / {formatNumber(targetStress, 0)}</span>
                <div className="week-progress-track">
                  <div className="week-progress-fill stress" style={{ width: `${stressProgress}%` }} />
                </div>
              </div>
            </div>
            <div className="stats-line">
              <span>Kilometer: {formatNumber(weekDistanceKm, 1)} km</span>
              <span>Ø TSS pro Einheit: {formatNumber(data?.summary.stress_avg ?? null, 1)}</span>
            </div>
          </div>
        </div>
      </div>

      {!loading && !error && data ? (
        <div className="week-grid">
          {data.days.map((day) => (
            <article className="week-day-card" key={day.date}>
              <header className="week-day-header">
                <h3>
                  {day.weekday_short} <span>{formatDate(day.date)}</span>
                </h3>
              </header>

              {day.activities.length === 0 ? (
                <p className="week-day-empty">Keine Aktivitäten.</p>
              ) : (
                <div className="week-activities-list">
                  {day.activities.map((activity) => (
                    <div className="week-activity-item" key={activity.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/activities/${activity.id}`)}>
                      <p className="week-activity-name">{activity.name}</p>
                      <p className="week-activity-meta">
                        {formatTime(activity.start_time)} - {formatTime(activity.end_time)} | {activity.duration_label ?? "-"}
                      </p>
                      <p className="week-activity-metrics">
                        Ø Watt: {formatNumber(activity.avg_power_w)} W | Ø Speed: {formatNumber(activity.avg_speed_kmh, 1)} km/h | TSS: {formatNumber(activity.stress_score, 1)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <footer className="week-day-summary">
                <span>Zeit: {day.summary.moving_time_label ?? "-"}</span>
                <span>Distanz: {formatDistanceMeters(day.summary.distance_m)}</span>
                <span>TSS: {formatNumber(day.summary.stress_total, 1)}</span>
              </footer>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
