import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import {
  AnalyticsScopeNav,
  DashboardCard,
  DashboardHeader,
  DonutChart,
  KpiCard,
  KpiGrid,
  LineChart,
  MetricList,
  ProgressCard,
  StackedBarChart,
} from "../components/DashboardComponents";
import {
  MONTHLY_ASCENT_TARGET_M,
  MONTHLY_DISTANCE_TARGET_KM,
  MONTHLY_HOURS_TARGET,
  MONTHLY_STRESS_TARGET,
  addMonths,
  buildIntensityBuckets,
  flattenActivities,
  formatApiErrorDetail,
  formatDate,
  formatHoursFromSeconds,
  formatKilometersFromMeters,
  formatMeters,
  formatNumber,
  formatShortDate,
  formatTime,
  groupActivityTypes,
  movingAverage,
  numeric,
  percentOf,
  todayIsoDate,
} from "../components/dashboardUtils";
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
  total_ascent_m: number;
  avg_power_w: number | null;
  avg_speed_kmh: number | null;
  stress_score: number | null;
  stress_source_label?: string | null;
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
    total_ascent_m: number;
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
    total_ascent_m: number;
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

type TrainingMetricsResponse = {
  ftp?: { value: number }[];
};

type YearMonthlyBreakdown = {
  month: number;
  total_ascent_m: number;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function stressClass(stress: number | null): string {
  const value = numeric(stress);
  if (value <= 0) return "load-none";
  if (value < 35) return "load-low";
  if (value < 75) return "load-medium";
  if (value < 120) return "load-high";
  return "load-very-high";
}

function bestBy(
  activities: MonthActivity[],
  selector: (activity: MonthActivity) => number,
): { activity: MonthActivity; value: number } | null {
  let best: { activity: MonthActivity; value: number } | null = null;
  for (const activity of activities) {
    const value = selector(activity);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!best || value > best.value) {
      best = { activity, value };
    }
  }
  return best;
}

function monthNumberFromIso(isoDate: string): number {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? 1 : dt.getUTCMonth() + 1;
}

function buildWeekBreakdown(days: MonthDayBundle[]) {
  const weeks = new Map<number, { distanceKm: number; ascentM: number; stress: number }>();
  for (const day of days) {
    const index = Math.floor((day.day - 1) / 7) + 1;
    const current = weeks.get(index) ?? { distanceKm: 0, ascentM: 0, stress: 0 };
    current.distanceKm += numeric(day.summary.distance_m) / 1000;
    current.ascentM += numeric(day.summary.total_ascent_m);
    current.stress += numeric(day.summary.stress_total);
    weeks.set(index, current);
  }
  return Array.from({ length: Math.max(5, weeks.size) }, (_entry, index) => {
    const week = weeks.get(index + 1) ?? { distanceKm: 0, ascentM: 0, stress: 0 };
    return {
      label: `W${index + 1}`,
      segments: [
        { key: "distance", label: `Distanz ${formatNumber(week.distanceKm, 0)} km`, value: week.distanceKm, color: "#2d8f78" },
        { key: "ascent", label: `HM ${formatNumber(week.ascentM, 0)} m`, value: week.ascentM / 10, color: "#d89b35" },
        { key: "stress", label: `TSS ${formatNumber(week.stress, 0)}`, value: week.stress, color: "#c9574f" },
      ],
    };
  });
}

