import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type MetricType = "ftp" | "maxHr";

type MetricEntry = {
  id: number;
  value: number;
  recorded_at: string;
  source: string;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type MetricConfig = {
  key: MetricType;
  apiMetricType: "ftp" | "max_hr";
  title: string;
  shortLabel: string;
  unit: string;
  emptyText: string;
  helperText: string;
  sourceOptions: string[];
  infoTitle: string;
  infoIntro: string;
  infoPoints: string[];
};

type ZoneRow = {
  label: string;
  range: string;
  detail: string;
};

type ZoneModelOption = {
  key: string;
  label: string;
  description: string;
  is_default: boolean;
};

type ZoneSetting = {
  metric_type: "ftp" | "max_hr";
  model_key: string;
  label: string;
  description: string;
  is_default: boolean;
  custom_upper_bounds: number[];
  custom_colors: string[];
  has_customizations: boolean;
};

type ZoneInfoSource = {
  label: string;
  href: string;
  note: string;
};

type ZoneDefinition = {
  label: string;
  min: number;
  max: number | null;
  detail: string;
};

type EditableZone = {
  label: string;
  detail: string;
  minRatio: number;
  maxRatio: number | null;
  range: string;
  upperDisplayRatio: number | null;
  color: string;
};

type ZoneChartDomain = {
  min: number;
  max: number;
};

type TrainingMetricsResponse = {
  ftp?: MetricEntry[];
  max_hr?: MetricEntry[];
  zone_settings?: Partial<Record<"ftp" | "max_hr", ZoneSetting>>;
  available_zone_models?: Partial<Record<"ftp" | "max_hr", ZoneModelOption[]>>;
};

const zoneInfoContent: Record<
  "ftp" | "max_hr",
  {
    title: string;
    intro: string;
    points: string[];
    modelNotes: Record<string, string>;
    sources: ZoneInfoSource[];
  }
> = {
  ftp: {
    title: "Leistungszonen verstehen",
    intro:
      "FTP-basierte Zonen ordnen deine Leistung relativ zur Functional Threshold Power ein. Das ist besonders praktisch für strukturierte Intervalle, TSS-nahe Auswertungen und eine konsistente Trainingssprache.",
    points: [
      "Coggan 7 Zonen ist das verbreitetste Standardmodell und deshalb hier als Default gesetzt.",
      "Vereinfachte 6-Zonen-Modelle reduzieren Komplexität, bleiben aber für Alltagssteuerung gut nutzbar.",
      "Seiler 3 Zonen ist bewusst gröber und eignet sich vor allem für Low-Mid-High-Logik statt für feine Intervallabstufungen.",
    ],
    modelNotes: {
      coggan_classic: "Klassisches FTP-Modell mit feineren Abstufungen von Recovery bis Neuromuscular Power.",
      ftp_6_simplified: "Nah am klassischen Modell, aber mit weniger Trennlinien und damit etwas einfacher im Alltag.",
      seiler_3_power: "Sehr grobe Einteilung mit Fokus auf niedrige, mittlere und hohe Intensität.",
    },
    sources: [
      {
        label: "TrainingPeaks: How to Interpret Cycling Power Data",
        href: "https://www.trainingpeaks.com/blog/how-to-interpret-power-data-and-what-to-do-with-it/",
        note: "Praxisreferenz für die von Andrew Coggan entwickelten FTP-/Power-Level.",
      },
      {
        label: "British Cycling Power Calculator",
        href: "https://www.britishcycling.org.uk/membership/article/20120925-Power-Calculator-0",
        note: "Verbandsnahe Referenz mit Power-Zonen und FTHR-Zonen für die Trainingspraxis.",
      },
      {
        label: "PubMed: Seiler 2010, Best Practice for Intensity Distribution",
        href: "https://pubmed.ncbi.nlm.nih.gov/20861519/",
        note: "Häufig zitierte Übersichtsarbeit zum 3-Zonen-/Polarized-Kontext im Ausdauertraining.",
      },
    ],
  },
  max_hr: {
    title: "Herzfrequenzzonen verstehen",
    intro:
      "Herzfrequenzzonen sind etwas indirekter als Leistungszonen, dafür aber mit Brustgurt oder Uhr oft leicht verfügbar. Sie eignen sich gut für Grundlagensteuerung und für längere Belastungen mit stabiler Herzfrequenz.",
    points: [
      "Das klassische 5-Zonen-Modell auf Basis von MaxHF ist weit verbreitet und deshalb hier der Default.",
      "Gleichmäßige 10-Prozent-Schritte sind einfach zu lesen, aber physiologisch gröber als schwellennahe Modelle.",
      "Das vereinfachte 3-Zonen-Modell ist gut für übergeordnete Analyse, wenn du vor allem locker, mittel und hart unterscheiden willst.",
    ],
    modelNotes: {
      max_hr_5_classic: "Typisches 5-Zonen-Raster für MaxHF-basierte Trainingssteuerung.",
      max_hr_5_even: "Sehr einfaches 10-Prozent-Schema, gut lesbar, aber fachlich eher grob.",
      max_hr_3_simplified: "Kompakte Low-Mid-High-Logik für vereinfachte Auswertung und Planung.",
    },
    sources: [
      {
        label: "British Cycling: Understanding intensity - Heart Rate",
        href: "https://www.britishcycling.org.uk/knowledge/training/get-started/article/izn20140808-Understanding-Intensity-2--Heart-Rate-0",
        note: "Verbandsquelle zur praktischen Nutzung und Einordnung von Herzfrequenzzonen.",
      },
      {
        label: "British Cycling: Following training plans using Heart Rate",
        href: "https://www.britishcycling.org.uk/knowledge/bike-kit/article/izn20191128-Following-the-British-Cycling-Digital-Training-plans-using-Heart-Rate-0",
        note: "Beschreibt FTHR/LTHR-gestützte Herangehensweise und die Nutzung in TrainingPeaks.",
      },
      {
        label: "PubMed: Seiler 2006, Quantifying training intensity distribution",
        href: "https://pubmed.ncbi.nlm.nih.gov/16430681/",
        note: "Primärquelle zur 3-Zonen-Logik anhand von Schwellen und Trainingsverteilung.",
      },
    ],
  },
};

const defaultZoneColors: Record<"ftp" | "max_hr", string[]> = {
  ftp: ["#7C7691", "#6D8FD0", "#59B78F", "#F1D96A", "#E7A458", "#D45D76", "#B86AD6"],
  max_hr: ["#7C7691", "#6D8FD0", "#59B78F", "#F1D96A", "#E7A458"],
};

const trainingZones = [
  "Recovery",
  "GA1",
  "GA2",
  "Sweetspot",
  "Schwelle",
  "VO2max",
  "Sprint",
  "Kraftausdauer",
];

const athleteProfiles = [
  "Gewichtsverlust und Gesundheit",
  "Hobbyfahrer mit Freude an Regelmäßigkeit",
  "Ambitionierter Amateur mit Eventfokus",
  "Marathon- und Ultra-Ziel wie 300-500 km",
  "Semiprofi mit hoher Wochenstruktur",
];

const trainingGoals = [
  "5 km bis 90 Minuten locker trainierbar",
  "Mehr Radtage sinnvoll organisieren",
  "Rennleistung auf Straße oder Gravel steigern",
  "Lange Ausdauer für 200-500 km Events aufbauen",
  "Triathlon-Tage mit Radschwerpunkten koordinieren",
];

const planFamilies = [
  {
    title: "3 Tage pro Woche",
    description: "Solide Basis für Gesundheit, Gewichtsmanagement und Hobbyziele mit klaren Prioritäten pro Einheit.",
    split: "1 lockere Grundlage, 1 Qualitätsreiz, 1 längere Ausfahrt",
  },
  {
    title: "4 Tage pro Woche",
    description: "Guter Sweetspot zwischen Alltag und Entwicklung, oft ideal für ambitionierte Amateure.",
    split: "2 Grundlagen, 1 Intervalltag, 1 Long Ride",
  },
  {
    title: "5-6 Tage pro Woche",
    description: "Mehr Steuerung über Belastung und Erholung, geeignet für Rennziele und lange Vorbereitungsblöcke.",
    split: "mehrere Belastungstypen plus Recovery- und Technikfenster",
  },
  {
    title: "Triathlon-orientiert",
    description: "Ordnet Radschwerpunkte so ein, dass Laufen und Schwimmen den Wochenfluss nicht brechen.",
    split: "Radqualität an frischen Tagen, Koppeleinheiten und kontrollierte Gesamtlast",
  },
];

const metricConfigs: Record<MetricType, MetricConfig> = {
  ftp: {
    key: "ftp",
    apiMetricType: "ftp",
    title: "FTP",
    shortLabel: "FTP",
    unit: "W",
    emptyText: "Noch kein FTP gespeichert.",
    helperText: "Typische Quellen sind Ramp Test, 20-Minuten-Test, Rennen, Labor oder eine manuelle Einschätzung.",
    sourceOptions: ["Ramp Test", "20-Minuten-Test", "Rennen", "Labor", "Manuelle Einschätzung", "Sonstiges"],
    infoTitle: "FTP verstehen",
    infoIntro: "Die FTP ist die Leistung, die du ungefähr eine Stunde lang nachhaltig treten kannst. Sie ist eine zentrale Basis für wattgesteuerte Trainingszonen.",
    infoPoints: [
      "TrainMind nutzt hier zunächst ein klassisches FTP-basiertes Zonenmodell.",
      "Typische Quellen sind Ramp Test, 20-Minuten-Test, Rennen oder Laborwerte.",
      "Später können wir weitere Zonenmodelle ergänzen, zum Beispiel vereinfachte 5-Zonen-Modelle.",
      "Die Werte werden jetzt persistent in der Datenbank gespeichert und beim Laden der Seite wiederhergestellt.",
    ],
  },
  maxHr: {
    key: "maxHr",
    apiMetricType: "max_hr",
    title: "MaxHF",
    shortLabel: "MaxHF",
    unit: "bpm",
    emptyText: "Noch keine MaxHF gespeichert.",
    helperText: "MaxHF kann später auch automatisch aus Aktivitäten vorgeschlagen werden, wenn ein höherer belastbarer Wert gefunden wird.",
    sourceOptions: ["Automatisch aus Aktivitäten", "Rennen oder Test", "Labor", "Manuell ermittelt", "Sonstiges"],
    infoTitle: "MaxHF verstehen",
    infoIntro: "Die maximale Herzfrequenz dient als einfacher Anker für Herzfrequenzzonen. Sie ist praktisch, aber meist gröber als ein schwellenbasierter Ansatz.",
    infoPoints: [
      "TrainMind nutzt hier zunächst MaxHF-basierte Herzfrequenzzonen.",
      "Später können wir alternativ auch Schwellenpuls oder Herzfrequenzreserve unterstützen.",
      "MaxHF kann aus Rennen, Tests oder automatisch aus Aktivitäten kommen.",
      "Die Werte werden jetzt persistent in der Datenbank gespeichert und beim Laden der Seite wiederhergestellt.",
    ],
  },
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function TrainingSection({
  title,
  description,
  children,
  highlight = false,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  highlight?: boolean;
}) {
  return (
    <article className={`card training-card ${highlight ? "training-card-highlight" : ""}`}>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </article>
  );
}

function PillList({ items }: { items: string[] }) {
  return (
    <div className="training-pill-list">
      {items.map((item) => (
        <span key={item} className="training-pill">
          {item}
        </span>
      ))}
    </div>
  );
}

function formatDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function roundValue(value: number): number {
  return Math.round(value);
}

function formatMetricBadge(entry: MetricEntry | null, unit: string): string {
  if (!entry) return "Noch leer";
  return `${entry.value} ${unit}`;
}

function buildFtpZones(value: number): ZoneRow[] {
  const zones = [
    { label: "Z1 Recovery", min: 0, max: 0.55, detail: "Locker rollen und Erholung" },
    { label: "Z2 GA1", min: 0.56, max: 0.75, detail: "Ruhige Grundlage" },
    { label: "Z3 GA2", min: 0.76, max: 0.9, detail: "Zügige Ausdauer" },
    { label: "Z4 Schwelle", min: 0.91, max: 1.05, detail: "Nahe an FTP" },
    { label: "Z5 VO2max", min: 1.06, max: 1.2, detail: "Kurze harte Intervalle" },
    { label: "Z6 Anaerob", min: 1.21, max: 1.5, detail: "Sehr harte Belastungen" },
  ];

  return zones.map((zone) => {
    const minValue = zone.min === 0 ? 0 : roundValue(value * zone.min);
    const maxValue = roundValue(value * zone.max);
    return {
      label: zone.label,
      range: zone.min === 0 ? `bis ${maxValue} W` : `${minValue}-${maxValue} W`,
      detail: zone.detail,
    };
  });
}

function buildHrZones(value: number): ZoneRow[] {
  const zones = [
    { label: "Z1 Recovery", min: 0.5, max: 0.6, detail: "Sehr locker" },
    { label: "Z2 GA1", min: 0.61, max: 0.72, detail: "Ruhige Grundlagenausdauer" },
    { label: "Z3 GA2", min: 0.73, max: 0.82, detail: "Kontrolliert fordernd" },
    { label: "Z4 Schwelle", min: 0.83, max: 0.9, detail: "Schwellennahe Arbeit" },
    { label: "Z5 Hoch", min: 0.91, max: 1, detail: "Maximal und wettkampfnah" },
  ];

  return zones.map((zone) => ({
    label: zone.label,
    range: `${roundValue(value * zone.min)}-${roundValue(value * zone.max)} bpm`,
    detail: zone.detail,
  }));
}

const zoneModelDefinitions: Record<"ftp" | "max_hr", Record<string, ZoneDefinition[]>> = {
  ftp: {
    coggan_classic: [
      { label: "Z1 Active Recovery", min: 0, max: 0.55, detail: "Locker rollen und Erholung" },
      { label: "Z2 Endurance", min: 0.56, max: 0.75, detail: "Ruhige Grundlage" },
    { label: "Z3 Tempo", min: 0.76, max: 0.9, detail: "Zügige Ausdauer" },
      { label: "Z4 Lactate Threshold", min: 0.91, max: 1.05, detail: "Nahe an FTP" },
      { label: "Z5 VO2max", min: 1.06, max: 1.2, detail: "Kurze harte Intervalle" },
      { label: "Z6 Anaerobic Capacity", min: 1.21, max: 1.5, detail: "Sehr harte Belastungen" },
      { label: "Z7 Sprint Open End", min: 1.51, max: null, detail: "Sprint und Spitzenleistung oberhalb von Zone 6" },
    ],
    ftp_6_simplified: [
      { label: "Z1 Recovery", min: 0, max: 0.55, detail: "Sehr locker" },
      { label: "Z2 GA1", min: 0.56, max: 0.75, detail: "Grundlagenausdauer" },
      { label: "Z3 GA2", min: 0.76, max: 0.9, detail: "Tempobereich" },
      { label: "Z4 Schwelle", min: 0.91, max: 1.05, detail: "Schwellennahe Arbeit" },
      { label: "Z5 VO2max", min: 1.06, max: 1.2, detail: "Kurze fordernde Intervalle" },
      { label: "Z6 Anaerob+", min: 1.21, max: 1.5, detail: "Anaerob und sehr hohe Spitzen" },
      { label: "Z7 Sprint Open End", min: 1.51, max: null, detail: "Open End für Sprints oberhalb von Zone 6" },
    ],
    seiler_3_power: [
      { label: "Z1 Niedrig", min: 0, max: 0.84, detail: "Locker bis moderat" },
      { label: "Z2 Mittel", min: 0.85, max: 1, detail: "Schwellennäherer Bereich" },
      { label: "Z3 Hoch", min: 1.01, max: 1.5, detail: "Hohe Intensität oberhalb der Schwelle" },
      { label: "Z4 Sprint Open End", min: 1.51, max: null, detail: "Open End für sehr hohe Spitzenleistungen" },
    ],
  },
  max_hr: {
    max_hr_5_classic: [
      { label: "Z1 Recovery", min: 0.5, max: 0.6, detail: "Sehr locker" },
      { label: "Z2 Grundlage", min: 0.61, max: 0.72, detail: "Ruhige Grundlagenausdauer" },
      { label: "Z3 Tempo", min: 0.73, max: 0.82, detail: "Kontrolliert fordernd" },
      { label: "Z4 Schwelle", min: 0.83, max: 0.9, detail: "Schwellennahe Arbeit" },
      { label: "Z5 Hoch", min: 0.91, max: 1, detail: "Maximal und wettkampfnah" },
    ],
    max_hr_5_even: [
      { label: "Z1 Recovery", min: 0.5, max: 0.6, detail: "Sehr locker" },
      { label: "Z2 Grundlage", min: 0.6, max: 0.7, detail: "Locker aerob" },
      { label: "Z3 Tempo", min: 0.7, max: 0.8, detail: "Stetige Belastung" },
      { label: "Z4 Hart", min: 0.8, max: 0.9, detail: "Deutlich fordernd" },
      { label: "Z5 Maximal", min: 0.9, max: 1, detail: "Sehr hart bis maximal" },
    ],
    max_hr_3_simplified: [
      { label: "Z1 Niedrig", min: 0.5, max: 0.78, detail: "Leicht bis moderat" },
      { label: "Z2 Mittel", min: 0.79, max: 0.88, detail: "Tempo bis Schwelle" },
      { label: "Z3 Hoch", min: 0.89, max: 1, detail: "Hart bis maximal" },
    ],
  },
};

function getZoneDefinitions(metricType: "ftp" | "max_hr", modelKey: string): ZoneDefinition[] {
  return zoneModelDefinitions[metricType][modelKey] ?? [];
}

function formatZoneRange(metricType: "ftp" | "max_hr", baseValue: number, minRatio: number, maxRatio: number | null): string {
  const unit = metricType === "ftp" ? "W" : "bpm";
  const minValue = roundValue(baseValue * minRatio);
  const maxValue = maxRatio === null ? null : roundValue(baseValue * maxRatio);
  if (minRatio === 0 && maxValue !== null) {
    return `bis ${maxValue} ${unit}`;
  }
  if (maxValue === null) {
    return `ab ${minValue} ${unit}`;
  }
  return `${minValue}-${maxValue} ${unit}`;
}

function getEditableUpperBounds(zones: ZoneDefinition[]): number[] {
  return zones.slice(0, -1).map((zone) => zone.max ?? zone.min);
}

function buildEditableZones(
  metricType: "ftp" | "max_hr",
  baseValue: number,
  zoneDefinitions: ZoneDefinition[],
  upperBounds: number[],
  colors: string[],
): EditableZone[] {
  return zoneDefinitions.map((zone, index) => {
    const minRatio = index === 0 ? zone.min : upperBounds[index - 1];
    const maxRatio = index < upperBounds.length ? upperBounds[index] : zone.max;
    const upperDisplayRatio = index < upperBounds.length ? upperBounds[index] : minRatio;
    return {
      label: zone.label,
      detail: zone.detail,
      minRatio,
      maxRatio,
      range: formatZoneRange(metricType, baseValue, minRatio, maxRatio),
      upperDisplayRatio,
      color: colors[index] ?? "#F2EFF7",
    };
  });
}

function getZoneChartDomain(
  metricType: "ftp" | "max_hr",
  zoneDefinitions: ZoneDefinition[],
  upperBounds: number[],
): ZoneChartDomain {
  if (metricType === "max_hr") {
    const min = zoneDefinitions[0]?.min ?? 0.5;
    const finiteMaxima = [
      ...zoneDefinitions.map((zone) => zone.max).filter((value): value is number => value != null),
      ...upperBounds,
    ];
    const max = finiteMaxima.length ? Math.max(...finiteMaxima) : 1;
    return { min, max: max <= min ? min + 0.01 : max };
  }

  if (zoneDefinitions.length && zoneDefinitions[zoneDefinitions.length - 1]?.max === null && upperBounds.length) {
    return { min: 0, max: Number((upperBounds[upperBounds.length - 1] + 0.1).toFixed(4)) };
  }
  const finiteMaxima = [
    ...zoneDefinitions.map((zone) => zone.max).filter((value): value is number => value != null),
    ...upperBounds,
  ];
  const highest = finiteMaxima.length ? Math.max(...finiteMaxima) : 1;
  return { min: 0, max: highest <= 1 ? 1.05 : highest };
}

function ratiosEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => Math.abs(value - right[index]) < 0.0001);
}

