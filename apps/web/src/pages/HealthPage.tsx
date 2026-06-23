import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type MetricKey = "weight_kg" | "fat_ratio_pct" | "fat_mass_kg" | "visceral_fat_index" | "muscle_mass_kg" | "bone_mass_kg" | "hydration_kg";

type UserProfile = {
  current_weight_kg: number | null;
  target_weight_kg: number | null;
  start_weight_kg: number | null;
  goal_start_date: string | null;
  goal_end_date: string | null;
  goal_period_days: number | null;
  date_of_birth: string | null;
  gender: string | null;
  height_cm: number | null;
};

type WeightLog = {
  id: number;
  recorded_at: string;
  weight_kg: number;
  source_type: string;
  source_label: string | null;
  notes: string | null;
  created_at: string;
};

type WithingsStatus = {
  provider: string;
  configured: boolean;
  connected: boolean;
  redirect_uri: string | null;
  scopes: string;
  userid: string | null;
  scope: string | null;
  expires_at: string | null;
};

type WithingsMeasurement = {
  measured_at: string;
  withings_grpid?: number | string | null;
  weight_kg?: number | null;
  fat_ratio_pct?: number | null;
  fat_mass_kg?: number | null;
  visceral_fat_index?: number | null;
  muscle_mass_kg?: number | null;
  bone_mass_kg?: number | null;
  hydration_kg?: number | null;
};

type WithingsBodyPayload = {
  status: string;
  connected: boolean;
  userid: string | null;
  count: number;
  measurements: WithingsMeasurement[];
  weight_import?: { created: number; updated_profile: boolean };
  detail?: string;
};

type ProfilePayload = UserProfile & { detail?: string };
type WeightLogsPayload = { weight_logs: WeightLog[]; detail?: string };

const METRICS: Array<{
  key: MetricKey;
  label: string;
  shortLabel: string;
  unit: string;
  color: string;
  summary: string;
  impact: string;
  range: string;
  note: string;
  bands?: Array<{ label: string; range: string; tone: "green" | "yellow" | "red"; note: string }>;
}> = [
  {
    key: "weight_kg",
    label: "Gewicht",
    shortLabel: "Gewicht",
    unit: "kg",
    color: "#1f8b6f",
    summary: "Die Gesamtmasse auf der Waage. Sie enthält Muskeln, Knochen, Organe, Fett, Wasser, Glykogen und Mageninhalt.",
    impact: "Nützlich als langfristiger Trend, aber allein kein gutes Urteil über Fitness. Ein Plus kann Wasser oder Muskelmasse sein; ein Minus kann Fett, Wasser oder leider auch Magermasse sein.",
    range: "Gewicht wird sinnvoller über Kontext bewertet: Körpergröße/BMI, Taillenumfang, Leistung, Energielevel und Körperzusammensetzung.",
    note: "Täglich schwankend. Salz, Kohlenhydrate, spätes Essen, harte Trainings und Entzündungsreaktionen können 1-2 kg Unterschied machen, ohne dass Fettmasse sich entsprechend verändert.",
  },
  {
    key: "fat_ratio_pct",
    label: "Körperfett",
    shortLabel: "Fett %",
    unit: "%",
    color: "#d8694f",
    summary: "Anteil der Körpermasse, den die Waage als gesamtes Fettgewebe schätzt. Das ist nicht automatisch nur 'schlechtes Fett'. Fett unter der Haut ist anders zu bewerten als Fett im Bauchraum um Organe.",
    impact: "Sehr niedrige Werte können Hormonstatus, Immunsystem und Energieverfügbarkeit belasten. Hohe Werte, vor allem zusammen mit hohem Bauchumfang/viszeralem Fett, erhöhen meist metabolische Risiken.",
    range: "Die Ampel ist eine grobe Orientierung für erwachsene Männer. Für Frauen, Alter und Leistungssport verschieben sich sinnvolle Bereiche deutlich.",
    note: "BIA-Waagen schätzen indirekt über elektrischen Widerstand. Hydration, volle Glykogenspeicher, Training am Vortag, Alkohol und Messzeitpunkt beeinflussen den Wert.",
    bands: [
      { label: "Athletisch/niedrig", range: "ca. 6-13 %", tone: "green", note: "Kann sportlich passend sein, sollte aber mit Energielevel, Libido, Stimmung und Regeneration zusammenpassen." },
      { label: "Fit/normal", range: "ca. 14-20 %", tone: "green", note: "Für viele Männer ein robuster Bereich mit guter Alltagstauglichkeit." },
      { label: "Erhöht", range: "ca. 21-25 %", tone: "yellow", note: "Nicht automatisch problematisch, aber Trend, Bauchumfang und Blutwerte werden wichtiger." },
      { label: "Hoch", range: "> 25 %", tone: "red", note: "Oft mit höherem metabolischem Risiko verbunden, besonders wenn viszerales Fett ebenfalls hoch ist." },
    ],
  },
  {
    key: "fat_mass_kg",
    label: "Fettmasse",
    shortLabel: "Fett kg",
    unit: "kg",
    color: "#c58a31",
    summary: "Absolutes geschätztes Fettgewicht in Kilogramm. Es umfasst subkutanes Fett, viszerales Fett und weitere Fettdepots zusammen.",
    impact: "Hilft zu sehen, ob Gewichtsänderungen eher aus Fettmasse oder fettfreier Masse kommen. Für Gesundheit ist die Verteilung wichtig: viszerales Fett ist kritischer als Fett direkt unter der Haut.",
    range: "Kein universeller guter kg-Bereich ohne Körpergröße, Geschlecht und Zielkontext. Der Prozentwert und der viszerale Index sind dafür meist lesbarer.",
    note: "Wenn Gewicht fällt, Fettmasse aber nicht, war es wahrscheinlich Wasser/Glykogen. Wenn Fettmasse langsam fällt und Muskelmasse stabil bleibt, ist das meist das bessere Signal.",
  },
  {
    key: "visceral_fat_index",
    label: "Viszerales Fett",
    shortLabel: "Viszeral",
    unit: "Index",
    color: "#9b5b3d",
    summary: "Withings liefert hierfür einen Index. Er steht für Fett im Bauchraum um die Organe und ist gesundheitlich relevanter als reines Unterhautfett.",
    impact: "Viszerales Fett ist stoffwechselaktiver und wird stärker mit Insulinresistenz, Fettleber, Entzündungsaktivität und kardiometabolischem Risiko verbunden als Fett direkt unter der Haut.",
    range: "Die exakten Kategorien sind geräte-/herstellerabhängig. In deiner Messreihe liegt der Index aktuell grob um 3.5-4.3; wichtig ist vor allem, ob er langfristig steigt oder fällt.",
    note: "Eine Waage kann viszerales Fett nicht direkt sehen wie CT/MRT. Sie schätzt es aus Bioimpedanz, Gewicht, Körperdaten und Algorithmus. Der Trend ist nützlicher als ein einzelner Wert.",
    bands: [
      { label: "Niedrig", range: "ca. 1-5", tone: "green", note: "Meist unauffällig, wenn Bauchumfang und Blutwerte ebenfalls passen." },
      { label: "Moderat", range: "ca. 6-9", tone: "yellow", note: "Trend beobachten; Schlaf, Ausdauer, Krafttraining und Ernährung werden wichtiger." },
      { label: "Erhöht", range: "ab ca. 10", tone: "red", note: "Kann auf ungünstigere Fettverteilung hinweisen. Bauchumfang und ärztliche Marker geben mehr Sicherheit." },
    ],
  },
  {
    key: "muscle_mass_kg",
    label: "Muskelmasse",
    shortLabel: "Muskel",
    unit: "kg",
    color: "#3574a6",
    summary: "Geschätzte Muskelmasse beziehungsweise magere Weichteilmasse. Bei BIA hängt dieser Wert stark mit Körperwasser zusammen.",
    impact: "Stabile oder steigende Muskelmasse unterstützt Kraft, Grundumsatz, Glukosestoffwechsel, Haltung und sportliche Leistung.",
    range: "Kein einfacher Universalbereich. Sinnvoll sind Trend, Kraftwerte, Trainingsreiz, Proteinversorgung und ob Gewicht/Fett gleichzeitig sinken oder steigen.",
    note: "Nach Kohlenhydraten oder viel Salz kann Muskelmasse scheinbar steigen, weil mehr Wasser in der Muskulatur gespeichert ist. Nach Dehydrierung kann sie scheinbar fallen.",
  },
  {
    key: "bone_mass_kg",
    label: "Knochenmasse",
    shortLabel: "Knochen",
    unit: "kg",
    color: "#6b7280",
    summary: "Eine Waagen-Schätzung der Knochenmineralmasse, nicht dasselbe wie eine medizinische Knochendichtemessung.",
    impact: "Knochengesundheit hängt mit Krafttraining, Sprung-/Stoßbelastung, Vitamin D, Calcium, Energieverfügbarkeit, Alter und Hormonen zusammen.",
    range: "Kurzfristige Änderungen sind selten echte Knochenveränderungen. Für echte Knochendichte ist DXA/ärztliche Diagnostik deutlich aussagekräftiger.",
    note: "Warum kann es variieren? BIA modelliert Knochenmasse aus Körperdaten und elektrischer Leitfähigkeit. Hydration, Fußkontakt, Algorithmus-Updates und veränderte Schätzungen von Muskel/Wasser können den Knochenwert bewegen, obwohl deine Knochen real praktisch gleich geblieben sind.",
  },
  {
    key: "hydration_kg",
    label: "Wasseranteil",
    shortLabel: "Wasser",
    unit: "kg",
    color: "#2f9bb3",
    summary: "Geschätztes Körperwasser in Kilogramm. Dieser Wert ist der wichtigste Kontext für fast alle anderen BIA-Werte.",
    impact: "Hydration beeinflusst Leistung, Kreislauf, Temperaturregulation, Blutvolumen und die Schätzung von Muskel- und Fettmasse.",
    range: "Tageszeit, Salz, Kohlenhydrate, Training, Sauna, Alkohol und Krankheit können kurzfristig stark verschieben.",
    note: "Wenn Wasser deutlich anders ist als sonst, Körperfett/Muskel/Knochen an diesem Tag vorsichtig interpretieren. Trends unter ähnlichen Messbedingungen sind viel besser.",
  },
];


function defaultDateTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultDateFrom(days = 90): string {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueOf(row: WithingsMeasurement, key: MetricKey): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type AnalysisTone = "green" | "yellow" | "red" | "neutral";

type MetricAnalysis = {
  key: string;
  title: string;
  label: string;
  tone: AnalysisTone;
  value: string;
  summary: string;
  details: string[];
};

function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(`${dateOfBirth.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age < 125 ? age : null;
}

function normalizedGender(gender: string | null | undefined): "male" | "female" | null {
  const value = (gender || "").toLowerCase();
  if (["male", "m", "mann", "männlich"].includes(value)) return "male";
  if (["female", "f", "frau", "weiblich"].includes(value)) return "female";
  return null;
}

function bmiFor(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (weightKg == null || heightCm == null || !Number.isFinite(weightKg) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

function toneLabel(tone: AnalysisTone): string {
  if (tone === "green") return "grün";
  if (tone === "yellow") return "gelb";
  if (tone === "red") return "rot";
  return "Info";
}

function bodyFatTone(value: number, gender: "male" | "female" | null, age: number | null): AnalysisTone {
  const older = age != null && age >= 60;
  if (gender === "female") {
    const normalHigh = older ? 34 : 31;
    if (value < 16) return "yellow";
    if (value <= normalHigh) return "green";
    if (value <= normalHigh + 6) return "yellow";
    return "red";
  }
  const normalHigh = older ? 24 : 20;
  if (value < 6) return "yellow";
  if (value <= normalHigh) return "green";
  if (value <= normalHigh + 5) return "yellow";
  return "red";
}

function hydrationTone(hydrationKg: number | null | undefined, weightKg: number | null | undefined, gender: "male" | "female" | null): AnalysisTone {
  if (hydrationKg == null || weightKg == null || weightKg <= 0) return "neutral";
  const pct = (hydrationKg / weightKg) * 100;
  const low = gender === "female" ? 45 : 50;
  const high = gender === "female" ? 60 : 65;
  if (pct >= low && pct <= high) return "green";
  if (pct >= low - 5 && pct <= high + 5) return "yellow";
  return "red";
}

function buildAnalysis(kind: "weight" | "fat" | "visceral" | "muscle", profile: UserProfile | null, latest: WithingsMeasurement | null): MetricAnalysis {
  const gender = normalizedGender(profile?.gender);
  const age = calculateAge(profile?.date_of_birth);
  const weight = latest?.weight_kg ?? profile?.current_weight_kg ?? null;
  const bmi = bmiFor(weight, profile?.height_cm);
  const context = [profile?.height_cm ? `${profile.height_cm.toFixed(0)} cm` : "Größe fehlt", age != null ? `${age} Jahre` : "Alter fehlt", gender === "male" ? "männlich" : gender === "female" ? "weiblich" : "Geschlecht fehlt"].join(" · ");

  if (kind === "weight") {
    let tone: AnalysisTone = "neutral";
    let label = "Kontext fehlt";
    let summary = "Für die Gewichtsanalyse fehlen noch Körpergröße oder Gewicht.";
    if (bmi != null) {
      if (bmi < 18.5) { tone = "yellow"; label = "niedrig"; }
      else if (bmi < 25) { tone = "green"; label = "im Normalbereich"; }
      else if (bmi < 30) { tone = "yellow"; label = "erhöht"; }
      else { tone = "red"; label = "hoch"; }
      summary = `BMI ${bmi.toFixed(1)}: ${label}. Das ist eine grobe Größen-Einordnung; Körperfett, Muskelmasse und Bauchfett erklären die Qualität des Gewichts besser.`;
    }
    return { key: "weight", title: "Gewichtsanalyse", label, tone, value: bmi != null ? `BMI ${bmi.toFixed(1)}` : "BMI fehlt", summary, details: [context, "BMI ist ein Screening-Wert. Bei viel Muskelmasse kann er zu streng wirken; bei wenig Muskelmasse kann er Risiken unterschätzen.", "Kurzfristige Gewichtssprünge sind häufig Wasser, Glykogen, Salz, Verdauungsinhalt oder Trainingsreaktion, nicht Fettzunahme über Nacht."] };
  }

  if (kind === "fat") {
    const fatPct = latest?.fat_ratio_pct ?? null;
    const fatKg = latest?.fat_mass_kg ?? null;
    const tone = fatPct == null ? "neutral" : bodyFatTone(fatPct, gender, age);
    const label = fatPct == null ? "Wert fehlt" : tone === "green" ? "passender Bereich" : tone === "yellow" ? "beobachten" : "erhöht";
    return { key: "fat", title: "Körperfettanalyse", label, tone, value: fatPct == null ? "Fett % fehlt" : `${fatPct.toFixed(1)} %`, summary: fatPct == null ? "Für Körperfett fehlt ein aktueller Withings-Wert." : `Gesamtfett ${fatPct.toFixed(1)} %${fatKg != null ? ` bzw. ${fatKg.toFixed(1)} kg` : ""}: ${label}. Wichtig ist die Trennung: Unterhautfett ist weniger kritisch, viszerales Fett um Organe ist metabolisch relevanter.`, details: [context, "Subkutanes Fett liegt unter der Haut und ist oft eher Energiepuffer. Viszerales Fett liegt im Bauchraum um Organe und steht stärker mit Insulinresistenz, Fettleber und Entzündungsmarkern in Verbindung.", "BIA-Waagen schätzen Körperfett indirekt. Hydration, Messzeitpunkt, Sport, Alkohol, Salz und volle Glykogenspeicher können den Prozentwert sichtbar verschieben."] };
  }

  if (kind === "visceral") {
    const value = latest?.visceral_fat_index ?? null;
    const tone: AnalysisTone = value == null ? "neutral" : value <= 5 ? "green" : value <= 9 ? "yellow" : "red";
    const label = value == null ? "Wert fehlt" : tone === "green" ? "niedrig" : tone === "yellow" ? "moderat" : "erhöht";
    return { key: "visceral", title: "Viszeralfettanalyse", label, tone, value: value == null ? "Index fehlt" : `${value.toFixed(2)} Index`, summary: value == null ? "Für viszerales Fett fehlt ein aktueller Withings-Wert." : `Viszerales Fett liegt aktuell bei ${value.toFixed(2)} und wirkt damit ${label}. Dieser Marker ist für Gesundheit meist wichtiger als Fettmasse allein.`, details: [context, "Der Index steht für Bauch-/Organfett. Ein niedriger Trend passt meist zu besserer metabolischer Ausgangslage, besonders wenn Bauchumfang, Blutdruck und Blutwerte ebenfalls passen.", "Eine Waage misst viszerales Fett nicht direkt wie CT/MRT. Nutze vor allem den Trend und gleiche Messbedingungen."] };
  }

  const muscle = latest?.muscle_mass_kg ?? null;
  const water = latest?.hydration_kg ?? null;
  const tone = hydrationTone(water, weight, gender);
  const hydrationPct = water != null && weight != null && weight > 0 ? (water / weight) * 100 : null;
  const label = tone === "green" ? "plausibel" : tone === "yellow" ? "schwankt" : tone === "red" ? "auffällig" : "Trendwert";
  return { key: "muscle", title: "Muskel- und Wasseranalyse", label, tone, value: muscle == null ? "Muskelwert fehlt" : `${muscle.toFixed(1)} kg`, summary: `Muskelmasse ${muscle == null ? "-" : `${muscle.toFixed(1)} kg`}, Wasser ${water == null ? "-" : `${water.toFixed(1)} kg`}${hydrationPct != null ? ` (${hydrationPct.toFixed(0)} %)` : ""}. Die Ampel bewertet hier vor allem, ob der Wasseranteil plausibel wirkt.`, details: [context, "Muskelmasse aus BIA ist stark wasserabhängig. Nach Kohlenhydraten, Salz oder hartem Training kann sie scheinbar steigen; nach Dehydrierung scheinbar fallen.", "Knochenmasse kann auf der Waage ebenfalls schwanken, obwohl Knochen sich kurzfristig kaum verändern. Der Wert wird modelliert und reagiert auf Hydration, Fußkontakt und Algorithmusannahmen."] };
}


function formatMetric(value: number | null | undefined, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const digits = unit === "%" ? 1 : value < 10 ? 2 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

function formatWeight(value: number | null | undefined): string {
  return formatMetric(value, "kg");
}

function formatDelta(value: number | null): string {
  if (value == null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} kg`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function dateInRange(value: string, fromDate: string, toDate: string): boolean {
  const day = value.slice(0, 10);
  return (!fromDate || day >= fromDate) && (!toDate || day <= toDate);
}

function rangeLabel(rows: Array<{ measured_at?: string; date?: string }>): string {
  if (!rows.length) return "Keine Daten im Zeitraum";
  const dates = rows.map((row) => (row.measured_at || row.date || "").slice(0, 10)).filter(Boolean).sort();
  return `${formatDate(dates[0])} bis ${formatDate(dates[dates.length - 1])}`;
}

function buildDateTicks(values: string[], width: number, maxTicks = 6): Array<{ x: number; label: string }> {
  const times = values
    .map((value) => new Date(value.length <= 10 ? `${value.slice(0, 10)}T12:00:00` : value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!times.length) return [];
  const min = times[0];
  const max = times[times.length - 1];
  const span = Math.max(1, max - min);
  const count = Math.min(maxTicks, Math.max(2, times.length));
  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0 : index / (count - 1);
    const time = min + span * ratio;
    return { x: ratio * width, label: formatDate(new Date(time).toISOString().slice(0, 10)) };
  });
}


type WithingsChartSelection = {
  metric: (typeof METRICS)[number];
  row: WithingsMeasurement;
  value: number;
  x: number;
  y: number;
};

type ChartScale = {
  min: number;
  max: number;
  span: number;
  minTime: number;
  timeSpan: number;
};

function chartScale(points: Array<{ time: number; value: number }>): ChartScale | null {
  if (!points.length) return null;
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const minTime = Math.min(...points.map((point) => point.time));
  const maxTime = Math.max(...points.map((point) => point.time));
  return { min, max, span: Math.max(0.1, max - min), minTime, timeSpan: Math.max(1, maxTime - minTime) };
}

function chartY(value: number, scale: ChartScale, height: number): number {
  return height - ((value - scale.min) / scale.span) * height;
}

function withingsSeriesPoints(rows: WithingsMeasurement[], key: MetricKey, width: number, height: number) {
  const points = rows
    .map((row) => ({ row, time: new Date(row.measured_at).getTime(), value: valueOf(row, key) }))
    .filter((point): point is { row: WithingsMeasurement; time: number; value: number } => Number.isFinite(point.time) && point.value != null)
    .sort((a, b) => a.time - b.time);
  const scale = chartScale(points);
  if (!scale) return [];
  return points.map((point) => ({
    ...point,
    x: ((point.time - scale.minTime) / scale.timeSpan) * width,
    y: chartY(point.value, scale, height),
  }));
}

function withingsMetricScale(rows: WithingsMeasurement[], key: MetricKey): ChartScale | null {
  const points = rows
    .map((row) => ({ time: new Date(row.measured_at).getTime(), value: valueOf(row, key) }))
    .filter((point): point is { time: number; value: number } => Number.isFinite(point.time) && point.value != null);
  return chartScale(points);
}

function buildMetricPath(rows: WithingsMeasurement[], key: MetricKey, width: number, height: number): string {
  const points = withingsSeriesPoints(rows, key, width, height);
  if (points.length < 2) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function formatAxisValue(value: number, unit: string): string {
  if (unit === "%") return `${value.toFixed(1)} %`;
  if (unit === "kg") return `${value.toFixed(1)} kg`;
  if (unit === "Index") return `${value.toFixed(1)}`;
  return value.toFixed(value < 10 ? 1 : 0);
}

function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6v5h-5" />
      <path d="M19 11a7 7 0 1 0-2 5" />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.5 2.5 0 0 1 4.4 1.6c0 1.8-2.2 2.1-2.2 3.7" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

function BodyCompositionGraphic({ metric }: { metric: (typeof METRICS)[number] }) {
  return (
    <svg className="health-composition-graphic" viewBox="0 0 220 150" role="img" aria-label={`${metric.label} schematisch`}>
      <rect x="20" y="18" width="180" height="114" rx="8" />
      <circle cx="70" cy="75" r="34" className="health-graphic-soft" />
      <circle cx="70" cy="75" r="22" style={{ fill: metric.color }} />
      <path d="M122 105c18-36 28-61 43-61 11 0 20 13 20 30s-9 31-20 31c-8 0-14-7-20-18-5 10-12 18-23 18z" className="health-graphic-body" />
      <path d="M40 122c27-16 62-16 89 0" style={{ stroke: metric.color }} />
      <text x="70" y="80" textAnchor="middle">{metric.shortLabel}</text>
    </svg>
  );
}

function WithingsChart({ rows, visibleKeys }: { rows: WithingsMeasurement[]; visibleKeys: MetricKey[] }) {
  const width = 1180;
  const height = 380;
  const plotLeft = 78;
  const plotTop = 28;
  const plotWidth = width - 118;
  const plotHeight = height - 92;
  const activeMetrics = METRICS.filter((metric) => visibleKeys.includes(metric.key));
  const primaryMetric = activeMetrics[0] ?? METRICS[0];
  const primaryScale = withingsMetricScale(rows, primaryMetric.key);
  const yTicks = primaryScale ? [0, 1, 2, 3, 4].map((tick) => primaryScale.max - (tick / 4) * primaryScale.span) : [];
  const dateTicks = buildDateTicks(rows.map((row) => row.measured_at), plotWidth);
  const [selected, setSelected] = useState<WithingsChartSelection | null>(null);

  useEffect(() => {
    if (selected && !visibleKeys.includes(selected.metric.key)) setSelected(null);
  }, [selected, visibleKeys]);

  function selectPoint(metric: (typeof METRICS)[number], point: ReturnType<typeof withingsSeriesPoints>[number]) {
    setSelected({ metric, row: point.row, value: point.value, x: point.x, y: point.y });
  }

  return (
    <div className="health-weight-chart health-weight-chart-wide" aria-label="Withings Verlauf">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Entwicklung der Withings Messwerte">
        <rect x="0" y="0" width={width} height={height} rx="8" />
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = plotTop + (tick / 4) * plotHeight;
          return <line key={tick} x1={plotLeft} x2={plotLeft + plotWidth} y1={y} y2={y} className="health-chart-grid" />;
        })}
        <line x1={plotLeft} x2={plotLeft + plotWidth} y1={plotTop + plotHeight} y2={plotTop + plotHeight} className="health-chart-axis" />
        <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotTop + plotHeight} className="health-chart-axis" />
        {yTicks.map((value, index) => (
          <text key={`${primaryMetric.key}-${index}`} x={plotLeft - 12} y={plotTop + (index / 4) * plotHeight + 4} textAnchor="end" className="health-chart-axis-label">
            {formatAxisValue(value, primaryMetric.unit)}
          </text>
        ))}
        <text x={plotLeft} y={18} className="health-chart-unit-label">{primaryMetric.label} ({primaryMetric.unit})</text>
        {dateTicks.map((tick) => (
          <g key={`${tick.x}-${tick.label}`}>
            <line x1={plotLeft + tick.x} x2={plotLeft + tick.x} y1={plotTop + plotHeight} y2={plotTop + plotHeight + 6} className="health-chart-axis" />
            <text x={plotLeft + tick.x} y={plotTop + plotHeight + 30} textAnchor="middle" className="health-chart-date-label">{tick.label}</text>
          </g>
        ))}
        {activeMetrics.length && rows.length >= 2 ? (
          <g transform={`translate(${plotLeft}, ${plotTop})`}>
            {activeMetrics.map((metric) => {
              const path = buildMetricPath(rows, metric.key, plotWidth, plotHeight);
              const points = withingsSeriesPoints(rows, metric.key, plotWidth, plotHeight);
              return (
                <g key={metric.key}>
                  {path ? <path d={path} className="health-weight-line" style={{ stroke: metric.color }} /> : null}
                  {points.map((point) => {
                    const isSelected = selected?.metric.key === metric.key && selected.row.measured_at === point.row.measured_at;
                    return (
                      <g key={`${metric.key}-${point.row.measured_at}`}>
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r="11"
                          className="health-chart-point-hit"
                          tabIndex={0}
                          role="button"
                          aria-label={`${metric.label} am ${formatDateTime(point.row.measured_at)}: ${formatMetric(point.value, metric.unit)}`}
                          onClick={() => selectPoint(metric, point)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") selectPoint(metric, point); }}
                        />
                        <circle cx={point.x} cy={point.y} r={isSelected ? 5.5 : 3.5} className="health-chart-point" style={{ fill: metric.color, stroke: isSelected ? "#173530" : "#ffffff" }} />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        ) : (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="health-chart-empty">Noch zu wenig Messpunkte</text>
        )}
      </svg>
      {selected ? (
        <div className="health-chart-selection" role="status" aria-live="polite">
          <span style={{ backgroundColor: selected.metric.color }} />
          <strong>{selected.metric.label}: {formatMetric(selected.value, selected.metric.unit)}</strong>
          <small>{formatDateTime(selected.row.measured_at)}</small>
        </div>
      ) : null}
    </div>
  );
}


export function HealthPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [withingsStatus, setWithingsStatus] = useState<WithingsStatus | null>(null);
  const [withingsRows, setWithingsRows] = useState<WithingsMeasurement[]>([]);
  const [visibleMetrics, setVisibleMetrics] = useState<Record<MetricKey, boolean>>({
    weight_kg: true,
    fat_ratio_pct: true,
    fat_mass_kg: true,
    visceral_fat_index: true,
    muscle_mass_kg: true,
    bone_mass_kg: false,
    hydration_kg: false,
  });
  const [helpMetric, setHelpMetric] = useState<(typeof METRICS)[number] | null>(null);
  const [analysisOverlay, setAnalysisOverlay] = useState<MetricAnalysis | null>(null);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom(90));
  const [dateTo, setDateTo] = useState(defaultDateTo());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [currentWeight, setCurrentWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [startWeight, setStartWeight] = useState("");
  const [goalStartDate, setGoalStartDate] = useState("");
  const [goalEndDate, setGoalEndDate] = useState("");
  const [logWeight, setLogWeight] = useState("");
  const [logDate, setLogDate] = useState("");
  const [logNotes, setLogNotes] = useState("");

  const filteredWithingsRows = useMemo(() => withingsRows.filter((row) => dateInRange(row.measured_at, dateFrom, dateTo)), [withingsRows, dateFrom, dateTo]);
  const latestWithings = filteredWithingsRows[0] ?? withingsRows[0] ?? null;
  const latestLog = weightLogs[0] ?? null;
  const startDelta = profile?.current_weight_kg != null && profile.start_weight_kg != null ? profile.current_weight_kg - profile.start_weight_kg : null;
  const targetDelta = profile?.current_weight_kg != null && profile.target_weight_kg != null ? profile.current_weight_kg - profile.target_weight_kg : null;
  const selectedMetricKeys = useMemo(() => METRICS.filter((metric) => visibleMetrics[metric.key]).map((metric) => metric.key), [visibleMetrics]);
  const recentWithingsRows = useMemo(() => filteredWithingsRows.slice(0, 80), [filteredWithingsRows]);
  const topAnalyses = useMemo(() => ({
    weight: buildAnalysis("weight", profile, latestWithings),
    fat: buildAnalysis("fat", profile, latestWithings),
    visceral: buildAnalysis("visceral", profile, latestWithings),
    muscle: buildAnalysis("muscle", profile, latestWithings),
  }), [profile, latestWithings]);

  async function loadHealth({ pageLoading = false } = {}) {
    if (pageLoading) setLoading(true);
    setError(null);
    try {
      const [profileRes, logsRes, withingsRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/profile`),
        apiFetch(`${API_BASE_URL}/profile/weight-logs?limit=500`),
        apiFetch(`${API_BASE_URL}/withings/status`),
      ]);
      const profileBody = await parseJsonSafely<ProfilePayload>(profileRes);
      const logsBody = await parseJsonSafely<WeightLogsPayload>(logsRes);
      const withingsBody = await parseJsonSafely<(WithingsStatus & { detail?: string })>(withingsRes);
      if (!profileRes.ok) throw new Error(profileBody?.detail || "Profil konnte nicht geladen werden.");
      if (!logsRes.ok) throw new Error(logsBody?.detail || "Gewichtsverlauf konnte nicht geladen werden.");
      if (!withingsRes.ok) throw new Error(withingsBody?.detail || "Withings-Status konnte nicht geladen werden.");
      const nextProfile = profileBody as UserProfile;
      const nextStatus = withingsBody as WithingsStatus;
      setProfile(nextProfile);
      setCurrentWeight(nextProfile.current_weight_kg == null ? "" : String(nextProfile.current_weight_kg));
      setTargetWeight(nextProfile.target_weight_kg == null ? "" : String(nextProfile.target_weight_kg));
      setStartWeight(nextProfile.start_weight_kg == null ? "" : String(nextProfile.start_weight_kg));
      setGoalStartDate(toLocalInputValue(nextProfile.goal_start_date));
      setGoalEndDate(toLocalInputValue(nextProfile.goal_end_date));
      setWeightLogs((logsBody?.weight_logs ?? []).slice());
      setWithingsStatus(nextStatus);

      if (nextStatus.connected) {
        const measuresRes = await apiFetch(`${API_BASE_URL}/withings/body-measures?limit=5000`);
        const measuresBody = await parseJsonSafely<WithingsBodyPayload>(measuresRes);
        if (!measuresRes.ok) throw new Error(measuresBody?.detail || "Withings-Daten konnten nicht geladen werden.");
        setWithingsRows(measuresBody?.measurements ?? []);
      } else {
        setWithingsRows([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function applyHealthRange() {
    if (applying || syncing) return;
    setApplying(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/withings/sync-weight?limit=5000`, { method: "POST" });
      const payload = await parseJsonSafely<WithingsBodyPayload>(response);
      if (!response.ok) throw new Error(payload?.detail || "Withings-Daten konnten nicht aktualisiert werden.");
      setWithingsRows(payload?.measurements ?? []);
      setMessage(`Withings synchronisiert: ${payload?.count ?? 0} Messpunkte geladen, ${payload?.weight_import?.created ?? 0} Gewichtseinträge neu übernommen.`);
      await loadHealth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setApplying(false);
    }
  }

  async function syncWithings() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/withings/sync-weight?limit=5000`, { method: "POST" });
      const payload = await parseJsonSafely<WithingsBodyPayload>(response);
      if (!response.ok) throw new Error(payload?.detail || "Withings-Daten konnten nicht aktualisiert werden.");
      setWithingsRows(payload?.measurements ?? []);
      setMessage(`Withings aktualisiert: ${payload?.count ?? 0} Messpunkte geladen, ${payload?.weight_import?.created ?? 0} Gewichtseinträge neu übernommen.`);
      await loadHealth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSyncing(false);
    }
  }


  async function saveTargets(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_weight_kg: toNumberOrNull(currentWeight),
          target_weight_kg: toNumberOrNull(targetWeight),
          start_weight_kg: toNumberOrNull(startWeight),
          goal_start_date: goalStartDate || null,
          goal_end_date: goalEndDate || null,
        }),
      });
      const payload = await parseJsonSafely<ProfilePayload>(response);
      if (!response.ok) throw new Error(payload?.detail || "Gewichtsziel konnte nicht gespeichert werden.");
      setMessage("Gewichtsziel gespeichert.");
      await loadHealth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function addWeightLog(event: FormEvent) {
    event.preventDefault();
    const parsedWeight = Number(logWeight);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      setError("Bitte ein gültiges Gewicht eingeben.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/profile/weight-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recorded_at: logDate || null,
          weight_kg: parsedWeight,
          notes: logNotes.trim() || null,
          source_type: "manual",
        }),
      });
      const payload = await parseJsonSafely<WeightLog & { detail?: string }>(response);
      if (!response.ok) throw new Error(payload?.detail || "Gewichtseintrag konnte nicht gespeichert werden.");
      setLogWeight("");
      setLogDate("");
      setLogNotes("");
      setMessage("Gewichtseintrag gespeichert.");
      await loadHealth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  }


  function applyDateWindow(days: number | "all") {
    if (days === "all") {
      const allDates = withingsRows.map((row) => row.measured_at.slice(0, 10)).filter(Boolean).sort();
      if (allDates.length) {
        setDateFrom(allDates[0]);
        setDateTo(allDates[allDates.length - 1]);
      }
      return;
    }
    setDateFrom(defaultDateFrom(days));
    setDateTo(defaultDateTo());
  }

  useEffect(() => {
    void loadHealth({ pageLoading: true });
  }, []);

  return (
    <section className="page health-page health-page-visual">
      <div className="hero health-hero">
        <div>
          <p className="eyebrow">Gesundheit</p>
          <h1>Gewicht & Körperanalyse</h1>
          <p className="lead">Withings-Körperdaten, Gewicht und Körperzusammensetzung im Verlauf.</p>
        </div>
        <div className="health-top-actions">
          <span className={`health-connected-marker ${withingsStatus?.connected ? "connected" : ""}`}>{withingsStatus?.connected ? "Withings verbunden" : "Withings nicht verbunden"}</span>
          <button className="icon-button health-refresh-button" type="button" onClick={() => void syncWithings()} disabled={syncing || !withingsStatus?.connected} aria-label="Withings Daten aktualisieren" title="Withings Daten aktualisieren"><IconRefresh /></button>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="info-text">{message}</p> : null}
      {loading ? <p>Gesundheitsdaten werden geladen...</p> : null}
      {loading || syncing || applying ? (
        <div className="health-loading-overlay" role="status" aria-live="polite" aria-label="Gesundheitsdaten werden geladen">
          <div className="health-loading-card">
            <div className="waiting-spinner" aria-hidden="true" />
            <strong>{syncing || applying ? "Withings wird synchronisiert" : "Gesundheitsdaten werden geladen"}</strong>
            <span>{syncing || applying ? "Körperwerte werden von Withings geholt und in der Datenbank gespeichert." : "Gespeicherte Werte werden aus der Datenbank geladen."}</span>
          </div>
        </div>
      ) : null}

      <article className="card health-filter-card">
        <div className="health-filter-row">
          <div>
            <strong>Zeitraum</strong>
            <span>{rangeLabel(filteredWithingsRows.map((row) => ({ measured_at: row.measured_at })))} · {filteredWithingsRows.length} Withings-Messpunkte</span>
          </div>
          <div className="health-date-controls">
            <button type="button" className="secondary-button" onClick={() => applyDateWindow(30)}>30 Tage</button>
            <button type="button" className="secondary-button" onClick={() => applyDateWindow(90)}>90 Tage</button>
            <button type="button" className="secondary-button" onClick={() => applyDateWindow("all")}>Alles</button>
            <label>Von<input className="settings-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label>Bis<input className="settings-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
            <button type="button" className="primary-button" onClick={() => void applyHealthRange()} disabled={applying || syncing}>Anwenden</button>
          </div>
        </div>
        <div className="health-timeline" aria-label="Datenzeitraum">
          <span>{formatDate(dateFrom)}</span>
          <div><i /></div>
          <span>{formatDate(dateTo)}</span>
        </div>
      </article>

      <div className="health-metric-grid">
        <article className="health-metric-card"><div className="health-metric-card-top"><span>Aktuell</span><button className={`health-analysis-marker ${topAnalyses.weight.tone}`} type="button" onClick={() => setAnalysisOverlay(topAnalyses.weight)} onMouseEnter={() => setAnalysisOverlay(topAnalyses.weight)} onFocus={() => setAnalysisOverlay(topAnalyses.weight)} aria-label="Gewichtsanalyse anzeigen">{toneLabel(topAnalyses.weight.tone)}</button></div><strong>{formatWeight(latestWithings?.weight_kg ?? profile?.current_weight_kg)}</strong><small>{latestWithings ? `Withings ${formatDateTime(latestWithings.measured_at)}` : latestLog ? `Messpunkt ${formatDateTime(latestLog.recorded_at)}` : "Kein Messpunkt"}</small></article>
        <article className="health-metric-card"><div className="health-metric-card-top"><span>Körperfett</span><button className={`health-analysis-marker ${topAnalyses.fat.tone}`} type="button" onClick={() => setAnalysisOverlay(topAnalyses.fat)} onMouseEnter={() => setAnalysisOverlay(topAnalyses.fat)} onFocus={() => setAnalysisOverlay(topAnalyses.fat)} aria-label="Körperfettanalyse anzeigen">{toneLabel(topAnalyses.fat.tone)}</button></div><strong>{formatMetric(latestWithings?.fat_ratio_pct, "%")}</strong><small>{formatMetric(latestWithings?.fat_mass_kg, "kg")} Fettmasse</small></article>
        <article className="health-metric-card"><div className="health-metric-card-top"><span>Viszerales Fett</span><button className={`health-analysis-marker ${topAnalyses.visceral.tone}`} type="button" onClick={() => setAnalysisOverlay(topAnalyses.visceral)} onMouseEnter={() => setAnalysisOverlay(topAnalyses.visceral)} onFocus={() => setAnalysisOverlay(topAnalyses.visceral)} aria-label="Viszeralfettanalyse anzeigen">{toneLabel(topAnalyses.visceral.tone)}</button></div><strong>{formatMetric(latestWithings?.visceral_fat_index, "Index")}</strong><small>Organ-/Bauchfett Index</small></article>
        <article className="health-metric-card"><div className="health-metric-card-top"><span>Muskel / Wasser</span><button className={`health-analysis-marker ${topAnalyses.muscle.tone}`} type="button" onClick={() => setAnalysisOverlay(topAnalyses.muscle)} onMouseEnter={() => setAnalysisOverlay(topAnalyses.muscle)} onFocus={() => setAnalysisOverlay(topAnalyses.muscle)} aria-label="Muskel- und Wasseranalyse anzeigen">{toneLabel(topAnalyses.muscle.tone)}</button></div><strong>{formatMetric(latestWithings?.muscle_mass_kg, "kg")}</strong><small>{formatMetric(latestWithings?.hydration_kg, "kg")} Wasser</small></article>
      </div>

      <article className="card health-chart-card health-wide-card">
        <div className="section-title-row"><h2>Withings Entwicklung</h2><small>{rangeLabel(filteredWithingsRows.map((row) => ({ measured_at: row.measured_at })))} </small></div>
        <div className="health-chart-with-controls">
          <WithingsChart rows={filteredWithingsRows} visibleKeys={selectedMetricKeys} />
          <div className="health-metric-toggle-column" role="group" aria-label="Withings Messwerte auswählen">
            {METRICS.map((metric) => {
              const active = visibleMetrics[metric.key];
              return (
                <label className={`health-metric-toggle-vertical ${active ? "active" : ""}`} key={metric.key} style={{ borderColor: active ? metric.color : undefined }}>
                  <input type="checkbox" checked={active} onChange={(event) => setVisibleMetrics((prev) => ({ ...prev, [metric.key]: event.target.checked }))} />
                  <span style={{ backgroundColor: metric.color }} />
                  <strong>{metric.shortLabel}</strong>
                  <small>{formatMetric(latestWithings ? valueOf(latestWithings, metric.key) : null, metric.unit)}</small>
                  <button className="health-help-button" type="button" onClick={(event) => { event.preventDefault(); setHelpMetric(metric); }} aria-label={`${metric.label} erklären`} title={`${metric.label} erklären`}><IconHelp /></button>
                </label>
              );
            })}
          </div>
        </div>
      </article>

      <div className="health-layout">
        <div className="health-main-stack">
          <article className="card">
            <div className="section-title-row"><h2>Withings Tabelle</h2><small>{recentWithingsRows.length ? `${recentWithingsRows.length} von ${filteredWithingsRows.length} Zeilen im Zeitraum` : "Keine Daten"}</small></div>
            <div className="health-table-wrap"><table className="health-table"><thead><tr><th>Zeitpunkt</th>{METRICS.filter((metric) => visibleMetrics[metric.key]).map((metric) => <th key={metric.key}>{metric.label}</th>)}</tr></thead><tbody>{recentWithingsRows.length === 0 ? <tr><td colSpan={selectedMetricKeys.length + 1}>Noch keine Withings-Daten im Zeitraum.</td></tr> : recentWithingsRows.map((row) => <tr key={`${row.measured_at}-${row.withings_grpid ?? "manual"}`}><td>{formatDateTime(row.measured_at)}</td>{METRICS.filter((metric) => visibleMetrics[metric.key]).map((metric) => <td key={metric.key}>{formatMetric(valueOf(row, metric.key), metric.unit)}</td>)}</tr>)}</tbody></table></div>
          </article>
        </div>

        <aside className="health-side-stack">
          <article className="health-source-card"><strong>Withings</strong><span>{withingsStatus?.connected ? `Verbunden${withingsStatus.userid ? ` mit User ${withingsStatus.userid}` : ""}` : "Noch nicht verbunden"}</span><span>{withingsStatus?.expires_at ? `Token bis ${formatDateTime(withingsStatus.expires_at)}` : "Verbindung im Setup verwalten"}</span></article>
          <article className="card"><div className="section-title-row"><h2>Zielrahmen</h2></div><form className="health-form" onSubmit={(event) => void saveTargets(event)}><label className="settings-label">Aktuelles Gewicht (kg)<input className="settings-input" type="number" step="0.1" value={currentWeight} onChange={(event) => setCurrentWeight(event.target.value)} /></label><label className="settings-label">Zielgewicht (kg)<input className="settings-input" type="number" step="0.1" value={targetWeight} onChange={(event) => setTargetWeight(event.target.value)} /></label><label className="settings-label">Startgewicht (kg)<input className="settings-input" type="number" step="0.1" value={startWeight} onChange={(event) => setStartWeight(event.target.value)} /></label><label className="settings-label">Ziel-Start<input className="settings-input" type="datetime-local" value={goalStartDate} onChange={(event) => setGoalStartDate(event.target.value)} /></label><label className="settings-label">Ziel-Ende<input className="settings-input" type="datetime-local" value={goalEndDate} onChange={(event) => setGoalEndDate(event.target.value)} /></label><button className="primary-button" type="submit" disabled={saving}>{saving ? "Speichere..." : "Ziel speichern"}</button><p className="nutrition-notes">Bis Ziel: {formatDelta(targetDelta)} · Seit Start: {formatDelta(startDelta)}</p></form></article>
          <article className="card"><div className="section-title-row"><h2>Manueller Messpunkt</h2></div><form className="health-form" onSubmit={(event) => void addWeightLog(event)}><label className="settings-label">Gewicht (kg)<input className="settings-input" type="number" step="0.1" value={logWeight} onChange={(event) => setLogWeight(event.target.value)} required /></label><label className="settings-label">Zeitpunkt<input className="settings-input" type="datetime-local" value={logDate} onChange={(event) => setLogDate(event.target.value)} /></label><label className="settings-label">Notiz<input className="settings-input" value={logNotes} onChange={(event) => setLogNotes(event.target.value)} placeholder="optional" /></label><button className="primary-button" type="submit" disabled={saving}>Gewicht eintragen</button></form></article>
        </aside>
      </div>

      {analysisOverlay ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={`${analysisOverlay.title}`} onClick={() => setAnalysisOverlay(null)}>
          <div className="confirm-dialog health-analysis-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Analyse</p>
                <h2>{analysisOverlay.title}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setAnalysisOverlay(null)} aria-label="Analyse schließen">×</button>
            </div>
            <div className={`health-analysis-banner ${analysisOverlay.tone}`}>
              <span>{toneLabel(analysisOverlay.tone)}</span>
              <strong>{analysisOverlay.value}</strong>
              <small>{analysisOverlay.label}</small>
            </div>
            <p>{analysisOverlay.summary}</p>
            <div className="health-analysis-list">
              {analysisOverlay.details.map((detail) => <article key={detail}>{detail}</article>)}
            </div>
            <p className="nutrition-notes">Orientierung anhand deiner Profilwerte. Das ersetzt keine medizinische Diagnose; bei auffälligen Trends sind Bauchumfang, Blutdruck, Laborwerte und ärztliche Einordnung aussagekräftiger.</p>
          </div>
        </div>
      ) : null}

      {helpMetric ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={`${helpMetric.label} Erklärung`} onClick={() => setHelpMetric(null)}>
          <div className="confirm-dialog health-help-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>{helpMetric.label}</h2>
              <button className="icon-button" type="button" onClick={() => setHelpMetric(null)} aria-label="Erklärung schließen">×</button>
            </div>
            <BodyCompositionGraphic metric={helpMetric} />
            <p>{helpMetric.summary}</p>
            {helpMetric.bands?.length ? (
              <div className="health-traffic-grid" aria-label={`${helpMetric.label} Ampelbereiche`}>
                {helpMetric.bands.map((band) => (
                  <article className={`health-traffic-card ${band.tone}`} key={`${helpMetric.key}-${band.label}`}>
                    <strong>{band.label}</strong>
                    <span>{band.range}</span>
                    <p>{band.note}</p>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="health-help-grid">
              <article><strong>Auswirkung</strong><span>{helpMetric.impact}</span></article>
              <article><strong>Bereiche</strong><span>{helpMetric.range}</span></article>
              <article><strong>Einordnung</strong><span>{helpMetric.note}</span></article>
            </div>
            <p className="nutrition-notes">Hinweis: Die Waage schätzt Körperzusammensetzung über Bioimpedanz. Einzelwerte sind keine Diagnose; Trends unter ähnlichen Messbedingungen sind aussagekräftiger.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
