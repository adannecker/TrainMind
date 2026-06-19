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
  MetricList,
  MiniDistribution,
  ProgressCard,
  VerticalBarChart,
} from "../components/DashboardComponents";
import {
  WEEKLY_ASCENT_TARGET_M,
  WEEKLY_DISTANCE_TARGET_KM,
  YEARLY_ASCENT_TARGET_M,
  addDays,
  addMonths,
  buildIntensityBuckets,
  flattenActivities,
  formatApiErrorDetail,
  formatDate,
  formatDeltaPercent,
  formatHoursFromSeconds,
  formatKilometersFromMeters,
  formatMeters,
  formatNumber,
  formatTime,
  getComparison,
  numeric,
  percentOf,
  todayIsoDate,
} from "../components/dashboardUtils";
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
  total_ascent_m: number | null;
  avg_power_w: number | null;
  avg_speed_kmh: number | null;
  stress_score: number | null;
  stress_source_label?: string | null;
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
    total_ascent_m: number;
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
    total_ascent_m: number;
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

type TrainingMetricsResponse = {
  ftp?: { value: number }[];
};

type ClimbContext = {
  monthAscentM: number | null;
  yearAscentM: number | null;
  yearTargetAscentM: number;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

async function requestWeek(referenceDate: string): Promise<WeekResponse> {
  const response = await apiFetch(`${API_BASE_URL}/activities/week?reference_date=${referenceDate}`);
  const payload = await parseJsonSafely<WeekResponse | { detail?: unknown }>(response);
  if (!response.ok || !payload || !("week_start" in payload)) {
    throw new Error(formatApiErrorDetail(payload && "detail" in payload ? payload.detail : null, "Wochenansicht konnte nicht geladen werden."));
  }
  return payload;
}

function intensityClass(stress: number | null): string {
  const value = numeric(stress);
  if (value <= 0) return "load-none";
  if (value < 35) return "load-low";
  if (value < 75) return "load-medium";
  if (value < 120) return "load-high";
  return "load-very-high";
}

function weightedAverage(activities: WeekActivity[], key: "avg_power_w" | "avg_speed_kmh"): number | null {
  let weighted = 0;
  let seconds = 0;
  for (const activity of activities) {
    const value = activity[key];
    const duration = numeric(activity.duration_s);
    if (value === null || value === undefined || duration <= 0) continue;
    weighted += Number(value) * duration;
    seconds += duration;
  }
  return seconds > 0 ? weighted / seconds : null;
}

function bestBy(
  activities: WeekActivity[],
  selector: (activity: WeekActivity) => number,
): { activity: WeekActivity; value: number } | null {
  let best: { activity: WeekActivity; value: number } | null = null;
  for (const activity of activities) {
    const value = selector(activity);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!best || value > best.value) {
      best = { activity, value };
    }
  }
  return best;
}

function buildWeekStreaks(weeks: AvailableWeek[]): { active: number; longest: number; lastGap: string } {
  const starts = weeks.map((week) => week.week_start).sort((left, right) => right.localeCompare(left));
  if (!starts.length) return { active: 0, longest: 0, lastGap: "-" };

  let active = 1;
  for (let index = 1; index < starts.length; index += 1) {
    if (addDays(starts[index - 1], -7) !== starts[index]) break;
    active += 1;
  }

  let longest = 1;
  let current = 1;
  let lastGap = "-";
  for (let index = 1; index < starts.length; index += 1) {
    if (addDays(starts[index - 1], -7) === starts[index]) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      if (lastGap === "-") {
        lastGap = `${formatDate(addDays(starts[index], 7))} bis ${formatDate(addDays(starts[index - 1], -1))}`;
      }
      current = 1;
    }
  }

  return { active, longest, lastGap };
}

