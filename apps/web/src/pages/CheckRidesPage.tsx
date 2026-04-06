import { useMemo, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type Ride = {
  activity_id: string;
  name: string;
  start_local: string | null;
  start_utc: string | null;
  duration_s: number | null;
  duration_label: string | null;
  distance_m: number | null;
  avg_power_w: number | null;
  avg_hr_bpm: number | null;
};

type RidesResponse = {
  generated_at: string;
  mode?: "recent" | "period";
  period?: {
    start_year: number;
    start_month: number;
    end_year: number;
    end_month: number;
  };
  summary: {
    checked_recent_rides: number;
    already_loaded: number;
    missing: number;
    pages_scanned?: number;
    reached_older_activities?: boolean;
  };
  rides: Ride[];
};

type InterestingUpdate = {
  kind: "new_max_hr_peak";
  metric_id: number;
  value: number;
  recorded_at: string;
  source: string;
  activity_name: string;
  activity_id: string;
};

type ImportResponse = {
  loaded: number;
  skipped: number;
  errors: Array<{ activity_id: string; reason: string }>;
  interesting_updates?: InterestingUpdate[];
};

type ImportedSummary = {
  status: string;
  activities: number;
  fit_files: number;
  derived_max_hr_metrics: number;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}

function formatDistanceMeters(value: number | null): string {
  if (value == null) return "-";
  return `${(value / 1000).toFixed(1)} km`;
}

function formatNumber(value: number | null, suffix: string): string {
  if (value == null) return "-";
  return `${Math.round(value)} ${suffix}`;
}

const monthOptions = [
  { value: 1, label: "Januar" },
  { value: 2, label: "Februar" },
  { value: 3, label: "März" },
  { value: 4, label: "April" },
  { value: 5, label: "Mai" },
  { value: 6, label: "Juni" },
  { value: 7, label: "Juli" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "Oktober" },
  { value: 11, label: "November" },
  { value: 12, label: "Dezember" },
];

export function CheckRidesPage() {
  const now = new Date();
  const [viewMode, setViewMode] = useState<"recent" | "month" | "delete">("recent");
  const [selectedStartMonth, setSelectedStartMonth] = useState(now.getMonth() + 1);
  const [selectedStartYear, setSelectedStartYear] = useState(now.getFullYear());
  const [selectedEndMonth, setSelectedEndMonth] = useState(now.getMonth() + 1);
  const [selectedEndYear, setSelectedEndYear] = useState(now.getFullYear());
  const [data, setData] = useState<RidesResponse | null>(null);
  const [importedSummary, setImportedSummary] = useState<ImportedSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Rides werden geprüft");
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importCurrent, setImportCurrent] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importCurrentName, setImportCurrentName] = useState("");
  const [celebration, setCelebration] = useState<InterestingUpdate | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleteDerivedMetrics, setDeleteDerivedMetrics] = useState(true);

  const selectedStartMonthLabel = monthOptions.find((option) => option.value === selectedStartMonth)?.label ?? String(selectedStartMonth);
  const selectedEndMonthLabel = monthOptions.find((option) => option.value === selectedEndMonth)?.label ?? String(selectedEndMonth);
  const selectedRangeLabel = `${selectedStartMonthLabel} ${selectedStartYear} bis ${selectedEndMonthLabel} ${selectedEndYear}`;

  const selectableYears = useMemo(() => {
    const years: number[] = [];
    for (let year = now.getFullYear(); year >= 2018; year -= 1) years.push(year);
    return years;
  }, [now]);

  async function loadImportedSummary() {
    setLoading(true);
    setLoadingLabel("Importierte Garmin-Fahrten werden gezählt");
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/garmin/imported-summary`);
      const payload = await parseJsonSafely<ImportedSummary | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Übersicht konnte nicht geladen werden.");
      }
      setImportedSummary(payload as ImportedSummary);
      setData(null);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function loadRides(mode: "recent" | "month" = viewMode === "delete" ? "recent" : viewMode) {
    setLoading(true);
    setLoadingLabel(mode === "recent" ? "Neueste Garmin-Rides werden geprüft" : `Garmin-Rides von ${selectedRangeLabel} werden geprüft`);
    setError(null);
    try {
      const response =
        mode === "recent"
          ? await apiFetch(`${API_BASE_URL}/garmin/new-rides?limit=80`)
          : await apiFetch(
              `${API_BASE_URL}/garmin/month-rides?start_year=${selectedStartYear}&start_month=${selectedStartMonth}&end_year=${selectedEndYear}&end_month=${selectedEndMonth}`,
            );
      const payload = await parseJsonSafely<RidesResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Rides konnten nicht geladen werden.");
      }
      if (!payload) {
        throw new Error("Rides konnten nicht geladen werden: leere Antwort.");
      }
      setData(payload as RidesResponse);
      setImportedSummary(null);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function importSelected() {
    if (selectedIds.size === 0 || importing || !data) return;
    setImporting(true);
    setImportMessage(null);
    setImportCurrent(0);
    setImportCurrentName("");

    try {
      const selectedList = data.rides.filter((ride) => selectedIds.has(ride.activity_id));
      setImportTotal(selectedList.length);

      let loaded = 0;
      let skipped = 0;
      let errors = 0;
      const interestingUpdates: InterestingUpdate[] = [];

      for (let i = 0; i < selectedList.length; i += 1) {
        const ride = selectedList[i];
        setImportCurrentName(ride.name);

        const response = await apiFetch(`${API_BASE_URL}/garmin/import-rides`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activity_ids: [ride.activity_id] }),
        });
        const payload = await parseJsonSafely<ImportResponse | { detail?: string }>(response);
        if (!response.ok) {
          throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Import fehlgeschlagen.");
        }
        if (!payload || !("loaded" in payload)) {
          throw new Error("Import fehlgeschlagen: leere Antwort.");
        }

        loaded += payload.loaded;
        skipped += payload.skipped;
        errors += payload.errors.length;
        interestingUpdates.push(...(payload.interesting_updates ?? []));
        setImportCurrent(i + 1);
      }

      setImportMessage(`Import fertig: geladen ${loaded}, übersprungen ${skipped}, Fehler ${errors}.`);
      if (viewMode === "recent" || viewMode === "month") {
        await loadRides(viewMode);
      }
      if (interestingUpdates.length > 0) {
        const newestPeak = [...interestingUpdates].filter((item) => item.kind === "new_max_hr_peak").sort((a, b) => b.value - a.value)[0];
        if (newestPeak) setCelebration(newestPeak);
      }
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : "Import fehlgeschlagen");
    } finally {
      setImporting(false);
      setImportCurrentName("");
    }
  }

  async function resetImported() {
    setResetting(true);
    setImportMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/garmin/reset-imported`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete_derived_metrics: deleteDerivedMetrics }),
      });
      const payload = (await parseJsonSafely<{ deleted_activities?: number; deleted_fit_files?: number; deleted_derived_metrics?: number; detail?: string }>(response)) ?? {};
      if (!response.ok) {
        throw new Error(payload.detail || "Löschen fehlgeschlagen");
      }
      setImportMessage(
        `Löschen fertig: ${payload.deleted_activities ?? 0} Aktivitäten, ${payload.deleted_fit_files ?? 0} FIT-Dateien und ${payload.deleted_derived_metrics ?? 0} abgeleitete MaxHF-Werte entfernt.`,
      );
      setShowResetConfirm(false);
      await loadImportedSummary();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    } finally {
      setResetting(false);
    }
  }

  const allIds = useMemo(() => data?.rides.map((ride) => ride.activity_id) ?? [], [data]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(allIds));
      return;
    }
    setSelectedIds(new Set());
  }

  function toggleSingle(activityId: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(activityId);
      else next.delete(activityId);
      return next;
    });
  }

  const progressPercent = importTotal > 0 ? Math.round((importCurrent / importTotal) * 100) : 0;
  const ringRadius = 42;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (progressPercent / 100) * ringCircumference;

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Setup</p>
        <h1>Neue Rides prüfen</h1>
        <p className="lead">Prüfe neue Garmin-Rides gezielt per Button, suche über einen Zeitraum oder verwalte den kompletten lokalen Garmin-Import.</p>
      </div>

      <div className="training-metric-tabs" role="tablist" aria-label="Ride-Prüfmodus">
        <button className={`training-metric-tab ${viewMode === "recent" ? "active" : ""}`} type="button" role="tab" aria-selected={viewMode === "recent"} onClick={() => setViewMode("recent")}>
          <strong>Neue Rides</strong>
          <span>Nur per Button prüfen</span>
        </button>
        <button className={`training-metric-tab ${viewMode === "month" ? "active" : ""}`} type="button" role="tab" aria-selected={viewMode === "month"} onClick={() => setViewMode("month")}>
          <strong>Zeitraum</strong>
          <span>Von Monat/Jahr bis Monat/Jahr</span>
        </button>
        <button className={`training-metric-tab ${viewMode === "delete" ? "active" : ""}`} type="button" role="tab" aria-selected={viewMode === "delete"} onClick={() => setViewMode("delete")}>
          <strong>Import löschen</strong>
          <span>Lokalen Garmin-Import verwalten</span>
        </button>
      </div>

      {viewMode !== "delete" ? (
        <>
          <div className="ride-summary">
            <div className="card">
              <h2>Übersicht</h2>

              {viewMode === "recent" ? (
                <div className="training-history-actions" style={{ marginBottom: "1rem" }}>
                  <button className="secondary-button" type="button" disabled={loading || importing} onClick={() => void loadRides("recent")}>
                    Neue Rides jetzt prüfen
                  </button>
                </div>
              ) : null}

              {viewMode === "month" ? (
                <div className="settings-status-grid" style={{ marginBottom: "1rem" }}>
                  <label className="settings-label">
                    <span>Von Monat</span>
                    <select className="settings-input" value={selectedStartMonth} onChange={(event) => setSelectedStartMonth(Number(event.target.value))}>
                      {monthOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-label">
                    <span>Von Jahr</span>
                    <select className="settings-input" value={selectedStartYear} onChange={(event) => setSelectedStartYear(Number(event.target.value))}>
                      {selectableYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-label">
                    <span>Bis Monat</span>
                    <select className="settings-input" value={selectedEndMonth} onChange={(event) => setSelectedEndMonth(Number(event.target.value))}>
                      {monthOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-label">
                    <span>Bis Jahr</span>
                    <select className="settings-input" value={selectedEndYear} onChange={(event) => setSelectedEndYear(Number(event.target.value))}>
                      {selectableYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-label">
                    <span>&nbsp;</span>
                    <button className="secondary-button" type="button" disabled={loading || importing} onClick={() => void loadRides("month")}>
                      Zeitraum laden
                    </button>
                  </label>
                </div>
              ) : null}

              {loading ? null : error ? (
                <p className="error-text">{error}</p>
              ) : data ? (
                <div className="stats-line">
                  <span>In Garmin geprüft: {data.summary.checked_recent_rides}</span>
                  <span>Bereits lokal importiert: {data.summary.already_loaded}</span>
                  <span>Noch nicht importiert: {data.summary.missing}</span>
                  {viewMode === "month" ? <span>Garmin-Seiten: {data.summary.pages_scanned ?? 0}</span> : null}
                  <button className="secondary-button" type="button" disabled={importing} onClick={() => void loadRides(viewMode)}>
                    Neu laden
                  </button>
                </div>
              ) : (
                <p className="training-note">
                  {viewMode === "recent"
                    ? "Es wird erst nach dem Klick auf den Button geprüft."
                    : "Wähle einen Zeitraum und starte die Abfrage mit dem Button."}
                </p>
              )}

              {!loading && data ? (
                <p className="training-note">
                  {viewMode === "recent"
                    ? "Geprüft bedeutet: So viele neueste Aktivitäten wurden direkt bei Garmin angesehen."
                    : "Geprüft bedeutet: So viele Aktivitäten wurden im gewählten Zeitraum in Garmin durchsucht. Seiten sind einzelne Garmin-Abrufblöcke."}
                </p>
              ) : null}

              {importMessage ? <p className="info-text">{importMessage}</p> : null}
            </div>
          </div>

          <div className="card rides-table-wrap">
            <div className="table-toolbar">
              <h2>{viewMode === "recent" ? "Fehlende Rides aus den neuesten Garmin-Aktivitäten" : `Fehlende Rides von ${selectedRangeLabel}`}</h2>
              <button className="primary-button" type="button" disabled={selectedIds.size === 0 || importing} onClick={() => void importSelected()}>
                {importing ? "Lade..." : `Ausgewählte laden (${selectedIds.size})`}
              </button>
            </div>

            <div className="table-scroll">
              <table className="rides-table">
                <thead>
                  <tr>
                    <th>
                      <label className="checkbox-header">
                        <input type="checkbox" checked={allSelected} disabled={importing} onChange={(event) => toggleAll(event.target.checked)} aria-label="Alle auswählen" />
                        <span>Select all</span>
                      </label>
                    </th>
                    <th>Datum/Zeit Start</th>
                    <th>Name</th>
                    <th>Dauer</th>
                    <th>Distanz</th>
                    <th>O Watt</th>
                    <th>O HF</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && !error && data && data.rides.length === 0 ? (
                    <tr>
                      <td colSpan={7}>{viewMode === "recent" ? "Keine fehlenden Rides gefunden." : "In diesem Zeitraum wurden keine noch nicht importierten Rides gefunden."}</td>
                    </tr>
                  ) : null}
                  {data?.rides.map((ride) => (
                    <tr key={ride.activity_id}>
                      <td>
                        <input type="checkbox" checked={selectedIds.has(ride.activity_id)} disabled={importing} onChange={(event) => toggleSingle(ride.activity_id, event.target.checked)} aria-label={`Ride ${ride.name} auswählen`} />
                      </td>
                      <td>{formatDateTime(ride.start_local ?? ride.start_utc)}</td>
                      <td className="ride-name-cell">
                        <strong>{ride.name}</strong>
                        <span className="ride-id">ID: {ride.activity_id}</span>
                      </td>
                      <td>{ride.duration_label ?? "-"}</td>
                      <td>{formatDistanceMeters(ride.distance_m)}</td>
                      <td>{formatNumber(ride.avg_power_w, "W")}</td>
                      <td>{formatNumber(ride.avg_hr_bpm, "bpm")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="ride-summary">
          <div className="card">
            <div className="training-history-head">
              <div>
                <h2>Lokaler Garmin-Import</h2>
                <p className="lead">Hier siehst du schnell, wie viel bereits lokal gespeichert ist. Das Löschen wirkt global auf den kompletten Garmin-Import.</p>
              </div>
              <div className="training-history-actions">
                <button className="secondary-button" type="button" disabled={loading || resetting} onClick={() => void loadImportedSummary()}>
                  Übersicht laden
                </button>
                <button className="primary-button" type="button" disabled={loading || resetting || !importedSummary || (importedSummary.activities === 0 && importedSummary.fit_files === 0 && importedSummary.derived_max_hr_metrics === 0)} onClick={() => setShowResetConfirm(true)}>
                  Wirklich alle löschen
                </button>
              </div>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
            {importMessage ? <p className="info-text">{importMessage}</p> : null}
            <div className="training-mini-grid">
              <div className="training-mini-card">
                <span>Importierte Aktivitäten</span>
                <strong>{importedSummary?.activities ?? 0}</strong>
              </div>
              <div className="training-mini-card">
                <span>Gespeicherte FIT-Dateien</span>
                <strong>{importedSummary?.fit_files ?? 0}</strong>
              </div>
              <div className="training-mini-card">
                <span>Abgeleitete MaxHF-Werte</span>
                <strong>{importedSummary?.derived_max_hr_metrics ?? 0}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {importing ? (
        <div className="import-overlay" role="status" aria-live="polite" aria-label="Import läuft">
          <div className="import-overlay-card">
            <div className="progress-ring-wrap">
              <svg width="110" height="110" className="progress-ring" aria-hidden="true">
                <circle className="progress-ring-bg" cx="55" cy="55" r={ringRadius} />
                <circle className="progress-ring-value" cx="55" cy="55" r={ringRadius} strokeDasharray={ringCircumference} strokeDashoffset={ringOffset} />
              </svg>
              <div className="progress-ring-label">
                {importCurrent}/{importTotal}
              </div>
            </div>
            <p className="import-overlay-title">Rides werden importiert</p>
            <p className="import-overlay-subtitle">{importCurrentName ? `Aktuell: ${importCurrentName}` : "Bitte warten..."}</p>
          </div>
        </div>
      ) : null}

      {loading && !importing ? (
        <div className="import-overlay" role="status" aria-live="polite" aria-label="Prüfung läuft">
          <div className="import-overlay-card">
            <div className="waiting-spinner" aria-hidden="true" />
            <p className="import-overlay-title">{loadingLabel}</p>
            <p className="import-overlay-subtitle">Bitte kurz warten, wir holen und prüfen die Daten aus Garmin Connect.</p>
          </div>
        </div>
      ) : null}

      {celebration ? (
        <div className="celebration-overlay" role="dialog" aria-modal="true" aria-label="Neuer Spitzenwert gefunden">
          <div className="celebration-fireworks" aria-hidden="true">
            <span className="firework firework-a" />
            <span className="firework firework-b" />
            <span className="firework firework-c" />
            <span className="firework firework-d" />
            <span className="firework firework-e" />
          </div>
          <div className="celebration-card">
            <p className="eyebrow">Import Highlight</p>
            <h2>Neuer MaxHF-Spitzenwert erkannt</h2>
            <p className="lead">Beim Import wurde ein neuer Spitzenwert gefunden und direkt in den Grunddaten gespeichert.</p>
            <div className="settings-status-grid">
              <div className="settings-status-chip">
                <span>MaxHF</span>
                <strong>{Math.round(celebration.value)} bpm</strong>
              </div>
              <div className="settings-status-chip">
                <span>Aktivität</span>
                <strong>{celebration.activity_name}</strong>
              </div>
              <div className="settings-status-chip">
                <span>Datum</span>
                <strong>{formatDateTime(celebration.recorded_at)}</strong>
              </div>
            </div>
            <div className="confirm-actions">
              <button className="primary-button" type="button" onClick={() => setCelebration(null)}>
                Super
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showResetConfirm ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Importierte Fahrten löschen">
          <div className="confirm-card">
            <h2>Wirklich alle lokal importierten Garmin-Fahrten löschen?</h2>
            <p>Diese Aktion entfernt den kompletten lokalen Garmin-Import: Aktivitäten, FIT-Dateien und optional auch automatisch erzeugte MaxHF-Werte.</p>
            <label className="settings-label">
              <span>Zusatzoption</span>
              <span className="settings-static-field">
                <input type="checkbox" checked={deleteDerivedMetrics} onChange={(event) => setDeleteDerivedMetrics(event.target.checked)} />
                <span style={{ marginLeft: "0.5rem" }}>Automatisch erzeugte MaxHF-Werte ebenfalls löschen</span>
              </span>
            </label>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" disabled={resetting} onClick={() => setShowResetConfirm(false)}>
                Abbrechen
              </button>
              <button className="primary-button" type="button" disabled={resetting} onClick={() => void resetImported()}>
                {resetting ? "Lösche..." : "Jetzt wirklich alles löschen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