function projectionForMonth(monthStart: string, currentValue: number): number {
  const start = new Date(`${monthStart}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return currentValue;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = new Date();
  const isCurrentMonth = today.getUTCFullYear() === year && today.getUTCMonth() === month;
  const elapsedDays = isCurrentMonth ? Math.max(1, Math.min(daysInMonth, today.getUTCDate())) : daysInMonth;
  return (currentValue / elapsedDays) * daysInMonth;
}

export function ActivitiesMonthPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<MonthResponse | null>(null);
  const [availableMonths, setAvailableMonths] = useState<AvailableMonth[]>([]);
  const [ftp, setFtp] = useState<number | null>(null);
  const [yearBreakdown, setYearBreakdown] = useState<YearMonthlyBreakdown[]>([]);
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
      setAvailableMonths([]);
    }
  }

  async function loadTrainingMetrics() {
    try {
      const response = await apiFetch(`${API_BASE_URL}/training/metrics`);
      const payload = await parseJsonSafely<TrainingMetricsResponse>(response);
      if (response.ok && payload?.ftp?.length) {
        setFtp(Number(payload.ftp[0].value));
      }
    } catch {
      setFtp(null);
    }
  }

  async function loadYearBreakdown(referenceDate: string) {
    const year = new Date(`${referenceDate}T00:00:00Z`).getUTCFullYear();
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/year-dashboard?year=${year}`);
      const payload = await parseJsonSafely<{ monthly?: YearMonthlyBreakdown[] }>(response);
      if (response.ok && payload?.monthly) {
        setYearBreakdown(payload.monthly);
      }
    } catch {
      setYearBreakdown([]);
    }
  }

  async function loadMonth(referenceDate: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/month?reference_date=${referenceDate}`);
      const payload = await parseJsonSafely<MonthResponse | { detail?: unknown }>(response);
      if (!response.ok || !payload || !("month_start" in payload)) {
        throw new Error(formatApiErrorDetail(payload && "detail" in payload ? payload.detail : null, "Monatsüberblick konnte nicht geladen werden."));
      }
      setData(payload);
      void loadYearBreakdown(referenceDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAvailableMonths();
    void loadTrainingMetrics();
  }, []);

  useEffect(() => {
    void loadMonth(selectedDate);
  }, [selectedDate]);

  const activities = useMemo(() => flattenActivities(data?.days ?? []) as MonthActivity[], [data]);
  const monthHours = numeric(data?.summary.moving_time_s) / 3600;
  const monthDistanceKm = numeric(data?.summary.distance_m) / 1000;
  const monthAscentM = numeric(data?.summary.total_ascent_m);
  const monthStress = numeric(data?.summary.stress_total);
  const freeDays = data ? data.days.length - data.summary.active_days : 0;
  const ridesPerWeek = data ? data.summary.activities_count / Math.max(1, data.days.length / 7) : 0;
  const zoneBuckets = useMemo(() => buildIntensityBuckets(activities, ftp), [activities, ftp]);
  const typeBuckets = useMemo(() => groupActivityTypes(activities), [activities]);
  const weekBreakdown = useMemo(() => buildWeekBreakdown(data?.days ?? []), [data]);
  const dailyStress = useMemo(() => (data?.days ?? []).map((day) => numeric(day.summary.stress_total)), [data]);
  const stressAverage = useMemo(() => movingAverage(dailyStress, 7), [dailyStress]);
  const selectedMonthNumber = data ? monthNumberFromIso(data.month_start) : 1;
  const ascentRanking = yearBreakdown
    .filter((month) => numeric(month.total_ascent_m) > 0)
    .sort((left, right) => numeric(right.total_ascent_m) - numeric(left.total_ascent_m));
  const ascentRank = ascentRanking.findIndex((month) => month.month === selectedMonthNumber) + 1;
  const projectedAscentM = data ? projectionForMonth(data.month_start, monthAscentM) : 0;
  const bestDuration = bestBy(activities, (activity) => numeric(activity.duration_s));
  const bestPower = bestBy(activities, (activity) => numeric(activity.avg_power_w));
  const bestSpeed = bestBy(activities, (activity) => numeric(activity.avg_speed_kmh));
  const bestAscent = bestBy(activities, (activity) => numeric(activity.total_ascent_m));
  const bestStress = bestBy(activities, (activity) => numeric(activity.stress_score));

  function goToPreviousMonth() {
    setSelectedDate(addMonths(data?.month_start ?? selectedDate, -1));
  }

  function goToNextMonth() {
    setSelectedDate(addMonths(data?.month_start ?? selectedDate, 1));
  }

  return (
    <section className="page analytics-page">
      <AnalyticsScopeNav />
      <DashboardHeader eyebrow="Aktivitäten" title="Monatsansicht" subtitle={data?.month_label ?? "Trainingsblock"}>
        <div className="analytics-controls">
          <button className="secondary-button week-nav-btn" type="button" onClick={goToPreviousMonth} title="Einen Monat zurück">
            {"<"}
          </button>
          <select
            className="week-data-select"
            value={data?.month_start ?? ""}
            onChange={(event) => setSelectedDate(event.target.value)}
            aria-label="Monat auswählen"
          >
            <option value="" disabled>
              Monat auswählen
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
      </DashboardHeader>

      {loading ? <div className="card">Lade Monatsansicht...</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!loading && !error && data ? (
        <>
          <KpiGrid>
            <KpiCard label="Aktivitäten" value={formatNumber(data.summary.activities_count)} subValue={`${formatNumber(ridesPerWeek, 1)} pro Woche`} tone="green" />
            <KpiCard label="Aktive Tage" value={formatNumber(data.summary.active_days)} subValue={`${freeDays} trainingsfrei`} tone="slate" />
            <KpiCard label="Zeit" value={formatHoursFromSeconds(data.summary.moving_time_s)} subValue={`${formatNumber(monthHours / Math.max(1, data.summary.active_days), 1)} h je aktivem Tag`} tone="blue" />
            <KpiCard label="Distanz" value={formatKilometersFromMeters(data.summary.distance_m)} subValue={`${formatNumber(monthDistanceKm / Math.max(1, data.summary.activities_count), 1)} km pro Fahrt`} tone="green" />
            <KpiCard label="Höhenmeter" value={formatMeters(data.summary.total_ascent_m)} subValue={`${formatNumber(monthAscentM / Math.max(1, data.summary.activities_count), 0)} m pro Fahrt`} tone="amber" />
            <KpiCard label="TSS" value={formatNumber(data.summary.stress_total, 0)} subValue={`${formatNumber(data.summary.stress_avg, 1)} pro Fahrt`} tone="red" />
          </KpiGrid>

          <div className="analytics-grid two">
            <DashboardCard title="Monatsziele" subtitle="Zielerreichung für den aktuellen Trainingsblock">
              <div className="analytics-progress-grid">
                <ProgressCard label="Zeit" value={`${formatNumber(monthHours, 1)} h`} target={`${MONTHLY_HOURS_TARGET} h`} percent={percentOf(monthHours, MONTHLY_HOURS_TARGET)} tone="blue" />
                <ProgressCard label="Distanz" value={`${formatNumber(monthDistanceKm, 1)} km`} target={`${MONTHLY_DISTANCE_TARGET_KM} km`} percent={percentOf(monthDistanceKm, MONTHLY_DISTANCE_TARGET_KM)} tone="green" />
                <ProgressCard label="HM" value={formatMeters(monthAscentM)} target={formatMeters(MONTHLY_ASCENT_TARGET_M)} percent={percentOf(monthAscentM, MONTHLY_ASCENT_TARGET_M)} tone="amber" />
                <ProgressCard label="TSS" value={formatNumber(monthStress, 0)} target={formatNumber(MONTHLY_STRESS_TARGET, 0)} percent={percentOf(monthStress, MONTHLY_STRESS_TARGET)} tone="red" />
              </div>
            </DashboardCard>

            <DashboardCard title="Wochenvergleich im Monat" subtitle="Distanz, Höhenmeter und TSS pro Monatswoche">
              <StackedBarChart data={weekBreakdown} />
              <div className="analytics-chart-legend">
                <span><i style={{ background: "#2d8f78" }} />Distanz</span>
                <span><i style={{ background: "#d89b35" }} />HM</span>
                <span><i style={{ background: "#c9574f" }} />TSS</span>
              </div>
            </DashboardCard>
          </div>

          <div className="analytics-grid two">
            <DashboardCard title="Belastungsentwicklung" subtitle="Täglicher TSS mit 7-Tage-Durchschnitt">
              <LineChart
                primary={dailyStress}
                secondary={stressAverage}
                labels={data.days.map((day) => formatShortDate(day.date))}
              />
            </DashboardCard>

            <DashboardCard title="Climb Quest Monat" subtitle="Monatsziel, Ranking und Prognose">
              <div className="analytics-progress-grid single">
                <ProgressCard label="Zielerreichung" value={formatMeters(monthAscentM)} target={formatMeters(MONTHLY_ASCENT_TARGET_M)} percent={percentOf(monthAscentM, MONTHLY_ASCENT_TARGET_M)} tone="amber" />
              </div>
              <MetricList
                items={[
                  { label: "Monats-HM-Ranking", value: ascentRank > 0 ? `#${ascentRank}` : "-" },
                  { label: "Prognose Monatsende", value: formatMeters(projectedAscentM) },
                  { label: "Restwert", value: formatMeters(Math.max(0, MONTHLY_ASCENT_TARGET_M - monthAscentM)) },
                ]}
              />
            </DashboardCard>
          </div>

          <div className="analytics-grid three">
            <DashboardCard title="Trainingstage Analyse">
              <MetricList
                items={[
                  { label: "Aktive Tage", value: formatNumber(data.summary.active_days) },
                  { label: "Trainingsfreie Tage", value: formatNumber(freeDays) },
                  { label: "Fahrten pro Woche", value: formatNumber(ridesPerWeek, 1) },
                ]}
              />
            </DashboardCard>

            <DashboardCard title="Durchschnittswerte">
              <MetricList
                items={[
                  { label: "km pro Fahrt", value: `${formatNumber(monthDistanceKm / Math.max(1, data.summary.activities_count), 1)} km` },
                  { label: "HM pro Fahrt", value: formatMeters(monthAscentM / Math.max(1, data.summary.activities_count)) },
                  { label: "Zeit pro Fahrt", value: formatHoursFromSeconds(data.summary.moving_time_s / Math.max(1, data.summary.activities_count), 1) },
                  { label: "TSS pro Fahrt", value: formatNumber(data.summary.stress_avg, 1) },
                ]}
              />
            </DashboardCard>

            <DashboardCard title="Intensitätsverteilung" subtitle={ftp ? "Aus Ø Leistung und FTP abgeleitet" : "Aus TSS pro Stunde abgeleitet"}>
              <DonutChart segments={zoneBuckets} centerLabel="h" />
            </DashboardCard>
          </div>

          <div className="analytics-grid two">
            <DashboardCard title="Monatsrekorde">
              <MetricList
                items={[
                  { label: "Längste Fahrt", value: bestDuration ? formatHoursFromSeconds(bestDuration.value, 1) : "-", subValue: bestDuration?.activity.name },
                  { label: "Höchste Leistung", value: bestPower ? `${formatNumber(bestPower.value, 0)} W` : "-", subValue: bestPower?.activity.name },
                  { label: "Höchste Geschwindigkeit", value: bestSpeed ? `${formatNumber(bestSpeed.value, 1)} km/h` : "-", subValue: bestSpeed?.activity.name },
                  { label: "Höchste HM", value: bestAscent ? formatMeters(bestAscent.value) : "-", subValue: bestAscent?.activity.name },
                  { label: "Höchste TSS", value: bestStress ? formatNumber(bestStress.value, 0) : "-", subValue: bestStress?.activity.name },
                ]}
              />
            </DashboardCard>

            <DashboardCard title="Aktivitätstypen">
              <DonutChart segments={typeBuckets} centerLabel="Rides" />
            </DashboardCard>
          </div>

          <DashboardCard title="Aktivitätskalender" subtitle="Farbkodierung nach Trainingsbelastung">
            <div className="month-grid analytics-month-grid">
              {data.days.map((day) => (
                <article
                  className={`month-day-card analytics-month-day ${day.activities.length ? "has-activities" : ""} ${stressClass(day.summary.stress_total)}`}
                  key={day.date}
                  tabIndex={day.activities.length ? 0 : undefined}
                >
                  <header className="month-day-header">
                    <h3>{day.day}</h3>
                    <span>{day.weekday_short}</span>
                  </header>

                  {day.activities.length === 0 ? (
                    <p className="month-day-empty">0 TSS</p>
                  ) : (
                    <>
                      <div className="month-day-summary">
                        <strong>{formatNumber(day.summary.stress_total, 0)} TSS</strong>
                        <span>{day.summary.activities_count} Ride{day.summary.activities_count === 1 ? "" : "s"}</span>
                        <span>{day.summary.moving_time_label ?? "-"}</span>
                        <span>{formatKilometersFromMeters(day.summary.distance_m)}</span>
                        <span>{formatMeters(day.summary.total_ascent_m)}</span>
                      </div>

                      <div className="month-day-overlay" aria-label={`Fahrten am ${formatDate(day.date)}`}>
                        <div className="month-day-overlay-head">
                          <strong>{formatShortDate(day.date)}</strong>
                          <span>{day.summary.activities_count}</span>
                        </div>
                        <div className="month-activities-list">
                          {day.activities.map((activity) => (
                            <button
                              key={activity.id}
                              className="month-activity-item"
                              type="button"
                              onClick={() => navigate(`/activities/${activity.id}`)}
                            >
                              <strong>{activity.name}</strong>
                              <span>{formatTime(activity.start_time)} | {activity.duration_label ?? "-"}</span>
                              <span>
                                {formatKilometersFromMeters(activity.distance_m)} | HM {formatNumber(activity.total_ascent_m, 0)} | Ø {formatNumber(activity.avg_power_w, 0)} W | TSS {formatNumber(activity.stress_score, 0)}{activity.stress_source_label ? ` (${activity.stress_source_label})` : ""}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          </DashboardCard>
        </>
      ) : null}
    </section>
  );
}
