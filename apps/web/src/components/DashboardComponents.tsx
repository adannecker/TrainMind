import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

export type Tone = "green" | "blue" | "amber" | "red" | "slate";

export type KpiCardProps = {
  label: string;
  value: string;
  subValue?: string;
  tone?: Tone;
};

export type ProgressCardProps = {
  label: string;
  value: string;
  target: string;
  percent: number;
  hint?: string;
  tone?: Tone;
};

export type ChartDatum = {
  label: string;
  value: number;
  secondary?: number;
  title?: string;
};

export type StackedDatum = {
  label: string;
  segments: {
    key: string;
    label: string;
    value: number;
    color: string;
  }[];
};

export type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

export type HeatmapDay = {
  date: string;
  value: number;
  title?: string;
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function buildLinePath(values: number[], width: number, height: number, padding: number, maxValue?: number): string {
  if (!values.length) return "";
  const max = Math.max(1, maxValue ?? Math.max(...values));
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  return values
    .map((value, index) => {
      const x = padding + (values.length === 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
      const y = height - padding - (Math.max(0, value) / max) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function heatmapLevel(value: number): string {
  if (value <= 0) return "level-0";
  if (value < 35) return "level-1";
  if (value < 75) return "level-2";
  if (value < 120) return "level-3";
  return "level-4";
}

export function AnalyticsScopeNav() {
  return (
    <nav className="analytics-scope-nav" aria-label="Dashboard Zeitraum">
      <NavLink to="/activities/week" className={({ isActive }) => (isActive ? "active" : "")}>
        Woche
      </NavLink>
      <NavLink to="/activities/month" className={({ isActive }) => (isActive ? "active" : "")}>
        Monat
      </NavLink>
      <NavLink to="/activities/dashboard" className={({ isActive }) => (isActive ? "active" : "")}>
        Jahr
      </NavLink>
    </nav>
  );
}

export function DashboardHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="analytics-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="analytics-subtitle">{subtitle}</p>
      </div>
      {children ? <div className="analytics-header-actions">{children}</div> : null}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="analytics-kpi-grid">{children}</div>;
}

export function KpiCard({ label, value, subValue, tone = "green" }: KpiCardProps) {
  return (
    <article className={`analytics-kpi-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subValue ? <small>{subValue}</small> : null}
    </article>
  );
}

export function ProgressCard({ label, value, target, percent, hint, tone = "green" }: ProgressCardProps) {
  const clamped = clampPercent(percent);
  return (
    <article className={`analytics-progress-card tone-${tone}`}>
      <div className="analytics-progress-head">
        <span>{label}</span>
        <strong>{Math.round(clamped)}%</strong>
      </div>
      <div className="analytics-progress-values">
        <strong>{value}</strong>
        <span>{target}</span>
      </div>
      <div
        className="analytics-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
      >
        <div style={{ width: `${clamped}%` }} />
      </div>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

export function DashboardCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`analytics-card ${className ?? ""}`.trim()}>
      <div className="analytics-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function VerticalBarChart({ data, unit = "", maxValue }: { data: ChartDatum[]; unit?: string; maxValue?: number }) {
  const max = Math.max(1, maxValue ?? Math.max(...data.map((item) => item.value), 0));
  return (
    <div className="analytics-bar-chart">
      {data.map((item) => {
        const height = clampPercent((item.value / max) * 100);
        return (
          <div className="analytics-bar-item" key={item.label} title={item.title ?? `${item.label}: ${item.value}${unit}`}>
            <div className="analytics-bar-value">{item.value > 0 ? `${Math.round(item.value)}${unit}` : ""}</div>
            <div className="analytics-bar-track">
              <div style={{ height: `${height}%` }} />
            </div>
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MiniDistribution({ data, unit = "" }: { data: ChartDatum[]; unit?: string }) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className="analytics-mini-distribution">
      {data.map((item) => (
        <div key={item.label} className="analytics-mini-row">
          <span>{item.label}</span>
          <div>
            <i style={{ width: `${clampPercent((item.value / max) * 100)}%` }} />
          </div>
          <strong>{`${Math.round(item.value)}${unit}`}</strong>
        </div>
      ))}
    </div>
  );
}

export function StackedBarChart({ data }: { data: StackedDatum[] }) {
  const max = Math.max(1, ...data.map((item) => item.segments.reduce((sum, segment) => sum + segment.value, 0)));
  return (
    <div className="analytics-stacked-chart">
      {data.map((item) => {
        const total = item.segments.reduce((sum, segment) => sum + segment.value, 0);
        return (
          <div className="analytics-stacked-row" key={item.label}>
            <span>{item.label}</span>
            <div className="analytics-stacked-track">
              <div className="analytics-stacked-fill" style={{ width: `${clampPercent((total / max) * 100)}%` }}>
                {item.segments.map((segment) => (
                  <i
                    key={segment.key}
                    style={{
                      width: `${total > 0 ? (segment.value / total) * 100 : 0}%`,
                      background: segment.color,
                    }}
                    title={`${segment.label}: ${Math.round(segment.value)}`}
                  />
                ))}
              </div>
            </div>
            <strong>{Math.round(total)}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function LineChart({
  primary,
  secondary,
  labels,
  height = 190,
}: {
  primary: number[];
  secondary?: number[];
  labels?: string[];
  height?: number;
}) {
  const width = 640;
  const padding = 22;
  const max = Math.max(1, ...primary, ...(secondary ?? []));
  const primaryPath = buildLinePath(primary, width, height, padding, max);
  const secondaryPath = secondary ? buildLinePath(secondary, width, height, padding, max) : "";
  const firstLabel = labels?.[0];
  const lastLabel = labels?.[labels.length - 1];

  return (
    <div className="analytics-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Liniendiagramm">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} />
        {secondaryPath ? <path className="secondary" d={secondaryPath} /> : null}
        {primaryPath ? <path d={primaryPath} /> : null}
      </svg>
      {firstLabel || lastLabel ? (
        <div className="analytics-chart-axis">
          <span>{firstLabel}</span>
          <span>{lastLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

export function DonutChart({ segments, centerLabel }: { segments: DonutSegment[]; centerLabel?: string }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  let offset = 25;
  const radius = 32;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="analytics-donut-wrap">
      <svg className="analytics-donut" viewBox="0 0 88 88" role="img" aria-label="Verteilungsdiagramm">
        <circle cx="44" cy="44" r={radius} />
        {total > 0
          ? segments.map((segment) => {
              const fraction = Math.max(0, segment.value) / total;
              const dash = `${fraction * circumference} ${circumference}`;
              const currentOffset = offset;
              offset -= fraction * 100;
              return (
                <circle
                  key={segment.label}
                  className="segment"
                  cx="44"
                  cy="44"
                  r={radius}
                  stroke={segment.color}
                  strokeDasharray={dash}
                  strokeDashoffset={currentOffset}
                />
              );
            })
          : null}
      </svg>
      <div className="analytics-donut-center">
        <strong>{total > 0 ? Math.round(total) : "-"}</strong>
        <span>{centerLabel ?? "Total"}</span>
      </div>
      <div className="analytics-donut-legend">
        {segments.map((segment) => (
          <div key={segment.label}>
            <i style={{ background: segment.color }} />
            <span>{segment.label}</span>
            <strong>{total > 0 ? `${Math.round((segment.value / total) * 100)}%` : "0%"}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Heatmap({ days }: { days: HeatmapDay[] }) {
  return (
    <div className="analytics-heatmap" aria-label="Trainings-Heatmap">
      {days.map((day) => (
        <span
          key={day.date}
          className={heatmapLevel(day.value)}
          title={day.title ?? `${day.date}: ${Math.round(day.value)} TSS`}
        />
      ))}
    </div>
  );
}

export function MetricList({
  items,
}: {
  items: {
    label: string;
    value: string;
    subValue?: string;
  }[];
}) {
  return (
    <div className="analytics-metric-list">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.subValue ? <small>{item.subValue}</small> : null}
        </div>
      ))}
    </div>
  );
}
