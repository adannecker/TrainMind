import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import {
  AnalyticsScopeNav,
  DashboardCard,
  DashboardHeader,
  DonutChart,
  Heatmap,
  KpiCard,
  KpiGrid,
  LineChart,
  MetricList,
  ProgressCard,
  VerticalBarChart,
} from "../components/DashboardComponents";
import {
  formatDeltaPercent,
  formatApiErrorDetail,
  formatHoursFromSeconds,
  formatKilometersFromMeters,
  formatMeters,
  formatNumber,
  percentOf,
} from "../components/dashboardUtils";
import { API_BASE_URL } from "../config";

type YearSummary = {
  activities_count: number;
  active_days: number;
  moving_time_s: number;
  distance_m: number;
  total_ascent_m: number;
  stress_total: number;
  stress_avg: number | null;
  avg_power_w: number | null;
  avg_speed_kmh: number | null;
  avg_per_week: {
    distance_m: number;
    moving_time_s: number;
    stress_total: number;
  };
  avg_per_month: {
    distance_m: number;
    moving_time_s: number;
    stress_total: number;
  };
};

type MonthlyRow = {
  month: number;
  label: string;
  activities_count: number;
  active_days: number;
  moving_time_s: number;
  distance_m: number;
  total_ascent_m: number;
  stress_total: number;
};

type HeatmapRow = {
  date: string;
  value: number;
  activities_count: number;
  moving_time_s: number;
  distance_m: number;
  total_ascent_m: number;
};

type FitnessRow = {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
};

type DashboardRecord = {
  activity_id?: number | null;
  activity_name?: string | null;
  label?: string | null;
  value?: number | null;
  value_label?: string | null;
  date?: string | null;
};

type ChallengeRow = {
  label: string;
  current: number;
  target: number;
  remaining: number;
  forecast: number;
  unit: string;
  status: string;
  progress_percent: number;
};

type ActivityDistributionRow = {
  label: string;
  activities_count: number;
  moving_time_s: number;
  distance_m: number;
  stress_total: number;
};

type ComparisonMetric = {
  current: number;
  previous: number;
  absolute: number;
  percent: number | null;
};

type LevelRow = {
  label: string;
  target: number;
  icon: string;
  achieved: boolean;
};

type LevelGoal = {
  key: "distance_km" | "ascent_m" | "stress";
  label: string;
  unit: string;
  current: number;
  current_level: LevelRow | null;
  next_level: LevelRow | null;
  target: number;
  remaining: number;
  progress_percent: number;
  levels: LevelRow[];
};

type RiderType = {
  key: string;
  label: string;
  icon: string;
  score: number;
  reason: string;
  metrics: {
    distance_km: number;
    ascent_per_km: number;
    zone2_share: number;
    intense_activity_share: number;
    weekend_tss_share: number;
    moving_time_h: number;
  };
  candidates: {
    key: string;
    label: string;
    icon: string;
    score: number;
  }[];
};

type YearDashboardResponse = {
  year: number;
  previous_year: number;
  goals: {
    distance_km: number;
    ascent_m: number;
    hours: number;
    stress: number;
  };
  level_goals: {
    distance_km: LevelGoal;
    ascent_m: LevelGoal;
    stress: LevelGoal;
  };
  rider_type: RiderType;
  summary: YearSummary;
  monthly: MonthlyRow[];
  heatmap: HeatmapRow[];
  fitness: FitnessRow[];
  records: Record<string, DashboardRecord | null>;
  challenges: ChallengeRow[];
  activity_distribution: ActivityDistributionRow[];
  comparison_previous_year: {
    distance_m: ComparisonMetric;
    total_ascent_m: ComparisonMetric;
    moving_time_s: ComparisonMetric;
    stress_total: ComparisonMetric;
    activities_count: ComparisonMetric;
  };
  insights: string[];
};

type MonthlyMetric = "distance" | "ascent" | "stress" | "hours";

const MONTHLY_METRIC_CONFIG: Record<MonthlyMetric, { label: string; unit: string; value: (row: MonthlyRow) => number }> = {
  distance: { label: "Kilometer", unit: " km", value: (row) => row.distance_m / 1000 },
  ascent: { label: "Höhenmeter", unit: " m", value: (row) => row.total_ascent_m },
  stress: { label: "TSS", unit: "", value: (row) => row.stress_total },
  hours: { label: "Stunden", unit: " h", value: (row) => row.moving_time_s / 3600 },
};