function getZoneShortLabel(index: number): string {
  return `Z${index + 1}`;
}

function normalizeHexColor(value: string): string {
  const text = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : "#F2EFF7";
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(color);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function zoneTextColor(color: string): string {
  const { r, g, b } = hexToRgb(color);
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? "#FFFFFF" : "#111111";
}

function zoneBorderColor(color: string): string {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, 0.72)`;
}

function zoneFillColor(color: string, alpha = 0.82): string {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getDefaultZoneColors(metricType: "ftp" | "max_hr", zoneCount: number): string[] {
  const palette = defaultZoneColors[metricType] ?? [];
  if (palette.length >= zoneCount) return palette.slice(0, zoneCount);
  return palette.concat(Array.from({ length: Math.max(0, zoneCount - palette.length) }, () => palette[palette.length - 1] ?? "#F2EFF7"));
}

function normalizeUpperBounds(upperBounds: number[] | undefined, defaults: number[]): number[] {
  return upperBounds && upperBounds.length === defaults.length ? upperBounds : defaults;
}

function normalizeZoneColors(colors: string[] | undefined, defaults: string[]): string[] {
  return colors && colors.length === defaults.length ? colors.map(normalizeHexColor) : defaults;
}

void buildFtpZones;
void buildHrZones;

function ZoneInfoOverlay({
  metricType,
  zoneSetting,
  onClose,
}: {
  metricType: "ftp" | "max_hr";
  zoneSetting: ZoneSetting | null;
  onClose: () => void;
}) {
  const content = zoneInfoContent[metricType];
  const modelNote = zoneSetting ? content.modelNotes[zoneSetting.model_key] : null;

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={`${content.title} Erklärung`}>
      <div className="confirm-card training-overlay-card training-zone-info-overlay">
        <div className="training-overlay-head">
          <div>
            <p className="eyebrow">Zonenmodell</p>
            <h2>{content.title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Overlay schließen">
            x
          </button>
        </div>

        <div className="training-info-stack">
          <p className="lead training-overlay-lead">{content.intro}</p>
          {zoneSetting ? (
            <div className="training-zone-model-note">
              <strong>Aktuell: {zoneSetting.label}</strong>
              <small>{modelNote || zoneSetting.description}</small>
            </div>
          ) : null}
          {content.points.map((point) => (
            <div key={point} className="training-info-point">
              {point}
            </div>
          ))}
          <div className="training-source-list">
            {content.sources.map((source) => (
              <a key={source.href} className="training-source-card" href={source.href} target="_blank" rel="noreferrer">
                <strong>{source.label}</strong>
                <span>{source.note}</span>
              </a>
            ))}
          </div>
        </div>

        <div className="confirm-actions">
          <button className="primary-button" type="button" onClick={onClose}>
            Verstanden
          </button>
        </div>
      </div>
    </div>
  );
}

function ZoneEditOverlay({
  metricType,
  currentValue,
  zone,
  minAllowed,
  maxAllowed,
  canEditUpperBound,
  onClose,
  onSave,
}: {
  metricType: "ftp" | "max_hr";
  currentValue: number;
  zone: EditableZone;
  minAllowed: number;
  maxAllowed: number;
  canEditUpperBound: boolean;
  onClose: () => void;
  onSave: (payload: { upperRatio: number | null; color: string }) => void;
}) {
  const [upperRatio, setUpperRatio] = useState(
    zone.upperDisplayRatio == null ? "" : String(Math.round(zone.upperDisplayRatio * 100)),
  );
  const [color, setColor] = useState(zone.color);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUpperRatio = canEditUpperBound ? Number(upperRatio) / 100 : null;
    onSave({
      upperRatio: canEditUpperBound ? nextUpperRatio : null,
      color: normalizeHexColor(color),
    });
  }

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={`${zone.label} bearbeiten`}>
      <div className="confirm-card training-overlay-card">
        <div className="training-overlay-head">
          <div>
            <p className="eyebrow">Zone bearbeiten</p>
            <h2>{zone.label}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Overlay schliessen">
            x
          </button>
        </div>

        <form className="settings-form settings-form-wide" onSubmit={handleSubmit}>
          {canEditUpperBound ? (
            <label className="settings-label">
              Oberes Ende in Prozent
              <input
                className="settings-input"
                type="number"
                min={Math.ceil(minAllowed * 100)}
                max={Math.floor(maxAllowed * 100)}
                step="1"
                value={upperRatio}
                onChange={(event) => setUpperRatio(event.target.value)}
              />
            </label>
          ) : (
            <div className="training-zone-edit-static">
              <strong>Oberes Ende</strong>
              <span>{metricType === "ftp" ? "200%+ fest für Sprint Open End" : "Open End"}</span>
            </div>
          )}

          <label className="settings-label">
            Farbe
            <div className="training-zone-color-input">
              <input className="training-zone-color-picker" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
              <input className="settings-input" type="text" value={color} onChange={(event) => setColor(event.target.value)} />
            </div>
          </label>

          <p className="training-note">
            Aktuell: {zone.range}
            {zone.upperDisplayRatio != null ? ` | ${Math.round(currentValue * zone.upperDisplayRatio)} ${metricType === "ftp" ? "W" : "bpm"}` : ""}
          </p>

          <div className="confirm-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit">
              Speichern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TrainingZoneChart({
  metricType,
  currentValue,
  zones,
  upperBounds,
  chartDomain,
  onBoundaryChange,
  onDraggingChange,
}: {
  metricType: "ftp" | "max_hr";
  currentValue: number;
  zones: EditableZone[];
  upperBounds: number[];
  chartDomain: ZoneChartDomain;
  onBoundaryChange: (boundaryIndex: number, nextRatio: number) => void;
  onDraggingChange: (isDragging: boolean) => void;
}) {
  const unit = metricType === "ftp" ? "W" : "bpm";
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [draggingBoundary, setDraggingBoundary] = useState<number | null>(null);
  const chartSpan = Math.max(0.01, chartDomain.max - chartDomain.min);

  function moveBoundary(boundaryIndex: number, clientX: number) {
    const chart = chartRef.current;
    if (!chart || currentValue <= 0) return;
    const rect = chart.getBoundingClientRect();
    if (rect.width <= 0) return;
    const previousBoundary = boundaryIndex === 0 ? zones[0]?.minRatio ?? 0 : upperBounds[boundaryIndex - 1];
    const nextBoundary = boundaryIndex === upperBounds.length - 1 ? chartDomain.max : upperBounds[boundaryIndex + 1];
    const relative = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const nextRatio = chartDomain.min + relative * chartSpan;
    const minGap = 0.01;
    const clamped = Math.min(nextBoundary - minGap, Math.max(previousBoundary + minGap, nextRatio));
    onBoundaryChange(boundaryIndex, clamped);
  }

  useEffect(() => {
    onDraggingChange(draggingBoundary != null);
  }, [draggingBoundary, onDraggingChange]);

  useEffect(() => {
    if (draggingBoundary == null) return;
    const activeBoundary = draggingBoundary;

    function handlePointerMove(event: PointerEvent) {
      moveBoundary(activeBoundary, event.clientX);
    }

    function handlePointerUp() {
      setDraggingBoundary(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [chartDomain.max, chartDomain.min, chartSpan, currentValue, draggingBoundary, onBoundaryChange, upperBounds, zones]);

  return (
    <div className="training-zone-chart-block">
        <div ref={chartRef} className="training-zone-chart">
          {zones.map((zone, index) => {
            const start = ((zone.minRatio - chartDomain.min) / chartSpan) * 100;
            const end = (((zone.maxRatio ?? chartDomain.max) - chartDomain.min) / chartSpan) * 100;
            const width = Math.max(0, end - start);
          const upperText =
            zone.upperDisplayRatio == null
              ? ""
              : metricType === "ftp" && index === zones.length - 1
                ? `+${roundValue(zone.minRatio * 100)}%`
                : `${roundValue(zone.upperDisplayRatio * 100)}%`;
          const valueText =
            zone.upperDisplayRatio == null
              ? ""
              : metricType === "ftp" && index === zones.length - 1
                ? `+${roundValue(currentValue * zone.minRatio)} ${unit}`
                : `${roundValue(currentValue * zone.upperDisplayRatio)} ${unit}`;
          return (
              <div
                key={`${zone.label}-${index}`}
                className={`training-zone-segment zone-tone-${index % 7}`}
                style={{ left: `${start}%`, width: `${width}%`, backgroundColor: zoneFillColor(zone.color, 0.82) }}
              >
              <div className="training-zone-segment-content">
                <span className="training-zone-segment-name" style={{ color: zoneTextColor(zone.color) }}>
                  {getZoneShortLabel(index)}
                </span>
                <strong className="training-zone-segment-percent" style={{ color: zoneTextColor(zone.color) }}>
                  {upperText}
                </strong>
                <small className="training-zone-segment-value" style={{ color: zoneTextColor(zone.color) }}>
                  {valueText}
                </small>
              </div>
            </div>
          );
          })}
          {upperBounds.map((boundary, index) => {
            const left = ((boundary - chartDomain.min) / chartSpan) * 100;
            return (
              <div key={`boundary-handle-${index}`} className="training-zone-boundary-control" style={{ left: `${left}%` }}>
              <button
                className="training-zone-boundary-hitbox"
                type="button"
                aria-label={`Grenze zwischen ${getZoneShortLabel(index)} und ${getZoneShortLabel(index + 1)} verschieben`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  setDraggingBoundary(index);
                  moveBoundary(index, event.clientX);
                }}
              >
                <span className="training-zone-boundary-visual" aria-hidden="true">
                  <span className="training-zone-boundary-top" />
                  <span className="training-zone-boundary-line" />
                </span>
              </button>
            </div>
          );
        })}
        </div>
        <div className="training-zone-axis">
          <span>{roundValue(currentValue * chartDomain.min)} {unit}</span>
          <span>{roundValue(currentValue * chartDomain.max)} {unit}</span>
        </div>
      </div>
    );
  }

function MetricInfoOverlay({ config, onClose }: { config: MetricConfig; onClose: () => void }) {
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={`${config.title} Erklärung`}>
      <div className="confirm-card training-overlay-card">
        <div className="training-overlay-head">
          <div>
            <p className="eyebrow">Grunddaten</p>
            <h2>{config.infoTitle}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Overlay schließen">
            x
          </button>
        </div>

        <div className="training-info-stack">
          <p className="lead training-overlay-lead">{config.infoIntro}</p>
          {config.infoPoints.map((point) => (
            <div key={point} className="training-info-point">
              {point}
            </div>
          ))}
        </div>

        <div className="confirm-actions">
          <button className="primary-button" type="button" onClick={onClose}>
            Verstanden
          </button>
        </div>
      </div>
    </div>
  );
}

function TrainingMetricEditor({
  config,
  initialEntry,
  onClose,
  onSave,
}: {
  config: MetricConfig;
  initialEntry?: MetricEntry | null;
  onClose: () => void;
  onSave: (payload: { value: number; recorded_at: string; source: string; notes: string | null }) => Promise<void>;
}) {
  const [value, setValue] = useState(initialEntry ? String(initialEntry.value) : "");
  const [recordedAt, setRecordedAt] = useState(initialEntry?.recorded_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState(initialEntry?.source ?? config.sourceOptions[0] ?? "");
  const [note, setNote] = useState(initialEntry?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0 || !recordedAt.trim() || !source.trim() || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        value: roundValue(numericValue),
        recorded_at: recordedAt,
        source: source.trim(),
        notes: note.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={`${config.title} erfassen`}>
      <div className="confirm-card training-overlay-card">
        <div className="training-overlay-head">
          <div>
            <p className="eyebrow">Grunddaten</p>
            <h2>{initialEntry ? `${config.title} bearbeiten` : `Neuen ${config.title}-Wert erfassen`}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Overlay schließen">
            x
          </button>
        </div>

        <form className="settings-form settings-form-wide" onSubmit={(event) => void handleSubmit(event)}>
          <label className="settings-label">
            Wert in {config.unit}
            <input
              className="settings-input"
              type="number"
              min="1"
              step="1"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={config.key === "ftp" ? "z. B. 286" : "z. B. 188"}
              autoFocus
            />
          </label>

          <label className="settings-label">
            Gültig ab
            <input className="settings-input" type="date" value={recordedAt} onChange={(event) => setRecordedAt(event.target.value)} />
          </label>

          <label className="settings-label">
            Quelle
            <select className="settings-input" value={source} onChange={(event) => setSource(event.target.value)}>
              {config.sourceOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-label">
            Notiz
            <textarea
              className="settings-input training-textarea"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={config.key === "ftp" ? "optional: Test, Rennen, Besonderheiten" : "optional: Aktivität, Test oder manuelle Herleitung"}
              rows={4}
            />
          </label>

          <p className="training-note">{config.helperText}</p>
          {error ? <p className="error-text">{error}</p> : null}

          <div className="confirm-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit" disabled={!value.trim() || !recordedAt.trim() || saving}>
              {saving ? "Speichere..." : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TrainingMetricCard({
  config,
  entries,
  loading,
  error,
  zoneSetting,
  zoneOptions,
  zoneSaving,
  onAdd,
  onEdit,
  onInfo,
  onDelete,
  onZoneChange,
  onZoneCustomize,
}: {
  config: MetricConfig;
  entries: MetricEntry[];
  loading: boolean;
  error: string | null;
  zoneSetting: ZoneSetting | null;
  zoneOptions: ZoneModelOption[];
  zoneSaving: boolean;
  onAdd: () => void;
  onEdit: (entry: MetricEntry) => void;
  onInfo: () => void;
  onDelete: (entry: MetricEntry) => void;
  onZoneChange: (modelKey: string) => void;
  onZoneCustomize: (payload: { custom_upper_bounds: number[]; custom_colors: string[] }) => Promise<void>;
}) {
  const currentEntry = entries[0] ?? null;
  const [showZoneInfo, setShowZoneInfo] = useState(false);
  const [editingZoneIndex, setEditingZoneIndex] = useState<number | null>(null);
  const [isDraggingZoneBoundary, setIsDraggingZoneBoundary] = useState(false);
  const pendingCustomizationRef = useRef<{ custom_upper_bounds: number[]; custom_colors: string[] } | null>(null);
  const zoneDefinitions = useMemo(
    () => (zoneSetting ? getZoneDefinitions(config.apiMetricType, zoneSetting.model_key) : []),
    [config.apiMetricType, zoneSetting],
  );
  const defaultUpperBounds = useMemo(() => getEditableUpperBounds(zoneDefinitions), [zoneDefinitions]);
  const defaultColors = useMemo(() => getDefaultZoneColors(config.apiMetricType, zoneDefinitions.length), [config.apiMetricType, zoneDefinitions.length]);
    const [manualUpperBounds, setManualUpperBounds] = useState<number[]>(
      normalizeUpperBounds(zoneSetting?.custom_upper_bounds, defaultUpperBounds),
    );
    const [manualColors, setManualColors] = useState<string[]>(
      normalizeZoneColors(zoneSetting?.custom_colors, defaultColors),
    );

    useEffect(() => {
      setManualUpperBounds(normalizeUpperBounds(zoneSetting?.custom_upper_bounds, defaultUpperBounds));
      setManualColors(normalizeZoneColors(zoneSetting?.custom_colors, defaultColors));
    }, [defaultColors, defaultUpperBounds, zoneSetting]);

  const zones = useMemo(() => {
    if (!currentEntry || !zoneDefinitions.length) return [];
    return buildEditableZones(config.apiMetricType, currentEntry.value, zoneDefinitions, manualUpperBounds, manualColors);
  }, [config.apiMetricType, currentEntry, manualColors, manualUpperBounds, zoneDefinitions]);
  const chartDomain = useMemo(
    () => getZoneChartDomain(config.apiMetricType, zoneDefinitions, manualUpperBounds),
    [config.apiMetricType, manualUpperBounds, zoneDefinitions],
  );
  const hasManualOverrides = useMemo(() => {
    const colorsChanged = JSON.stringify(manualColors) !== JSON.stringify(defaultColors);
    return !ratiosEqual(manualUpperBounds, defaultUpperBounds) || colorsChanged;
  }, [defaultColors, defaultUpperBounds, manualColors, manualUpperBounds]);

  useEffect(() => {
    if (isDraggingZoneBoundary) return;
    const pendingPayload = pendingCustomizationRef.current;
    if (!pendingPayload) return;
    pendingCustomizationRef.current = null;
    void onZoneCustomize(pendingPayload);
  }, [isDraggingZoneBoundary, onZoneCustomize]);

  function updateUpperBound(boundaryIndex: number, nextValue: number) {
    setManualUpperBounds((current) => {
      const next = current.slice();
      const previousBoundary = boundaryIndex === 0 ? zoneDefinitions[0]?.min ?? 0 : next[boundaryIndex - 1];
        const followingBoundary = boundaryIndex === next.length - 1 ? chartDomain.max : next[boundaryIndex + 1];
      const minGap = 0.01;
      const clamped = Math.min(followingBoundary - minGap, Math.max(previousBoundary + minGap, nextValue));
      next[boundaryIndex] = Number(clamped.toFixed(2));
      pendingCustomizationRef.current = {
        custom_upper_bounds: next,
        custom_colors: manualColors,
      };
      return next;
    });
  }

  function resetToDefault() {
    setManualUpperBounds(defaultUpperBounds);
    setManualColors(defaultColors);
    pendingCustomizationRef.current = null;
    void onZoneCustomize({
      custom_upper_bounds: defaultUpperBounds,
      custom_colors: defaultColors,
    });
  }

  const editingZone = editingZoneIndex != null ? zones[editingZoneIndex] ?? null : null;

  return (
    <article className="card training-metric-card">
      <div className="training-metric-head">
        <div>
          <p className="training-metric-kicker">{config.title}</p>
        </div>
        <div className="training-head-actions">
          <button className="icon-button training-info-button" type="button" title={`${config.shortLabel} erklären`} onClick={onInfo}>
            ?
          </button>
          <button className="icon-button training-add-button" type="button" title={`Neuen ${config.shortLabel}-Wert erfassen`} onClick={onAdd}>
            +
          </button>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {loading ? (
        <div className="training-zones-block">
          <div className="training-empty-state">
            <strong>{config.title} wird geladen...</strong>
          </div>
        </div>
      ) : currentEntry ? (
        <div className="training-zones-block">
          <div className="training-zones-head">
            <div>
              <h3>Zonen</h3>
              <span>{config.shortLabel}</span>
              <div className="training-zone-head-actions">
                <button className="secondary-button training-zone-reset-button" type="button" onClick={resetToDefault} disabled={!hasManualOverrides}>
                  Reset to default
                </button>
              </div>
            </div>
            <label className="training-zone-select-wrap">
              <span className="training-zone-select-label">
                <span>Zonenmodell</span>
                <button
                  className="icon-button training-zone-help-button"
                  type="button"
                  title="Zonenmodelle erklären"
                  aria-label="Zonenmodelle erklären"
                  onClick={() => setShowZoneInfo(true)}
                >
                  ?
                </button>
              </span>
              <div className="training-zone-select-row">
                <select
                  className="settings-input training-zone-select"
                  value={zoneSetting?.model_key ?? ""}
                  onChange={(event) => onZoneChange(event.target.value)}
                  disabled={zoneSaving}
                >
                  {zoneOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                      {option.is_default ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
          {zoneSaving ? (
            <p className="training-note">Zonenmodell wird gespeichert...</p>
          ) : null}
          {currentEntry && zones.length ? (
              <TrainingZoneChart
                metricType={config.apiMetricType}
                currentValue={currentEntry.value}
                zones={zones}
                upperBounds={manualUpperBounds}
                chartDomain={chartDomain}
                onBoundaryChange={updateUpperBound}
                onDraggingChange={setIsDraggingZoneBoundary}
              />
          ) : null}
          <div className="training-zone-list">
            {zones.map((zone, index) => (
                <button
                  key={`${zone.label}-${index}`}
                  className="training-zone-row"
                  type="button"
                  onClick={() => setEditingZoneIndex(index)}
                  style={{
                    backgroundColor: zoneFillColor(zone.color, 0.82),
                    borderColor: zoneBorderColor(zone.color),
                    color: zoneTextColor(zone.color),
                  }}
                >
                <div className="training-zone-row-top">
                  <strong>{zone.label}</strong>
                  <span>{zone.range}</span>
                </div>
                <small>{zone.detail}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="training-zones-block">
          <div className="training-empty-state">
            <strong>{config.emptyText}</strong>
            <span>{config.helperText}</span>
          </div>
        </div>
      )}

      <div className="training-history-block">
        <div className="training-history-head">
          <h3>Eingestellte Werte</h3>
          <span>{entries.length}</span>
        </div>
        {entries.length ? (
          <div className="training-history-list">
            {entries.map((entry, index) => (
              <div key={entry.id} className="training-history-item">
                <div className="training-history-top">
                  <div className="training-history-main">
                    <strong>
                      {entry.value} {config.unit}
                    </strong>
                    {index === 0 ? <span className="training-history-badge">Aktuell</span> : null}
                  </div>
                  <div className="training-history-actions">
                    <button className="secondary-button training-edit-button" type="button" onClick={() => onEdit(entry)}>
                      Bearbeiten
                    </button>
                    <button className="secondary-button training-delete-button" type="button" onClick={() => onDelete(entry)}>
                      Löschen
                    </button>
                  </div>
                </div>
                <div className="training-history-meta">
                  <span>{formatDate(entry.recorded_at)}</span>
                  <span>{entry.source}</span>
                </div>
                {entry.notes ? <p className="training-inline-note">{entry.notes}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="training-note">Sobald Werte erfasst sind, erscheinen sie hier und können direkt bearbeitet werden.</p>
        )}
      </div>

      {showZoneInfo ? <ZoneInfoOverlay metricType={config.apiMetricType} zoneSetting={zoneSetting} onClose={() => setShowZoneInfo(false)} /> : null}
      {editingZoneIndex != null && currentEntry && editingZone ? (
        <ZoneEditOverlay
          metricType={config.apiMetricType}
          currentValue={currentEntry.value}
          zone={editingZone}
          minAllowed={editingZoneIndex === 0 ? editingZone.minRatio : manualUpperBounds[editingZoneIndex - 1] + 0.01}
          maxAllowed={
            editingZoneIndex >= manualUpperBounds.length
              ? chartDomain.max
              : (editingZoneIndex === manualUpperBounds.length - 1 ? chartDomain.max : manualUpperBounds[editingZoneIndex + 1] - 0.01)
          }
          canEditUpperBound={editingZoneIndex < manualUpperBounds.length}
          onClose={() => setEditingZoneIndex(null)}
          onSave={({ upperRatio, color }) => {
            const nextUpperBounds =
              upperRatio != null && editingZoneIndex < manualUpperBounds.length
                ? manualUpperBounds.map((entry, idx) => (idx === editingZoneIndex ? upperRatio : entry))
                : manualUpperBounds;
            const nextColors = manualColors.map((entry, idx) => (idx === editingZoneIndex ? color : entry));
            setManualUpperBounds(nextUpperBounds);
            setManualColors(nextColors);
            void onZoneCustomize({
              custom_upper_bounds: nextUpperBounds,
              custom_colors: nextColors,
            });
            setEditingZoneIndex(null);
          }}
        />
      ) : null}
    </article>
  );
}

export function TrainingBasicsPage() {
  const [ftpEntries, setFtpEntries] = useState<MetricEntry[]>([]);
  const [maxHrEntries, setMaxHrEntries] = useState<MetricEntry[]>([]);
  const [activeMetricTab, setActiveMetricTab] = useState<MetricType>("ftp");
  const [zoneSettings, setZoneSettings] = useState<Partial<Record<"ftp" | "max_hr", ZoneSetting>>>({});
  const [zoneOptions, setZoneOptions] = useState<Partial<Record<"ftp" | "max_hr", ZoneModelOption[]>>>({});
  const [zoneSavingMetric, setZoneSavingMetric] = useState<"ftp" | "max_hr" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorMetric, setEditorMetric] = useState<MetricType | null>(null);
  const [editingEntry, setEditingEntry] = useState<MetricEntry | null>(null);
  const [infoMetric, setInfoMetric] = useState<MetricType | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ metric: MetricType; entry: MetricEntry } | null>(null);

  async function loadMetrics() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/training/metrics`);
      const payload = await parseJsonSafely<TrainingMetricsResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Trainingswerte konnten nicht geladen werden.");
      }
      const body = (payload as TrainingMetricsResponse) || {};
      setFtpEntries([...(body.ftp ?? [])]);
      setMaxHrEntries([...(body.max_hr ?? [])]);
      setZoneSettings(body.zone_settings ?? {});
      setZoneOptions(body.available_zone_models ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trainingswerte konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMetrics();
  }, []);

  function openAdd(metric: MetricType) {
    setEditingEntry(null);
    setEditorMetric(metric);
  }

  function openEdit(metric: MetricType, entry: MetricEntry) {
    setEditingEntry(entry);
    setEditorMetric(metric);
  }

  async function saveMetric(payload: { value: number; recorded_at: string; source: string; notes: string | null }) {
    if (!editorMetric) return;
    const config = metricConfigs[editorMetric];
    const url = editingEntry ? `${API_BASE_URL}/training/metrics/${editingEntry.id}` : `${API_BASE_URL}/training/metrics`;
    const method = editingEntry ? "PATCH" : "POST";
    const response = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metric_type: config.apiMetricType,
        ...payload,
      }),
    });
    const body = await parseJsonSafely<MetricEntry | { detail?: string }>(response);
    if (!response.ok) {
      throw new Error(typeof body === "object" && body && "detail" in body && body.detail ? body.detail : "Speichern fehlgeschlagen.");
    }
    await loadMetrics();
    setEditorMetric(null);
    setEditingEntry(null);
  }

  async function deleteMetric(metric: MetricType, entry: MetricEntry) {
    const response = await apiFetch(`${API_BASE_URL}/training/metrics/${entry.id}`, {
      method: "DELETE",
    });
    const body = await parseJsonSafely<{ detail?: string }>(response);
    if (!response.ok) {
      throw new Error(body?.detail || "Löschen fehlgeschlagen.");
    }
    await loadMetrics();
    setPendingDelete(null);
    if (editorMetric === metric && editingEntry?.id === entry.id) {
      setEditorMetric(null);
      setEditingEntry(null);
    }
  }

  async function saveZoneSetting(metricType: "ftp" | "max_hr", modelKey: string) {
    setZoneSavingMetric(metricType);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/training/zone-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric_type: metricType,
          model_key: modelKey,
        }),
      });
      const body = await parseJsonSafely<ZoneSetting | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof body === "object" && body && "detail" in body && body.detail ? body.detail : "Zonenmodell konnte nicht gespeichert werden.");
      }
      const savedSetting = body as ZoneSetting;
      setZoneSettings((current) => ({
        ...current,
        [metricType]: savedSetting,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Zonenmodell konnte nicht gespeichert werden.");
    } finally {
      setZoneSavingMetric(null);
    }
  }

  async function saveZoneCustomization(
    metricType: "ftp" | "max_hr",
    payload: { custom_upper_bounds: number[]; custom_colors: string[] },
  ) {
    const currentSetting = metricType === "ftp" ? zoneSettings.ftp : zoneSettings.max_hr;
    if (!currentSetting) return;
    setZoneSavingMetric(metricType);
    try {
      const response = await apiFetch(`${API_BASE_URL}/training/zone-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric_type: metricType,
          model_key: currentSetting.model_key,
          config: payload,
        }),
      });
      const body = await parseJsonSafely<ZoneSetting | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof body === "object" && body && "detail" in body && body.detail ? body.detail : "Zone customization konnte nicht gespeichert werden.");
      }
      const savedSetting = body as ZoneSetting;
      setZoneSettings((current) => ({
        ...current,
        [metricType]: savedSetting,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Zone customization konnte nicht gespeichert werden.");
    } finally {
      setZoneSavingMetric(null);
    }
  }

  const activeMetricConfig = metricConfigs[activeMetricTab];
  const activeEntries = activeMetricTab === "ftp" ? ftpEntries : maxHrEntries;
  const activeZoneSetting = activeMetricTab === "ftp" ? zoneSettings.ftp ?? null : zoneSettings.max_hr ?? null;
  const activeZoneOptions = activeMetricTab === "ftp" ? zoneOptions.ftp ?? [] : zoneOptions.max_hr ?? [];
  const activeZoneSaving = zoneSavingMetric === activeMetricConfig.apiMetricType;

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Training</p>
        <h1>Grunddaten</h1>
        <p className="lead">FTP und MaxHF bilden die Basis für Zonen, spätere Trainingspläne und die historische Einordnung deiner Trainings.</p>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="training-metrics-layout">
        <div className="training-metric-tabs" role="tablist" aria-label="Trainingsmetriken">
          <button
            className={`training-metric-tab ${activeMetricTab === "ftp" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeMetricTab === "ftp"}
            onClick={() => setActiveMetricTab("ftp")}
          >
            <strong>FTP</strong>
            <span>{formatMetricBadge(ftpEntries[0] ?? null, metricConfigs.ftp.unit)}</span>
          </button>
          <button
            className={`training-metric-tab ${activeMetricTab === "maxHr" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeMetricTab === "maxHr"}
            onClick={() => setActiveMetricTab("maxHr")}
          >
            <strong>MaxHF</strong>
            <span>{formatMetricBadge(maxHrEntries[0] ?? null, metricConfigs.maxHr.unit)}</span>
          </button>
        </div>
        <TrainingMetricCard
          config={activeMetricConfig}
          entries={activeEntries}
          loading={loading}
          error={null}
          zoneSetting={activeZoneSetting}
          zoneOptions={activeZoneOptions}
          zoneSaving={activeZoneSaving}
          onAdd={() => openAdd(activeMetricTab)}
          onEdit={(entry) => openEdit(activeMetricTab, entry)}
          onInfo={() => setInfoMetric(activeMetricTab)}
          onDelete={(entry) => setPendingDelete({ metric: activeMetricTab, entry })}
          onZoneChange={(modelKey) => void saveZoneSetting(activeMetricConfig.apiMetricType, modelKey)}
          onZoneCustomize={(payload) => saveZoneCustomization(activeMetricConfig.apiMetricType, payload)}
        />
      </div>

      <div className="grid">
        <TrainingSection
          title="Zeitliche Gültigkeit"
          description="Jeder Messpunkt bekommt ein Datum und optional eine Quelle. Der neueste gültige Eintrag wird als aktueller Wert verwendet, ältere Werte bleiben in der Historie sichtbar."
          highlight
        >
          <div className="training-mini-grid">
            <div className="training-mini-card">
              <span>FTP</span>
              <strong>nach Test, Rennen oder Einschätzung</strong>
              <small>wird für Leistungszonen und Intervalle genutzt</small>
            </div>
            <div className="training-mini-card">
              <span>MaxHF</span>
              <strong>manuell oder später automatisch aus Aktivitäten</strong>
              <small>wird für Herzfrequenzzonen genutzt</small>
            </div>
          </div>
        </TrainingSection>
      </div>

      {editorMetric ? (
        <TrainingMetricEditor
          config={metricConfigs[editorMetric]}
          initialEntry={editingEntry}
          onClose={() => {
            setEditorMetric(null);
            setEditingEntry(null);
          }}
          onSave={saveMetric}
        />
      ) : null}

      {infoMetric ? <MetricInfoOverlay config={metricConfigs[infoMetric]} onClose={() => setInfoMetric(null)} /> : null}

      {pendingDelete ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Wert löschen">
          <div className="confirm-card">
            <h2>Wert löschen</h2>
            <p>
              Willst du den Eintrag `{pendingDelete.entry.value} {metricConfigs[pendingDelete.metric].unit}` vom{" "}
              {formatDate(pendingDelete.entry.recorded_at)} wirklich löschen?
            </p>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" onClick={() => setPendingDelete(null)}>
                Abbrechen
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void deleteMetric(pendingDelete.metric, pendingDelete.entry)}
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function TrainingConfigPage() {
  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Training</p>
        <h1>Training Konfiguration</h1>
        <p className="lead">
          Diese Seite wird das Self-Assessment bündeln: Zielbild, verfügbare Tage, sportlicher Hintergrund und gewünschte Trainingslogik führen dann zu passenden Wochenstrukturen.
        </p>
      </div>

      <div className="grid">
        <TrainingSection
          title="Athletenprofil"
          description="Von Gewichtsverlust und gesunder Regelmäßigkeit bis zu ambitioniertem Amateur- und Semiprofi-Kontext sollen mehrere Entwicklungsstufen abbildbar sein."
        >
          <PillList items={athleteProfiles} />
        </TrainingSection>

        <TrainingSection
          title="Ziele und Eventkontext"
          description="Normale Rennen, sehr lange Events oder Triathlon beeinflussen die Wochenlogik unterschiedlich. Diese Entscheidung soll die spätere Planfamilie direkt steuern."
        >
          <PillList items={trainingGoals} />
        </TrainingSection>

        <TrainingSection
          title="Wochenorganisation"
          description="Wichtige Fragen sind Anzahl Trainingstage, mögliche Doppeltage, verfügbare Zeitfenster, Krafttraining sowie welche Tage für Radfahren realistisch frei sind."
        >
          <div className="training-check-grid">
            <div className="training-check-item">2-3 Tage kompakt</div>
            <div className="training-check-item">4 Tage strukturiert</div>
            <div className="training-check-item">5-6 Tage leistungsorientiert</div>
            <div className="training-check-item">Triathlon mit Rad-Prioritäten</div>
          </div>
        </TrainingSection>

        <TrainingSection
          title="Quellenbasierte Setups"
          description="Für jede Konfiguration wollen wir später belastbare Trainings-Setups und Trainingszonen hinterlegen, inklusive verlinkter Quellen aus Forschung, Verbänden oder anerkannten Coaching-Ansätzen."
          highlight
        >
          <p className="training-note">
            Nächster sinnvoller Schritt: Fragenkatalog definieren, Ergebniscluster bilden und dazu eine zitierfähige Referenzbibliothek aufbauen.
          </p>
        </TrainingSection>
      </div>
    </section>
  );
}

export function TrainingPlansPage() {
  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Training</p>
        <h1>Trainingspläne</h1>
        <p className="lead">
          Hier sammeln wir Planfamilien, die aus den Grunddaten und der Konfiguration entstehen. Ziel ist keine Einheitslösung, sondern mehrere gut begründete Wochenmuster je nach Anspruch, Ziel und Verfügbarkeit.
        </p>
      </div>

      <div className="grid">
        <TrainingSection
          title="Trainingszonen"
          description="Die Trainingszonen sind hier als fachlicher Baustein für spätere Planfamilien verankert. In den konkreten Plänen werden wir diese Zonen später mit Quellen und Einheitenmustern verbinden."
          highlight
        >
          <PillList items={trainingZones} />
        </TrainingSection>

        {planFamilies.map((plan) => (
          <TrainingSection key={plan.title} title={plan.title} description={plan.description}>
            <p className="training-note">
              <strong>Typische Zusammensetzung:</strong> {plan.split}
            </p>
          </TrainingSection>
        ))}
      </div>
    </section>
  );
}
