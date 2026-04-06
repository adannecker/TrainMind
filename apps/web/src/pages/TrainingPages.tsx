import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type MetricType = "ftp" | "maxHr";
type TrainingConfigTabKey = "profile" | "goals" | "week" | "sources";
type TrainingConfigTopTabKey = TrainingConfigTabKey | "llm";
type TrainingConfigTab = {
  key: TrainingConfigTabKey;
  title: string;
  note: string;
  description: string;
  previewKind: "pills" | "checks" | "note";
  previewItems?: string[];
  previewNote?: string;
  highlight?: boolean;
  questions: string[];
  meanings: string[];
  fineTuning: string[];
};

type LlmStatus = {
  provider: string;
  configured: boolean;
  key_hint: string | null;
};

type AthleteProfileFocusItem = {
  id: string;
  label: string;
  description: string;
};

type AthleteProfileDeriveResponse = {
  result_title: string;
  profile_name?: string;
  summary: string;
  rationale: string[];
  planning_implications: string[];
  follow_up_questions: string[];
  recommended_focus_order: string[];
  prompt: string;
  model: string | null;
};

type TrainingConfigFocusOption = AthleteProfileFocusItem & {
  explanation: string;
};

type TrainingConfigEvidenceSource = {
  label: string;
  href: string;
  note: string;
};

type TrainingConfigFocusDetail = {
  planningImpact: string[];
  sources: TrainingConfigEvidenceSource[];
};

type TrainingConfigWorkbenchConfig = {
  selectionHint: string;
  priorityHint: string;
  promptHint: string;
  notesPlaceholder: string;
  emptyTitle: string;
  emptyText: string;
  resultKicker: string;
  focusItems: TrainingConfigFocusOption[];
};

type TrainingConfigSectionState = {
  focus_ids: string[];
  notes: string;
};

type TrainingPlanWeekDay = {
  day_label: string;
  session_label: string;
  objective: string;
  details: string;
  duration_hint: string;
  intensity_hint: string;
};

type TrainingPlanWeekVariant = {
  title: string;
  summary: string;
  level: string;
  suitable_for: string;
  days: TrainingPlanWeekDay[];
};

type TrainingPlanDraftResponse = {
  plan_title: string;
  summary: string;
  weekly_structure: string[];
  week_variants?: TrainingPlanWeekVariant[];
  key_workouts: string[];
  progression_notes: string[];
  watchouts: string[];
  why_this_plan_fits: string[];
  adoption_checklist: string[];
  prompt: string;
  model: string | null;
  sections?: Array<{
    section_key: string;
    section_title: string;
    focus_labels: string[];
    notes: string | null;
  }>;
};

type TrainingConfigProfilePayload = {
  training_config?: {
    sections?: Partial<Record<TrainingConfigTabKey, Partial<TrainingConfigSectionState>>>;
    updated_at?: string | null;
  } | null;
  training_plan?: TrainingPlanDraftResponse | null;
};

type HfDevelopmentPoint = {
  date: string;
  avg_hr_bpm: number;
  avg_power_w: number;
  activity_id: number;
  activity_name: string;
  started_at: string | null;
};

type HfDevelopmentResponse = {
  window_options: Array<{ key: string; label: string; seconds: number }>;
  bucket_options: Array<{ bucket_start_w: number; bucket_end_w: number; label: string }>;
  selected_window_key: string;
  selected_bucket_start_w: number;
  selected_bucket_label: string;
  points: HfDevelopmentPoint[];
  summary: {
    points_count: number;
    activities_considered: number;
    window_label: string;
  };
};

const TRAINING_CONFIG_DRAFT_STORAGE_KEY = "trainmind:training-config-draft";

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

type ZoneEducationContent = {
  title: string;
  summary: string;
  howToTrain: string[];
  lowerBand: string;
  middleBand: string;
  upperBand: string;
};

type ZoneBandSpec = {
  label: string;
  rangePercent: string;
  rangeValue: string;
  explanation: string;
};

