import { useEffect, useMemo, useState } from "react";
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

type TrainingMetricsResponse = {
  ftp?: MetricEntry[];
  max_hr?: MetricEntry[];
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
  onAdd,
  onEdit,
  onInfo,
  onDelete,
}: {
  config: MetricConfig;
  entries: MetricEntry[];
  loading: boolean;
  error: string | null;
  onAdd: () => void;
  onEdit: (entry: MetricEntry) => void;
  onInfo: () => void;
  onDelete: (entry: MetricEntry) => void;
}) {
  const currentEntry = entries[0] ?? null;
  const zones = useMemo(() => {
    if (!currentEntry) return [];
    return config.key === "ftp" ? buildFtpZones(currentEntry.value) : buildHrZones(currentEntry.value);
  }, [config.key, currentEntry]);

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

      {loading ? (
        <div className="training-empty-state">
          <strong>{config.title} wird geladen...</strong>
        </div>
      ) : currentEntry ? (
        <div className="training-current-value-card">
          <span>Aktueller Wert</span>
          <strong>
            {currentEntry.value} {config.unit}
          </strong>
        </div>
      ) : (
        <div className="training-empty-state">
          <strong>{config.emptyText}</strong>
          <span>{config.helperText}</span>
        </div>
      )}

      {error ? <p className="error-text">{error}</p> : null}

      {currentEntry ? (
        <div className="training-zones-block">
          <div className="training-zones-head">
            <h3>Zonen</h3>
            <span>{config.shortLabel}</span>
          </div>
          <div className="training-zone-list">
            {zones.map((zone, index) => (
              <div key={zone.label} className={`training-zone-row zone-tone-${index}`}>
                <strong>{zone.label}</strong>
                <span>{zone.range}</span>
                <small>{zone.detail}</small>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
    </article>
  );
}

export function TrainingBasicsPage() {
  const [ftpEntries, setFtpEntries] = useState<MetricEntry[]>([]);
  const [maxHrEntries, setMaxHrEntries] = useState<MetricEntry[]>([]);
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

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Training</p>
        <h1>Grunddaten</h1>
        <p className="lead">FTP und MaxHF bilden die Basis für Zonen, spätere Trainingspläne und die historische Einordnung deiner Trainings.</p>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="training-metrics-layout">
        <TrainingMetricCard
          config={metricConfigs.ftp}
          entries={ftpEntries}
          loading={loading}
          error={null}
          onAdd={() => openAdd("ftp")}
          onEdit={(entry) => openEdit("ftp", entry)}
          onInfo={() => setInfoMetric("ftp")}
          onDelete={(entry) => setPendingDelete({ metric: "ftp", entry })}
        />
        <TrainingMetricCard
          config={metricConfigs.maxHr}
          entries={maxHrEntries}
          loading={loading}
          error={null}
          onAdd={() => openAdd("maxHr")}
          onEdit={(entry) => openEdit("maxHr", entry)}
          onInfo={() => setInfoMetric("maxHr")}
          onDelete={(entry) => setPendingDelete({ metric: "maxHr", entry })}
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