const ACTIVITY_TYPE_COLORS: Record<string, string> = {
  Rennrad: "#2d8f78",
  Gravel: "#b9853a",
  MTB: "#5f7fbf",
  Indoor: "#b15c8f",
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function currentYear(): number {
  return new Date().getFullYear();
}

function formatChallengeValue(value: number, unit: string): string {
  if (unit === "km") return `${formatNumber(value, 0)} km`;
  if (unit === "m") return `${formatNumber(value, 0)} m`;
  if (unit === "h") return `${formatNumber(value, 1)} h`;
  return `${formatNumber(value, 0)} ${unit}`;
}

function levelTone(key: LevelGoal["key"]): "green" | "amber" | "red" {
  if (key === "distance_km") return "green";
  if (key === "ascent_m") return "amber";
  return "red";
}

function recordValue(record: DashboardRecord | null | undefined): string {
  return record?.value_label || (record?.value != null ? formatNumber(record.value, 0) : "-");
}

function recordLabel(record: DashboardRecord | null | undefined): string | undefined {
  return record?.activity_name || record?.label || undefined;
}

export function ActivitiesDashboardPage() {
  const navigate = useNavigate();
  const [year, setYear] = useState(currentYear());
  const [metric, setMetric] = useState<MonthlyMetric>("distance");
  const [data, setData] = useState<YearDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard(selectedYear: number) {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/year-dashboard?year=${selectedYear}`);
      const payload = await parseJsonSafely<YearDashboardResponse | { detail?: unknown }>(response);
      if (!response.ok || !payload || !("summary" in payload)) {
        throw new Error(formatApiErrorDetail(payload && "detail" in payload ? payload.detail : null, "Jahresdashboard konnte nicht geladen werden."));
      }
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard(year);
  }, [year]);

  const metricConfig = MONTHLY_METRIC_CONFIG[metric];
  const monthlyChartData = useMemo(
    () =>
      (data?.monthly ?? []).map((row) => ({
        label: row.label,
        value: metricConfig.value(row),
        title: `${row.label}: ${formatNumber(metricConfig.value(row), metric === "hours" ? 1 : 0)}${metricConfig.unit}`,
      })),
    [data, metric, metricConfig],
  );
  const heatmapDays = useMemo(
    () =>
      (data?.heatmap ?? []).map((day) => ({
        date: day.date,
        value: day.value,
        title: `${day.date}: ${formatNumber(day.value, 0)} TSS, ${formatKilometersFromMeters(day.distance_m)}`,
      })),
    [data],
  );
  const latestFitness = data?.fitness[data.fitness.length - 1] ?? null;
  const activityDistribution = useMemo(
    () =>
      (data?.activity_distribution ?? []).map((row) => ({
        label: row.label,
        value: row.activities_count,
        color: ACTIVITY_TYPE_COLORS[row.label] ?? "#6f7b8b",
      })),
    [data],
  );

  function openRecord(record: DashboardRecord | null | undefined) {
    if (record?.activity_id) {
      navigate(`/activities/${record.activity_id}`);
    }
  }

  return (
    <section className="page analytics-page">
      <AnalyticsScopeNav />
      <DashboardHeader eyebrow="Aktivitäten" title="Dashboard" subtitle={`Jahrescockpit ${year}`}>
        <div className="analytics-controls">
          <button className="secondary-button week-nav-btn" type="button" onClick={() => setYear((current) => current - 1)} title="Vorjahr">
            {"<"}
          </button>
          <select className="week-data-select year-select" value={year} onChange={(event) => setYear(Number(event.target.value))} aria-label="Jahr auswählen">
            {Array.from({ length: 9 }, (_entry, index) => currentYear() + 1 - index).map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          <button className="secondary-button week-nav-btn" type="button" onClick={() => setYear((current) => current + 1)} title="Nächstes Jahr">
            {">"}
          </button>
        </div>
      </DashboardHeader>

      {loading ? <div className="card">Lade Jahresdashboard...</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!loading && !error && data ? (
        <>
          <KpiGrid>
            <KpiCard label="Kilometer" value={formatKilometersFromMeters(data.summary.distance_m)} subValue={`${formatKilometersFromMeters(data.summary.avg_per_week.distance_m)} / Woche`} tone="green" />
            <KpiCard label="Fahrstunden" value={formatHoursFromSeconds(data.summary.moving_time_s)} subValue={`${formatHoursFromSeconds(data.summary.avg_per_month.moving_time_s)} / Monat`} tone="blue" />
            <KpiCard label="Höhenmeter" value={formatMeters(data.summary.total_ascent_m)} subValue={`${formatMeters(data.summary.total_ascent_m / 12)} / Monat`} tone="amber" />
            <KpiCard label="TSS" value={formatNumber(data.summary.stress_total, 0)} subValue={`${formatNumber(data.summary.stress_avg, 1)} / Ride`} tone="red" />
            <KpiCard label="Aktivitäten" value={formatNumber(data.summary.activities_count)} subValue={`${formatNumber(data.summary.activities_count / 52, 1)} / Woche`} tone="slate" />
            <KpiCard label="Aktive Tage" value={formatNumber(data.summary.active_days)} subValue={`${formatNumber((data.summary.active_days / data.heatmap.length) * 100, 0)}% des Jahres`} tone="blue" />
          </KpiGrid>

          <div className="analytics-grid two">
            <DashboardCard title="Level-Ziele" subtitle="Dynamische Jahresziele bis Diamant">
              <div className="analytics-level-grid">
                {[data.level_goals.distance_km, data.level_goals.ascent_m, data.level_goals.stress].map((goal) => (
                  <article key={goal.key} className={`analytics-level-card tone-${levelTone(goal.key)}`}>
                    <div className="analytics-level-card-head">
                      <span>{goal.label}</span>
                      <strong>{goal.current_level?.icon ?? "◇"} {goal.current_level?.label ?? "Start"}</strong>
                    </div>
                    <div className="analytics-level-target">
                      <strong>{formatChallengeValue(goal.current, goal.unit)}</strong>
                      <span>Nächstes Ziel: {goal.next_level ? `${goal.next_level.icon} ${goal.next_level.label}` : "Diamant erreicht"}</span>
                    </div>
                    <div className="analytics-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(goal.progress_percent)}>
                      <div style={{ width: `${Math.max(0, Math.min(100, goal.progress_percent))}%` }} />
                    </div>
                    <div className="analytics-level-medals" aria-label={`${goal.label} Level`}>
                      {goal.levels.map((level) => (
                        <span key={`${goal.key}-${level.label}`} className={level.achieved ? "achieved" : ""} title={`${level.label}: ${formatChallengeValue(level.target, goal.unit)}`}>
                          <i>{level.icon}</i>
                          <small>{level.label}</small>
                        </span>
                      ))}
                    </div>
                    <p>
                      {goal.next_level
                        ? `${formatChallengeValue(goal.remaining, goal.unit)} bis ${goal.next_level.label}`
                        : "Maximales Level erreicht."}
                    </p>
                  </article>
                ))}
              </div>
            </DashboardCard>

            <DashboardCard title="Persönlicher Fahrer-Typ" subtitle="Automatisch aus deinem Jahresprofil berechnet">
              <div className="analytics-rider-type">
                <div className="analytics-rider-type-hero">
                  <span>{data.rider_type.icon}</span>
                  <div>
                    <strong>{data.rider_type.label}</strong>
                    <p>{data.rider_type.reason}</p>
                  </div>
                </div>
                <MetricList
                  items={[
                    { label: "Profil-Score", value: `${formatNumber(data.rider_type.score, 0)} / 100` },
                    { label: "HM pro km", value: `${formatNumber(data.rider_type.metrics.ascent_per_km, 1)} m/km` },
                    { label: "Zone-2-Anteil", value: `${formatNumber(data.rider_type.metrics.zone2_share * 100, 0)}%` },
                    { label: "Wochenend-TSS", value: `${formatNumber(data.rider_type.metrics.weekend_tss_share * 100, 0)}%` },
                  ]}
                />
                <div className="analytics-rider-type-list">
                  {data.rider_type.candidates.map((candidate) => (
                    <div key={candidate.key} className={candidate.key === data.rider_type.key ? "active" : ""}>
                      <span>{candidate.icon} {candidate.label}</span>
                      <strong>{formatNumber(candidate.score, 0)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </DashboardCard>
          </div>

          <DashboardCard title="Jahresfortschritt" subtitle="Zielstand mit Prognose">
            <div className="analytics-progress-grid four">
              {data.challenges.slice(0, 4).map((challenge) => (
                <ProgressCard
                  key={challenge.label}
                  label={challenge.label.replace(" Challenge", "")}
                  value={formatChallengeValue(challenge.current, challenge.unit)}
                  target={formatChallengeValue(challenge.target, challenge.unit)}
                  percent={challenge.progress_percent}
                  hint={`${challenge.status} · Prognose ${formatChallengeValue(challenge.forecast, challenge.unit)}`}
                  tone={challenge.unit === "m" ? "amber" : challenge.unit === "TSS" ? "red" : challenge.unit === "h" ? "blue" : "green"}
                />
              ))}
            </div>
          </DashboardCard>

          <div className="analytics-grid two">
            <DashboardCard title="Monatsentwicklung" subtitle={metricConfig.label}>
              <div className="analytics-segmented">
                {Object.entries(MONTHLY_METRIC_CONFIG).map(([key, config]) => (
                  <button
                    key={key}
                    className={metric === key ? "active" : ""}
                    type="button"
                    onClick={() => setMetric(key as MonthlyMetric)}
                  >
                    {config.label}
                  </button>
                ))}
              </div>
              <VerticalBarChart data={monthlyChartData} unit={metricConfig.unit} />
            </DashboardCard>

            <DashboardCard title="Fitness Entwicklung" subtitle="CTL, ATL und aktuelle Form aus Tages-TSS">
              <LineChart
                primary={data.fitness.map((row) => row.ctl)}
                secondary={data.fitness.map((row) => row.atl)}
                labels={data.fitness.map((row) => row.date.slice(5))}
              />
              <MetricList
                items={[
                  { label: "CTL Fitness", value: latestFitness ? formatNumber(latestFitness.ctl, 1) : "-" },
                  { label: "ATL Fatigue", value: latestFitness ? formatNumber(latestFitness.atl, 1) : "-" },
                  { label: "TSB Form", value: latestFitness ? formatNumber(latestFitness.tsb, 1) : "-" },
                ]}
              />
            </DashboardCard>
          </div>

          <DashboardCard title="Trainings Heatmap" subtitle="365 Tage nach TSS eingefärbt">
            <Heatmap days={heatmapDays} />
          </DashboardCard>

          <div className="analytics-grid two">
            <DashboardCard title="Rekorde">
              <div className="analytics-record-grid">
                {[
                  ["Längste Fahrt", data.records.longest_ride],
                  ["Höchste HM", data.records.highest_ascent],
                  ["Höchste Leistung", data.records.highest_power],
                  ["Höchste Geschwindigkeit", data.records.highest_speed],
                  ["Höchste TSS", data.records.highest_tss],
                  ["Längste Trainingswoche", data.records.longest_training_week],
                  ["Stärkster Trainingsmonat", data.records.strongest_training_month],
                ].map(([label, record]) => (
                  <button
                    key={String(label)}
                    className="analytics-record-card"
                    type="button"
                    disabled={!record || !(record as DashboardRecord).activity_id}
                    onClick={() => openRecord(record as DashboardRecord | null)}
                  >
                    <span>{String(label)}</span>
                    <strong>{recordValue(record as DashboardRecord | null)}</strong>
                    <small>{recordLabel(record as DashboardRecord | null)}</small>
                  </button>
                ))}
              </div>
            </DashboardCard>

            <DashboardCard title="Challenges" subtitle="Fortschritt, Restwert und Prognose">
              <div className="analytics-progress-grid single">
                {data.challenges.map((challenge) => (
                  <ProgressCard
                    key={challenge.label}
                    label={challenge.label}
                    value={formatChallengeValue(challenge.current, challenge.unit)}
                    target={formatChallengeValue(challenge.target, challenge.unit)}
                    percent={challenge.progress_percent}
                    hint={`${formatChallengeValue(challenge.remaining, challenge.unit)} offen · ${challenge.status}`}
                    tone={challenge.unit === "m" ? "amber" : challenge.unit === "TSS" ? "red" : challenge.unit === "h" ? "blue" : "green"}
                  />
                ))}
              </div>
            </DashboardCard>
          </div>

          <div className="analytics-grid two">
            <DashboardCard title="Aktivitätsverteilung">
              <DonutChart segments={activityDistribution} centerLabel="Rides" />
            </DashboardCard>

            <DashboardCard title={`Vergleich ${data.year} vs ${data.previous_year}`}>
              <MetricList
                items={[
                  {
                    label: "km",
                    value: formatKilometersFromMeters(data.comparison_previous_year.distance_m.current),
                    subValue: formatDeltaPercent(data.comparison_previous_year.distance_m.percent),
                  },
                  {
                    label: "HM",
                    value: formatMeters(data.comparison_previous_year.total_ascent_m.current),
                    subValue: formatDeltaPercent(data.comparison_previous_year.total_ascent_m.percent),
                  },
                  {
                    label: "Zeit",
                    value: formatHoursFromSeconds(data.comparison_previous_year.moving_time_s.current),
                    subValue: formatDeltaPercent(data.comparison_previous_year.moving_time_s.percent),
                  },
                  {
                    label: "TSS",
                    value: formatNumber(data.comparison_previous_year.stress_total.current, 0),
                    subValue: formatDeltaPercent(data.comparison_previous_year.stress_total.percent),
                  },
                  {
                    label: "Aktivitäten",
                    value: formatNumber(data.comparison_previous_year.activities_count.current, 0),
                    subValue: formatDeltaPercent(data.comparison_previous_year.activities_count.percent),
                  },
                ]}
              />
            </DashboardCard>
          </div>

          <DashboardCard title="Persönliche Insights">
            <div className="analytics-insight-list">
              {data.insights.map((insight) => (
                <p key={insight}>{insight}</p>
              ))}
              <p>Deine Jahresziel-Erreichung liegt bei {formatNumber(percentOf(data.summary.distance_m / 1000, data.goals.distance_km), 0)} % für Kilometer und {formatNumber(percentOf(data.summary.total_ascent_m, data.goals.ascent_m), 0)} % für Höhenmeter.</p>
            </div>
          </DashboardCard>
        </>
      ) : null}
    </section>
  );
}
