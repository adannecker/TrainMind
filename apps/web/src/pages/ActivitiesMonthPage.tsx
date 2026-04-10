import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type MonthActivity = {
  id: number;
  name: string;
  provider: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_s: number | null;
  duration_label: string | null;
  distance_m: number | null;
  avg_power_w: number | null;
  avg_speed_kmh: number | null;
  stress_score: number | null;
};

type MonthDayBundle = {
  date: string;
  day: number;
  weekday_short: string;
  activities: MonthActivity[];
  summary: {
    activities_count: number;
    moving_time_s: number;
    moving_time_label: string | null;
    distance_m: number;
    stress_total: number | null;
    stress_avg: number | null;
  };
};

type MonthResponse = {
  month_start: string;
  month_end: string;
  month_label: string;
  days: MonthDayBundle[];
  summary: {
    activities_count: number;
    moving_time_s: number;
    moving_time_label: string | null;
    distance_m: number;
    stress_total: number | null;
    stress_avg: number | null;
    active_days: number;
  };
};

type AvailableMonth = {
  month_start: string;
  month_end: string;
  month_label: string;
  activities_count: number;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDateParts(isoDate: string): { y: number; m: number; d: number } | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function addMonths(isoDate: string, months: number): string {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return isoDate;
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(value: string | null): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

function formatDistanceMeters(value: number | null): string {
  if (value == null) return "-";
  return `${(value / 1000).toFixed(1)} km`;
}

function formatNumber(value: number | null, digits = 0): string {
  if (value == null) return "-";
  return value.toFixed(digits);
}

export function ActivitiesMonthPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<MonthResponse | null>(null);
  const [availableMonths, setAvailableMonths] = useState<AvailableMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayIsoDate());

  async function loadAvailableMonths() {
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/months-available`);
      const payload = await parseJsonSafely<{ months?: AvailableMonth[] }>(response);
      if (response.ok && payload) {
        setAvailableMonths(payload.months ?? []);
      }
    } catch {
      // Keep usable without the auxiliary list.
    }
  }

  async function loadMonth(referenceDate: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/month?reference_date=${referenceDate}`);
      const payload = await parseJsonSafely<MonthResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Monatsansicht konnte nicht geladen werden.");
      }
      if (!payload) {
        throw new Error("Monatsansicht konnte nicht geladen werden: leere Antwort von der API.");
      }
      setData(payload as MonthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAvailableMonths();
  }, []);

  useEffect(() => {
    void loadMonth(selectedDate);
  }, [selectedDate]);

  const monthDistanceKm = useMemo(() => ((data?.summary.distance_m ?? 0) / 1000), [data]);
  const monthHours = useMemo(() => ((data?.summary.moving_time_s ?? 0) / 3600), [data]);

  function goToPreviousMonth() {
    const base = data?.month_start ?? selectedDate;
    setSelectedDate(addMonths(base, -1));
  }

  function goToNextMonth() {
    const base = data?.month_start ?? selectedDate;
    setSelectedDate(addMonths(base, 1));
  }

  return (
    <section className="page">
      <div className="hero week-hero-layout">
        <div className="week-hero-main">
          <p className="eyebrow">Aktivitäten</p>
          <h1>Monatsansicht</h1>
          <p className="week-title-line">
            <span className={`week-data-indicator ${data ? "has-data" : "no-data"}`} />
            <span>{data?.month_label ?? "Monat -"}</span>
          </p>

          <div className="week-controls">
            <button className="secondary-button week-nav-btn" type="button" onClick={goToPreviousMonth} title="Einen Monat zurück">
              {"<"}
            </button>
            <select className="week-data-select" value={data?.month_start ?? ""} onChange={(event) => setSelectedDate(event.target.value)} aria-label="Monat auswählen">
              <option value="" disabled>
                Monat auswählen...
              </option>
              {availableMonths.map((month) => (
                <option key={month.month_start} value={month.month_start}>
                  {month.month_label} ({month.activities_count})
                </option>
              ))}
            </select>
            <button className="secondary-button week-nav-btn" type="button" onClick={goToNextMonth} title="Einen Monat vor">
              {">"}
            </button>
          </div>
        </div>

        <div className="week-hero-right">
          <div className="week-hero-summary card">
            <h2>Monatsüberblick</h2>
            {loading ? <p>Lade Monatsansicht...</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
            {!loading && !error && data ? (
              <div className="stats-line">
                <span>Aktivitäten: {data.summary.activities_count}</span>
                <span>Aktive Tage: {data.summary.active_days}</span>
                <span>Zeit in Bewegung: {data.summary.moving_time_label ?? "-"}</span>
                <span>Distanz: {formatDistanceMeters(data.summary.distance_m)}</span>
                <span>TSS gesamt: {formatNumber(data.summary.stress_total, 1)}</span>
              </div>
            ) : null}
          </div>

          <div className="week-visualizer card">
            <h2>Monatsblock</h2>
            <p className="week-visualizer-target">Überblick über Umfang, Reiz und wie sich die Fahrten über den Monat verteilen.</p>
            <div className="stats-line">
              <span>Stunden: {formatNumber(monthHours, 1)} h</span>
              <span>Kilometer: {formatNumber(monthDistanceKm, 1)} km</span>
              <span>Ø TSS pro Einheit: {formatNumber(data?.summary.stress_avg ?? null, 1)}</span>
            </div>
          </div>
        </div>
      </div>

      {!loading && !error && data ? (
        <div className="month-grid">
          {data.days.map((day) => (
            <article className={`month-day-card ${day.activities.length ? "has-activities" : ""}`} key={day.date}>
              <header className="month-day-header">
                <h3>{day.day}</h3>
                <span>{day.weekday_short}</span>
              </header>

              {day.activities.length === 0 ? (
                <p className="month-day-empty">Keine Fahrt</p>
              ) : (
                <>
                  <div className="month-day-summary">
                    <strong>{day.summary.activities_count} Ride{day.summary.activities_count === 1 ? "" : "s"}</strong>
                    <span>{day.summary.moving_time_label ?? "-"}</span>
                    <span>{formatDistanceMeters(day.summary.distance_m)}</span>
                    <span>TSS {formatNumber(day.summary.stress_total, 1)}</span>
                  </div>
                  <div className="month-activities-list">
                    {day.activities.map((activity) => (
                      <button key={activity.id} className="month-activity-item" type="button" onClick={() => navigate(`/activities/${activity.id}`)}>
                        <strong>{activity.name}</strong>
                        <span>{formatTime(activity.start_time)} | {activity.duration_label ?? "-"}</span>
                        <span>{formatDistanceMeters(activity.distance_m)} | Ø {formatNumber(activity.avg_power_w)} W | TSS {formatNumber(activity.stress_score, 1)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