type ZoneEducationItem = {
  label: string;
  range: string;
  detail: string;
  minRatio: number;
  maxRatio: number | null;
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


const trainingConfigTabs: TrainingConfigTab[] = [
  {
    key: "profile",
    title: "Athletenprofil",
    note: "Ausgangslage, Erfahrung und Entwicklungsstufe",
    description: "Von Gewichtsverlust und gesunder Regelmäßigkeit bis zu ambitioniertem Amateur- und Semiprofi-Kontext sollen mehrere Entwicklungsstufen abbildbar sein.",
    previewKind: "pills",
    previewItems: athleteProfiles,
    questions: [
      "Was ist das Hauptmotiv: Gesundheit, Gewichtsverlust, Spaß, Eventleistung oder Wettkampf?",
      "Wie viel strukturierte Trainingserfahrung ist bereits vorhanden?",
      "Wie stabil sind Erholung, Schlaf und Alltagsbelastung aktuell?",
      "Wie sicher sind Technik, Gruppenfahren, lange Ausfahrten und harte Belastungen?",
    ],
    meanings: [
      "Das Profil steuert, wie aggressiv Umfang und Intensität überhaupt wachsen dürfen.",
      "Es entscheidet, ob wir eher Routine, Belastbarkeit oder gezielte Spitzenleistung priorisieren.",
      "Es beeinflusst, wie viel Einfachheit oder Feinsteuerung der Plan verträgt.",
    ],
    fineTuning: [
      "Belastungsverträglichkeit in Stufen statt nur Anfänger/Fortgeschritten.",
      "Trainingshistorie der letzten 8-12 Wochen als Realitätscheck.",
      "Eigenwahrnehmung für locker, mittel, hart und lange Einheiten getrennt erfassen.",
    ],
  },
  {
    key: "goals",
    title: "Ziele und Eventkontext",
    note: "Zielbild, Zeithorizont und Priorität",
    description: "Normale Rennen, sehr lange Events oder Triathlon beeinflussen die Wochenlogik unterschiedlich. Diese Entscheidung soll die spätere Planfamilie direkt steuern.",
    previewKind: "pills",
    previewItems: trainingGoals,
    questions: [
      "Welches Ziel hat Priorität: fitter werden, schneller werden, länger durchhalten oder ein konkretes Event?",
      "Gibt es ein fixes Eventdatum, mehrere Saisonhöhepunkte oder nur einen offenen Zielkorridor?",
      "Ist das Ziel straßen-, gravel-, berg-, ultra- oder triathlonorientiert?",
      "Wie wichtig ist Radperformance im Vergleich zu Gewicht, Alltagstauglichkeit oder multisportiver Balance?",
    ],
    meanings: [
      "Ziele bestimmen, welche Leistungsdimension wir aufbauen: Schwelle, VO2max, Ausdauer, Robustheit oder Effizienz.",
      "Der Eventkontext beeinflusst die Länge der langen Einheiten, Spezifität und den Belastungsverlauf über Wochen.",
      "Die Priorität entscheidet, worauf wir bei Zielkonflikten optimieren.",
    ],
    fineTuning: [
      "A-/B-/C-Ziele mit unterschiedlicher Wichtigkeit.",
      "Saisonfenster, Peak-Dauer und gewünschter Formaufbau.",
      "Eventprofil wie Höhenmeter, Dauer, Untergrund, Wetter oder Verpflegungskontext.",
    ],
  },
  {
    key: "week",
    title: "Wochenorganisation",
    note: "Verfügbarkeit, Rhythmus und echte Alltagsspielräume",
    description: "Wichtige Fragen sind Anzahl Trainingstage, mögliche Doppeltage, verfügbare Zeitfenster, Krafttraining sowie welche Tage für Radfahren realistisch frei sind.",
    previewKind: "checks",
    previewItems: ["2-3 Tage kompakt", "4 Tage strukturiert", "5-6 Tage leistungsorientiert", "Triathlon mit Rad-Prioritäten"],
    questions: [
      "An welchen Tagen ist Training realistisch und wie lang dürfen Einheiten dort sein?",
      "Gibt es feste No-Go-Tage, Schichtarbeit, Familie, Pendeln oder saisonale Einschränkungen?",
      "Sind Doppeltage, Indoor-Einheiten oder kurze Früheinheiten praktikabel?",
      "Welche anderen Belastungen laufen parallel: Krafttraining, Laufen, Schwimmen, Arbeitsspitzen?",
    ],
    meanings: [
      "Die Wochenorganisation entscheidet, ob ein Plan alltagstauglich bleibt oder nur theoretisch gut aussieht.",
      "Sie beeinflusst, wo harte Reize sinnvoll liegen und wie viel Erholung dazwischen möglich ist.",
      "Sie ist oft wichtiger als die perfekte Trainingslogik, weil Konsistenz aus realistischen Strukturen entsteht.",
    ],
    fineTuning: [
      "Pflicht-, Wunsch- und flexible Trainingstage getrennt erfassen.",
      "Zeitfenster in groben Klassen wie 30, 60, 90 oder 180+ Minuten.",
      "Indoor, Outdoor, Gruppe, Rolle, Pendeln und lange Wochenendfenster getrennt führen.",
    ],
  },
  {
    key: "sources",
    title: "Quellenbasierte Setups",
    note: "Modelle, Annahmen und spätere Regelwerke",
    description: "Für jede Konfiguration wollen wir später belastbare Trainings-Setups und Trainingszonen hinterlegen, inklusive verlinkter Quellen aus Forschung, Verbänden oder anerkannten Coaching-Ansätzen.",
    previewKind: "note",
    previewNote: "Nächster sinnvoller Schritt: Fragenkatalog definieren, Ergebniscluster bilden und dazu eine zitierfähige Referenzbibliothek aufbauen.",
    highlight: true,
    questions: [
      "Welche Modelle wollen wir als Default hinterlegen: pyramidal, polarized, sweetspot-lastig oder event-spezifisch?",
      "Welche Kennzahlen stehen sicher zur Verfügung: FTP, MaxHF, Gewicht, Trainingszeit, Historie, subjektive Ermüdung?",
      "Welche Regeln sollen transparent begründbar sein und welche nur als Empfehlung laufen?",
      "Welche Quellen gelten bei uns als primär: Forschung, Verbände, Coaching-Modelle oder interne Heuristik?",
    ],
    meanings: [
      "Dieses Segment entscheidet, wie nachvollziehbar und erklärbar TrainMind Empfehlungen später begründen kann.",
      "Es trennt harte Eingaben von heuristischen Annahmen und macht Feinjustierung kontrollierbar.",
      "Es legt fest, welche Konfigurationen wir automatisieren dürfen und wo der Nutzer bewusst entscheiden sollte.",
    ],
    fineTuning: [
      "Pro Setup die Quelle, Annahmen und Grenzen sichtbar machen.",
      "Progressionshärte, Recovery-Konservativität und Volumenanstieg getrennt führen.",
      "Später adaptive Regeln ergänzen: verpasste Einheiten, schlechte Erholung oder neue Messwerte.",
    ],
  },
];

const trainingConfigTabDefinitions: TrainingConfigTab[] = [
  {
    ...trainingConfigTabs[0],
    note: "Ausgangslage, Erfahrung und Entwicklungsstufe",
    description:
      "Von Gewichtsverlust und gesunder Regelmäßigkeit bis zu ambitioniertem Amateur- und Semiprofi-Kontext sollen mehrere Entwicklungsstufen sauber abbildbar sein.",
    questions: [
      "Was ist das Hauptmotiv: Gesundheit, Gewichtsverlust, Spaß, Eventleistung oder Wettkampf?",
      "Wie viel strukturierte Trainingserfahrung ist bereits vorhanden?",
      "Wie stabil sind Erholung, Schlaf und Alltagsbelastung aktuell?",
      "Wie sicher sind Technik, Gruppenfahren, lange Ausfahrten und harte Belastungen?",
    ],
    meanings: [
      "Das Profil steuert, wie aggressiv Umfang und Intensität überhaupt wachsen dürfen.",
      "Es entscheidet, ob wir eher Routine, Belastbarkeit oder gezielte Spitzenleistung priorisieren.",
      "Es beeinflusst, wie viel Einfachheit oder Feinsteuerung der Plan verträgt.",
    ],
    fineTuning: [
      "Belastungsverträglichkeit in Stufen statt nur Anfänger oder Fortgeschritten.",
      "Trainingshistorie der letzten 8-12 Wochen als Realitätscheck.",
      "Eigenwahrnehmung für locker, mittel, hart und lange Einheiten getrennt erfassen.",
    ],
  },
  {
    ...trainingConfigTabs[1],
    note: "Zielbild, Zeithorizont und Priorität",
    description:
      "Normale Rennen, sehr lange Events oder Triathlon beeinflussen die Wochenlogik unterschiedlich. Diese Entscheidung soll die spätere Planfamilie direkt steuern.",
    questions: [
      "Welches Ziel hat Priorität: fitter werden, schneller werden, länger durchhalten oder ein konkretes Event?",
      "Gibt es ein fixes Eventdatum, mehrere Saisonhöhepunkte oder nur einen offenen Zielkorridor?",
      "Ist das Ziel straßen-, gravel-, berg-, ultra- oder triathlonorientiert?",
      "Wie wichtig ist Radperformance im Vergleich zu Gewicht, Alltagstauglichkeit oder multisportiver Balance?",
    ],
    meanings: [
      "Ziele bestimmen, welche Leistungsdimension wir aufbauen: Schwelle, VO2max, Ausdauer, Robustheit oder Effizienz.",
      "Der Eventkontext beeinflusst die Länge der langen Einheiten, Spezifität und den Belastungsverlauf über Wochen.",
      "Die Priorität entscheidet, worauf wir bei Zielkonflikten optimieren.",
    ],
    fineTuning: [
      "A-, B- und C-Ziele mit unterschiedlicher Wichtigkeit.",
      "Saisonfenster, Peak-Dauer und gewünschter Formaufbau.",
      "Eventprofil wie Höhenmeter, Dauer, Untergrund, Wetter oder Verpflegungskontext.",
    ],
  },
  {
    ...trainingConfigTabs[2],
    note: "Verfügbarkeit, Rhythmus und echte Alltagsspielräume",
    description:
      "Wichtige Fragen sind Anzahl Trainingstage, mögliche Doppeltage, verfügbare Zeitfenster, Krafttraining sowie welche Tage für Radfahren realistisch frei sind.",
    previewItems: ["2-3 Tage kompakt", "4 Tage strukturiert", "5-6 Tage leistungsorientiert", "Triathlon mit Rad-Prioritäten"],
    questions: [
      "An welchen Tagen ist Training realistisch und wie lang dürfen Einheiten dort sein?",
      "Gibt es feste No-Go-Tage, Schichtarbeit, Familie, Pendeln oder saisonale Einschränkungen?",
      "Sind Doppeltage, Indoor-Einheiten oder kurze Früheinheiten praktikabel?",
      "Welche anderen Belastungen laufen parallel: Krafttraining, Laufen, Schwimmen, Arbeitsspitzen?",
    ],
    meanings: [
      "Die Wochenorganisation entscheidet, ob ein Plan alltagstauglich bleibt oder nur theoretisch gut aussieht.",
      "Sie beeinflusst, wo harte Reize sinnvoll liegen und wie viel Erholung dazwischen möglich ist.",
      "Sie ist oft wichtiger als die perfekte Trainingslogik, weil Konsistenz aus realistischen Strukturen entsteht.",
    ],
    fineTuning: [
      "Pflicht-, Wunsch- und flexible Trainingstage getrennt erfassen.",
      "Zeitfenster in groben Klassen wie 30, 60, 90 oder 180+ Minuten.",
      "Indoor, Outdoor, Gruppe, Rolle, Pendeln und lange Wochenendfenster getrennt führen.",
    ],
  },
  {
    ...trainingConfigTabs[3],
    note: "Modelle, Annahmen und spätere Regelwerke",
    description:
      "Für jede Konfiguration wollen wir später belastbare Trainings-Setups und Trainingszonen hinterlegen, inklusive verlinkter Quellen aus Forschung, Verbänden oder anerkannten Coaching-Ansätzen.",
    previewNote:
      "Nächster sinnvoller Schritt: Fragenkatalog definieren, Ergebniscluster bilden und dazu eine zitierfähige Referenzbibliothek aufbauen.",
    questions: [
      "Welche Modelle wollen wir als Default hinterlegen: pyramidal, polarized, sweetspot-lastig oder event-spezifisch?",
      "Welche Kennzahlen stehen sicher zur Verfügung: FTP, MaxHF, Gewicht, Trainingszeit, Historie, subjektive Ermüdung?",
      "Welche Regeln sollen transparent begründbar sein und welche nur als Empfehlung laufen?",
      "Welche Quellen gelten bei uns als primär: Forschung, Verbände, Coaching-Modelle oder interne Heuristik?",
    ],
    meanings: [
      "Dieses Segment entscheidet, wie nachvollziehbar und erklärbar TrainMind Empfehlungen später begründen kann.",
      "Es trennt harte Eingaben von heuristischen Annahmen und macht Feinjustierung kontrollierbar.",
      "Es legt fest, welche Konfigurationen wir automatisieren dürfen und wo der Nutzer bewusst entscheiden sollte.",
    ],
    fineTuning: [
      "Pro Setup die Quelle, Annahmen und Grenzen sichtbar machen.",
      "Progressionshärte, Recovery-Konservativität und Volumenanstieg getrennt führen.",
      "Später adaptive Regeln ergänzen: verpasste Einheiten, schlechte Erholung oder neue Messwerte.",
    ],
  },
];

const trainingConfigTopTabs: Array<{ key: TrainingConfigTopTabKey; title: string; note: string }> = [
  ...trainingConfigTabDefinitions.map((tab) => ({ key: tab.key, title: tab.title, note: tab.note })),
  {
    key: "llm",
    title: "LLM",
    note: "Prompt, Planentwurf und Übernehmen",
  },
];

const emptyTrainingConfigState: Record<TrainingConfigTabKey, TrainingConfigSectionState> = {
  profile: { focus_ids: [], notes: "" },
  goals: { focus_ids: [], notes: "" },
  week: { focus_ids: [], notes: "" },
  sources: { focus_ids: [], notes: "" },
};

const trainingConfigEvidenceSources = {
  who_guidelines: {
    label: "WHO Guidelines on physical activity and sedentary behaviour (2020)",
    href: "https://iris.who.int/handle/10665/336656",
    note: "Offizielle WHO-Leitlinie zur Mindestbewegung, Progression und Gesundheitswirkung.",
  },
  acsm_progression: {
    label: "ACSM Position Stand: Progression Models in Resistance Training for Healthy Adults",
    href: "https://pubmed.ncbi.nlm.nih.gov/19204579/",
    note: "ACSM-Positionspapier zu Progression, Belastungssteuerung und ergänzendem Krafttraining.",
  },
  seiler_distribution: {
    label: "Seiler 2010: What is Best Practice for Training Intensity and Duration Distribution in Endurance Athletes?",
    href: "https://pubmed.ncbi.nlm.nih.gov/20861519/",
    note: "Häufig zitierte Übersichtsarbeit zur Verteilung von locker, mittel und hart im Ausdauertraining.",
  },
  seiler_zones: {
    label: "Seiler 2006: Quantifying Training Intensity Distribution in Elite Endurance Athletes",
    href: "https://pubmed.ncbi.nlm.nih.gov/16430681/",
    note: "Grundlage für die 3-Zonen-Logik und die Einordnung von Intensitätsverteilung.",
  },
  stoggl_polarized: {
    label: "Stöggl & Sperlich 2014: Polarized training has greater impact on key endurance variables",
    href: "https://pubmed.ncbi.nlm.nih.gov/24550842/",
    note: "Vergleicht Schwellen-, HIIT-, Volumen- und polarisiertes Training auf zentrale Ausdauerwerte.",
  },
  bosquet_taper: {
    label: "Bosquet 2007: Effects of tapering on performance",
    href: "https://pubmed.ncbi.nlm.nih.gov/17762369/",
    note: "Meta-Analyse zum Formaufbau vor wichtigen Wettkämpfen und Events.",
  },
  ronnestad_block: {
    label: "Rønnestad 2012: Block periodization of high-intensity aerobic intervals",
    href: "https://pubmed.ncbi.nlm.nih.gov/22646668/",
    note: "Zeigt, wie kompakt organisierte Intensitätsblöcke in trainierten Ausdauergruppen wirken können.",
  },
  gillen_time_efficient: {
    label: "Gillen & Gibala 2018: Interval training as a time-efficient exercise strategy",
    href: "https://pubmed.ncbi.nlm.nih.gov/30255712/",
    note: "Übersicht zu zeiteffizientem Intervalltraining und dessen Einsatz bei begrenzten Zeitfenstern.",
  },
  training_load_review: {
    label: "Eckard 2018: The Relationship Between Training Load and Injury in Athletes",
    href: "https://pubmed.ncbi.nlm.nih.gov/29943231/",
    note: "Systematischer Review zur Beziehung zwischen Trainingslast, Belastungssprüngen und Verletzungsrisiko.",
  },
} satisfies Record<string, TrainingConfigEvidenceSource>;

function createTrainingConfigFocusDetail(
  planningImpact: string[],
  sourceKeys: Array<keyof typeof trainingConfigEvidenceSources>,
): TrainingConfigFocusDetail {
  return {
    planningImpact,
    sources: sourceKeys.map((key) => trainingConfigEvidenceSources[key]),
  };
}

const trainingConfigProfileFocusDetails: Record<string, TrainingConfigFocusDetail> = {
  health: createTrainingConfigFocusDetail(
    [
      "Der Plan priorisiert eine konservative Progression mit viel niedriger bis moderater Intensität und klaren Erholungsfenstern.",
      "Belastungssprünge, sehr dichte Intensitätswochen und aggressive Peaks werden später zurückhaltender gesetzt.",
    ],
    ["who_guidelines", "training_load_review"],
  ),
  weight: createTrainingConfigFocusDetail(
    [
      "Die Wochenlogik muss Energiebalance und Leistungsreize zusammen denken, damit Reduktion nicht zu schlechter Verfügbarkeit und schwacher Qualität führt.",
      "Lange oder harte Einheiten brauchen eher saubere Platzierung und genug Erholung, statt nur möglichst viel Zusatzvolumen.",
    ],
    ["who_guidelines", "training_load_review"],
  ),
  routine: createTrainingConfigFocusDetail(
    [
      "Die Planung bevorzugt wiederholbare Muster, feste Mindestbausteine und weniger fragile Spezialwochen.",
      "Konsistenz schlägt Einzelsessions: lieber stabile Wochen mit wenig Ausfallrisiko als einzelne heroische Belastungstage.",
    ],
    ["who_guidelines", "training_load_review"],
  ),
  motivation: createTrainingConfigFocusDetail(
    [
      "Mehr Abwechslung, bewusst gesetzte leichte Wochen und verschiedene Reizformen helfen, mentale Ermüdung klein zu halten.",
      "Der Plan sollte nicht nur physiologisch, sondern auch motivational tragfähig sein, damit die Umsetzungsrate hoch bleibt.",
    ],
    ["who_guidelines", "training_load_review"],
  ),
  efficiency: createTrainingConfigFocusDetail(
    [
      "Qualitätseinheiten, Indoor-Slots und kompakte Reize werden gegenüber zusätzlichem Leervolumen höher priorisiert.",
      "Die Wochenstruktur braucht eine klare Unterscheidung zwischen wenigen wirklich wirksamen Kernreizen und optionalem Zusatzumfang.",
    ],
    ["gillen_time_efficient", "ronnestad_block"],
  ),
  endurance: createTrainingConfigFocusDetail(
    [
      "Der Plan baut längere Grundlageneinheiten, Verpflegungspraxis und robuste Ermüdungsresistenz bewusster aus.",
      "Nicht nur Spitzenleistung zählt, sondern auch Pacing, Dauerverträglichkeit und die Fähigkeit, Belastung über Stunden sauber zu halten.",
    ],
    ["seiler_distribution", "stoggl_polarized"],
  ),
  performance: createTrainingConfigFocusDetail(
    [
      "Die Periodisierung darf spezifischer werden: qualitative Kerneinheiten, klarere Phasen und gezieltere Peak-Blöcke bekommen mehr Gewicht.",
      "Zielkonflikte werden eher zugunsten von Leistung gelöst als zugunsten maximaler Einfachheit oder reinem Gesundheitsfokus.",
    ],
    ["seiler_distribution", "stoggl_polarized"],
  ),
  climbing: createTrainingConfigFocusDetail(
    [
      "Längere Schwellenarbeit, Kraftausdauer und anstiegsnahe Belastungen werden im Plan höher gewichtet.",
      "Auch Körpergewicht, Pacing am Berg und die Platzierung längerer Druckphasen werden dadurch planungsrelevanter.",
    ],
    ["stoggl_polarized", "bosquet_taper"],
  ),
  intensity: createTrainingConfigFocusDetail(
    [
      "VO2max- und HIT-Reize werden bewusster eingebaut, aber mit stärkerem Blick auf Erholung und Gesamtverteilung.",
      "Die Woche braucht dann meist klarere Trennung zwischen sehr locker und sehr hart, damit Qualität wirklich reproduzierbar bleibt.",
    ],
    ["seiler_distribution", "ronnestad_block"],
  ),
  recovery: createTrainingConfigFocusDetail(
    [
      "Recovery-Tage, Deload-Wochen und die Dichte harter Reize werden konservativer geplant.",
      "Subjektive Ermüdung, Schlaf und Alltagslast müssen stärker in die Freigabe für Intensität oder Zusatzvolumen einfließen.",
    ],
    ["training_load_review", "who_guidelines"],
  ),
  technique: createTrainingConfigFocusDetail(
    [
      "Die Planung braucht Raum für Fahrtechnik, Sicherheit und kontrollierte Qualität statt nur physiologischer Reizmaximierung.",
      "Vor allem bei Gruppe, Abfahrt oder technisch anspruchsvollen Events kann das die Belastungsauswahl deutlich verändern.",
    ],
    ["who_guidelines", "training_load_review"],
  ),
  triathlon: createTrainingConfigFocusDetail(
    [
      "Radreize müssen so gesetzt werden, dass sie Schlüssel-Lauf- und Schwimmeinheiten nicht unnötig zerstören.",
      "Die Trainingsplanung priorisiert deshalb Gesamtlast, Kopplung und Erholungsfenster disziplinübergreifend.",
    ],
    ["training_load_review", "who_guidelines"],
  ),
};

const trainingConfigGoalFocusDetails: Record<string, TrainingConfigFocusDetail> = {
  goal_fitness: createTrainingConfigFocusDetail(
    [
      "Die Planung bleibt breit aufgestellt und vermeidet zu frühe Überspezialisierung auf nur eine Leistungsdimension.",
      "Volumen, Intensität und Technik können ausgewogener verteilt werden, weil kein einzelner Wettkampf alles dominiert.",
    ],
    ["who_guidelines", "seiler_distribution"],
  ),
  goal_event: createTrainingConfigFocusDetail(
    [
      "Die Periodisierung bekommt einen klaren Formaufbau mit Build-, Spezifitäts- und Taper-Logik zum Eventdatum hin.",
      "Belastungssteuerung orientiert sich stärker an Timing und Peak als an allgemeiner Jahresform.",
    ],
    ["bosquet_taper", "stoggl_polarized"],
  ),
  goal_threshold: createTrainingConfigFocusDetail(
    [
      "Schwellennahe Intervalle, längere steady-state Belastungen und wiederholbare Qualitätsarbeit werden zentraler.",
      "Das verschiebt die Wochenlogik oft zu klaren Qualitätsankern und kontrollierter Ermüdung statt zufälliger Härte.",
    ],
    ["stoggl_polarized", "seiler_distribution"],
  ),
  goal_endurance: createTrainingConfigFocusDetail(
    [
      "Long Rides, Ernährungsstrategie, Pacing und Ermüdungsresistenz erhalten mehr Raum als reine Spitzenleistung.",
      "Die Planung muss gut unterscheiden, wann zusätzliches Volumen echten Nutzen bringt und wann es nur Müdigkeit sammelt.",
    ],
    ["seiler_distribution", "training_load_review"],
  ),
  goal_climbing: createTrainingConfigFocusDetail(
    [
      "Anstiegsnahe Reize, längere Druckphasen und gegebenenfalls Körpergewichts-Themen werden höher priorisiert.",
      "Das Zielprofil beeinflusst außerdem, ob flache Speed-Arbeit oder bergspezifische Kraftausdauer mehr Gewicht bekommt.",
    ],
    ["stoggl_polarized", "bosquet_taper"],
  ),
  goal_triathlon: createTrainingConfigFocusDetail(
    [
      "Radqualität wird nicht isoliert geplant, sondern gegen Lauf- und Schwimmbelastung abgewogen.",
      "Wichtige Radreize müssen so liegen, dass sie Schlüsselsessions in den anderen Disziplinen nicht entwerten.",
    ],
    ["training_load_review", "who_guidelines"],
  ),
  goal_multiple_peaks: createTrainingConfigFocusDetail(
    [
      "Die Saison braucht eher mehrere kleinere Zuspitzungen statt nur einen maximalen Peak.",
      "Zwischen den Höhepunkten werden Regeneration und erneuter Aufbau selbst zu einem Planungsbaustein.",
    ],
    ["bosquet_taper", "training_load_review"],
  ),
  goal_weight_secondary: createTrainingConfigFocusDetail(
    [
      "Leistung bleibt Primärziel, aber Ernährung und Energieverfügbarkeit müssen genügend Qualität für harte Reize sichern.",
      "Die Trainingsplanung sollte hier vorsichtig mit zusätzlichem Defizit, Zusatzvolumen und Erholung umgehen.",
    ],
    ["who_guidelines", "training_load_review"],
  ),
};

const trainingConfigWeekFocusDetails: Record<string, TrainingConfigFocusDetail> = {
  week_fixed_days: createTrainingConfigFocusDetail(
    [
      "Die Wochenarchitektur muss harte und lockere Tage an reale Kalendergrenzen anpassen statt an ein ideales Modell.",
      "Trainingsqualität hängt hier stark davon ab, ob zentrale Reize auf die tatsächlich verfügbaren Slots gelegt werden.",
    ],
    ["training_load_review", "who_guidelines"],
  ),
  week_short_weekdays: createTrainingConfigFocusDetail(
    [
      "Kurze Slots verlangen kompakte, klar definierte Kerneinheiten und wenig Leerlauf innerhalb der Woche.",
      "Längere Grundlagen- oder Spezifitätseinheiten verschieben sich dadurch meist stärker in längere Wochenendfenster.",
    ],
    ["gillen_time_efficient", "ronnestad_block"],
  ),
  week_long_weekend: createTrainingConfigFocusDetail(
    [
      "Lange Schlüsselreize, Long Rides und eventnahe Spezifität können gezielt am Wochenende verankert werden.",
      "Unter der Woche darf der Plan dann kompakter bleiben, ohne die Langzeitausdauer zu vernachlässigen.",
    ],
    ["seiler_distribution", "bosquet_taper"],
  ),
  week_double_days: createTrainingConfigFocusDetail(
    [
      "Doppeltage erweitern die Wochenlogik, erhöhen aber auch die Anforderungen an Reihenfolge, Recovery und Gesamtlast.",
      "Sie sind besonders dann sinnvoll, wenn dadurch Qualität erhalten bleibt und nicht nur zusätzliche Müdigkeit entsteht.",
    ],
    ["training_load_review", "acsm_progression"],
  ),
  week_indoor: createTrainingConfigFocusDetail(
    [
      "Indoor-Einheiten machen Qualität wetterunabhängig planbar und eignen sich gut für kurze, kontrollierte Reize.",
      "Dadurch können Intervalle oder Technikfokus präziser gelegt werden, während Outdoor-Fenster eher für Dauer und Spezifität genutzt werden.",
    ],
    ["gillen_time_efficient", "ronnestad_block"],
  ),
  week_strength: createTrainingConfigFocusDetail(
    [
      "Kraft und Ausdauer müssen zeitlich so gelegt werden, dass sich die Reize ergänzen statt sich gegenseitig zu stören.",
      "Der Plan braucht dann meist klare Priorisierungstage und saubere Erholungsfenster nach schweren Kraftreizen.",
    ],
    ["acsm_progression", "training_load_review"],
  ),
  week_shift_stress: createTrainingConfigFocusDetail(
    [
      "Die Planung muss flexibler werden und eher mit Regeln, Prioritäten und Minimalvarianten arbeiten als mit starren Wochenschablonen.",
      "Erholungsqualität und Alltagsstress bekommen dadurch mehr Gewicht bei der Freigabe harter Einheiten.",
    ],
    ["training_load_review", "who_guidelines"],
  ),
  week_multisport: createTrainingConfigFocusDetail(
    [
      "Radtage müssen gegen Gesamtbelastung aus Laufen, Schwimmen oder anderem Training abgestimmt werden.",
      "Wichtig wird vor allem, welche Disziplin wann den höchsten Qualitätsanspruch hat und wie sich Ermüdung überträgt.",
    ],
    ["training_load_review", "who_guidelines"],
  ),
};

const trainingConfigSourceFocusDetails: Record<string, TrainingConfigFocusDetail> = {
  sources_defaults: createTrainingConfigFocusDetail(
    [
      "Klare Defaults machen die erste Planversion robuster und reduzieren unnötige Komplexität bei der initialen Konfiguration.",
      "Für die Trainingsplanung heißt das: erst ein belastbares Startmodell, danach gezielte Feinjustierung dort, wo es wirklich Nutzen bringt.",
    ],
    ["who_guidelines", "seiler_distribution"],
  ),
  sources_conservative: createTrainingConfigFocusDetail(
    [
      "Progression, Umfangsanstieg und Härte werden vorsichtiger gesetzt, um Robustheit und Umsetzbarkeit zu schützen.",
      "Das reduziert oft das Risiko, zu schnell zu viel zu wollen, gerade bei instabiler Woche oder heterogener Nutzerbasis.",
    ],
    ["training_load_review", "who_guidelines"],
  ),
  sources_transparency: createTrainingConfigFocusDetail(
    [
      "Regeln und Empfehlungen sollten im Produkt erklärbar bleiben, damit Nutzer verstehen, warum eine Belastung vorgeschlagen wird.",
      "Für die Planung bedeutet das meist klarere Entscheidungslogik statt Black-Box-Heuristiken ohne Einordnung.",
    ],
    ["who_guidelines", "seiler_distribution"],
  ),
  sources_data_only: createTrainingConfigFocusDetail(
    [
      "Messwerte und belastbare Eingaben erhalten Priorität, wodurch Empfehlungen enger an objektiven Signalen ausgerichtet werden.",
      "Die Trainingsplanung wird damit konsistenter, kann aber bei lückenhaften Daten auch weniger alltagsnahe Nuancen erfassen.",
    ],
    ["training_load_review", "seiler_zones"],
  ),
  sources_coaching: createTrainingConfigFocusDetail(
    [
      "Heuristische Coaching-Regeln fangen Situationen auf, in denen Daten allein noch keine gute Trainingsentscheidung liefern.",
      "Für die Planung schafft das Spielraum bei Unsicherheit, erfordert aber klare Grenzen und gute Kommunikation.",
    ],
    ["seiler_distribution", "stoggl_polarized"],
  ),
  sources_user_choice: createTrainingConfigFocusDetail(
    [
      "Bewusste Nutzerentscheidungen sind besonders wichtig bei echten Zielkonflikten, etwa zwischen Performance, Einfachheit und Risiko.",
      "Die Trainingsplanung muss dann Varianten anbieten statt stillschweigend alles zu automatisieren.",
    ],
    ["who_guidelines", "training_load_review"],
  ),
  sources_adaptive: createTrainingConfigFocusDetail(
    [
      "Regeln sollten auf verpasste Einheiten, neue Daten und veränderte Erholung reagieren, statt nur einen statischen Plan auszuspielen.",
      "Damit wird die Wochenlogik resilienter, verlangt aber klare Trigger für Anpassung und Re-Planung.",
    ],
    ["training_load_review", "seiler_distribution"],
  ),
  sources_visible_limits: createTrainingConfigFocusDetail(
    [
      "Nicht nur Empfehlungen, sondern auch ihre Grenzen und Annahmen sollten sichtbar sein, damit Feinjustierung verantwortbar bleibt.",
      "Für die Trainingsplanung heißt das: Empfehlungen werden nicht als absolute Wahrheit, sondern als begründete Vorschläge dargestellt.",
    ],
    ["who_guidelines", "training_load_review"],
  ),
};

function getTrainingConfigFocusDetail(item: TrainingConfigFocusOption): TrainingConfigFocusDetail {
  return (
    trainingConfigProfileFocusDetails[item.id] ??
    trainingConfigGoalFocusDetails[item.id] ??
    trainingConfigWeekFocusDetails[item.id] ??
    trainingConfigSourceFocusDetails[item.id] ?? {
      planningImpact: ["Dieser Punkt beeinflusst die Gewichtung, Reihenfolge und Absicherung der späteren Trainingsreize."],
      sources: [trainingConfigEvidenceSources.who_guidelines],
    }
  );
}

const athleteProfileFocusItems: AthleteProfileFocusItem[] = [
  {
    id: "health",
    label: "Gesundheit und Belastbarkeit",
    description: "Training soll vor allem nachhaltig gut tun und den Körper robuster machen.",
  },
  {
    id: "weight",
    label: "Gewichtsmanagement",
    description: "Körpergewicht und Energiehaushalt sollen bewusst mitgedacht werden.",
  },
  {
    id: "routine",
    label: "Regelmäßigkeit im Alltag",
    description: "Der Plan muss einfach in den Wochenrhythmus passen und konstant machbar sein.",
  },
  {
    id: "motivation",
    label: "Spaß und Motivation",
    description: "Abwechslung, Freude und mentale Frische sind ein eigener Erfolgsfaktor.",
  },
  {
    id: "efficiency",
    label: "Zeitökonomie",
    description: "Mit wenig Zeit soll möglichst viel Wirkung erreicht werden.",
  },
  {
    id: "endurance",
    label: "Lange Ausdauer",
    description: "Längere Belastungen und stabile Energie über viele Stunden sind wichtig.",
  },
  {
    id: "performance",
    label: "Rennperformance",
    description: "Leistungsfähigkeit für Straße, Gravel oder Rennen steht klar im Vordergrund.",
  },
  {
    id: "climbing",
    label: "Kletterstärke",
    description: "Anstiege, Höhenmeter und kraftvolle längere Belastungen sollen besser werden.",
  },
  {
    id: "intensity",
    label: "VO2max und hohe Intensität",
    description: "Kurze harte Reize und Leistungsreserven nach oben sind ein Fokus.",
  },
  {
    id: "recovery",
    label: "Erholung und Stressverträglichkeit",
    description: "Belastung muss zur Erholung, zum Schlaf und zum sonstigen Stress passen.",
  },
  {
    id: "technique",
    label: "Technik und Sicherheit",
    description: "Handling, Gruppenfahren, Abfahrten oder Souveränität sollen verbessert werden.",
  },
  {
    id: "triathlon",
    label: "Triathlon-Balance",
    description: "Radtraining soll mit Laufen und Schwimmen sauber zusammen funktionieren.",
  },
];

const trainingConfigWorkbenchConfigs: Record<TrainingConfigTabKey, TrainingConfigWorkbenchConfig> = {
  profile: {
    selectionHint:
      "Wähle alles aus, was für das Profil wirklich wichtig ist. Aktivierte Punkte landen rechts in deiner Prioritätenliste.",
    priorityHint:
      "Bringe die gewählten Aspekte in die Reihenfolge, die dein Profil später am stärksten prägen soll.",
    promptHint:
      "Du kannst den Prompt direkt kopieren oder, wenn ein OpenAI-Schlüssel hinterlegt ist, die Einordnung sofort im System ableiten lassen.",
    notesPlaceholder: "z. B. wenig Schlaf unter der Woche, Event in 14 Wochen, Unsicherheit bei hoher Intensität",
    emptyTitle: "Noch keine Fokus-Bausteine gewählt.",
    emptyText: "Links auswählen, rechts priorisieren und daraus dann eine Einordnung ableiten.",
    resultKicker: "Abgeleitetes Profil",
    focusItems: [
      {
        ...athleteProfileFocusItems[0],
        explanation:
          "Diesen Punkt solltest du wählen, wenn Training vor allem gesund halten, Belastbarkeit aufbauen und langfristig stabil funktionieren soll. Er ist besonders wichtig bei Wiedereinstieg, vorsichtiger Progression oder wenn hohe Trainingslast aktuell nicht das Ziel ist.",
      },
      {
        ...athleteProfileFocusItems[1],
        explanation:
          "Wähle das, wenn Körpergewicht, Energiebalance oder nachhaltige Gewohnheiten bewusst mitgedacht werden sollen. Das ist sinnvoll, wenn Leistung zwar wichtig ist, aber nicht auf Kosten von Ernährung, Alltag und realistischer Umsetzbarkeit.",
      },
      {
        ...athleteProfileFocusItems[2],
        explanation:
          "Dieser Punkt passt, wenn Konsistenz wichtiger ist als einzelne heroische Trainingswochen. Er hilft besonders, wenn Beruf, Familie oder schwankende Wochen den Plan alltagstauglich und einfach halten müssen.",
      },
      {
        ...athleteProfileFocusItems[3],
        explanation:
          "Wähle diesen Baustein, wenn Motivation, Abwechslung und Freude aktiv geschützt werden sollen. Das ist oft entscheidend, wenn jemand schnell mental ermüdet oder bei zu starrer Struktur die Lust verliert.",
      },
      {
        ...athleteProfileFocusItems[4],
        explanation:
          "Zeitökonomie ist relevant, wenn unter der Woche wenig Raum für lange Einheiten bleibt und jeder Trainingsreiz zählen muss. Dann beeinflusst dieser Punkt stark, wie kompakt und zielgerichtet die Woche gebaut wird.",
      },
      {
        ...athleteProfileFocusItems[5],
        explanation:
          "Diesen Punkt solltest du wählen, wenn lange Belastungen, große Distanzen oder Ultra-Ziele eine Rolle spielen. Er signalisiert, dass Dauer, Energieversorgung und robuste Grundlagen hohe Priorität haben.",
      },
      {
        ...athleteProfileFocusItems[6],
        explanation:
          "Rennperformance ist der richtige Fokus, wenn Resultate, Geschwindigkeit oder Wettbewerb klar im Vordergrund stehen. Dann darf die Trainingslogik spezifischer, strukturierter und leistungsnäher werden.",
      },
      {
        ...athleteProfileFocusItems[7],
        explanation:
          "Kletterstärke ist besonders sinnvoll bei bergigen Events, schweren Anstiegen oder wenn lange Druckphasen am Berg limitieren. Dieser Punkt verschiebt den Blick stärker auf Kraftausdauer und längere Schwellenarbeit.",
      },
      {
        ...athleteProfileFocusItems[8],
        explanation:
          "Wähle das, wenn hohe Intensität, VO2max-Arbeit oder Leistungsreserven nach oben bewusst entwickelt werden sollen. Das ist eher für leistungsorientierte Athleten sinnvoll als für reine Konsistenz- oder Gesundheitsziele.",
      },
      {
        ...athleteProfileFocusItems[9],
        explanation:
          "Dieser Fokus passt, wenn Erholung aktuell ein limitierender Faktor ist, etwa wegen Berufsstress, Schlafmangel oder empfindlicher Reaktion auf hohe Belastung. Er hilft, die Planhärte bewusster zu steuern.",
      },
      {
        ...athleteProfileFocusItems[10],
        explanation:
          "Technik und Sicherheit solltest du wählen, wenn Handling, Gruppenfahren, Abfahrten oder Unsicherheit auf dem Rad Trainingsqualität und Selbstvertrauen begrenzen. Dann braucht der Plan mehr als nur Watt und Herzfrequenz.",
      },
      {
        ...athleteProfileFocusItems[11],
        explanation:
          "Triathlon-Balance ist wichtig, wenn das Radtraining nie isoliert betrachtet werden darf. Dieser Punkt macht vor allem Sinn, wenn Radqualität mit Lauf- und Schwimmlast sauber austariert werden muss.",
      },
    ],
  },
  goals: {
    selectionHint:
      "Wähle die Zielaspekte aus, die für diese Saison oder das nächste Event wirklich leitend sind. Die Reihenfolge bestimmt, worauf der Plan bei Zielkonflikten zuerst optimieren soll.",
    priorityHint:
      "Ordne die Ziele so, wie sie in der Trainingslogik gewichtet werden sollen: ganz oben steht das, woran der Plan sich im Zweifel zuerst orientiert.",
    promptHint:
      "Hier entsteht die Ziel-Einordnung. Das hilft später, passende Wochenlogik, Spezifität und Priorisierung sauber abzuleiten.",
    notesPlaceholder: "z. B. A-Rennen Ende August, zwei wichtige Gravel-Events, Gewicht soll nur Nebenrolle spielen",
    emptyTitle: "Noch keine Ziel-Bausteine gewählt.",
    emptyText: "Leitende Ziele auswählen und priorisieren, damit daraus eine saubere Ziel-Einordnung entstehen kann.",
    resultKicker: "Abgeleitete Ziel-Einordnung",
    focusItems: [
      {
        id: "goal_fitness",
        label: "Allgemeine Fitness",
        description: "Die Gesamtform soll besser werden, ohne dass ein einzelnes Event alles dominiert.",
        explanation:
          "Wähle das, wenn kein scharf umrissenes Wettkampfziel im Vordergrund steht und du vor allem breiter belastbar, fitter und konstanter werden willst. Dieser Fokus ist sinnvoll, wenn der Plan eher vielseitig als extrem spezifisch bleiben soll.",
      },
      {
        id: "goal_event",
        label: "Konkretes Event mit Datum",
        description: "Ein klarer Termin soll die Planung und den Formaufbau steuern.",
        explanation:
          "Diesen Punkt solltest du wählen, wenn ein Rennen oder Event wirklich den Takt vorgibt. Er ist entscheidend, sobald Belastungsaufbau, Peak und Taper nicht offen bleiben, sondern auf einen festen Zeitpunkt zulaufen müssen.",
      },
      {
        id: "goal_threshold",
        label: "Schwellenleistung steigern",
        description: "Längere hohe Leistung nahe FTP oder Schwelle soll gezielt besser werden.",
        explanation:
          "Das ist passend, wenn dauerhafte Leistung, Zeitfahren, lange Anstiege oder hohes Tempo über längere Phasen limitieren. Dieser Fokus macht den Plan meist strukturierter und stärker auf wiederholbare Qualitätsarbeit ausgerichtet.",
      },
      {
        id: "goal_endurance",
        label: "Ultra- und Langzeitausdauer",
        description: "Dauer, Pacing und Energie über sehr lange Belastungen sind zentral.",
        explanation:
          "Wähle diesen Punkt, wenn das eigentliche Ziel nicht nur Geschwindigkeit, sondern das lange Durchhalten ist. Er ist besonders wichtig bei 200-500-km-Events, sehr langen Marathons oder langen Gravel-Tagen.",
      },
      {
        id: "goal_climbing",
        label: "Berg- und Höhenmeterprofil",
        description: "Das Ziel hängt stark an Anstiegen, Höhenmetern oder Kletterfähigkeit.",
        explanation:
          "Diesen Fokus solltest du wählen, wenn das Zielprofil deutlich bergig ist oder Kletterstärke einen echten Unterschied macht. Dann werden Intensität, Kraftausdauer und Event-Spezifik anders priorisiert.",
      },
      {
        id: "goal_triathlon",
        label: "Triathlon-Kompatibilität",
        description: "Das Radziel muss mit Laufen und Schwimmen zusammenpassen.",
        explanation:
          "Das ist sinnvoll, sobald Radperformance nicht isoliert optimiert werden darf. Wähle diesen Punkt, wenn das eigentliche Ziel nur gemeinsam mit den anderen Disziplinen sinnvoll bewertet werden kann.",
      },
      {
        id: "goal_multiple_peaks",
        label: "Mehrere Saisonhöhepunkte",
        description: "Nicht nur ein Peak, sondern mehrere wichtige Zeitfenster sollen funktionieren.",
        explanation:
          "Wähle das, wenn du mehrere wichtige Rennen oder Eventblöcke in einer Saison hast. Dann ist relevant, wie viel Formaufbau, Erholung und erneute Zuspitzung überhaupt realistisch geplant werden können.",
      },
      {
        id: "goal_weight_secondary",
        label: "Gewicht als Nebenziel",
        description: "Leistung bleibt zentral, aber Körpergewicht soll mitgedacht werden.",
        explanation:
          "Dieser Punkt ist passend, wenn Gewicht relevant ist, aber nicht die Hauptlogik des Plans übernehmen soll. Er hilft dabei, Zielkonflikte zwischen Performance, Energieverfügbarkeit und Alltag bewusster zu steuern.",
      },
    ],
  },
  week: {
    selectionHint:
      "Wähle die Rahmenbedingungen aus, die deine Woche real prägen. Genau diese Dinge entscheiden später, ob ein guter Plan im Alltag wirklich tragfähig ist.",
    priorityHint:
      "Ordne die Wochenfaktoren nach Härtegrad für die Planung: oben steht, was bei der Wochenlogik am wenigsten verhandelbar ist.",
    promptHint:
      "Aus dieser Auswahl entsteht eine konkrete Organisations-Einordnung, damit die spätere Wochenstruktur nicht nur sportlich, sondern auch praktisch funktioniert.",
    notesPlaceholder: "z. B. Dienstag und Donnerstag nur 45 Minuten, Samstag lang möglich, Krafttraining immer mittwochs",
    emptyTitle: "Noch keine Wochen-Bausteine gewählt.",
    emptyText: "Wähle zuerst die Faktoren aus, die deine Woche wirklich begrenzen oder besonders wertvoll machen.",
    resultKicker: "Abgeleitete Wochenlogik",
    focusItems: [
      {
        id: "week_fixed_days",
        label: "Feste Trainingstage",
        description: "Bestimmte Tage sind gesetzt oder ausgeschlossen.",
        explanation:
          "Wähle das, wenn deine Woche klar durch fixe Termine, Familie oder Arbeit strukturiert ist. Dieser Punkt ist wichtig, weil harte und lockere Einheiten nur dann sinnvoll verteilt werden können, wenn feste Grenzen bekannt sind.",
      },
      {
        id: "week_short_weekdays",
        label: "Kurze Einheiten unter der Woche",
        description: "Unter der Woche sind nur kompakte Sessions realistisch.",
        explanation:
          "Das solltest du wählen, wenn werktags kaum Zeit für längere Einheiten bleibt. Dann muss der Plan viel bewusster zwischen Effizienz, Ermüdung und dem sinnvollen Einsatz kurzer Qualitätsreize balancieren.",
      },
      {
        id: "week_long_weekend",
        label: "Langes Wochenende verfügbar",
        description: "Am Wochenende gibt es Raum für längere oder wichtigere Einheiten.",
        explanation:
          "Dieser Fokus passt, wenn die längsten oder spezifischsten Einheiten zuverlässig am Wochenende liegen können. Das ist besonders relevant für Ausdauerziele, Long Rides und Event-Spezifik.",
      },
      {
        id: "week_double_days",
        label: "Doppeltage möglich",
        description: "An einzelnen Tagen können zwei Einheiten sinnvoll untergebracht werden.",
        explanation:
          "Wähle das, wenn du an bestimmten Tagen bewusst zwei Reize setzen kannst, etwa Rad plus Kraft oder Rolle plus kurzer Lauf. Das verändert die Wochenlogik deutlich und erweitert die Optionen trotz engem Kalender.",
      },
      {
        id: "week_indoor",
        label: "Indoor als feste Option",
        description: "Rolle oder Indoor-Training soll systematisch eingeplant werden.",
        explanation:
          "Das ist sinnvoll, wenn Wetter, Sicherheit oder Zeitfenster Outdoor-Einheiten begrenzen. Dann kann Indoor nicht nur Notlösung, sondern ein geplanter Baustein für Qualität und Verlässlichkeit sein.",
      },
      {
        id: "week_strength",
        label: "Krafttraining integriert",
        description: "Kraft- oder Stabilisationseinheiten laufen parallel und müssen mitgedacht werden.",
        explanation:
          "Diesen Punkt solltest du wählen, wenn Krafttraining nicht optional, sondern fester Teil der Woche ist. Er ist wichtig, weil Radbelastung und Kraftreize sich gegenseitig verstärken oder stören können.",
      },
      {
        id: "week_shift_stress",
        label: "Schichtarbeit oder schwankender Alltag",
        description: "Die Woche ist nicht stabil, sondern verändert sich häufig.",
        explanation:
          "Wähle das, wenn Schlaf, Arbeitszeiten oder Belastung stark schwanken. Dieser Punkt ist zentral, sobald starre Wochenpläne eher scheitern würden und mehr flexible Regeln gebraucht werden.",
      },
      {
        id: "week_multisport",
        label: "Weitere Sportarten laufen mit",
        description: "Laufen, Schwimmen oder andere Belastungen wirken direkt in die Woche hinein.",
        explanation:
          "Das ist passend, wenn Radtraining nur ein Teil der Gesamtbelastung ist. Dann muss die Wochenorganisation nicht nur freie Radtage, sondern die Gesamtlast aus mehreren Disziplinen sauber berücksichtigen.",
      },
    ],
  },
  sources: {
    selectionHint:
      "Wähle die Prinzipien aus, nach denen TrainMind Empfehlungen später begründen und steuern soll. Diese Auswahl formt den fachlichen Unterbau hinter den Setups.",
    priorityHint:
      "Ordne die Prinzipien danach, wie stark sie die spätere Regel- und Empfehlungslogik dominieren sollen.",
    promptHint:
      "Hier entsteht die Setup-Einordnung für Modelle, Regeln und Transparenz. Das hilft, spätere Empfehlungen nachvollziehbar und bewusst justierbar zu machen.",
    notesPlaceholder: "z. B. eher konservativ steigern, Quellen sichtbar machen, Coaching-Heuristik zulassen aber nicht dominieren",
    emptyTitle: "Noch keine Setup-Bausteine gewählt.",
    emptyText: "Wähle die Regeln und Prinzipien aus, auf denen spätere Empfehlungen basieren sollen.",
    resultKicker: "Abgeleitetes Setup",
    focusItems: [
      {
        id: "sources_defaults",
        label: "Klare Default-Modelle",
        description: "Ein stabiles Standardmodell soll den Startpunkt bilden.",
        explanation:
          "Wähle das, wenn Nutzer nicht mit zu vielen Entscheidungen starten sollen und ein belastbarer Default wichtig ist. Dieser Punkt sorgt dafür, dass die Plattform nicht bei jeder Kleinigkeit sofort offene Grundsatzfragen stellt.",
      },
      {
        id: "sources_conservative",
        label: "Konservative Progression",
        description: "Belastungsanstieg soll eher vorsichtig als aggressiv ausfallen.",
        explanation:
          "Das ist sinnvoll, wenn Robustheit, Planbarkeit und geringes Risiko höher gewichtet werden als maximal schneller Fortschritt. Besonders bei wechselhaftem Alltag oder breiter Nutzerbasis ist dieser Punkt oft sehr wertvoll.",
      },
      {
        id: "sources_transparency",
        label: "Transparente Regeln",
        description: "Empfehlungen sollen nachvollziehbar erklärt und begründet sein.",
        explanation:
          "Diesen Punkt solltest du wählen, wenn Nutzer verstehen sollen, warum eine Empfehlung entsteht. Er ist wichtig, sobald Vertrauen, Nachvollziehbarkeit und manuelle Feinjustierung aktiv unterstützt werden sollen.",
      },
      {
        id: "sources_data_only",
        label: "Stark datenbasierte Ableitung",
        description: "Messwerte und harte Eingaben sollen Vorrang vor Heuristik haben.",
        explanation:
          "Wähle das, wenn die Plattform sich möglichst eng an Daten orientieren soll. Das ist besonders sinnvoll bei klar verfügbaren Kennzahlen und wenn subjektive Heuristik bewusst begrenzt werden soll.",
      },
      {
        id: "sources_coaching",
        label: "Coaching-Heuristik zulassen",
        description: "Erfahrene Faustregeln dürfen Teil der Empfehlung sein.",
        explanation:
          "Dieser Fokus passt, wenn nicht alles rein datengetrieben sein muss und gute Coaching-Praxis bewusst Raum bekommen soll. Er hilft vor allem dort, wo harte Daten unvollständig oder zu grob sind.",
      },
      {
        id: "sources_user_choice",
        label: "Bewusste Nutzerentscheidung",
        description: "An wichtigen Stellen soll der Nutzer aktiv zwischen Varianten wählen können.",
        explanation:
          "Wähle das, wenn nicht jede Entscheidung unsichtbar automatisiert werden soll. Dieser Punkt ist wichtig, wenn Transparenz und Mitsteuerung ein bewusster Teil des Produkts sein sollen.",
      },
      {
        id: "sources_adaptive",
        label: "Adaptive Regeln bei Änderungen",
        description: "Verpasste Einheiten, neue Daten oder schlechte Erholung sollen Regeln anpassen.",
        explanation:
          "Das solltest du wählen, wenn Setups nicht statisch bleiben sollen, sondern auf neue Realität reagieren müssen. Besonders sinnvoll ist das bei langfristiger Nutzung und schwankenden Wochen.",
      },
      {
        id: "sources_visible_limits",
        label: "Grenzen und Quellen sichtbar",
        description: "Nutzer sollen auch Annahmen, Grenzen und Herkunft einer Regel sehen können.",
        explanation:
          "Dieser Punkt ist relevant, wenn TrainMind nicht nur Empfehlungen geben, sondern auch deren Grenzen offenlegen soll. Das stärkt Vertrauen und hilft bei bewusster Feinjustierung.",
      },
    ],
  },
};

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

function TrainingConfigPreview({ tab }: { tab: TrainingConfigTab }) {
  if (tab.previewKind === "pills") {
    return <PillList items={tab.previewItems ?? []} />;
  }

  if (tab.previewKind === "checks") {
    return (
      <div className="training-check-grid">
        {(tab.previewItems ?? []).map((item) => (
          <div key={item} className="training-check-item">
            {item}
          </div>
        ))}
      </div>
    );
  }

  if (!tab.previewNote) return null;

  return <p className="training-note">{tab.previewNote}</p>;
}

function TrainingConfigDetailCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="training-config-detail-card">
      <h3>{title}</h3>
      <ul className="training-config-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function TrainingConfigFocusOverlay({
  tabTitle,
  item,
  active,
  onClose,
  onToggle,
}: {
  tabTitle: string;
  item: TrainingConfigFocusOption;
  active: boolean;
  onClose: () => void;
  onToggle: () => void;
}) {
  const detail = getTrainingConfigFocusDetail(item);

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={`${item.label} im Detail`}>
      <div className="confirm-card training-overlay-card training-focus-overlay-card">
        <div className="training-overlay-head">
          <div className="training-profile-builder-head">
            <p className="training-config-kicker">{tabTitle}</p>
            <h2>{item.label}</h2>
            <p>{item.description}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Overlay schließen">
            ×
          </button>
        </div>

        <div className="training-focus-overlay-intro">
          <span className={`training-profile-focus-badge training-profile-focus-badge-static ${active ? "active" : ""}`}>
            {active ? "Im Fokus" : "Noch nicht ausgewählt"}
          </span>
          <p>{item.explanation}</p>
        </div>

        <div className="training-focus-overlay-grid">
          <div className="training-config-detail-card">
            <h3>Auswirkungen auf die Trainingsplanung</h3>
            <ul className="training-config-list">
              {detail.planningImpact.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </div>

          <div className="training-config-detail-card">
            <h3>Offizielle Quellen und Studien</h3>
            <div className="training-focus-source-list">
              {detail.sources.map((source) => (
                <a
                  key={source.href}
                  className="training-focus-source-link"
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <strong>{source.label}</strong>
                  <span>{source.note}</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Schließen
          </button>
          <button className="primary-button" type="button" onClick={onToggle}>
            {active ? "Aus Fokus entfernen" : "In Fokus übernehmen"}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildTrainingConfigPromptPreview(sectionTitle: string, selectedItems: TrainingConfigFocusOption[], notes: string): string {
  if (!selectedItems.length) {
    return `Wähle zuerst Fokus-Bausteine für "${sectionTitle}" aus und bringe sie in deine Reihenfolge. Dann entsteht hier automatisch ein Prompt für die Einordnung.`;
  }

  const priorityLines = selectedItems.map((item, index) => `${index + 1}. ${item.label} - ${item.description}`).join("\n");
  const noteBlock = notes.trim() ? notes.trim() : "Keine zusätzlichen Hinweise.";

  return [
    `Erstelle auf Deutsch eine kompakte Einordnung für den Konfigurationsbereich "${sectionTitle}" einer Ausdauer-Trainingsplattform.`,
    "Die Reihenfolge der Fokus-Bausteine ist priorisiert und soll bei der Einordnung stark gewichtet werden.",
    "",
    "Priorisierte Fokus-Bausteine:",
    priorityLines,
    "",
    "Zusätzliche Hinweise:",
    noteBlock,
    "",
    "Liefere:",
    "1. einen kurzen Titel für die Einordnung,",
    "2. eine prägnante Zusammenfassung,",
    "3. die wichtigsten Trainingsimplikationen,",
    "4. die wichtigsten offenen Rückfragen,",
    "5. optional eine sinnvollere Reihenfolge der gewählten Fokus-Bausteine.",
  ].join("\n");
}

function getTrainingConfigTabTitle(tabKey: TrainingConfigTabKey): string {
  return trainingConfigTabDefinitions.find((tab) => tab.key === tabKey)?.title ?? tabKey;
}

function getSelectedTrainingConfigFocusItems(tabKey: TrainingConfigTabKey, focusIds: string[]): TrainingConfigFocusOption[] {
  const itemMap = new Map(trainingConfigWorkbenchConfigs[tabKey].focusItems.map((item) => [item.id, item]));
  return focusIds
    .map((id) => itemMap.get(id))
    .filter((item): item is TrainingConfigFocusOption => Boolean(item));
}

function buildTrainingPlanSectionsPayload(tabState: Record<TrainingConfigTabKey, TrainingConfigSectionState>) {
  return trainingConfigTabDefinitions.map((tab) => ({
    section_key: tab.key,
    section_title: tab.title,
    focus_labels: getSelectedTrainingConfigFocusItems(tab.key, tabState[tab.key].focus_ids).map((item) => item.label),
    notes: tabState[tab.key].notes.trim() || null,
  }));
}

function buildTrainingPlanPromptPreview(tabState: Record<TrainingConfigTabKey, TrainingConfigSectionState>): string {
  const sections = buildTrainingPlanSectionsPayload(tabState);
  const nonEmptySections = sections.filter((section) => section.focus_labels.length || section.notes);
  if (!nonEmptySections.length) {
    return "Wähle und speichere zuerst Inhalte in den vier Konfigurationsbereichen. Danach entsteht hier die kombinierte LLM-Anfrage für den Planentwurf.";
  }

  const sectionBlocks = nonEmptySections.map((section) => {
    const focusLines = section.focus_labels.length
      ? section.focus_labels.map((label, index) => `${index + 1}. ${label}`).join("\n")
      : "Keine priorisierten Fokus-Bausteine.";
    const notesLine = section.notes || "Keine zusätzlichen Hinweise.";
    return `${section.section_title}\n${focusLines}\nHinweise: ${notesLine}`;
  });

  return [
    "Erstelle auf Deutsch einen realistischen Trainingsplan-Entwurf für eine Ausdauer-Trainingsplattform.",
    "Berücksichtige alle vier Konfigurationsbereiche gemeinsam und löse Zielkonflikte nachvollziehbar auf.",
    "",
    "Konfiguration:",
    sectionBlocks.join("\n\n"),
    "",
    "Liefere als Ergebnis:",
    "1. einen kurzen Plantitel,",
    "2. eine prägnante Gesamtzusammenfassung,",
    "3. eine Wochenstruktur,",
    "4. die wichtigsten Schlüsseleinheiten,",
    "5. Hinweise zur Progression,",
    "6. Risiken oder Grenzen,",
    "7. eine kurze Checkliste vor dem Übernehmen.",
  ].join("\n");
}

function hasTrainingConfigContent(tabState: Record<TrainingConfigTabKey, TrainingConfigSectionState>): boolean {
  return (Object.keys(tabState) as TrainingConfigTabKey[]).some((key) => {
    const section = tabState[key];
    return section.focus_ids.length > 0 || section.notes.trim().length > 0;
  });
}

function normalizeTrainingConfigProfileState(
  payload: TrainingConfigProfilePayload | null | undefined,
): Record<TrainingConfigTabKey, TrainingConfigSectionState> {
  const sections = payload?.training_config?.sections ?? {};
  return {
    profile: {
      focus_ids: Array.isArray(sections.profile?.focus_ids) ? sections.profile?.focus_ids.filter(Boolean).map(String) : [],
      notes: typeof sections.profile?.notes === "string" ? sections.profile.notes : "",
    },
    goals: {
      focus_ids: Array.isArray(sections.goals?.focus_ids) ? sections.goals?.focus_ids.filter(Boolean).map(String) : [],
      notes: typeof sections.goals?.notes === "string" ? sections.goals.notes : "",
    },
    week: {
      focus_ids: Array.isArray(sections.week?.focus_ids) ? sections.week?.focus_ids.filter(Boolean).map(String) : [],
      notes: typeof sections.week?.notes === "string" ? sections.week.notes : "",
    },
    sources: {
      focus_ids: Array.isArray(sections.sources?.focus_ids) ? sections.sources?.focus_ids.filter(Boolean).map(String) : [],
      notes: typeof sections.sources?.notes === "string" ? sections.sources.notes : "",
    },
  };
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map(String) : [];
}

function buildWeekVariantFromWeeklyStructure(
  weeklyStructure: string[],
  keyWorkouts: string[],
  summary: string,
): TrainingPlanWeekVariant[] {
  if (!weeklyStructure.length) return [];

  const workoutHints = keyWorkouts.join(" | ");
  const days = weeklyStructure.map((line, index) => {
    const text = String(line || "").trim();
    if (!text) return null;

    const [headRaw, ...rest] = text.split(":");
    const hasExplicitDay = rest.length > 0;
    const dayLabel = hasExplicitDay ? headRaw.trim() : `Tag ${index + 1}`;
    const detailsText = hasExplicitDay ? rest.join(":").trim() : text;
    const sessionLabel = detailsText.split(",")[0]?.trim() || detailsText || "Einheit";

    return {
      day_label: dayLabel,
      session_label: sessionLabel,
      objective: detailsText,
      details: workoutHints ? `${detailsText}${detailsText.endsWith(".") ? "" : "."} Schlüsseleinheiten: ${workoutHints}` : detailsText,
      duration_hint: "laut Wochenstruktur",
      intensity_hint: "gemäß Plan",
    };
  }).filter((day): day is TrainingPlanWeekDay => Boolean(day));

  if (!days.length) return [];

  return [
    {
      title: "Aktueller Wochenplan",
      summary: summary || "Aus der Wochenstruktur direkt abgeleiteter Plan.",
      level: `${days.length} Tage`,
      suitable_for: "direkte Darstellung aus der erzeugten Wochenstruktur",
      days,
    },
  ];
}

function normalizeTrainingPlanPayload(value: unknown): TrainingPlanDraftResponse | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<TrainingPlanDraftResponse>;
  const planTitle = typeof payload.plan_title === "string" && payload.plan_title.trim() ? payload.plan_title.trim() : "";
  const summary = typeof payload.summary === "string" && payload.summary.trim() ? payload.summary.trim() : "";
  if (!planTitle && !summary) return null;

  const weekVariants = Array.isArray(payload.week_variants)
    ? payload.week_variants
        .map((variant) => {
          if (!variant || typeof variant !== "object") return null;
          const item = variant as Partial<TrainingPlanWeekVariant>;
          const days = Array.isArray(item.days)
            ? item.days
                .map((day) => {
                  if (!day || typeof day !== "object") return null;
                  const entry = day as Partial<TrainingPlanWeekDay>;
                  const dayLabel = typeof entry.day_label === "string" ? entry.day_label.trim() : "";
                  const sessionLabel = typeof entry.session_label === "string" ? entry.session_label.trim() : "";
                  if (!dayLabel || !sessionLabel) return null;
                  return {
                    day_label: dayLabel,
                    session_label: sessionLabel,
                    objective: typeof entry.objective === "string" ? entry.objective.trim() : "",
                    details: typeof entry.details === "string" ? entry.details.trim() : "",
                    duration_hint: typeof entry.duration_hint === "string" ? entry.duration_hint.trim() : "",
                    intensity_hint: typeof entry.intensity_hint === "string" ? entry.intensity_hint.trim() : "",
                  };
                })
                .filter((day): day is TrainingPlanWeekDay => Boolean(day))
            : [];
          if (!days.length) return null;
          return {
            title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Wochenvariante",
            summary: typeof item.summary === "string" ? item.summary.trim() : "",
            level: typeof item.level === "string" ? item.level.trim() : "",
            suitable_for: typeof item.suitable_for === "string" ? item.suitable_for.trim() : "",
            days,
          };
        })
        .filter((variant): variant is TrainingPlanWeekVariant => Boolean(variant))
    : [];

  const weeklyStructure = normalizeStringList(payload.weekly_structure);
  const keyWorkouts = normalizeStringList(payload.key_workouts);
  const normalizedWeekVariants = weekVariants.length
    ? weekVariants
    : buildWeekVariantFromWeeklyStructure(weeklyStructure, keyWorkouts, summary);

  return {
    plan_title: planTitle || "Trainingsplan",
    summary,
    weekly_structure: weeklyStructure,
    week_variants: normalizedWeekVariants,
    key_workouts: keyWorkouts,
    progression_notes: normalizeStringList(payload.progression_notes),
    watchouts: normalizeStringList(payload.watchouts),
    why_this_plan_fits: normalizeStringList(payload.why_this_plan_fits),
    adoption_checklist: normalizeStringList(payload.adoption_checklist),
    prompt: typeof payload.prompt === "string" ? payload.prompt : "",
    model: typeof payload.model === "string" ? payload.model : null,
    sections: Array.isArray(payload.sections) ? payload.sections : [],
  };
}

function cloneTrainingConfigState(
  state: Record<TrainingConfigTabKey, TrainingConfigSectionState>,
): Record<TrainingConfigTabKey, TrainingConfigSectionState> {
  return {
    profile: {
      focus_ids: [...state.profile.focus_ids],
      notes: state.profile.notes,
    },
    goals: {
      focus_ids: [...state.goals.focus_ids],
      notes: state.goals.notes,
    },
    week: {
      focus_ids: [...state.week.focus_ids],
      notes: state.week.notes,
    },
    sources: {
      focus_ids: [...state.sources.focus_ids],
      notes: state.sources.notes,
    },
  };
}

function buildTrainingConfigProfileUpdatePayload(tabState: Record<TrainingConfigTabKey, TrainingConfigSectionState>) {
  return {
    sections: cloneTrainingConfigState(tabState),
  };
}

function loadTrainingConfigDraft(): Record<TrainingConfigTabKey, TrainingConfigSectionState> | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(TRAINING_CONFIG_DRAFT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { sections?: unknown };
    return normalizeTrainingConfigProfileState({
      training_config: {
        sections: (parsed && typeof parsed === "object" ? parsed.sections : undefined) as
          | Partial<Record<TrainingConfigTabKey, Partial<TrainingConfigSectionState>>>
          | undefined,
      },
    });
  } catch {
    window.localStorage.removeItem(TRAINING_CONFIG_DRAFT_STORAGE_KEY);
    return null;
  }
}

function persistTrainingConfigDraft(tabState: Record<TrainingConfigTabKey, TrainingConfigSectionState>) {
  if (typeof window === "undefined") return;
  if (!hasTrainingConfigContent(tabState)) {
    window.localStorage.removeItem(TRAINING_CONFIG_DRAFT_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    TRAINING_CONFIG_DRAFT_STORAGE_KEY,
    JSON.stringify({
      sections: cloneTrainingConfigState(tabState),
      updated_at: new Date().toISOString(),
    }),
  );
}

function clearTrainingConfigDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TRAINING_CONFIG_DRAFT_STORAGE_KEY);
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

function normalizeZoneEducationKey(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("recovery")) return "recovery";
  if (normalized.includes("active recovery")) return "recovery";
  if (normalized.includes("ga1")) return "ga1";
  if (normalized.includes("endurance")) return "ga1";
  if (normalized.includes("grundlage")) return "ga1";
  if (normalized.includes("ga2")) return "ga2";
  if (normalized.includes("tempo")) return "ga2";
  if (normalized.includes("sweetspot")) return "sweetspot";
  if (normalized.includes("kraftausdauer")) return "strength_endurance";
  if (normalized.includes("threshold")) return "threshold";
  if (normalized.includes("schwelle")) return "threshold";
  if (normalized.includes("vo2")) return "vo2max";
  if (normalized.includes("anaer")) return "anaerobic";
  if (normalized.includes("sprint")) return "sprint";
  if (normalized.includes("hoch")) return "high";
  if (normalized.includes("mittel")) return "middle";
  if (normalized.includes("niedrig")) return "low";
  return "generic";
}

function getZoneEducationContent(metricType: "ftp" | "max_hr", label: string): ZoneEducationContent {
  const key = normalizeZoneEducationKey(label);

  const genericPower = {
    title: label,
    summary: "Diese Zone ist ein definierter Belastungsbereich innerhalb deines aktuellen Zonenmodells. Sie hilft dir, Reize bewusst zu setzen statt nur irgendwie hart oder locker zu fahren.",
    howToTrain: [
      "Einheiten in dieser Zone sollten einen klaren Zweck haben: Erholung, Grundlage, Tempo oder Spitzenreiz.",
      "Nutze die Zone nicht isoliert, sondern immer im Kontext von Wochenbelastung, Schlaf und Gesamtstress.",
    ],
    lowerBand: "Im unteren Bereich der Zone bleibt der Reiz kontrollierter und besser wiederholbar.",
    middleBand: "Im mittleren Bereich triffst du meist den Kernreiz der Zone am saubersten.",
    upperBand: "Im oberen Bereich wird die Einheit spezifischer und fordernder, aber auch schwerer sauber zu dosieren.",
  } satisfies ZoneEducationContent;

  const genericHeartRate = {
    title: label,
    summary: "Diese Herzfrequenzzone ist ein praktischer Steuerungsbereich für Einheiten mit stabiler Belastung. Sie reagiert träger als Leistung, ist aber sehr hilfreich für längere, saubere Belastungen.",
    howToTrain: [
      "Plane die Belastung mit etwas Geduld, weil die Herzfrequenz auf Belastungswechsel verzögert reagiert.",
      "Beobachte Temperatur, Müdigkeit und Koffein, weil sie die Herzfrequenz spürbar beeinflussen können.",
    ],
    lowerBand: "Im unteren Bereich bleibt die Belastung ruhiger und oft nachhaltiger.",
    middleBand: "Im mittleren Bereich bist du meist sauber im beabsichtigten Trainingsreiz.",
    upperBand: "Im oberen Bereich steigt die Beanspruchung deutlich; dort lohnt sich besonders sauberes Pacing.",
  } satisfies ZoneEducationContent;

  const library: Record<string, ZoneEducationContent> = metricType === "ftp"
    ? {
        recovery: {
          title: "Recovery",
          summary: "Recovery ist echte Entlastung. Hier sammelst du keine große Fitness über Härte, sondern sorgst dafür, dass der Körper Belastung verarbeiten kann.",
          howToTrain: [
            "Fahre sehr locker mit ruhigem Tritt und ohne Druck auf die Pedale.",
            "Nutze die Zone für aktive Erholung nach harten Tagen, zwischen Intervallen oder an müden Tagen.",
          ],
          lowerBand: "Ganz unten ist es fast nur Bewegung und Durchblutung. Ideal für Regeneration und lockeres Rollen.",
          middleBand: "In der Mitte bleibt es locker, aber schon etwas flüssiger. Gut für Recovery Rides mit etwas Rhythmus.",
          upperBand: "Oben wird es schnell zu flott für echte Erholung. Das kann noch okay sein, aber der Regenerationseffekt wird kleiner.",
        },
        ga1: {
          title: "GA1",
          summary: "GA1 ist der klassische Grundlagenteil. Hier baust du Ausdauer, Ökonomie und Belastungsverträglichkeit mit relativ geringem Stress auf.",
          howToTrain: [
            "Längere ruhige Ausfahrten, lockere Indoor-Rides oder stabile Dauerfahrten passen sehr gut in diesen Bereich.",
            "Achte auf gleichmäßiges Pacing und darauf, dass du am Ende noch kontrolliert fahren könntest.",
          ],
          lowerBand: "Im unteren GA1-Bereich trainierst du sehr entspannt und sammelst viel Umfang mit wenig Ermüdung.",
          middleBand: "Im mittleren Bereich liegst du oft ideal für klassische Grundlagenfahrten: ruhig, aber trotzdem klarer Ausdauerreiz.",
          upperBand: "Im oberen Bereich wird GA1 schon zügiger. Gut für etwas sportlichere Dauerfahrten, aber nicht mehr ganz so regenerationsfreundlich.",
        },
        ga2: {
          title: "GA2",
          summary: "GA2 ist der zügigere Ausdauer- und Tempobereich. Er ist deutlich fordernder als GA1 und eignet sich gut für kontrolliert harte Dauerarbeit.",
          howToTrain: [
            "Typisch sind längere Tempoblöcke, zügige Abschnitte in langen Ausfahrten oder steady-state Intervalle.",
            "Fahre hier bewusst kontrolliert und nicht als 'halbe Rennsimulation', sonst wird die Ermüdung schnell unnötig hoch.",
          ],
          lowerBand: "Unten in GA2 bleibt die Belastung noch gut kontrollierbar und ist oft ideal für längere Tempoblöcke.",
          middleBand: "Die Mitte ist meist der klassische Sweet Spot des Tempobereichs: fordernd, aber noch stabil zu halten.",
          upperBand: "Oben in GA2 näherst du dich stark der Schwelle. Das ist wirksam, aber auch deutlich kostspieliger in der Erholung.",
        },
        sweetspot: {
          title: "Sweetspot",
          summary: "Sweetspot liegt typischerweise zwischen zügigem Tempo und Schwelle. Der Bereich liefert viel Trainingsreiz pro Zeiteinheit, ohne ganz so teuer zu sein wie voll ausgefahrene Schwellenarbeit.",
          howToTrain: [
            "Typisch sind längere Blöcke wie 2x20, 3x15 oder 4x10 Minuten mit kontrolliertem, ruhigem Druck.",
            "Sweetspot funktioniert am besten gleichmäßig und sauber gepaced, nicht als halbes Rennen.",
          ],
          lowerBand: "Im unteren Sweetspot-Bereich ist die Belastung noch gut kontrollierbar und eignet sich besonders für längere Intervalle.",
          middleBand: "In der Mitte liegt oft der produktivste Bereich: hoher Reiz, aber noch solide wiederholbar.",
          upperBand: "Oben wird Sweetspot schon sehr schwellennah. Wirksam, aber deutlich anspruchsvoller für Erholung und saubere Wiederholungen.",
        },
        strength_endurance: {
          title: "Kraftausdauer",
          summary: "Kraftausdauer ist kein eigenes physiologisches Zonenmodell, sondern eher eine Trainingsform: relativ hoher Druck, oft bei niedriger Kadenz, meist im Bereich von hohem GA2 bis Schwelle.",
          howToTrain: [
            "Typisch sind längere Blöcke mit bewusst niedrigerer Kadenz, zum Beispiel am Anstieg oder auf der Rolle mit sauberer Spannung.",
            "Wichtig ist, dass der Druck muskulär deutlich spürbar ist, ohne technisch zu verkrampfen oder komplett zu überziehen.",
          ],
          lowerBand: "Im unteren Bereich bleibt Kraftausdauer eher kontrolliert und eignet sich gut für längere muskuläre Blöcke.",
          middleBand: "In der Mitte verbindest du muskulären Druck und stabile Ausdauerarbeit meist am sinnvollsten.",
          upperBand: "Oben wird Kraftausdauer sehr schwellennah und deutlich fordernder. Das ist eher für gezielte Reize als für viel Umfang gedacht.",
        },
        threshold: {
          title: "Schwelle",
          summary: "Schwellentraining entwickelt deine Fähigkeit, hohe Leistung lange stabil zu halten. Es ist einer der wichtigsten Bereiche für ambitionierte Ausdauerleistung.",
          howToTrain: [
            "Arbeite mit klaren Intervallen wie 2x20, 3x12 oder ähnlichen strukturierten Blöcken mit bewusster Pause.",
            "Wichtig ist sauberes Dosieren: lieber konstant stark als zu hart starten und hinten zerfallen.",
          ],
          lowerBand: "Im unteren Schwellenbereich ist die Arbeit noch etwas kontrollierter und oft gut für längere Intervalldauer.",
          middleBand: "In der Mitte setzt du meist den präzisesten Schwellenreiz, ohne unnötig ins Überziehen zu kommen.",
          upperBand: "Oben wird es sehr spezifisch und hart. Das kann sinnvoll sein, ist aber deutlich schwerer sauber über mehrere Wiederholungen zu halten.",
        },
        vo2max: {
          title: "VO2max",
          summary: "VO2max-Training zielt auf hohe Sauerstoffaufnahme und starke zentrale Belastung. Es ist kurz, hart und braucht gute Erholung drumherum.",
          howToTrain: [
            "Nutze eher kürzere harte Intervalle mit klarer Struktur, zum Beispiel 3-5 Minuten oder gebrochene Blöcke.",
            "Die Qualität zählt mehr als reines Leiden. Saubere Wiederholungen sind wertvoller als ein chaotischer Vollgas-Tag.",
          ],
          lowerBand: "Im unteren Bereich ist der Reiz etwas kontrollierbarer und oft gut für den Einstieg in diese Intensität.",
          middleBand: "Die Mitte ist häufig ideal: hoch genug für einen starken Reiz, aber noch wiederholbar.",
          upperBand: "Ganz oben wird es sehr aggressiv. Das lohnt sich eher für kurze Intervalle und gut erholte Tage.",
        },
        anaerobic: {
          title: "Anaerob",
          summary: "Anaerobe Arbeit schult hohe Laktatbildung, harte Beschleunigungen und sehr intensive Belastungsspitzen. Diese Zone ist kein Alltagswerkzeug, sondern ein gezielter Spezialreiz.",
          howToTrain: [
            "Typisch sind kurze harte Wiederholungen, Antritte oder über der VO2max liegende Intervalle mit ausreichend Pause.",
            "Plane solche Reize sparsam und mit frischen Beinen, sonst sinkt die Qualität schnell ab.",
          ],
          lowerBand: "Im unteren Bereich ist die Belastung immer noch sehr hart, aber meist noch etwas strukturierter zu wiederholen.",
          middleBand: "In der Mitte erzeugst du einen klaren Hochintensitätsreiz mit starkem anaeroben Anteil.",
          upperBand: "Im oberen Bereich geht es Richtung maximale Spitzen. Sehr wirksam, aber auch sehr teuer in Ermüdung und Erholung.",
        },
        sprint: {
          title: "Sprint",
          summary: "Sprint steht für sehr kurze Spitzenleistung, neuromuskuläre Aktivierung und maximale Beschleunigung. Hier geht es eher um Qualität als um lange Belastungszeit.",
          howToTrain: [
            "Fahre sehr kurze explosive Sprints mit voller Konzentration, langer Pause und sauberer Technik.",
            "Wenig Wiederholungen in hoher Qualität bringen meist mehr als viele schlechte Sprints in Müdigkeit.",
          ],
          lowerBand: "Im unteren Bereich bleibt es eher ein kräftiger Antritt als ein echter Maximalsprint.",
          middleBand: "In der Mitte trainierst du starke Beschleunigung mit noch relativ guter technischer Kontrolle.",
          upperBand: "Ganz oben geht es um maximale Spitzenleistung. Das braucht volle Frische, Fokus und lange Erholung.",
        },
        low: {
          title: "Niedrige Zone",
          summary: "Im vereinfachten Modell bündelt diese Zone lockere bis moderate Dauerarbeit. Sie bildet die stabile Basis für viel Trainingszeit.",
          howToTrain: [
            "Nutze sie für ruhige Dauerfahrten, lockere Koppeltage und die meisten umfangsorientierten Einheiten.",
            "Der Fokus liegt auf Konstanz, nicht auf Drücken.",
          ],
          lowerBand: "Ganz unten ist der Reiz sehr locker und regenerationsnah.",
          middleBand: "Die Mitte ist oft ideal für lange ruhige Ausdauereinheiten.",
          upperBand: "Oben wird die Dauerarbeit schon sportlicher und driftet Richtung zügige Grundlage.",
        },
        middle: {
          title: "Mittlere Zone",
          summary: "Die mittlere Zone bündelt Tempo bis schwellennahe Arbeit. Sie ist deutlich wirksamer, aber auch spürbar teurer als lockere Grundlage.",
          howToTrain: [
            "Nutze sie für längere kontrollierte Blöcke, wenn du gezielt Druck machen willst, ohne voll in Hochintensität zu gehen.",
            "Sauberes Pacing ist hier entscheidend.",
          ],
          lowerBand: "Unten liegt die Belastung näher an steady-state Tempoarbeit.",
          middleBand: "In der Mitte sitzt meist der zentrale spezifische Reiz.",
          upperBand: "Oben wird es schnell schwellennah und deutlich fordernder.",
        },
        high: {
          title: "Hohe Zone",
          summary: "Die hohe Zone steht für harte bis sehr harte Belastungen oberhalb des kontrollierten Dauerbereichs. Sie sollte bewusst und sparsam eingesetzt werden.",
          howToTrain: [
            "Verwende sie für strukturierte harte Intervalle oder rennnahe Spitzenreize.",
            "Diese Zone verlangt gute Erholung und klare Qualität.",
          ],
          lowerBand: "Unten bleibt die harte Arbeit noch etwas kontrollierbarer.",
          middleBand: "In der Mitte entsteht ein klarer Hochintensitätsreiz.",
          upperBand: "Oben geht es an sehr harte Spitzen mit hoher Ermüdung.",
        },
      }
    : {
        recovery: {
          title: "Recovery",
          summary: "In der Recovery-Herzfrequenzzone geht es um Erholung, Bewegung und lockere Aktivierung. Das ist keine Zone zum Sammeln harter Trainingsreize.",
          howToTrain: [
            "Halte die Belastung bewusst ruhig und lasse die Herzfrequenz nicht unnötig hochlaufen.",
            "Ideal für Recovery-Rides, Einrollen, Ausrollen oder sehr müde Tage.",
          ],
          lowerBand: "Ganz unten bleibt die Einheit fast rein regenerativ.",
          middleBand: "In der Mitte ist es weiterhin locker, aber etwas flüssiger.",
          upperBand: "Oben wird es für echte Recovery schon relativ lebhaft.",
        },
        ga1: {
          title: "Grundlage / GA1",
          summary: "Die Grundlage-Herzfrequenzzone ist dein ruhiger aerober Dauerbereich. Sie ist sehr wertvoll für Umfang, Fettstoffwechsel und nachhaltige Belastbarkeit.",
          howToTrain: [
            "Passe die Leistung so an, dass die Herzfrequenz stabil in diesem Bereich bleibt.",
            "Besonders gut geeignet für längere Ausdauerfahrten und kontrollierte Alltagseinheiten.",
          ],
          lowerBand: "Unten ist der Reiz ruhig und gut für sehr lange oder lockere Tage.",
          middleBand: "In der Mitte liegt meist die saubere klassische Grundlagenausdauer.",
          upperBand: "Oben wird die Dauerarbeit sportlicher und driftet Richtung zügigere Ausdauer.",
        },
        ga2: {
          title: "GA2 / Tempo",
          summary: "In dieser Herzfrequenzzone wird die Belastung deutlich fordernder. Sie eignet sich gut für steady-state Arbeit und zügige längere Belastungen.",
          howToTrain: [
            "Steuere hier mit Geduld, weil die Herzfrequenz verzögert reagiert und ansteigt.",
            "Geeignet für längere Tempoblöcke oder kontrolliert zügige Dauerfahrten.",
          ],
          lowerBand: "Unten bleibt die Zone noch recht gut kontrollierbar.",
          middleBand: "In der Mitte sitzt oft der beste Reiz für zügige, aber stabile Ausdauerarbeit.",
          upperBand: "Oben wird die Belastung schnell schwellennah und deutlich ermüdender.",
        },
        threshold: {
          title: "Schwelle",
          summary: "Schwellennahe Herzfrequenzarbeit steht für längere fordernde Belastung nahe deinem nachhaltigen Limit. Sie ist wirksam, aber eher schwer präzise zu steuern als Leistung.",
          howToTrain: [
            "Nutze sie eher für längere stabile Intervalle oder kontinuierliche Belastung als für sehr kurze Wechsel.",
            "Achte auf Drift: Gerade bei längeren Blöcken steigt die Herzfrequenz oft noch langsam weiter an.",
          ],
          lowerBand: "Unten bleibt der Reiz kontrollierbarer und oft alltagstauglicher.",
          middleBand: "In der Mitte triffst du meist den klaren schwellenorientierten Reiz.",
          upperBand: "Oben wird es sehr hart und kann durch Herzfrequenzdrift schnell zu hoch werden.",
        },
        high: {
          title: "Hoch",
          summary: "Diese Zone bündelt harte bis maximale Herzfrequenzarbeit. Sie eignet sich für sehr fordernde Intervalle und rennnahe Belastungen.",
          howToTrain: [
            "Nutze sie eher als Ergebnis harter Intervalle, nicht als Zielgröße für sehr kurze Sprints.",
            "Plane genügend Erholung vor und nach solchen Einheiten ein.",
          ],
          lowerBand: "Unten ist die Arbeit hart, aber noch eher kontrollierbar.",
          middleBand: "In der Mitte liegst du klar im hochintensiven Bereich.",
          upperBand: "Oben wird es maximalnah und sehr teuer in Ermüdung.",
        },
        low: genericHeartRate,
        middle: {
          ...genericHeartRate,
          title: "Mittlere Zone",
        },
      };

  return library[key] ?? (metricType === "ftp" ? genericPower : genericHeartRate);
}

function formatRatioPercentRange(minRatio: number, maxRatio: number | null): string {
  const min = roundValue(minRatio * 100);
  if (maxRatio == null) {
    return `ab ${min}%`;
  }
  const max = roundValue(maxRatio * 100);
  if (min === 0) {
    return `bis ${max}%`;
  }
  return `${min}-${max}%`;
}

function buildZoneBands(metricType: "ftp" | "max_hr", currentValue: number, zone: Pick<ZoneEducationItem, "minRatio" | "maxRatio">, content: ZoneEducationContent): ZoneBandSpec[] {
  const effectiveMax =
    zone.maxRatio ?? Number((zone.minRatio + (metricType === "ftp" ? 0.24 : 0.09)).toFixed(2));
  const span = Math.max(0.03, effectiveMax - zone.minRatio);
  const firstUpper = Number((zone.minRatio + span / 3).toFixed(4));
  const secondUpper = Number((zone.minRatio + (span * 2) / 3).toFixed(4));
  const lowerMax = zone.maxRatio == null ? firstUpper : Math.min(firstUpper, effectiveMax);
  const middleMin = zone.maxRatio == null ? firstUpper : Math.min(firstUpper, effectiveMax);
  const middleMax = zone.maxRatio == null ? secondUpper : Math.min(secondUpper, effectiveMax);
  const upperMin = zone.maxRatio == null ? secondUpper : Math.min(secondUpper, effectiveMax);

  return [
    {
      label: "Unterer Bereich",
      rangePercent: formatRatioPercentRange(zone.minRatio, lowerMax),
      rangeValue: formatZoneRange(metricType, currentValue, zone.minRatio, lowerMax),
      explanation: content.lowerBand,
    },
    {
      label: "Mittlerer Bereich",
      rangePercent: formatRatioPercentRange(middleMin, middleMax),
      rangeValue: formatZoneRange(metricType, currentValue, middleMin, middleMax),
      explanation: content.middleBand,
    },
    {
      label: "Oberer Bereich",
      rangePercent: formatRatioPercentRange(upperMin, zone.maxRatio),
      rangeValue: formatZoneRange(metricType, currentValue, upperMin, zone.maxRatio),
      explanation: content.upperBand,
    },
  ];
}

function buildEducationItems(metricType: "ftp" | "max_hr", currentValue: number, zones: EditableZone[]): ZoneEducationItem[] {
  const baseItems: ZoneEducationItem[] = zones.map((zone) => ({
    label: zone.label,
    range: zone.range,
    detail: zone.detail,
    minRatio: zone.minRatio,
    maxRatio: zone.maxRatio,
  }));

  if (metricType !== "ftp") {
    return baseItems;
  }

  const supplemental: ZoneEducationItem[] = [
    {
      label: "Sweetspot",
      range: formatZoneRange("ftp", currentValue, 0.88, 0.94),
      detail: "Zwischen hohem GA2 und Schwelle, sehr effizient für längere strukturierte Intervalle.",
      minRatio: 0.88,
      maxRatio: 0.94,
    },
    {
      label: "Kraftausdauer",
      range: formatZoneRange("ftp", currentValue, 0.82, 0.97),
      detail: "Muskulär betonte Arbeit mit Druck auf dem Pedal, oft bei niedriger Kadenz im Bereich hohes GA2 bis Schwelle.",
      minRatio: 0.82,
      maxRatio: 0.97,
    },
  ];

  return baseItems.concat(supplemental);
}

function TrainingZoneEducation({
  metricType,
  currentValue,
  zones,
}: {
  metricType: "ftp" | "max_hr";
  currentValue: number;
  zones: EditableZone[];
}) {
  const educationItems = useMemo(() => buildEducationItems(metricType, currentValue, zones), [currentValue, metricType, zones]);
  const [activeZoneLabel, setActiveZoneLabel] = useState<string | null>(educationItems[0]?.label ?? null);

  useEffect(() => {
    if (!educationItems.length) {
      setActiveZoneLabel(null);
      return;
    }
    if (!activeZoneLabel || !educationItems.some((zone) => zone.label === activeZoneLabel)) {
      setActiveZoneLabel(educationItems[0].label);
    }
  }, [activeZoneLabel, educationItems]);

  if (!educationItems.length || !activeZoneLabel) return null;

  const activeZone = educationItems.find((zone) => zone.label === activeZoneLabel) ?? educationItems[0];
  const content = getZoneEducationContent(metricType, activeZone.label);
  const bands = buildZoneBands(metricType, currentValue, activeZone, content);
  const sourceContent = zoneInfoContent[metricType];

  return (
    <section className="training-zone-education">
      <div className="training-zone-education-head">
        <div>
          <h4>Zonen erklärt</h4>
          <p>Wähle eine Zone aus. Dann siehst du Bedeutung, Trainingsidee und wie sich unterer, mittlerer und oberer Bereich unterscheiden.</p>
        </div>
      </div>

      <div className="training-zone-education-tabs" role="tablist" aria-label="Trainingszonen erklärt">
        {educationItems.map((zone) => (
          <button
            key={`education-${zone.label}`}
            className={`training-zone-education-tab ${zone.label === activeZone.label ? "active" : ""}`}
            type="button"
            onClick={() => setActiveZoneLabel(zone.label)}
          >
            <strong>{zone.label}</strong>
            <span>{zone.range}</span>
          </button>
        ))}
      </div>

      <div className="training-zone-education-card">
        <div className="training-zone-education-title">
          <div>
            <p className="training-config-kicker">Teilinfo Trainingszonen</p>
            <h4>{content.title}</h4>
          </div>
          <span>{activeZone.range}</span>
        </div>

        <p className="training-zone-education-summary">{content.summary}</p>

        <div className="training-zone-education-grid">
          <div className="training-zone-education-block">
            <h5>Wie trainiert man das?</h5>
            <ul className="training-config-list">
              {content.howToTrain.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          {bands.map((band) => (
            <div key={band.label} className="training-zone-education-block">
              <h5>{band.label}</h5>
              <div className="training-zone-education-ranges">
                <strong>{band.rangePercent}</strong>
                <span>{band.rangeValue}</span>
              </div>
              <p>{band.explanation}</p>
            </div>
          ))}
        </div>

        <div className="training-zone-education-sources">
          <h5>Quellen</h5>
          <div className="training-source-list">
            {sourceContent.sources.map((source) => (
              <a key={`${activeZone.label}-${source.href}`} className="training-source-card" href={source.href} target="_blank" rel="noreferrer">
                <strong>{source.label}</strong>
                <span>{source.note}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TrainingWeekVariants({ variants }: { variants: TrainingPlanWeekVariant[] }) {
  if (!variants.length) return null;

  return (
    <div className="training-plan-variant-stack">
      <div className="training-profile-builder-head">
        <h3>Wochenvarianten</h3>
        <p>Das LLM hat daraus konkrete Wochenlayouts abgeleitet, damit der Plan nicht nur konzeptionell, sondern direkt alltagstauglich lesbar wird.</p>
      </div>

      <div className="training-plan-variant-grid">
        {variants.map((variant) => (
          <div key={variant.title} className="training-profile-builder-card training-plan-variant-card">
            <div className="training-profile-builder-head">
              <p className="training-config-kicker">{variant.level || "Wochenvariante"}</p>
              <h3>{variant.title}</h3>
              {variant.summary ? <p>{variant.summary}</p> : null}
              {variant.suitable_for ? <p className="training-note">Passend für: {variant.suitable_for}</p> : null}
            </div>

            <div className="training-plan-week-list">
              {variant.days.map((day) => (
                <div key={`${variant.title}-${day.day_label}`} className="training-plan-week-item">
                  <div className="training-plan-week-head">
                    <strong>{day.day_label}</strong>
                    <span>{day.session_label}</span>
                  </div>
                  {day.objective ? <p><strong>Ziel:</strong> {day.objective}</p> : null}
                  {day.details ? <p>{day.details}</p> : null}
                  {(day.duration_hint || day.intensity_hint) ? (
                    <div className="training-plan-week-meta">
                      {day.duration_hint ? <span>{day.duration_hint}</span> : null}
                      {day.intensity_hint ? <span>{day.intensity_hint}</span> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
          <TrainingZoneEducation metricType={config.apiMetricType} currentValue={currentEntry.value} zones={zones} />
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
  const activeZoneSetting = activeMetricTab === "ftp" ? (zoneSettings.ftp ?? null) : (zoneSettings.max_hr ?? null);
  const activeZoneOptions = activeMetricTab === "ftp" ? (zoneOptions.ftp ?? []) : (zoneOptions.max_hr ?? []);
  const activeZoneSaving = zoneSavingMetric === activeMetricConfig.apiMetricType;
  const activeEducationZones = useMemo(() => {
    const currentEntry = activeEntries[0] ?? null;
    if (!currentEntry || !activeZoneSetting) return [];
    const zoneDefinitions = getZoneDefinitions(activeMetricConfig.apiMetricType, activeZoneSetting.model_key);
    if (!zoneDefinitions.length) return [];
    const defaultUpperBounds = getEditableUpperBounds(zoneDefinitions);
    const defaultColors = getDefaultZoneColors(activeMetricConfig.apiMetricType, zoneDefinitions.length);
    const upperBounds = normalizeUpperBounds(activeZoneSetting.custom_upper_bounds, defaultUpperBounds);
    const colors = normalizeZoneColors(activeZoneSetting.custom_colors, defaultColors);
    return buildEditableZones(activeMetricConfig.apiMetricType, currentEntry.value, zoneDefinitions, upperBounds, colors);
  }, [activeEntries, activeMetricConfig.apiMetricType, activeZoneSetting]);

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

      <TrainingSection
        title="Trainingszonen Erklaert"
        description="Hier findest du die fachliche Einordnung der wichtigsten Zonen. Waehle oben FTP oder MaxHF, dann passen sich die Erklaerungen direkt an dein aktuelles Zonenmodell an."
        highlight
      >
        {activeEducationZones.length ? (
          <TrainingZoneEducation metricType={activeMetricConfig.apiMetricType} currentValue={activeEntries[0]?.value ?? 0} zones={activeEducationZones} />
        ) : (
          <div className="training-empty-state">
            <strong>Noch keine Trainingszonen verfuegbar.</strong>
            <span>Lege zuerst einen FTP- oder MaxHF-Wert an, damit die Zonen und die Erklaerungen angezeigt werden.</span>
          </div>
        )}
      </TrainingSection>

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

function TrainingConfigPageLegacy() {
  const [activeConfigTab, setActiveConfigTab] = useState<TrainingConfigTabKey>("profile");
  const activeTabConfig =
    trainingConfigTabDefinitions.find((tab) => tab.key === activeConfigTab) ?? trainingConfigTabDefinitions[0];
  const activeWorkbenchConfig = trainingConfigWorkbenchConfigs[activeConfigTab];
  const [tabFocusIds, setTabFocusIds] = useState<Record<TrainingConfigTabKey, string[]>>({
    profile: [],
    goals: [],
    week: [],
    sources: [],
  });
  const [tabNotes, setTabNotes] = useState<Record<TrainingConfigTabKey, string>>({
    profile: "",
    goals: "",
    week: "",
    sources: "",
  });
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [llmLoading, setLlmLoading] = useState(true);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [tabPromptMessages, setTabPromptMessages] = useState<Record<TrainingConfigTabKey, string | null>>({
    profile: null,
    goals: null,
    week: null,
    sources: null,
  });
  const [tabDeriveLoading, setTabDeriveLoading] = useState<Record<TrainingConfigTabKey, boolean>>({
    profile: false,
    goals: false,
    week: false,
    sources: false,
  });
  const [tabDeriveErrors, setTabDeriveErrors] = useState<Record<TrainingConfigTabKey, string | null>>({
    profile: null,
    goals: null,
    week: null,
    sources: null,
  });
  const [tabDeriveResults, setTabDeriveResults] = useState<Record<TrainingConfigTabKey, AthleteProfileDeriveResponse | null>>({
    profile: null,
    goals: null,
    week: null,
    sources: null,
  });

  const activeFocusIds = tabFocusIds[activeConfigTab];
  const activeNotes = tabNotes[activeConfigTab];
  const activePromptMessage = tabPromptMessages[activeConfigTab];
  const activeDeriveLoading = tabDeriveLoading[activeConfigTab];
  const activeDeriveError = tabDeriveErrors[activeConfigTab];
  const activeDeriveResult = tabDeriveResults[activeConfigTab];
  const activeSectionTitle = getTrainingConfigTabTitle(activeConfigTab);

  const selectedFocusItems = useMemo(
    () => getSelectedTrainingConfigFocusItems(activeConfigTab, activeFocusIds),
    [activeConfigTab, activeFocusIds],
  );

  const activePrompt = useMemo(
    () => buildTrainingConfigPromptPreview(activeSectionTitle, selectedFocusItems, activeNotes),
    [activeNotes, activeSectionTitle, selectedFocusItems],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadLlmStatus() {
      setLlmLoading(true);
      setLlmError(null);
      try {
        const response = await apiFetch(`${API_BASE_URL}/llm/status`);
        const payload = await parseJsonSafely<LlmStatus | { detail?: string }>(response);
        if (!response.ok) {
          throw new Error(
            typeof payload === "object" && payload && "detail" in payload && payload.detail
              ? payload.detail
              : "LLM-Status konnte nicht geladen werden.",
          );
        }
        if (isMounted) {
          setLlmStatus(payload as LlmStatus);
        }
      } catch (err) {
        if (isMounted) {
          setLlmError(err instanceof Error ? err.message : "LLM-Status konnte nicht geladen werden.");
        }
      } finally {
        if (isMounted) {
          setLlmLoading(false);
        }
      }
    }

    void loadLlmStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  function toggleFocusItem(tabKey: TrainingConfigTabKey, id: string) {
    setTabPromptMessages((current) => ({ ...current, [tabKey]: null }));
    setTabDeriveErrors((current) => ({ ...current, [tabKey]: null }));
    setTabFocusIds((current) => ({
      ...current,
      [tabKey]: current[tabKey].includes(id) ? current[tabKey].filter((entry) => entry !== id) : [...current[tabKey], id],
    }));
  }

  function moveFocusItem(tabKey: TrainingConfigTabKey, id: string, direction: -1 | 1) {
    setTabPromptMessages((current) => ({ ...current, [tabKey]: null }));
    setTabDeriveErrors((current) => ({ ...current, [tabKey]: null }));
    setTabFocusIds((current) => {
      const currentItems = current[tabKey];
      const index = currentItems.indexOf(id);
      if (index === -1) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= currentItems.length) return current;
      const nextItems = currentItems.slice();
      const [item] = nextItems.splice(index, 1);
      nextItems.splice(nextIndex, 0, item);
      return { ...current, [tabKey]: nextItems };
    });
  }

  function applyRecommendedFocusOrder(tabKey: TrainingConfigTabKey) {
    const deriveResult = tabDeriveResults[tabKey];
    if (!deriveResult?.recommended_focus_order.length) return;

    const labelToId = new Map(trainingConfigWorkbenchConfigs[tabKey].focusItems.map((item) => [item.label, item.id]));
    const suggestedIds = deriveResult.recommended_focus_order
      .map((label) => labelToId.get(label))
      .filter((id): id is string => Boolean(id));

    setTabFocusIds((current) => {
      const currentItems = current[tabKey];
      const currentSet = new Set(currentItems);
      const nextOrdered = suggestedIds.filter((id) => currentSet.has(id));
      const rest = currentItems.filter((id) => !nextOrdered.includes(id));
      return { ...current, [tabKey]: [...nextOrdered, ...rest] };
    });
    setTabPromptMessages((current) => ({ ...current, [tabKey]: "Empfohlene Reihenfolge übernommen." }));
  }

  async function handleCopyPrompt(tabKey: TrainingConfigTabKey) {
    const currentItems = getSelectedTrainingConfigFocusItems(tabKey, tabFocusIds[tabKey]);
    if (!currentItems.length) {
      setTabPromptMessages((current) => ({ ...current, [tabKey]: "Bitte zuerst Fokus-Bausteine auswählen." }));
      return;
    }
    try {
      await navigator.clipboard.writeText(buildTrainingConfigPromptPreview(getTrainingConfigTabTitle(tabKey), currentItems, tabNotes[tabKey]));
      setTabPromptMessages((current) => ({ ...current, [tabKey]: "Prompt in die Zwischenablage kopiert." }));
    } catch {
      setTabPromptMessages((current) => ({
        ...current,
        [tabKey]: "Zwischenablage ist in diesem Browser gerade nicht verfügbar.",
      }));
    }
  }

  async function handleDeriveConfigSection(tabKey: TrainingConfigTabKey) {
    const currentItems = getSelectedTrainingConfigFocusItems(tabKey, tabFocusIds[tabKey]);
    if (!currentItems.length) {
      setTabDeriveErrors((current) => ({ ...current, [tabKey]: "Bitte zuerst mindestens einen Fokus-Baustein auswählen." }));
      return;
    }

    setTabDeriveLoading((current) => ({ ...current, [tabKey]: true }));
    setTabDeriveErrors((current) => ({ ...current, [tabKey]: null }));
    setTabPromptMessages((current) => ({ ...current, [tabKey]: null }));
    try {
      const response = await apiFetch(`${API_BASE_URL}/training/config-section/derive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_key: tabKey,
          section_title: getTrainingConfigTabTitle(tabKey),
          focus_labels: currentItems.map((item) => item.label),
          notes: tabNotes[tabKey].trim() || null,
        }),
      });
      const payload = await parseJsonSafely<AthleteProfileDeriveResponse | { detail?: string }>(response);
      if (!response.ok || !payload || !("summary" in payload)) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Einordnung konnte nicht abgeleitet werden.",
        );
      }
      setTabDeriveResults((current) => ({ ...current, [tabKey]: payload as AthleteProfileDeriveResponse }));
      setTabPromptMessages((current) => ({
        ...current,
        [tabKey]: `Einordnung für ${getTrainingConfigTabTitle(tabKey)} mit LLM abgeleitet.`,
      }));
    } catch (err) {
      setTabDeriveErrors((current) => ({
        ...current,
        [tabKey]: err instanceof Error ? err.message : "Einordnung konnte nicht abgeleitet werden.",
      }));
    } finally {
      setTabDeriveLoading((current) => ({ ...current, [tabKey]: false }));
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Training</p>
        <h1>Training Konfiguration</h1>
        <p className="lead">
          Diese Seite bündelt das Athletenprofil als echtes Self-Assessment: Zielbild, verfügbare Tage, sportlicher
          Hintergrund und gewünschte Trainingslogik führen dann zu passenden Wochenstrukturen.
        </p>
      </div>

      <div className="training-config-layout">
        <div className="training-config-tabs" role="tablist" aria-label="Athletenprofil Kategorien">
          {trainingConfigTabDefinitions.map((tab) => (
            <button
              key={tab.key}
              className={`training-config-tab ${activeConfigTab === tab.key ? "active" : ""}`}
              type="button"
              id={`training-config-tab-${tab.key}`}
              role="tab"
              aria-selected={activeConfigTab === tab.key}
              aria-controls={`training-config-panel-${tab.key}`}
              onClick={() => setActiveConfigTab(tab.key)}
            >
              <strong>{tab.title}</strong>
              <span>{tab.note}</span>
            </button>
          ))}
        </div>

        <div
          className="training-config-panel"
          id={`training-config-panel-${activeTabConfig.key}`}
          role="tabpanel"
          aria-labelledby={`training-config-tab-${activeTabConfig.key}`}
        >
          <TrainingSection
            title={activeTabConfig.title}
            description={activeTabConfig.description}
            highlight={activeTabConfig.highlight}
          >
            <div className="training-config-preview">
              <div className="training-config-preview-head">
                <p className="training-config-kicker">{activeTabConfig.note}</p>
                <p className="training-note">
                  Diese Kategorie bildet die Grundlage dafür, was wir später wirklich abfragen, wie stark die
                  Trainingslogik personalisiert wird und an welchen Stellen wir dem Nutzer gezielte Feinjustierung
                  anbieten.
                </p>
              </div>
              <TrainingConfigPreview tab={activeTabConfig} />
            </div>

            <div className="training-config-detail-grid">
              <TrainingConfigDetailCard title="Was wir abfragen können" items={activeTabConfig.questions} />
              <TrainingConfigDetailCard title="Warum das wichtig ist" items={activeTabConfig.meanings} />
              <TrainingConfigDetailCard title="Später feinjustieren" items={activeTabConfig.fineTuning} />
            </div>

            <div className="training-profile-workbench">
              <div className="training-profile-builder-grid">
                <div className="training-profile-builder-card">
                  <div className="training-profile-builder-head">
                    <h3>Fokus-Bausteine</h3>
                    <p>{activeWorkbenchConfig.selectionHint}</p>
                  </div>
                  <div className="training-profile-focus-grid">
                    {activeWorkbenchConfig.focusItems.map((item) => {
                      const active = activeFocusIds.includes(item.id);
                      const tooltipId = `training-config-tip-${activeConfigTab}-${item.id}`;
                      return (
                        <button
                          key={item.id}
                          className={`training-profile-focus-item ${active ? "active" : ""}`}
                          type="button"
                          title={item.explanation}
                          aria-describedby={tooltipId}
                          onClick={() => toggleFocusItem(activeConfigTab, item.id)}
                        >
                          <span className="training-profile-focus-badge">{active ? "Im Fokus" : "Hinzufügen"}</span>
                          <strong>{item.label}</strong>
                          <span className="training-profile-focus-description">{item.description}</span>
                          <span className="training-profile-focus-help">Warum und wann?</span>
                          <span className="training-profile-focus-tooltip" id={tooltipId} role="tooltip">
                            <strong>Warum und wann wählen?</strong>
                            <span>{item.explanation}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="training-profile-builder-card">
                  <div className="training-profile-builder-head">
                    <h3>Prioritätenliste</h3>
                    <p>{activeWorkbenchConfig.priorityHint}</p>
                  </div>

                  {selectedFocusItems.length ? (
                    <div className="training-profile-priority-list">
                      {selectedFocusItems.map((item, index) => (
                        <div key={item.id} className="training-profile-priority-item">
                          <div className="training-profile-priority-rank">{index + 1}</div>
                          <div className="training-profile-priority-copy">
                            <strong>{item.label}</strong>
                            <span>{item.description}</span>
                          </div>
                          <div className="training-profile-priority-actions">
                            <button
                              className="icon-button"
                              type="button"
                              title="Nach oben"
                              onClick={() => moveFocusItem(activeConfigTab, item.id, -1)}
                              disabled={index === 0}
                            >
                              ↑
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              title="Nach unten"
                              onClick={() => moveFocusItem(activeConfigTab, item.id, 1)}
                              disabled={index === selectedFocusItems.length - 1}
                            >
                              ↓
                            </button>
                            <button
                              className="icon-button danger"
                              type="button"
                              title="Entfernen"
                              onClick={() => toggleFocusItem(activeConfigTab, item.id)}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="training-empty-state">
                      <strong>{activeWorkbenchConfig.emptyTitle}</strong>
                      <span>{activeWorkbenchConfig.emptyText}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="training-profile-builder-card">
                <div className="training-profile-builder-head">
                  <h3>Prompt und Ableitung</h3>
                  <p>{activeWorkbenchConfig.promptHint}</p>
                </div>

                <label className="settings-label">
                  Zusätzliche Hinweise
                  <textarea
                    className="settings-input training-textarea"
                    rows={4}
                    value={activeNotes}
                    onChange={(event) => setTabNotes((current) => ({ ...current, [activeConfigTab]: event.target.value }))}
                    placeholder={activeWorkbenchConfig.notesPlaceholder}
                  />
                </label>

                {llmLoading ? <p className="training-note">LLM-Status wird geladen...</p> : null}
                {llmError ? <p className="error-text">{llmError}</p> : null}
                {!llmLoading && llmStatus ? (
                  <div className="settings-status-grid">
                    <div className="settings-status-chip">
                      <span>Provider</span>
                      <strong>{llmStatus.provider}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Direkte Ableitung</span>
                      <strong>{llmStatus.configured ? "Ja" : "Nein"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Schlüssel</span>
                      <strong>{llmStatus.key_hint ?? "-"}</strong>
                    </div>
                  </div>
                ) : null}

                <label className="settings-label">
                  Prompt-Vorschau
                  <textarea className="settings-input training-textarea" rows={10} value={activePrompt} readOnly />
                </label>

                <div className="settings-actions">
                  <button className="secondary-button" type="button" onClick={() => void handleCopyPrompt(activeConfigTab)}>
                    Prompt kopieren
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void handleDeriveConfigSection(activeConfigTab)}
                    disabled={!selectedFocusItems.length || !llmStatus?.configured || activeDeriveLoading}
                  >
                    {activeDeriveLoading ? "Einordnung wird abgeleitet..." : "Einordnung mit LLM ableiten"}
                  </button>
                  {activeDeriveResult?.recommended_focus_order.length ? (
                    <button className="secondary-button" type="button" onClick={() => applyRecommendedFocusOrder(activeConfigTab)}>
                      Empfohlene Reihenfolge übernehmen
                    </button>
                  ) : null}
                </div>

                {activePromptMessage ? <p className="training-note">{activePromptMessage}</p> : null}
                {activeDeriveError ? <p className="error-text">{activeDeriveError}</p> : null}
              </div>

              {activeDeriveResult ? (
                <div className="training-profile-result-grid">
                  <div className="training-profile-result-card training-profile-result-card-primary">
                    <p className="training-config-kicker">{activeWorkbenchConfig.resultKicker}</p>
                    <h3>{activeDeriveResult.result_title || activeDeriveResult.profile_name || activeSectionTitle}</h3>
                    <p>{activeDeriveResult.summary}</p>
                    {activeDeriveResult.model ? <p className="training-note">Modell: {activeDeriveResult.model}</p> : null}
                    {activeDeriveResult.recommended_focus_order.length ? (
                      <div className="training-profile-order-preview">
                        {activeDeriveResult.recommended_focus_order.map((label) => (
                          <span key={label} className="training-pill">
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <TrainingConfigDetailCard
                    title="Warum diese Einordnung passt"
                    items={
                      activeDeriveResult.rationale.length
                        ? activeDeriveResult.rationale
                        : ["Die aktuelle Auswahl gibt noch keine zusätzliche Begründung aus."]
                    }
                  />
                  <TrainingConfigDetailCard
                    title="Trainingsimplikationen"
                    items={
                      activeDeriveResult.planning_implications.length
                        ? activeDeriveResult.planning_implications
                        : ["Noch keine konkreten Trainingsimplikationen vorhanden."]
                    }
                  />
                  <TrainingConfigDetailCard
                    title="Wichtige Rückfragen"
                    items={
                      activeDeriveResult.follow_up_questions.length
                        ? activeDeriveResult.follow_up_questions
                        : ["Im Moment gibt es keine zusätzlichen Rückfragen."]
                    }
                  />
                </div>
              ) : null}
            </div>
          </TrainingSection>
        </div>
      </div>
    </section>
  );
}

void TrainingConfigPageLegacy;

export function TrainingConfigPage() {
  const [activeTopTab, setActiveTopTab] = useState<TrainingConfigTopTabKey>("profile");
  const [tabState, setTabState] = useState<Record<TrainingConfigTabKey, TrainingConfigSectionState>>(() =>
    cloneTrainingConfigState(emptyTrainingConfigState),
  );
  const [savedTabState, setSavedTabState] = useState<Record<TrainingConfigTabKey, TrainingConfigSectionState>>(() =>
    cloneTrainingConfigState(emptyTrainingConfigState),
  );
  const [savedTrainingPlan, setSavedTrainingPlan] = useState<TrainingPlanDraftResponse | null>(null);
  const [draftTrainingPlan, setDraftTrainingPlan] = useState<TrainingPlanDraftResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [autoSaveLoading, setAutoSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftRestoreMessage, setDraftRestoreMessage] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [llmLoading, setLlmLoading] = useState(true);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmMessage, setLlmMessage] = useState<string | null>(null);
  const [planDraftLoading, setPlanDraftLoading] = useState(false);
  const [planDraftError, setPlanDraftError] = useState<string | null>(null);
  const [planAdoptLoading, setPlanAdoptLoading] = useState(false);
  const [planAdoptError, setPlanAdoptError] = useState<string | null>(null);
  const [focusOverlay, setFocusOverlay] = useState<{ tabKey: TrainingConfigTabKey; item: TrainingConfigFocusOption } | null>(
    null,
  );
  const [draggedFocusItemId, setDraggedFocusItemId] = useState<string | null>(null);
  const [priorityDropActive, setPriorityDropActive] = useState(false);

  const activeConfigTab: TrainingConfigTabKey = activeTopTab === "llm" ? "profile" : activeTopTab;
  const activeTabConfig =
    trainingConfigTabDefinitions.find((tab) => tab.key === activeConfigTab) ?? trainingConfigTabDefinitions[0];
  const activeWorkbenchConfig = trainingConfigWorkbenchConfigs[activeConfigTab];
  const activeSectionState = tabState[activeConfigTab];
  const activeFocusIds = activeSectionState.focus_ids;
  const activeNotes = activeSectionState.notes;

  const selectedFocusItems = useMemo(
    () => getSelectedTrainingConfigFocusItems(activeConfigTab, activeSectionState.focus_ids),
    [activeConfigTab, activeFocusIds],
  );
  const llmSections = useMemo(() => buildTrainingPlanSectionsPayload(tabState), [tabState]);
  const combinedPromptPreview = useMemo(() => buildTrainingPlanPromptPreview(tabState), [tabState]);
  const visibleTrainingPlan = draftTrainingPlan ?? savedTrainingPlan;
  const hasConfiguredContent = useMemo(
    () => llmSections.some((section) => section.focus_labels.length || section.notes),
    [llmSections],
  );
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(tabState) !== JSON.stringify(savedTabState),
    [savedTabState, tabState],
  );
  const llmSectionSummaries = useMemo(
    () =>
      trainingConfigTabDefinitions.map((tab) => ({
        tab,
        selectedItems: getSelectedTrainingConfigFocusItems(tab.key, tabState[tab.key].focus_ids),
        notes: tabState[tab.key].notes.trim(),
      })),
    [tabState],
  );
  const configuredSectionCount = useMemo(
    () => llmSectionSummaries.filter((section) => section.selectedItems.length || section.notes).length,
    [llmSectionSummaries],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      setProfileLoading(true);
      setProfileError(null);
      try {
        const response = await apiFetch(`${API_BASE_URL}/profile`);
        const payload = await parseJsonSafely<TrainingConfigProfilePayload | { detail?: string }>(response);
        if (!response.ok) {
          throw new Error(
            typeof payload === "object" && payload && "detail" in payload && payload.detail
              ? payload.detail
              : "Profil konnte nicht geladen werden.",
          );
        }

        if (isMounted) {
          const profilePayload = payload as TrainingConfigProfilePayload;
          const normalizedState = normalizeTrainingConfigProfileState(profilePayload);
          const hasSavedConfig = hasTrainingConfigContent(normalizedState);
          const localDraft = hasSavedConfig ? null : loadTrainingConfigDraft();
          setTabState(cloneTrainingConfigState(localDraft ?? normalizedState));
          setSavedTabState(cloneTrainingConfigState(normalizedState));
          setSavedTrainingPlan(normalizeTrainingPlanPayload(profilePayload.training_plan));
          setDraftTrainingPlan(null);
          setDraftRestoreMessage(
            !hasSavedConfig && localDraft
              ? "Lokaler Entwurf wiederhergestellt. Speichere ihn im Profil, damit er erhalten bleibt."
              : null,
          );
          if (hasSavedConfig) {
            clearTrainingConfigDraft();
          }
        }
      } catch (err) {
        if (isMounted) {
          setProfileError(err instanceof Error ? err.message : "Profil konnte nicht geladen werden.");
        }
      } finally {
        if (isMounted) {
          setProfileLoading(false);
        }
      }
    }

    async function loadLlmStatus() {
      setLlmLoading(true);
      setLlmError(null);
      try {
        const response = await apiFetch(`${API_BASE_URL}/llm/status`);
        const payload = await parseJsonSafely<LlmStatus | { detail?: string }>(response);
        if (!response.ok) {
          throw new Error(
            typeof payload === "object" && payload && "detail" in payload && payload.detail
              ? payload.detail
              : "LLM-Status konnte nicht geladen werden.",
          );
        }
        if (isMounted) {
          setLlmStatus(payload as LlmStatus);
        }
      } catch (err) {
        if (isMounted) {
          setLlmError(err instanceof Error ? err.message : "LLM-Status konnte nicht geladen werden.");
        }
      } finally {
        if (isMounted) {
          setLlmLoading(false);
        }
      }
    }

    void loadProfile();
    void loadLlmStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    persistTrainingConfigDraft(tabState);
  }, [tabState]);

  async function persistTrainingConfigToProfile(
    trainingPlan: TrainingPlanDraftResponse | null,
    successMessage: string,
  ): Promise<TrainingConfigProfilePayload> {
    const response = await apiFetch(`${API_BASE_URL}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        training_config: buildTrainingConfigProfileUpdatePayload(tabState),
        training_plan: trainingPlan,
      }),
    });
    const payload = await parseJsonSafely<TrainingConfigProfilePayload | { detail?: string }>(response);
    if (!response.ok) {
      throw new Error(
        typeof payload === "object" && payload && "detail" in payload && payload.detail
          ? payload.detail
          : "Auswahl konnte nicht gespeichert werden.",
      );
    }

    const profilePayload = payload as TrainingConfigProfilePayload;
    const normalizedState = normalizeTrainingConfigProfileState(profilePayload);
    setTabState(cloneTrainingConfigState(normalizedState));
    setSavedTabState(cloneTrainingConfigState(normalizedState));
    setSavedTrainingPlan(normalizeTrainingPlanPayload(profilePayload.training_plan) ?? normalizeTrainingPlanPayload(trainingPlan));
    if (trainingPlan) {
      setDraftTrainingPlan(null);
      clearTrainingConfigDraft();
    }
    setDraftRestoreMessage(null);
    setSaveMessage(successMessage);
    return profilePayload;
  }

  useEffect(() => {
    if (profileLoading || !hasUnsavedChanges || autoSaveLoading || planAdoptLoading) return;

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setAutoSaveLoading(true);
        setSaveError(null);
        setSaveMessage("Speichert automatisch...");
        try {
          await persistTrainingConfigToProfile(
            null,
            savedTrainingPlan
              ? "Konfiguration automatisch gespeichert. Der bisherige Plan wurde zurückgesetzt."
              : "Konfiguration automatisch gespeichert.",
          );
        } catch (err) {
          setSaveError(err instanceof Error ? err.message : "Automatisches Speichern fehlgeschlagen.");
        } finally {
          setAutoSaveLoading(false);
        }
      })();
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [autoSaveLoading, hasUnsavedChanges, planAdoptLoading, profileLoading, savedTrainingPlan, tabState]);

  function updateTrainingConfigState(
    updater: (
      current: Record<TrainingConfigTabKey, TrainingConfigSectionState>,
    ) => Record<TrainingConfigTabKey, TrainingConfigSectionState>,
  ) {
    setTabState((current) => cloneTrainingConfigState(updater(current)));
    setDraftTrainingPlan(null);
    setSaveMessage(null);
    setSaveError(null);
    setDraftRestoreMessage(null);
    setLlmMessage(null);
    setPlanDraftError(null);
    setPlanAdoptError(null);
  }

  function toggleFocusItem(tabKey: TrainingConfigTabKey, id: string) {
    updateTrainingConfigState((current) => ({
      ...current,
      [tabKey]: {
        ...current[tabKey],
        focus_ids: current[tabKey].focus_ids.includes(id)
          ? current[tabKey].focus_ids.filter((entry) => entry !== id)
          : [...current[tabKey].focus_ids, id],
      },
    }));
  }

  function moveFocusItem(tabKey: TrainingConfigTabKey, id: string, direction: -1 | 1) {
    updateTrainingConfigState((current) => {
      const currentItems = current[tabKey].focus_ids;
      const index = currentItems.indexOf(id);
      if (index === -1) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= currentItems.length) return current;
      const nextItems = currentItems.slice();
      const [item] = nextItems.splice(index, 1);
      nextItems.splice(nextIndex, 0, item);
      return {
        ...current,
        [tabKey]: {
          ...current[tabKey],
          focus_ids: nextItems,
        },
      };
    });
  }

  function moveFocusItemToIndex(tabKey: TrainingConfigTabKey, id: string, targetIndex: number) {
    updateTrainingConfigState((current) => {
      const currentItems = current[tabKey].focus_ids;
      const clampedIndex = Math.max(0, Math.min(targetIndex, currentItems.length));
      const nextItems = currentItems.filter((entry) => entry !== id);
      nextItems.splice(Math.min(clampedIndex, nextItems.length), 0, id);
      return {
        ...current,
        [tabKey]: {
          ...current[tabKey],
          focus_ids: nextItems,
        },
      };
    });
  }

  function swapFocusItems(tabKey: TrainingConfigTabKey, draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    updateTrainingConfigState((current) => {
      const currentItems = current[tabKey].focus_ids.slice();
      const draggedIndex = currentItems.indexOf(draggedId);
      const targetIndex = currentItems.indexOf(targetId);
      if (draggedIndex === -1 || targetIndex === -1) {
        return current;
      }
      [currentItems[draggedIndex], currentItems[targetIndex]] = [currentItems[targetIndex], currentItems[draggedIndex]];
      return {
        ...current,
        [tabKey]: {
          ...current[tabKey],
          focus_ids: currentItems,
        },
      };
    });
  }

  function appendFocusItemToPriority(tabKey: TrainingConfigTabKey, id: string) {
    updateTrainingConfigState((current) => {
      const currentItems = current[tabKey].focus_ids;
      if (currentItems.includes(id)) {
        return current;
      }
      return {
        ...current,
        [tabKey]: {
          ...current[tabKey],
          focus_ids: [...currentItems, id],
        },
      };
    });
  }

  function handleFocusDragStart(id: string, event: React.DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDraggedFocusItemId(id);
  }

  function handleFocusDragEnd() {
    setDraggedFocusItemId(null);
    setPriorityDropActive(false);
  }

  function updateNotes(tabKey: TrainingConfigTabKey, value: string) {
    updateTrainingConfigState((current) => ({
      ...current,
      [tabKey]: {
        ...current[tabKey],
        notes: value,
      },
    }));
  }

  async function handleCopyCombinedPrompt() {
    if (!hasConfiguredContent) {
      setLlmMessage("Bitte zuerst Inhalte in mindestens einem Reiter auswählen.");
      return;
    }
    try {
      await navigator.clipboard.writeText(combinedPromptPreview);
      setLlmMessage("Prompt in die Zwischenablage kopiert.");
    } catch {
      setLlmMessage("Zwischenablage ist in diesem Browser gerade nicht verfügbar.");
    }
  }

  async function handleGenerateTrainingPlan() {
    if (!hasConfiguredContent) {
      setPlanDraftError("Bitte zuerst Inhalte in den Konfigurationsreitern auswählen.");
      return;
    }

    setPlanDraftLoading(true);
    setPlanDraftError(null);
    setPlanAdoptError(null);
    setLlmMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/training/plan-draft/derive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sections: llmSections,
        }),
      });
      const payload = await parseJsonSafely<TrainingPlanDraftResponse | { detail?: string }>(response);
      if (!response.ok || !payload || !("summary" in payload)) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Planentwurf konnte nicht erstellt werden.",
        );
      }

      setDraftTrainingPlan(normalizeTrainingPlanPayload(payload as TrainingPlanDraftResponse));
      setLlmMessage("Planentwurf mit LLM erstellt.");
    } catch (err) {
      setPlanDraftError(err instanceof Error ? err.message : "Planentwurf konnte nicht erstellt werden.");
    } finally {
      setPlanDraftLoading(false);
    }
  }

  async function handleAdoptTrainingPlan() {
    if (!draftTrainingPlan) {
      setPlanAdoptError("Bitte zuerst einen neuen Planentwurf erstellen.");
      return;
    }

    setPlanAdoptLoading(true);
    setPlanAdoptError(null);
    setSaveError(null);
    setSaveMessage(null);
    try {
      await persistTrainingConfigToProfile(draftTrainingPlan, "Plan im Profil gespeichert.");
      setLlmMessage("Trainingsplan im Profil übernommen.");
    } catch (err) {
      setPlanAdoptError(err instanceof Error ? err.message : "Plan konnte nicht übernommen werden.");
    } finally {
      setPlanAdoptLoading(false);
    }
  }

  const llmPanel = (
    <TrainingSection
      title="LLM und Planentwurf"
      description="Hier werden die vier Konfigurationsbereiche zusammengeführt. Daraus entsteht ein kombinierter Prompt, ein Planentwurf und bei Bedarf ein übernehmbarer Profilstand."
      highlight
    >
      <div className="training-profile-workbench">
        <div className="training-profile-builder-card">
          <div className="training-profile-builder-head">
            <h3>Konfigurationsstand</h3>
            <p>
              Der LLM-Aufruf nutzt aktuell {configuredSectionCount} von {trainingConfigTabDefinitions.length} Bereichen.
              Änderungen kannst du zuerst im Profil speichern oder direkt in einen neuen Planentwurf übersetzen.
            </p>
          </div>

          {llmLoading ? <p className="training-note">LLM-Status wird geladen...</p> : null}
          {llmError ? <p className="error-text">{llmError}</p> : null}
          {!llmLoading && llmStatus ? (
            <div className="settings-status-grid">
              <div className="settings-status-chip">
                <span>Provider</span>
                <strong>{llmStatus.provider}</strong>
              </div>
              <div className="settings-status-chip">
                <span>Direkte Ableitung</span>
                <strong>{llmStatus.configured ? "Ja" : "Nein"}</strong>
              </div>
              <div className="settings-status-chip">
                <span>Schlüssel</span>
                <strong>{llmStatus.key_hint ?? "-"}</strong>
              </div>
            </div>
          ) : null}

          <div className="settings-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void handleCopyCombinedPrompt()}
              disabled={!hasConfiguredContent}
            >
              Prompt kopieren
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void handleGenerateTrainingPlan()}
              disabled={!hasConfiguredContent || llmLoading || !llmStatus?.configured || planDraftLoading}
            >
              {planDraftLoading ? "Planentwurf wird erstellt..." : "Plan mit LLM erstellen"}
            </button>
            {draftTrainingPlan ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleAdoptTrainingPlan()}
                disabled={planAdoptLoading}
              >
                {planAdoptLoading ? "Wird übernommen..." : "Plan übernehmen"}
              </button>
            ) : null}
          </div>

          {hasUnsavedChanges ? (
            <p className="training-note">
              Es gibt ungespeicherte Änderungen. Wenn du sie separat speicherst, wird ein bisher übernommener Plan
              zurückgesetzt, bis du einen neuen Entwurf übernimmst.
            </p>
          ) : savedTrainingPlan ? (
            <p className="training-note">Im Profil liegt bereits ein übernommener Trainingsplan für den gespeicherten Stand.</p>
          ) : (
            <p className="training-note">Du kannst aus diesem Stand direkt einen Planentwurf erzeugen.</p>
          )}

          {saveMessage ? <p className="training-note">{saveMessage}</p> : null}
          {saveError ? <p className="error-text">{saveError}</p> : null}
          {draftRestoreMessage ? <p className="training-note">{draftRestoreMessage}</p> : null}
          {llmMessage ? <p className="training-note">{llmMessage}</p> : null}
          {planDraftError ? <p className="error-text">{planDraftError}</p> : null}
          {planAdoptError ? <p className="error-text">{planAdoptError}</p> : null}
        </div>

        <div className="training-profile-result-grid">
          {llmSectionSummaries.map(({ tab, selectedItems, notes }) => (
            <div key={tab.key} className="training-profile-builder-card">
              <div className="training-profile-builder-head">
                <h3>{tab.title}</h3>
                <p>{tab.note}</p>
              </div>

              {selectedItems.length || notes ? (
                <>
                  {selectedItems.length ? (
                    <div className="training-profile-order-preview">
                      {selectedItems.map((item) => (
                        <span key={item.id} className="training-pill">
                          {item.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {notes ? (
                    <p className="training-note">
                      <strong>Hinweise:</strong> {notes}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="training-empty-state">
                  <strong>Noch nichts ausgewählt.</strong>
                  <span>In diesem Bereich ist aktuell noch kein Fokus-Baustein oder Hinweis gespeichert.</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="training-profile-builder-card">
          <div className="training-profile-builder-head">
            <h3>Prompt-Vorschau</h3>
            <p>So wird der kombinierte LLM-Aufruf aus den vier Reitern zusammengesetzt.</p>
          </div>

          <label className="settings-label">
            Kombinierter Prompt
            <textarea className="settings-input training-textarea" rows={12} value={combinedPromptPreview} readOnly />
          </label>
        </div>

        {visibleTrainingPlan ? (
          <div className="training-plan-draft-layout">
            <div className="training-profile-result-card training-profile-result-card-primary training-plan-draft-summary">
              <p className="training-config-kicker">
                {draftTrainingPlan ? "Neuer Planentwurf" : "Im Profil gespeicherter Trainingsplan"}
              </p>
              <h3>{visibleTrainingPlan.plan_title}</h3>
              <p>{visibleTrainingPlan.summary}</p>
              {visibleTrainingPlan.model ? <p className="training-note">Modell: {visibleTrainingPlan.model}</p> : null}
              {draftTrainingPlan ? (
                <p className="training-note">Dieser Entwurf ist noch nicht übernommen.</p>
              ) : hasUnsavedChanges ? (
                <p className="training-note">Der gespeicherte Plan gehört noch zum letzten gespeicherten Konfigurationsstand.</p>
              ) : (
                <p className="training-note">Dieser Plan ist aktuell im Profil übernommen.</p>
              )}
            </div>
            {visibleTrainingPlan.week_variants?.length ? <TrainingWeekVariants variants={visibleTrainingPlan.week_variants} /> : null}
            <div className="training-plan-draft-grid">
            <TrainingConfigDetailCard
              title="Wochenstruktur"
              items={
                visibleTrainingPlan.weekly_structure.length
                  ? visibleTrainingPlan.weekly_structure
                  : ["Noch keine konkrete Wochenstruktur im Entwurf enthalten."]
              }
            />
            <TrainingConfigDetailCard
              title="Schlüsseleinheiten"
              items={
                visibleTrainingPlan.key_workouts.length
                  ? visibleTrainingPlan.key_workouts
                  : ["Noch keine Schlüsseleinheiten im Entwurf enthalten."]
              }
            />
            <TrainingConfigDetailCard
              title="Progression"
              items={
                visibleTrainingPlan.progression_notes.length
                  ? visibleTrainingPlan.progression_notes
                  : ["Noch keine Progressionshinweise im Entwurf enthalten."]
              }
            />
            <TrainingConfigDetailCard
              title="Warum dieser Plan passt"
              items={
                visibleTrainingPlan.why_this_plan_fits.length
                  ? visibleTrainingPlan.why_this_plan_fits
                  : ["Noch keine Begründung im Entwurf enthalten."]
              }
            />
            <TrainingConfigDetailCard
              title="Worauf du achten solltest"
              items={
                visibleTrainingPlan.watchouts.length
                  ? visibleTrainingPlan.watchouts
                  : ["Noch keine Risiken oder Grenzen im Entwurf enthalten."]
              }
            />
            <TrainingConfigDetailCard
              title="Vor dem Übernehmen prüfen"
              items={
                visibleTrainingPlan.adoption_checklist.length
                  ? visibleTrainingPlan.adoption_checklist
                  : ["Vor dem Übernehmen liegen noch keine zusätzlichen Prüfpunkte vor."]
              }
            />
            </div>
          </div>
        ) : (
          <div className="training-empty-state">
            <strong>Noch kein Planentwurf vorhanden.</strong>
            <span>
              Sobald die Konfiguration steht, kannst du hier einen Entwurf erzeugen, prüfen und danach ins Profil
              übernehmen.
            </span>
          </div>
        )}
      </div>
    </TrainingSection>
  );

  const configPanel = (
    <TrainingSection
      title={activeTabConfig.title}
      description={activeTabConfig.description}
      highlight={activeTabConfig.highlight}
    >
      <div className="training-config-preview">
        <div className="training-config-preview-head">
          <p className="training-config-kicker">{activeTabConfig.note}</p>
          <p className="training-note">
            Diese Kategorie legt fest, welche Aspekte wir wirklich im Profil festhalten und später für die Trainingslogik
            gewichten.
          </p>
        </div>
        <TrainingConfigPreview tab={activeTabConfig} />
      </div>

      <div className="training-config-detail-grid">
        <TrainingConfigDetailCard title="Was wir abfragen können" items={activeTabConfig.questions} />
        <TrainingConfigDetailCard title="Warum das wichtig ist" items={activeTabConfig.meanings} />
        <TrainingConfigDetailCard title="Später feinjustieren" items={activeTabConfig.fineTuning} />
      </div>

      <div className="training-profile-workbench">
        <div className="training-profile-builder-grid">
          <div className="training-profile-builder-card">
            <div className="training-profile-builder-head">
              <h3>Fokus-Bausteine</h3>
              <p>{activeWorkbenchConfig.selectionHint}</p>
            </div>
            <div className="training-profile-focus-grid">
              {activeWorkbenchConfig.focusItems.map((item) => {
                const active = activeFocusIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className={`training-profile-focus-item ${active ? "active" : ""} ${
                      draggedFocusItemId === item.id ? "dragging" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    draggable
                    onClick={() => setFocusOverlay({ tabKey: activeConfigTab, item })}
                    onDragStart={(event) => handleFocusDragStart(item.id, event)}
                    onDragEnd={handleFocusDragEnd}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setFocusOverlay({ tabKey: activeConfigTab, item });
                      }
                    }}
                  >
                    <div className="training-profile-focus-item-head">
                      <button
                        className={`training-profile-focus-badge-button ${active ? "active" : ""}`}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFocusItem(activeConfigTab, item.id);
                        }}
                      >
                        {active ? "Im Fokus" : "Hinzufügen"}
                      </button>
                      <button
                        className="icon-button training-profile-focus-open"
                        type="button"
                        aria-label={`${item.label} im Detail öffnen`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setFocusOverlay({ tabKey: activeConfigTab, item });
                        }}
                      >
                        i
                      </button>
                    </div>
                    <strong>{item.label}</strong>
                    <span className="training-profile-focus-description">{item.description}</span>
                    <span className="training-profile-focus-help">Klicken für Details, Wirkung und Quellen</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="training-profile-builder-card">
            <div className="training-profile-builder-head">
              <h3>Prioritätenliste</h3>
              <p>{activeWorkbenchConfig.priorityHint}</p>
            </div>

            {saveError ? (
              <p className="error-text">{saveError}</p>
            ) : saveMessage ? (
              <p className="training-note">{saveMessage}</p>
            ) : hasUnsavedChanges && savedTrainingPlan ? (
              <p className="training-note">
                Wenn du diese Änderungen speicherst, wird der bisherige Trainingsplan zurückgesetzt, bis du im LLM-Reiter
                einen neuen Entwurf übernimmst.
              </p>
            ) : (
              <p className="training-note">Der gespeicherte Stand wird beim Öffnen dieses Profils wieder geladen.</p>
            )}

            {selectedFocusItems.length ? (
              <div
                className={`training-profile-priority-list ${priorityDropActive ? "drag-target" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setPriorityDropActive(true);
                }}
                onDragLeave={() => setPriorityDropActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = event.dataTransfer.getData("text/plain");
                  if (!draggedId) return;
                  if (activeFocusIds.includes(draggedId)) {
                    moveFocusItemToIndex(activeConfigTab, draggedId, selectedFocusItems.length);
                  } else {
                    appendFocusItemToPriority(activeConfigTab, draggedId);
                  }
                  handleFocusDragEnd();
                }}
              >
                <p className="training-note">Karten können hier hineingezogen und innerhalb der Liste neu sortiert werden.</p>
                {selectedFocusItems.map((item, index) => (
                  <div
                    key={item.id}
                    className={`training-profile-priority-item ${draggedFocusItemId === item.id ? "dragging" : ""}`}
                    draggable
                    onDragStart={(event) => handleFocusDragStart(item.id, event)}
                    onDragEnd={handleFocusDragEnd}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setPriorityDropActive(true);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedId = event.dataTransfer.getData("text/plain");
                      if (!draggedId) return;
                      if (activeFocusIds.includes(draggedId)) {
                        swapFocusItems(activeConfigTab, draggedId, item.id);
                      } else {
                        moveFocusItemToIndex(activeConfigTab, draggedId, index);
                      }
                      handleFocusDragEnd();
                    }}
                  >
                    <div className="training-profile-priority-rank">{index + 1}</div>
                    <div className="training-profile-priority-copy">
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                    </div>
                    <div className="training-profile-priority-actions">
                      <button
                        className="icon-button"
                        type="button"
                        title="Nach oben"
                        onClick={() => moveFocusItem(activeConfigTab, item.id, -1)}
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title="Nach unten"
                        onClick={() => moveFocusItem(activeConfigTab, item.id, 1)}
                        disabled={index === selectedFocusItems.length - 1}
                      >
                        ↓
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        title="Entfernen"
                        onClick={() => toggleFocusItem(activeConfigTab, item.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={`training-empty-state ${priorityDropActive ? "drag-target" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setPriorityDropActive(true);
                }}
                onDragLeave={() => setPriorityDropActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = event.dataTransfer.getData("text/plain");
                  if (!draggedId) return;
                  appendFocusItemToPriority(activeConfigTab, draggedId);
                  handleFocusDragEnd();
                }}
              >
                <strong>{activeWorkbenchConfig.emptyTitle}</strong>
                <span>{activeWorkbenchConfig.emptyText}</span>
                <small>Kacheln können direkt hier hineingezogen werden.</small>
              </div>
            )}
          </div>
        </div>

        <div className="training-profile-builder-card">
          <div className="training-profile-builder-head">
            <h3>Zusätzliche Hinweise</h3>
            <p>
              Alles, was in diesem Reiter noch wichtig ist, wird zusammen mit der Auswahl im Profil gespeichert und später
              im Planentwurf berücksichtigt.
            </p>
          </div>

          <label className="settings-label">
            Hinweise für diesen Bereich
            <textarea
              className="settings-input training-textarea"
              rows={4}
              value={activeNotes}
              onChange={(event) => updateNotes(activeConfigTab, event.target.value)}
              placeholder={activeWorkbenchConfig.notesPlaceholder}
            />
          </label>

          <div className="settings-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setFocusOverlay(null);
                setActiveTopTab("llm");
              }}
              disabled={!hasConfiguredContent}
            >
              Zum LLM-Reiter
            </button>
          </div>
        </div>
      </div>
    </TrainingSection>
  );

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Training</p>
        <h1>Training Konfiguration</h1>
        <p className="lead">
          Diese Seite bündelt das Athletenprofil als echtes Self-Assessment: Zielbild, verfügbare Tage, sportlicher
          Hintergrund und gewünschte Trainingslogik führen dann zu passenden Wochenstrukturen.
        </p>
      </div>

      <div className="training-config-layout">
        <div className="training-config-tabs" role="tablist" aria-label="Training Konfiguration">
          {trainingConfigTopTabs.map((tab) => (
            <button
              key={tab.key}
              className={`training-config-tab ${activeTopTab === tab.key ? "active" : ""}`}
              type="button"
              id={`training-config-tab-${tab.key}`}
              role="tab"
              aria-selected={activeTopTab === tab.key}
              aria-controls={`training-config-panel-${tab.key}`}
              onClick={() => {
                setFocusOverlay(null);
                setActiveTopTab(tab.key);
              }}
            >
              <strong>{tab.title}</strong>
              <span>{tab.note}</span>
            </button>
          ))}
        </div>

        {profileLoading ? <p className="training-note">Gespeicherte Konfiguration wird geladen...</p> : null}
        {profileError ? <p className="error-text">{profileError}</p> : null}

        <div
          className="training-config-panel"
          id={`training-config-panel-${activeTopTab}`}
          role="tabpanel"
          aria-labelledby={`training-config-tab-${activeTopTab}`}
        >
          {activeTopTab === "llm" ? llmPanel : configPanel}
        </div>
      </div>

      {focusOverlay ? (
        <TrainingConfigFocusOverlay
          tabTitle={getTrainingConfigTabTitle(focusOverlay.tabKey)}
          item={focusOverlay.item}
          active={tabState[focusOverlay.tabKey].focus_ids.includes(focusOverlay.item.id)}
          onClose={() => setFocusOverlay(null)}
          onToggle={() => {
            toggleFocusItem(focusOverlay.tabKey, focusOverlay.item.id);
            setFocusOverlay(null);
          }}
        />
      ) : null}
      {planDraftLoading ? (
        <div className="training-llm-loading-overlay" role="status" aria-live="polite" aria-label="Planentwurf wird erstellt">
          <div className="training-llm-loading-card">
            <div className="waiting-spinner" aria-hidden="true" />
            <h3>Planentwurf wird erstellt</h3>
            <p>
              Die ausgewählten Bereiche werden gerade zusammengeführt und als neuer Trainingsplanentwurf aufbereitet.
              Das Overlay schließt sich automatisch, sobald das Ergebnis da ist.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatHfDevelopmentDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function HfDevelopmentChart({ points }: { points: HfDevelopmentPoint[] }) {
  if (!points.length) {
    return (
      <div className="training-empty-state">
        <strong>Noch keine passenden Punkte gefunden.</strong>
        <span>Wähle ein anderes Zeitfenster oder einen anderen Wattbereich, um den Verlauf zu sehen.</span>
      </div>
    );
  }

  const width = 960;
  const height = 320;
  const left = 64;
  const right = 28;
  const top = 20;
  const bottom = 48;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const hrValues = points.map((point) => point.avg_hr_bpm);
  const minHr = Math.min(...hrValues);
  const maxHr = Math.max(...hrValues);
  const axisMin = Math.floor((minHr - 3) / 5) * 5;
  const axisMax = Math.ceil((maxHr + 3) / 5) * 5;
  const axisSpan = Math.max(1, axisMax - axisMin);
  const maxIndex = Math.max(1, points.length - 1);

  const mappedPoints = points.map((point, index) => {
    const x = left + (index / maxIndex) * innerWidth;
    const y = top + innerHeight - ((point.avg_hr_bpm - axisMin) / axisSpan) * innerHeight;
    return { ...point, x, y };
  });

  const polyline = mappedPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const ticks = Array.from({ length: 5 }, (_value, index) => axisMin + (axisSpan / 4) * index);
  const xLabels = [mappedPoints[0], mappedPoints[Math.floor(maxIndex / 2)], mappedPoints[maxIndex]].filter(
    (point, index, array) => array.findIndex((entry) => entry.date === point.date) === index,
  );

  return (
    <div className="training-hf-chart-card">
      <svg viewBox={`0 0 ${width} ${height}`} className="training-hf-chart" role="img" aria-label="HF Entwicklung">
        {ticks.map((tick) => {
          const y = top + innerHeight - ((tick - axisMin) / axisSpan) * innerHeight;
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={left + innerWidth} y2={y} stroke="#dbe9e4" strokeWidth="1" />
              <text x={left - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#58716a">
                {Math.round(tick)}
              </text>
            </g>
          );
        })}
        <line x1={left} y1={top + innerHeight} x2={left + innerWidth} y2={top + innerHeight} stroke="#8fb7ab" strokeWidth="1.4" />
        <line x1={left} y1={top} x2={left} y2={top + innerHeight} stroke="#8fb7ab" strokeWidth="1.4" />
        <polyline fill="none" stroke="#209a7f" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={polyline} />
        {mappedPoints.map((point) => (
          <a key={`${point.date}-${point.activity_id}`} href={`/activities/${point.activity_id}`}>
            <circle cx={point.x} cy={point.y} r="5.5" fill="#f8fffc" stroke="#146f5b" strokeWidth="2.5">
              <title>{`${formatHfDevelopmentDate(point.date)} | ${Math.round(point.avg_hr_bpm)} bpm | ${Math.round(point.avg_power_w)} W | ${point.activity_name}`}</title>
            </circle>
          </a>
        ))}
        {xLabels.map((point) => (
          <text key={`label-${point.date}-${point.activity_id}`} x={point.x} y={height - 18} textAnchor="middle" fontSize="12" fill="#58716a">
            {formatHfDevelopmentDate(point.date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function TrainingHfDevelopmentSection() {
  const [data, setData] = useState<HfDevelopmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWindowKey, setSelectedWindowKey] = useState("5m");
  const [selectedBucketStart, setSelectedBucketStart] = useState<number | null>(null);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [bucketMenuOpen, setBucketMenuOpen] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (selectedWindowKey) {
          params.set("window_key", selectedWindowKey);
        }
        if (selectedBucketStart != null) {
          params.set("bucket_start_w", String(selectedBucketStart));
        }
        const response = await apiFetch(`${API_BASE_URL}/training/analysis/hf-development?${params.toString()}`);
        const payload = await parseJsonSafely<HfDevelopmentResponse | { detail?: string }>(response);
        if (!response.ok || !payload || !("points" in payload)) {
          throw new Error(
            typeof payload === "object" && payload && "detail" in payload && payload.detail
              ? payload.detail
              : "HF Entwicklung konnte nicht geladen werden.",
          );
        }
        const resolved = payload as HfDevelopmentResponse;
        setData(resolved);
        setSelectedWindowKey(resolved.selected_window_key);
        setSelectedBucketStart(resolved.selected_bucket_start_w);
      } catch (err) {
        setError(err instanceof Error ? err.message : "HF Entwicklung konnte nicht geladen werden.");
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [selectedWindowKey, selectedBucketStart]);

  const points = data?.points ?? [];
  const bestPoint = useMemo(
    () => (points.length ? points.reduce((best, point) => (point.avg_hr_bpm < best.avg_hr_bpm ? point : best), points[0]) : null),
    [points],
  );
  const latestPoint = points.length ? points[points.length - 1] : null;
  const selectedWindowLabel =
    data?.window_options.find((option) => option.key === selectedWindowKey)?.label ?? selectedWindowKey;
  const selectedBucketLabel =
    data?.bucket_options.find((option) => option.bucket_start_w === selectedBucketStart)?.label ?? data?.selected_bucket_label ?? "-";

  return (
      <TrainingSection
        title="HF Entwicklung"
        description="Pro Tag wird der niedrigste gefundene Durchschnitts-HF-Wert gezeigt. Wenn an einem Tag mehrere Fahrten passen, bleibt nur der beste Tagespunkt sichtbar."
        highlight
      >
        {loading ? <p className="training-note">HF Verlauf wird geladen...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        {data && !loading && !error ? (
          <>
            <div className="training-analysis-summary-grid">
              <div className="training-analysis-summary-card training-analysis-summary-card-select">
                <div className="training-analysis-summary-line">
                  <span>Zeitfenster:</span>
                  <strong>{selectedWindowLabel}</strong>
                </div>
                <button
                  className="training-analysis-select-trigger"
                  type="button"
                  aria-expanded={windowMenuOpen}
                  onClick={() => {
                    setWindowMenuOpen((current) => !current);
                    setBucketMenuOpen(false);
                  }}
                >
                  Zeitfenster wählen
                </button>
                {windowMenuOpen ? (
                  <div className="training-analysis-popover" role="dialog" aria-label="Zeitfenster Auswahl">
                    <div className="training-analysis-option-grid">
                      {(data.window_options ?? []).map((option) => (
                        <button
                          key={option.key}
                          className={`training-analysis-option ${selectedWindowKey === option.key ? "active" : ""}`}
                          type="button"
                          onClick={() => {
                            setSelectedWindowKey(option.key);
                            setSelectedBucketStart(null);
                            setWindowMenuOpen(false);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="training-analysis-summary-card training-analysis-summary-card-select">
                <div className="training-analysis-summary-line">
                  <span>Bereich:</span>
                  <strong>{selectedBucketLabel}</strong>
                </div>
                <button
                  className="training-analysis-select-trigger"
                  type="button"
                  aria-expanded={bucketMenuOpen}
                  onClick={() => {
                    setBucketMenuOpen((current) => !current);
                    setWindowMenuOpen(false);
                  }}
                >
                  Bereich wählen
                </button>
                {bucketMenuOpen ? (
                  <div className="training-analysis-popover training-analysis-popover-buckets" role="dialog" aria-label="Wattbereich Auswahl">
                    <div className="training-analysis-option-grid training-analysis-option-grid-buckets">
                      {(data.bucket_options ?? []).map((option) => (
                        <button
                          key={option.bucket_start_w}
                          className={`training-analysis-option ${selectedBucketStart === option.bucket_start_w ? "active" : ""}`}
                          type="button"
                          onClick={() => {
                            setSelectedBucketStart(option.bucket_start_w);
                            setBucketMenuOpen(false);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="training-analysis-summary-card">
                <div className="training-analysis-summary-line">
                  <span>Punkte:</span>
                  <strong>{data.summary.points_count}</strong>
                </div>
              </div>
              <div className="training-analysis-summary-card">
                <div className="training-analysis-summary-line">
                  <span>Bester Tag:</span>
                  <strong>{bestPoint ? `${Math.round(bestPoint.avg_hr_bpm)} bpm` : "-"}</strong>
                </div>
              </div>
            </div>

            <HfDevelopmentChart points={points} />

            {latestPoint || bestPoint ? (
              <div className="training-analysis-summary-grid">
                <div className="training-analysis-summary-card">
                  <span>Letzter Punkt</span>
                  <strong>{latestPoint ? formatHfDevelopmentDate(latestPoint.date) : "-"}</strong>
                  <small>{latestPoint ? `${Math.round(latestPoint.avg_hr_bpm)} bpm bei ${Math.round(latestPoint.avg_power_w)} W` : ""}</small>
                </div>
                <div className="training-analysis-summary-card">
                  <span>Bester Punkt</span>
                  <strong>{bestPoint ? formatHfDevelopmentDate(bestPoint.date) : "-"}</strong>
                  <small>{bestPoint ? `${Math.round(bestPoint.avg_hr_bpm)} bpm bei ${Math.round(bestPoint.avg_power_w)} W` : ""}</small>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </TrainingSection>
  );
}

export function TrainingAnalysisPage() {
  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Training</p>
        <h1>Analyse</h1>
        <p className="lead">
          Hier bauen wir schrittweise Trainingsauswertungen auf. Die einzelnen Auswertungen liegen jetzt als Unterpunkte in der Navigation.
        </p>
      </div>

      <div className="training-analysis-tabs" role="list" aria-label="Training Analyse Unterpunkte">
        <Link to="/training/analysis/hf-development" className="training-analysis-tab">
          <strong>HF Entwicklung</strong>
          <span>Verlauf pro Tag im gewaehlten Fenster</span>
        </Link>
      </div>
    </section>
  );
}

export function TrainingHfDevelopmentPage() {
  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Training</p>
        <h1>HF Entwicklung</h1>
        <p className="lead">
          Hier siehst du je Tag den besten, also niedrigsten HF-Wert im gewaehlten Zeit- und Wattfenster.
        </p>
      </div>

      <TrainingHfDevelopmentSection />
    </section>
  );
}

export function TrainingPlansPage() {
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planMessage, setPlanMessage] = useState<string | null>(null);
  const [planDebugText, setPlanDebugText] = useState("");
  const [planLoadingStep, setPlanLoadingStep] = useState(0);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [llmLoading, setLlmLoading] = useState(true);
  const [savedProfile, setSavedProfile] = useState<TrainingConfigProfilePayload | null>(null);
  const [generatedTrainingPlan, setGeneratedTrainingPlan] = useState<TrainingPlanDraftResponse | null>(null);

  const savedConfigState = useMemo(() => normalizeTrainingConfigProfileState(savedProfile), [savedProfile]);
  const llmSections = useMemo(() => buildTrainingPlanSectionsPayload(savedConfigState), [savedConfigState]);
  const hasConfiguredContent = useMemo(
    () => llmSections.some((section) => section.focus_labels.length || section.notes),
    [llmSections],
  );
  const savedTrainingPlan = useMemo(() => normalizeTrainingPlanPayload(savedProfile?.training_plan), [savedProfile]);
  const visibleTrainingPlan = generatedTrainingPlan ?? savedTrainingPlan;
  const planVariants = visibleTrainingPlan?.week_variants ?? [];
  const planLoadingSteps = [
    {
      title: "Planstruktur wird vorbereitet",
      text: "Die gespeicherte Trainingskonfiguration wird gesammelt und für das LLM als strukturierter Auftrag aufbereitet.",
    },
    {
      title: "LLM erstellt Varianten",
      text: "Es werden gerade 1 bis 3 unterschiedliche Wochenstrukturen mit Schwerpunkten, Belastungsideen und Tageslogik ausgearbeitet.",
    },
    {
      title: "Plan wird im Profil gespeichert",
      text: "Die Antwort wird geprüft, aufbereitet und anschließend direkt in deinem Profil hinterlegt.",
    },
  ];

  useEffect(() => {
    if (!planLoading) {
      setPlanLoadingStep(0);
      return;
    }

    setPlanLoadingStep(0);
    const timer = window.setInterval(() => {
      setPlanLoadingStep((current) => (current + 1) % planLoadingSteps.length);
    }, 1800);

    return () => window.clearInterval(timer);
  }, [planLoading]);

  async function loadPlanProfile() {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/profile`);
      const payload = await parseJsonSafely<TrainingConfigProfilePayload | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Profil konnte nicht geladen werden.",
        );
      }
      const profilePayload = (payload as TrainingConfigProfilePayload) ?? null;
      setSavedProfile(
        profilePayload
          ? {
              ...profilePayload,
              training_plan: normalizeTrainingPlanPayload(profilePayload.training_plan),
            }
          : null,
      );
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Profil konnte nicht geladen werden.");
    } finally {
      setProfileLoading(false);
    }
  }

  useEffect(() => {
    void loadPlanProfile();
    void (async () => {
      setLlmLoading(true);
      try {
        const response = await apiFetch(`${API_BASE_URL}/llm/status`);
        const payload = await parseJsonSafely<LlmStatus | { detail?: string }>(response);
        if (response.ok) {
          setLlmStatus(payload as LlmStatus);
        }
      } finally {
        setLlmLoading(false);
      }
    })();
  }, []);

  async function handleGeneratePlanStructures() {
    if (!hasConfiguredContent) {
      setPlanError("Im Profil ist noch keine Trainingskonfiguration gespeichert.");
      return;
    }

    setPlanLoading(true);
    setPlanError(null);
    setPlanMessage(null);
    setPlanDebugText("");
    try {
      const deriveResponse = await apiFetch(`${API_BASE_URL}/training/plan-draft/derive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: llmSections }),
      });
      const derivePayload = await parseJsonSafely<TrainingPlanDraftResponse | { detail?: string }>(deriveResponse);
      setPlanDebugText(JSON.stringify(derivePayload, null, 2));
      if (!deriveResponse.ok || !derivePayload || !('summary' in derivePayload)) {
        throw new Error(
          typeof derivePayload === "object" && derivePayload && "detail" in derivePayload && derivePayload.detail
            ? derivePayload.detail
            : "Planstrukturen konnten nicht erstellt werden.",
        );
      }
      const normalizedDerivedPlan = normalizeTrainingPlanPayload(derivePayload);
      setGeneratedTrainingPlan(normalizedDerivedPlan);

      const profileResponse = await apiFetch(`${API_BASE_URL}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          training_plan: derivePayload,
        }),
      });
      const profilePayload = await parseJsonSafely<TrainingConfigProfilePayload | { detail?: string }>(profileResponse);
      if (!profileResponse.ok) {
        throw new Error(
          typeof profilePayload === "object" && profilePayload && "detail" in profilePayload && profilePayload.detail
            ? profilePayload.detail
            : "Planstrukturen konnten nicht im Profil gespeichert werden.",
        );
      }

      const nextProfile = (profilePayload as TrainingConfigProfilePayload) ?? null;
      const resolvedProfile = nextProfile
        ? {
            ...nextProfile,
            training_plan: normalizeTrainingPlanPayload(nextProfile.training_plan) ?? normalizedDerivedPlan,
          }
        : { training_plan: normalizedDerivedPlan };

      setSavedProfile(resolvedProfile as TrainingConfigProfilePayload);
      setPlanMessage(
        normalizedDerivedPlan?.week_variants?.length
          ? "1-3 Planstrukturen wurden erzeugt und im Profil gespeichert."
          : "Der Planentwurf wurde gespeichert. Es wurden diesmal aber noch keine einzelnen Plan 1-3 Varianten zurückgegeben.",
      );
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Planstrukturen konnten nicht erstellt werden.");
    } finally {
      setPlanLoading(false);
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Training</p>
        <h1>Trainingspläne</h1>
        <p className="lead">
          Hier entstehen aus deinem Profil konkrete Wochenstrukturen. Das LLM erzeugt daraus 1 bis 3 Varianten und speichert sie direkt im Profil.
        </p>
      </div>

      {profileError ? <p className="error-text">{profileError}</p> : null}
      {planError ? <p className="error-text">{planError}</p> : null}
      {planMessage ? <p className="training-note">{planMessage}</p> : null}

      <TrainingSection
        title="Planstruktur"
        description="Hier siehst du die aktuell im Profil gespeicherte Grundlage, aus der später strukturierte Wochenvorschläge abgeleitet werden."
        highlight
      >
        <div className="training-profile-result-grid">
          {llmSections.map((section) => (
            <div key={section.section_key} className="training-profile-builder-card">
              <div className="training-profile-builder-head">
                <h3>{section.section_title}</h3>
              </div>

              {section.focus_labels.length || section.notes ? (
                <>
                  {section.focus_labels.length ? (
                    <div className="training-profile-order-preview">
                      {section.focus_labels.map((label) => (
                        <span key={`${section.section_key}-${label}`} className="training-pill">
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {section.notes ? (
                    <p className="training-note">
                      <strong>Hinweise:</strong> {section.notes}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="training-empty-state">
                  <strong>Noch nichts hinterlegt.</strong>
                  <span>In diesem Bereich ist aktuell noch kein gespeicherter Fokus oder Hinweis im Profil vorhanden.</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </TrainingSection>

      <TrainingSection
        title="LLM Vorschläge"
        description="Aus der Planstruktur erzeugt das LLM 1 bis 3 konkrete Wochenvarianten und speichert sie direkt im Profil."
        highlight
      >
        <div className="training-profile-builder-card">
          <div className="training-profile-builder-head">
            <h3>Wochenvorschläge</h3>
            <p>
              {hasConfiguredContent
                ? "Die gespeicherte Konfiguration ist bereit. Du kannst daraus jetzt konkrete Wochenvarianten erzeugen."
                : "Speichere zuerst in Training Konfiguration einen Profilstand mit Inhalten, damit daraus Planstrukturen abgeleitet werden können."}
            </p>
          </div>

          <div className="settings-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => void handleGeneratePlanStructures()}
              disabled={profileLoading || llmLoading || !llmStatus?.configured || !hasConfiguredContent || planLoading}
            >
              {planLoading ? "Planstrukturen werden erstellt..." : "1-3 Planstrukturen erzeugen"}
            </button>
          </div>

          <label className="training-field">
            <span>LLM Antwort Debug</span>
            <textarea
              className="training-textarea"
              value={planDebugText}
              readOnly
              placeholder="Nach dem Klick auf '1-3 Planstrukturen erzeugen' erscheint hier die rohe API-Antwort."
            />
          </label>

          {visibleTrainingPlan ? (
            <div className="training-plan-draft-layout">
              <div className="training-profile-builder-head">
                <h3>{visibleTrainingPlan.plan_title}</h3>
                <p>{visibleTrainingPlan.summary}</p>
              </div>
              {visibleTrainingPlan.model ? <p className="training-note">Letzte Generierung mit: {visibleTrainingPlan.model}</p> : null}
              {!planVariants.length ? (
                <p className="training-note">
                  Dieser Entwurf ist gespeichert, enthält aber noch keine einzelnen Wochenvarianten. Die allgemeinen Planbausteine siehst du darunter trotzdem.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="training-empty-state">
              <strong>Noch keine LLM-Vorschläge im Profil.</strong>
              <span>Erzeuge hier die ersten 1 bis 3 Varianten, damit sie darunter als eigene Pläne erscheinen.</span>
            </div>
          )}
        </div>
      </TrainingSection>

      {visibleTrainingPlan ? (
        <>
          {planVariants.length ? (
            planVariants.map((variant, index) => (
              <TrainingSection
                key={`${variant.title}-${index}`}
                title={`Plan ${index + 1}`}
                description={variant.summary || variant.title}
                highlight={index === 0}
              >
                <div className="training-plan-draft-layout">
                  <div className="training-profile-builder-card training-plan-variant-card">
                    <div className="training-profile-builder-head">
                      <p className="training-config-kicker">{variant.level || "Wochenvariante"}</p>
                      <h3>{variant.title}</h3>
                      {variant.suitable_for ? <p className="training-note">Passend für: {variant.suitable_for}</p> : null}
                    </div>

                    <div className="training-plan-week-list">
                      {variant.days.map((day) => (
                        <div key={`${variant.title}-${day.day_label}`} className="training-plan-week-item">
                          <div className="training-plan-week-head">
                            <strong>{day.day_label}</strong>
                            <span>{day.session_label}</span>
                          </div>
                          {day.objective ? <p><strong>Ziel:</strong> {day.objective}</p> : null}
                          {day.details ? <p>{day.details}</p> : null}
                          {day.duration_hint || day.intensity_hint ? (
                            <div className="training-plan-week-meta">
                              {day.duration_hint ? <span>{day.duration_hint}</span> : null}
                              {day.intensity_hint ? <span>{day.intensity_hint}</span> : null}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="training-plan-draft-grid">
                    <TrainingConfigDetailCard
                      title="Wochenstruktur"
                      items={
                        visibleTrainingPlan.weekly_structure.length
                          ? visibleTrainingPlan.weekly_structure
                          : ["Noch keine konkrete Wochenstruktur im gespeicherten Plan enthalten."]
                      }
                    />
                    <TrainingConfigDetailCard
                      title="Schlüsseleinheiten"
                      items={
                        visibleTrainingPlan.key_workouts.length
                          ? visibleTrainingPlan.key_workouts
                          : ["Noch keine Schlüsseleinheiten im gespeicherten Plan enthalten."]
                      }
                    />
                    <TrainingConfigDetailCard
                      title="Progression"
                      items={
                        visibleTrainingPlan.progression_notes.length
                          ? visibleTrainingPlan.progression_notes
                          : ["Noch keine Progressionshinweise im gespeicherten Plan enthalten."]
                      }
                    />
                    <TrainingConfigDetailCard
                      title="Warum dieser Plan passt"
                      items={
                        visibleTrainingPlan.why_this_plan_fits.length
                          ? visibleTrainingPlan.why_this_plan_fits
                          : ["Noch keine Begründung im gespeicherten Plan enthalten."]
                      }
                    />
                    <TrainingConfigDetailCard
                      title="Worauf du achten solltest"
                      items={
                        visibleTrainingPlan.watchouts.length
                          ? visibleTrainingPlan.watchouts
                          : ["Noch keine Risiken oder Grenzen im gespeicherten Plan enthalten."]
                      }
                    />
                    <TrainingConfigDetailCard
                      title="Vor dem Übernehmen prüfen"
                      items={
                        visibleTrainingPlan.adoption_checklist.length
                          ? visibleTrainingPlan.adoption_checklist
                          : ["Noch keine Prüfpunkte im gespeicherten Plan enthalten."]
                      }
                    />
                  </div>
                </div>
              </TrainingSection>
            ))
          ) : (
            <TrainingSection
              title={visibleTrainingPlan.plan_title}
              description={visibleTrainingPlan.summary}
            >
              <div className="training-plan-draft-layout">
                <div className="training-empty-state">
                  <strong>Noch keine Plan 1-3 Varianten vorhanden.</strong>
                  <span>Die nächste Generierung sollte wieder konkrete Wochenvorschläge als eigene Sektionen anlegen. Der gespeicherte Planentwurf ist aber bereits vorhanden.</span>
                </div>

                <div className="training-plan-draft-grid">
                  <TrainingConfigDetailCard
                    title="Wochenstruktur"
                    items={
                      visibleTrainingPlan.weekly_structure.length
                        ? visibleTrainingPlan.weekly_structure
                        : ["Noch keine konkrete Wochenstruktur im gespeicherten Plan enthalten."]
                    }
                  />
                  <TrainingConfigDetailCard
                    title="Schlüsseleinheiten"
                    items={
                      visibleTrainingPlan.key_workouts.length
                        ? visibleTrainingPlan.key_workouts
                        : ["Noch keine Schlüsseleinheiten im gespeicherten Plan enthalten."]
                    }
                  />
                  <TrainingConfigDetailCard
                    title="Progression"
                    items={
                      visibleTrainingPlan.progression_notes.length
                        ? visibleTrainingPlan.progression_notes
                        : ["Noch keine Progressionshinweise im gespeicherten Plan enthalten."]
                    }
                  />
                  <TrainingConfigDetailCard
                    title="Warum dieser Plan passt"
                    items={
                      visibleTrainingPlan.why_this_plan_fits.length
                        ? visibleTrainingPlan.why_this_plan_fits
                        : ["Noch keine Begründung im gespeicherten Plan enthalten."]
                    }
                  />
                  <TrainingConfigDetailCard
                    title="Worauf du achten solltest"
                    items={
                      visibleTrainingPlan.watchouts.length
                        ? visibleTrainingPlan.watchouts
                        : ["Noch keine Risiken oder Grenzen im gespeicherten Plan enthalten."]
                    }
                  />
                  <TrainingConfigDetailCard
                    title="Vor dem Übernehmen prüfen"
                    items={
                      visibleTrainingPlan.adoption_checklist.length
                        ? visibleTrainingPlan.adoption_checklist
                        : ["Noch keine Prüfpunkte im gespeicherten Plan enthalten."]
                    }
                  />
                </div>
              </div>
            </TrainingSection>
          )}
        </>
      ) : (
        <TrainingSection
          title="Noch kein gespeicherter Plan"
          description="Sobald das LLM Planstrukturen aus deiner Konfiguration erzeugt hat, erscheinen sie hier als Plan 1 bis Plan 3."
        >
          <div className="training-empty-state">
            <strong>Noch keine Planvarianten im Profil.</strong>
            <span>Erzeuge hier die ersten 1 bis 3 Varianten und speichere sie direkt auf dem Profil.</span>
          </div>
        </TrainingSection>
      )}

      {planLoading ? (
        <div className="training-llm-loading-overlay" role="status" aria-live="polite" aria-label="Planstrukturen werden erstellt">
          <div className="training-llm-loading-card">
            <div className="waiting-spinner" aria-hidden="true" />
            <h3>{planLoadingSteps[planLoadingStep]?.title ?? "Planstrukturen werden erstellt"}</h3>
            <p>{planLoadingSteps[planLoadingStep]?.text ?? "Die Anfrage wird verarbeitet."}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