export function ActivitiesWeekPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<WeekResponse | null>(null);
  const [previousData, setPreviousData] = useState<WeekResponse | null>(null);
  const [availableWeeks, setAvailableWeeks] = useState<AvailableWeek[]>([]);
  const [ftp, setFtp] = useState<number | null>(null);
  const [climbContext, setClimbContext] = useState<ClimbContext>({
    monthAscentM: null,
    yearAscentM: null,
    yearTargetAscentM: YEARLY_ASCENT_TARGET_M,
  });
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
      setAvailableWeeks([]);
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

  async function loadClimbContext(referenceDate: string) {
    const year = new Date(`${referenceDate}T00:00:00Z`).getUTCFullYear();
    try {
      const [monthResult, yearResult] = await Promise.allSettled([
        apiFetch(`${API_BASE_URL}/activities/month?reference_date=${referenceDate}`),
        apiFetch(`${API_BASE_URL}/activities/year-dashboard?year=${year}`),
      ]);

      let monthAscentM: number | null = null;
      let yearAscentM: number | null = null;
      let yearTargetAscentM = YEARLY_ASCENT_TARGET_M;

      if (monthResult.status === "fulfilled" && monthResult.value.ok) {
        const payload = await parseJsonSafely<{ summary?: { total_ascent_m?: number } }>(monthResult.value);
        monthAscentM = payload?.summary?.total_ascent_m ?? null;
      }
      if (yearResult.status === "fulfilled" && yearResult.value.ok) {
        const payload = await parseJsonSafely<{
          summary?: { total_ascent_m?: number };
          goals?: { ascent_m?: number };
        }>(yearResult.value);
        yearAscentM = payload?.summary?.total_ascent_m ?? null;
        yearTargetAscentM = payload?.goals?.ascent_m ?? YEARLY_ASCENT_TARGET_M;
      }

      setClimbContext({ monthAscentM, yearAscentM, yearTargetAscentM });
    } catch {
      setClimbContext({ monthAscentM: null, yearAscentM: null, yearTargetAscentM: YEARLY_ASCENT_TARGET_M });
    }
  }

  async function loadWeek(referenceDate: string) {
    setLoading(true);
    setError(null);
    try {
      const [currentResult, previousResult] = await Promise.allSettled([
        requestWeek(referenceDate),
        requestWeek(addDays(referenceDate, -7)),
      ]);

      if (currentResult.status === "rejected") {
        throw currentResult.reason instanceof Error ? currentResult.reason : new Error("Wochenansicht konnte nicht geladen werden.");
      }
      setData(currentResult.value);
      setPreviousData(previousResult.status === "fulfilled" ? previousResult.value : null);
      void loadClimbContext(referenceDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWeeksAvailable();
    void loadTrainingMetrics();
  }, []);

  useEffect(() => {
    void loadWeek(selectedDate);
  }, [selectedDate]);

  const activities = useMemo(() => flattenActivities(data?.days ?? []) as WeekActivity[], [data]);
  const activeDays = useMemo(() => data?.days.filter((day) => day.summary.activities_count > 0).length ?? 0, [data]);
  const weekHours = numeric(data?.summary.moving_time_s) / 3600;
  const weekDistanceKm = numeric(data?.summary.distance_m) / 1000;
  const weekAscentM = numeric(data?.summary.total_ascent_m);
  const weekStress = numeric(data?.summary.stress_total);
  const targetHours = data?.summary.goal?.target_hours ?? 10;
  const targetStress = data?.summary.goal?.target_stress ?? 300;
  const averagePower = weightedAverage(activities, "avg_power_w");
  const averageSpeed = weightedAverage(activities, "avg_speed_kmh");
  const tssPerHourValue = weekHours > 0 ? weekStress / weekHours : null;
  const tssPerUnit = activities.length > 0 ? weekStress / activities.length : null;
  const streaks = useMemo(() => buildWeekStreaks(availableWeeks), [availableWeeks]);
  const zoneBuckets = useMemo(() => buildIntensityBuckets(activities, ftp), [activities, ftp]);

  const bestStress = bestBy(activities, (activity) => numeric(activity.stress_score));
  const bestDuration = bestBy(activities, (activity) => numeric(activity.duration_s));
  const bestAscent = bestBy(activities, (activity) => numeric(activity.total_ascent_m));
  const bestPower = bestBy(activities, (activity) => numeric(activity.avg_power_w));

  const comparisonItems = [
    {
      label: "Zeit",
      current: numeric(data?.summary.moving_time_s) / 3600,
      previous: numeric(previousData?.summary.moving_time_s) / 3600,
      suffix: " h",
    },
    {
      label: "Distanz",
      current: weekDistanceKm,
      previous: numeric(previousData?.summary.distance_m) / 1000,
      suffix: " km",
    },
    {
      label: "HM",
      current: weekAscentM,
      previous: numeric(previousData?.summary.total_ascent_m),
      suffix: " m",
    },
    {
      label: "TSS",
      current: weekStress,
      previous: numeric(previousData?.summary.stress_total),
      suffix: "",
    },
    {
      label: "Aktivitäten",
      current: numeric(data?.summary.activities_count),
      previous: numeric(previousData?.summary.activities_count),
      suffix: "",
    },
  ];

  function goToPreviousWeek() {
    setSelectedDate(addDays(data?.week_start ?? selectedDate, -7));
  }

  function goToNextWeek() {
    setSelectedDate(addDays(data?.week_start ?? selectedDate, 7));
  }

  function goToPreviousMonth() {
    setSelectedDate(addMonths(data?.week_start ?? selectedDate, -1));
  }

  function goToNextMonth() {
    setSelectedDate(addMonths(data?.week_start ?? selectedDate, 1));
  }

  return (
    <section className="page analytics-page">
      <AnalyticsScopeNav />
      <DashboardHeader
        eyebrow="Aktivitäten"
        title="Wochenansicht"
        subtitle={data ? `${formatDate(data.week_start)} - ${formatDate(data.week_end)}` : "Trainingswoche"}
      >
        <div className="analytics-controls">
          <button className="secondary-button week-nav-btn" type="button" onClick={goToPreviousMonth} title="Einen Monat zurück">
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
              Woche auswählen
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
          <button className="secondary-button week-nav-btn" type="button" onClick={goToNextMonth} title="Einen Monat vor">
            {">>"}
          </button>
        </div>
      </DashboardHeader>

      {loading ? <div className="card">Lade Wochenansicht...</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!loading && !error && data ? (
        <>
          <KpiGrid>
            <KpiCard label="Aktivitäten" value={formatNumber(data.summary.activities_count)} subValue={`${activeDays} aktive Tage`} tone="green" />
            <KpiCard label="Trainingszeit" value={formatHoursFromSeconds(data.summary.moving_time_s)} subValue={`${formatNumber(tssPerHourValue, 1)} TSS/h`} tone="blue" />
            <KpiCard label="Distanz" value={formatKilometersFromMeters(data.summary.distance_m)} subValue={`${formatNumber(averageSpeed, 1)} km/h`} tone="slate" />
            <KpiCard label="Höhenmeter" value={formatMeters(data.summary.total_ascent_m)} subValue={`${formatNumber(weekAscentM / Math.max(1, weekDistanceKm), 0)} m/km`} tone="amber" />
            <KpiCard label="Gesamt-TSS" value={formatNumber(data.summary.stress_total, 0)} subValue={`${formatNumber(tssPerUnit, 1)} pro Einheit`} tone="red" />
            <KpiCard label="Ø Leistung" value={`${formatNumber(averagePower, 0)} W`} subValue={ftp ? `FTP ${formatNumber(ftp, 0)} W` : "Leistungsbasis"} tone="blue" />
          </KpiGrid>

          <div className="analytics-grid two">
            <DashboardCard title="Wochenziele" subtitle={data.summary.goal.is_custom ? "Persönliche Zielwerte aktiv" : "Standardziel mit erweitertem Umfang"}>
              <div className="analytics-progress-grid">
                <ProgressCard label="Zeit" value={`${formatNumber(weekHours, 1)} h`} target={`${formatNumber(targetHours, 1)} h`} percent={percentOf(weekHours, targetHours)} tone="blue" />
                <ProgressCard label="Distanz" value={`${formatNumber(weekDistanceKm, 1)} km`} target={`${WEEKLY_DISTANCE_TARGET_KM} km`} percent={percentOf(weekDistanceKm, WEEKLY_DISTANCE_TARGET_KM)} tone="green" />
                <ProgressCard label="TSS" value={formatNumber(weekStress, 0)} target={formatNumber(targetStress, 0)} percent={percentOf(weekStress, targetStress)} tone="red" />
                <ProgressCard label="HM" value={formatMeters(weekAscentM)} target={formatMeters(WEEKLY_ASCENT_TARGET_M)} percent={percentOf(weekAscentM, WEEKLY_ASCENT_TARGET_M)} tone="amber" />
              </div>
            </DashboardCard>

            <DashboardCard title="Belastungsverteilung" subtitle="TSS pro Tag">
              <VerticalBarChart
                data={data.days.map((day) => ({
                  label: day.weekday_short,
                  value: numeric(day.summary.stress_total),
                  title: `${formatDate(day.date)}: ${formatNumber(day.summary.stress_total, 0)} TSS`,
                }))}
              />
            </DashboardCard>
          </div>

          <div className="analytics-grid three">
            <DashboardCard title="Trainingsverteilung">
              <MiniDistribution data={data.days.map((day) => ({ label: day.weekday_short, value: day.summary.activities_count }))} />
            </DashboardCard>

            <DashboardCard title="Intensitätsverteilung" subtitle={ftp ? "Aus Ø Leistung und FTP abgeleitet" : "Aus TSS pro Stunde abgeleitet"}>
              <DonutChart segments={zoneBuckets} centerLabel="h" />
            </DashboardCard>

            <DashboardCard title="Wochenvergleich" subtitle="Aktuelle Woche vs. Vorwoche">
              <MetricList
                items={comparisonItems.map((item) => {
                  const comparison = getComparison(item.current, item.previous);
                  return {
                    label: item.label,
                    value: `${formatNumber(item.current, item.label === "Zeit" || item.label === "Distanz" ? 1 : 0)}${item.suffix}`,
                    subValue: `${comparison.absolute >= 0 ? "+" : ""}${formatNumber(comparison.absolute, item.label === "Zeit" || item.label === "Distanz" ? 1 : 0)}${item.suffix} / ${formatDeltaPercent(comparison.percent)}`,
                  };
                })}
              />
            </DashboardCard>
          </div>

          <div className="analytics-grid three">
            <DashboardCard title="Beste Einheit der Woche">
              <MetricList
                items={[
                  {
                    label: "Höchster TSS",
                    value: bestStress ? formatNumber(bestStress.value, 0) : "-",
                    subValue: bestStress?.activity.name,
                  },
                  {
                    label: "Längste Fahrt",
                    value: bestDuration ? formatHoursFromSeconds(bestDuration.value, 1) : "-",
                    subValue: bestDuration?.activity.name,
                  },
                  {
                    label: "Meiste HM",
                    value: bestAscent ? formatMeters(bestAscent.value) : "-",
                    subValue: bestAscent?.activity.name,
                  },
                  {
                    label: "Höchste Ø Leistung",
                    value: bestPower ? `${formatNumber(bestPower.value, 0)} W` : "-",
                    subValue: bestPower?.activity.name,
                  },
                ]}
              />
            </DashboardCard>

            <DashboardCard title="Streaks">
              <MetricList
                items={[
                  { label: "Aktive Wochen in Folge", value: formatNumber(streaks.active) },
                  { label: "Längste Serie", value: formatNumber(streaks.longest) },
                  { label: "Letzter freier Zeitraum", value: streaks.lastGap },
                ]}
              />
            </DashboardCard>

            <DashboardCard title="Climb Quest">
              <div className="analytics-progress-grid single">
                <ProgressCard label="Woche" value={formatMeters(weekAscentM)} target={formatMeters(WEEKLY_ASCENT_TARGET_M)} percent={percentOf(weekAscentM, WEEKLY_ASCENT_TARGET_M)} tone="amber" />
                <ProgressCard label="Monat" value={formatMeters(climbContext.monthAscentM)} target="8'000 m" percent={percentOf(numeric(climbContext.monthAscentM), 8000)} tone="amber" />
                <ProgressCard label="Jahr" value={formatMeters(climbContext.yearAscentM)} target={formatMeters(climbContext.yearTargetAscentM)} percent={percentOf(numeric(climbContext.yearAscentM), climbContext.yearTargetAscentM)} tone="amber" />
              </div>
            </DashboardCard>
          </div>

          <DashboardCard title="Wochenkalender" subtitle="Tageskarten mit Belastungsfarbe und Aktivitätsnavigation">
            <div className="week-grid analytics-week-grid">
              {data.days.map((day) => (
                <article className={`week-day-card analytics-day-card ${intensityClass(day.summary.stress_total)}`} key={day.date}>
                  <header className="week-day-header">
                    <h3>
                      {day.weekday_short} <span>{formatDate(day.date)}</span>
                    </h3>
                  </header>

                  {day.activities.length === 0 ? (
                    <p className="week-day-empty">Trainingsfrei</p>
                  ) : (
                    <div className="week-activities-list">
                      {day.activities.map((activity) => (
                        <button
                          className="week-activity-item analytics-activity-button"
                          key={activity.id}
                          type="button"
                          title={`${activity.duration_label ?? "-"} | ${formatKilometersFromMeters(activity.distance_m)} | ${formatNumber(activity.stress_score, 0)} TSS${activity.stress_source_label ? ` (${activity.stress_source_label})` : ""}`}
                          onClick={() => navigate(`/activities/${activity.id}`)}
                        >
                          <span className="analytics-ride-marker" aria-hidden="true" />
                          <span>
                            <strong className="week-activity-name">{activity.name}</strong>
                            <small className="week-activity-meta">
                              {formatTime(activity.start_time)} - {formatTime(activity.end_time)} | {activity.duration_label ?? "-"}
                            </small>
                            <small className="week-activity-metrics">
                              Ø {formatNumber(activity.avg_power_w, 0)} W | {formatNumber(activity.avg_speed_kmh, 1)} km/h | HM {formatNumber(activity.total_ascent_m, 0)} | TSS {formatNumber(activity.stress_score, 0)}{activity.stress_source_label ? ` (${activity.stress_source_label})` : ""}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <footer className="week-day-summary">
                    <span>{day.summary.moving_time_label ?? "-"}</span>
                    <span>{formatKilometersFromMeters(day.summary.distance_m)}</span>
                    <span>{formatMeters(day.summary.total_ascent_m)}</span>
                    <span>{formatNumber(day.summary.stress_total, 0)} TSS</span>
                  </footer>
                </article>
              ))}
            </div>
          </DashboardCard>
        </>
      ) : null}
    </section>
  );
}
