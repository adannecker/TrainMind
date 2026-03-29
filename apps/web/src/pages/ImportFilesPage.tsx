import { ChangeEvent, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type DbMatch = {
  fit_file_id: number;
  external_activity_id: string | null;
  file_name: string;
  file_sha256: string | null;
  content_sha256: string;
  activity_id: number | null;
  activity_name: string | null;
  started_at: string | null;
};

type FitSummary = {
  activity_name: string | null;
  sport: string | null;
  sub_sport: string | null;
  time_created: string | null;
  device_serial_number: number | null;
  garmin_product: number | null;
  session_start_time: string | null;
  total_distance_m: number | null;
  total_timer_time_s: number | null;
  avg_power_w: number | null;
  avg_hr_bpm: number | null;
  records_count: number;
  laps_count: number;
  sessions_count: number;
  metadata_messages: Array<{
    message_name: string;
    message_index: number;
    fields: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
  }>;
  parse_error: string | null;
};

type RideAnalysis = {
  export_file_name: string;
  provider?: string | null;
  external_activity_id: string | null;
  suggested_external_activity_id?: string | null;
  suggested_activity_name?: string | null;
  suggested_activity_name_reason?: string | null;
  suggestion_reasons?: string[];
  filename_numeric_candidates?: string[];
  activity_name: string | null;
  started_at: string | null;
  content_sha256?: string | null;
  fit_sha256?: string | null;
  content_size_bytes?: number | null;
  fit_size_bytes?: number | null;
  fit_summary?: FitSummary;
  duplicate_assessment?: {
    garmin_id_exists: boolean;
    garmin_id_matches: Array<{
      activity_id: number | null;
      external_activity_id: string | null;
      activity_name: string | null;
      started_at: string | null;
    }>;
    same_start_time_exists: boolean;
    same_start_time_matches: Array<{
      activity_id: number | null;
      external_activity_id: string | null;
      activity_name: string | null;
      started_at: string | null;
      match_reasons: string[];
    }>;
    similar_values_exists: boolean;
    similar_value_matches: Array<{
      activity_id: number | null;
      external_activity_id: string | null;
      activity_name: string | null;
      started_at: string | null;
      match_score: number;
      match_reasons: string[];
    }>;
    probability_pct: number;
    probability_label: string;
    reasons: string[];
  };
  heuristic_matches?: Array<{
    activity_id: number | null;
    external_activity_id: string | null;
    activity_name: string | null;
    started_at: string | null;
    duration_s: number | null;
    distance_m: number | null;
    sport: string | null;
    match_score: number;
    match_reasons: string[];
  }>;
  status: "ready" | "missing_from_zip";
  is_duplicate: boolean;
  duplicate_flags: string[];
  db_matches: {
    external_activity_id: DbMatch[];
    content_sha256: DbMatch[];
    file_sha256: DbMatch[];
    heuristic_activity?: Array<{
      activity_id: number | null;
      external_activity_id: string | null;
      activity_name: string | null;
      started_at: string | null;
      duration_s: number | null;
      distance_m: number | null;
      sport: string | null;
      match_score: number;
      match_reasons: string[];
    }>;
  };
};

type ImportFilesAnalysisResponse = {
  generated_at: string;
  source_file_name: string;
  summary: {
    source_file_name: string;
    detected_format?: string;
    db_fit_files: number;
    rides_in_manifest: number;
    duplicates: number;
    new: number;
    missing_from_zip: number;
  };
  rides: RideAnalysis[];
};

type ImportFilesImportResponse = {
  source_file_name: string;
  detected_format?: string;
  requested: number;
  imported: number;
  skipped: number;
  errors: Array<{ export_file_name: string; reason: string }>;
  skipped_items: Array<{ export_file_name: string; reason: string }>;
  imported_items: Array<{
    export_file_name: string;
    provider: string;
    external_activity_id: string;
    activity_name: string;
  }>;
};

type RideRowState = {
  selected: boolean;
  activityName: string;
  editing: boolean;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}

function formatDistanceMeters(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${(value / 1000).toFixed(1)} km`;
}

function formatDurationSeconds(value: number | null | undefined): string {
  if (value == null) return "-";
  const safe = Math.max(0, Math.round(value));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function shortHash(value: string | null | undefined): string {
  if (!value) return "-";
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function formatPower(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${Math.round(value)} W`;
}

function formatHeartRate(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${Math.round(value)} bpm`;
}

function formatBooleanCheck(value: boolean | null | undefined): string {
  return value ? "Ja" : "Nein";
}

function duplicateProbabilityTone(value: number | null | undefined): "high" | "medium" | "low" {
  if ((value ?? 0) >= 65) return "high";
  if ((value ?? 0) >= 40) return "medium";
  return "low";
}

function stripFitExtension(value: string): string {
  return value.replace(/\.fit$/i, "");
}

function isUsableKnownActivityName(ride: RideAnalysis, candidate: string | null | undefined): boolean {
  const value = (candidate || "").trim();
  if (!value) return false;
  const exportName = stripFitExtension(ride.export_file_name).trim().toLowerCase();
  const normalizedCandidate = value.toLowerCase();
  if (normalizedCandidate === ride.export_file_name.trim().toLowerCase()) return false;
  if (normalizedCandidate === exportName) return false;
  return true;
}

function resolvedKnownActivityName(ride: RideAnalysis): string | null {
  const candidates = [
    ride.activity_name,
    ride.duplicate_assessment?.garmin_id_matches[0]?.activity_name,
    ride.duplicate_assessment?.same_start_time_matches[0]?.activity_name,
    ride.duplicate_assessment?.similar_value_matches[0]?.activity_name,
    ride.db_matches.heuristic_activity?.[0]?.activity_name,
    ride.heuristic_matches?.[0]?.activity_name,
    ride.fit_summary?.activity_name,
  ];
  for (const candidate of candidates) {
    if (isUsableKnownActivityName(ride, candidate)) return (candidate || "").trim();
  }
  return null;
}

function previewActivityName(ride: RideAnalysis): string {
  const knownName = resolvedKnownActivityName(ride);
  if (knownName) return knownName;
  const suggestedName = (ride.suggested_activity_name || "").trim();
  if (suggestedName) return suggestedName;
  return ride.export_file_name;
}

function suggestedOrPreviewActivityName(ride: RideAnalysis): string {
  const explicitName = resolvedKnownActivityName(ride);
  if (explicitName) return explicitName;
  const suggestedName = (ride.suggested_activity_name || "").trim();
  if (suggestedName) return suggestedName;
  return previewActivityName(ride);
}

function formatProvider(value: string | null | undefined): string {
  const safe = (value || "").trim();
  if (!safe) return "-";
  if (safe.toLowerCase() === "garmin") return "Garmin";
  return safe;
}

function rideKey(ride: RideAnalysis): string {
  return ride.export_file_name;
}

function buildInitialRideRowState(rides: RideAnalysis[]): Record<string, RideRowState> {
  return Object.fromEntries(
    rides.map((ride) => [
      rideKey(ride),
      {
        selected: ride.status !== "missing_from_zip",
        activityName: suggestedOrPreviewActivityName(ride),
        editing: false,
      },
    ]),
  );
}

function isPossibleDuplicate(ride: RideAnalysis): boolean {
  return ride.is_duplicate || (ride.duplicate_assessment?.probability_pct ?? 0) >= 40;
}

function duplicateLabel(flag: string): string {
  if (flag === "external_activity_id") return "Garmin-ID";
  if (flag === "content_sha256") return "Payload-Hash";
  if (flag === "file_sha256") return "FIT-Hash";
  if (flag === "heuristic_activity") return "Heuristischer Treffer";
  return flag;
}

function detectedFormatLabel(value: string | null | undefined): string {
  if (value === "manifest_export_zip") return "TrainMind Export-ZIP mit Manifest";
  if (value === "garmin_direct_zip") return "Garmin ZIP ohne Manifest";
  return value || "-";
}

function formatMetadataValue(value: string | number | boolean | null | Array<string | number | boolean | null>): string {
  if (value == null) return "-";
  if (Array.isArray(value)) {
    return value.map((item) => (item == null ? "-" : String(item))).join(", ");
  }
  return String(value);
}

export function ImportFilesPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ImportFilesAnalysisResponse | null>(null);
  const [rideRowState, setRideRowState] = useState<Record<string, RideRowState>>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "duplicates" | "new">("all");

  async function analyzeFile(file: File) {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiFetch(`${API_BASE_URL}/garmin/import-files/analyze`, {
        method: "POST",
        body: formData,
      });
      const payload = await parseJsonSafely<ImportFilesAnalysisResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "ZIP konnte nicht analysiert werden.",
        );
      }
      const next = payload as ImportFilesAnalysisResponse;
      setSelectedFile(file);
      setAnalysis(next);
      setRideRowState(buildInitialRideRowState(next.rides));
      setMessage(`Analyse fertig: ${next.summary.rides_in_manifest} Fahrten geprüft.`);
    } catch (err) {
      setAnalysis(null);
      setRideRowState({});
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await analyzeFile(file);
  }

  const visibleRides = useMemo(() => {
    if (!analysis) return [];
    if (filter === "duplicates") return analysis.rides.filter((ride: RideAnalysis) => ride.is_duplicate);
    if (filter === "new") return analysis.rides.filter((ride: RideAnalysis) => !ride.is_duplicate);
    return analysis.rides;
  }, [analysis, filter]);

  const selectedVisibleRideCount = visibleRides.filter((ride) => rideRowState[rideKey(ride)]?.selected).length;
  const selectableVisibleRideCount = visibleRides.filter((ride) => ride.status !== "missing_from_zip").length;
  const allVisibleSelected = selectableVisibleRideCount > 0 && selectedVisibleRideCount === selectableVisibleRideCount;
  const selectedRideCount = analysis?.rides.filter((ride) => rideRowState[rideKey(ride)]?.selected).length ?? 0;

  function updateRideRowState(exportFileName: string, updater: (current: RideRowState) => RideRowState) {
    setRideRowState((current) => {
      const existing = current[exportFileName] ?? { selected: true, activityName: "", editing: false };
      return { ...current, [exportFileName]: updater(existing) };
    });
  }

  function toggleVisibleSelection(nextSelected: boolean) {
    setRideRowState((current) => {
      const next = { ...current };
      for (const ride of visibleRides) {
        if (ride.status === "missing_from_zip") continue;
        const key = rideKey(ride);
        const existing = next[key] ?? { selected: true, activityName: suggestedOrPreviewActivityName(ride), editing: false };
        next[key] = { ...existing, selected: nextSelected };
      }
      return next;
    });
  }

  function deselectPossibleDuplicates() {
    if (!analysis) return;
    setRideRowState((current) => {
      const next = { ...current };
      for (const ride of analysis.rides) {
        if (!isPossibleDuplicate(ride)) continue;
        const key = rideKey(ride);
        const existing = next[key] ?? { selected: true, activityName: suggestedOrPreviewActivityName(ride), editing: false };
        next[key] = { ...existing, selected: false };
      }
      return next;
    });
  }

  async function handleImportSelected() {
    if (!selectedFile || !analysis) return;
    const selections = analysis.rides
      .filter((ride) => rideRowState[rideKey(ride)]?.selected)
      .map((ride) => ({
        export_file_name: ride.export_file_name,
        activity_name: (rideRowState[rideKey(ride)]?.activityName || "").trim() || suggestedOrPreviewActivityName(ride),
      }));
    if (selections.length === 0) {
      setError("Bitte mindestens eine Fahrt für den Import auswählen.");
      return;
    }

    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("selections_json", JSON.stringify(selections));
      const response = await apiFetch(`${API_BASE_URL}/garmin/import-files/import`, {
        method: "POST",
        body: formData,
      });
      const payload = await parseJsonSafely<ImportFilesImportResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Import konnte nicht durchgeführt werden.",
        );
      }
      const result = payload as ImportFilesImportResponse;
      const errorSummary =
        result.errors.length > 0 ? ` Fehler: ${result.errors.map((entry) => `${entry.export_file_name} (${entry.reason})`).join("; ")}` : "";
      setMessage(`Import fertig: ${result.imported} importiert, ${result.skipped} übersprungen.${errorSummary}`);
      await analyzeFile(selectedFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Setup</p>
        <h1>Import Files</h1>
        <p className="lead">
          ZIP mit FIT-Dateien und Manifest hochladen, Fahrten analysieren und Doubletten gegen die aktuelle DB prüfen.
          Danach können ausgewählte Fahrten direkt importiert werden.
        </p>
      </div>

      <div className="import-files-layout">
        <div className="card">
          <div className="section-title-row">
            <h2>ZIP Analyse</h2>
          </div>
          <label className="settings-label">
            Garmin FIT Dump ZIP
            <input className="settings-input" type="file" accept=".zip,application/zip" onChange={(event) => void handleFileChange(event)} />
            <span className="training-note">Nur eine ZIP-Datei. Nach der Auswahl wird sie direkt analysiert.</span>
          </label>
          <div className="settings-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={!selectedFile || loading}
              onClick={() => (selectedFile ? void analyzeFile(selectedFile) : undefined)}
            >
              {loading ? "Analysiere..." : "ZIP erneut analysieren"}
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {message ? <p className="info-text">{message}</p> : null}
        </div>

        {analysis ? (
          <>
            <div className="card">
              <div className="section-title-row">
                <h2>Übersicht</h2>
                <span className="fit-repair-pill">{analysis.summary.source_file_name}</span>
              </div>
              <div className="training-mini-grid">
                <div className="training-mini-card">
                  <span>Fahrten im Manifest</span>
                  <strong>{analysis.summary.rides_in_manifest}</strong>
                </div>
                <div className="training-mini-card">
                  <span>Doubletten</span>
                  <strong>{analysis.summary.duplicates}</strong>
                </div>
                <div className="training-mini-card">
                  <span>Neu</span>
                  <strong>{analysis.summary.new}</strong>
                </div>
                <div className="training-mini-card">
                  <span>Fehlend im ZIP</span>
                  <strong>{analysis.summary.missing_from_zip}</strong>
                </div>
              </div>
              <p className="training-note">
                Geprüft gegen aktuell {analysis.summary.db_fit_files} lokale Garmin-FIT-Dateien in der DB.
              </p>
              <p className="training-note">Erkanntes ZIP-Format: {detectedFormatLabel(analysis.summary.detected_format)}</p>
            </div>

            <div className="card">
              <div className="section-title-row">
                <h2>Fahrten</h2>
              </div>
              <div className="fit-mode-row" role="tablist" aria-label="Analyse Filter">
                <button className={`fit-mode-button ${filter === "all" ? "active" : ""}`} type="button" onClick={() => setFilter("all")}>
                  Alle
                </button>
                <button className={`fit-mode-button ${filter === "duplicates" ? "active" : ""}`} type="button" onClick={() => setFilter("duplicates")}>
                  Doubletten
                </button>
                <button className={`fit-mode-button ${filter === "new" ? "active" : ""}`} type="button" onClick={() => setFilter("new")}>
                  Neu
                </button>
              </div>

              <div className="import-files-bulk-bar">
                <label className="import-files-select-all">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={selectableVisibleRideCount === 0}
                    onChange={(event) => toggleVisibleSelection(event.target.checked)}
                  />
                  <span>Alle sichtbaren auswählen</span>
                </label>
                <div className="import-files-bulk-actions">
                  <button className="secondary-button" type="button" disabled={!analysis} onClick={deselectPossibleDuplicates}>
                    Mögliche Doubletten abwählen
                  </button>
                  <button className="primary-button" type="button" disabled={!selectedFile || selectedRideCount === 0 || importing} onClick={() => void handleImportSelected()}>
                    {importing ? "Importiere..." : `Importieren (${selectedRideCount})`}
                  </button>
                </div>
              </div>

              <div className="table-scroll import-files-table-wrap">
                <table className="rides-table">
                  <thead>
                    <tr>
                      <th>Auswahl</th>
                      <th>Status</th>
                      <th>Provider</th>
                      <th>Garmin-ID</th>
                      <th>Name des Rides</th>
                      <th>Datum / Uhrzeit</th>
                      <th>Länge</th>
                      <th>Ø Watt</th>
                      <th>Ø HF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRides.map((ride: RideAnalysis) => (
                      <tr key={`table-${ride.export_file_name}-${ride.external_activity_id ?? "none"}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(rideRowState[rideKey(ride)]?.selected)}
                            disabled={ride.status === "missing_from_zip"}
                            onChange={(event) =>
                              updateRideRowState(rideKey(ride), (current) => ({
                                ...current,
                                selected: event.target.checked,
                              }))
                            }
                          />
                        </td>
                        <td>{ride.status === "missing_from_zip" ? "Fehlt im ZIP" : ride.is_duplicate ? "Doublette" : "Neu"}</td>
                        <td>{formatProvider(ride.provider)}</td>
                        <td>{ride.external_activity_id || ride.suggested_external_activity_id || "-"}</td>
                        <td>
                          <div className="import-files-name-cell">
                            {rideRowState[rideKey(ride)]?.editing ? (
                              <input
                                className="settings-input import-files-name-input"
                                type="text"
                                value={rideRowState[rideKey(ride)]?.activityName || ""}
                                onChange={(event) =>
                                  updateRideRowState(rideKey(ride), (current) => ({
                                    ...current,
                                    activityName: event.target.value,
                                  }))
                                }
                                onBlur={() =>
                                  updateRideRowState(rideKey(ride), (current) => ({
                                    ...current,
                                    editing: false,
                                  }))
                                }
                              />
                            ) : (
                              <span>{(rideRowState[rideKey(ride)]?.activityName || "").trim() || suggestedOrPreviewActivityName(ride)}</span>
                            )}
                            <button
                              className="secondary-button import-files-edit-button"
                              type="button"
                              onClick={() =>
                                updateRideRowState(rideKey(ride), (current) => ({
                                  ...current,
                                  editing: !current.editing,
                                  activityName: current.activityName || suggestedOrPreviewActivityName(ride),
                                }))
                              }
                              aria-label={`Name für ${ride.export_file_name} bearbeiten`}
                            >
                              ✎
                            </button>
                          </div>
                        </td>
                        <td>{formatDateTime(ride.started_at)}</td>
                        <td>{formatDistanceMeters(ride.fit_summary?.total_distance_m)}</td>
                        <td>{formatPower(ride.fit_summary?.avg_power_w)}</td>
                        <td>{formatHeartRate(ride.fit_summary?.avg_hr_bpm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="import-files-list">
                {visibleRides.length === 0 ? <p>Für diesen Filter wurden keine Fahrten gefunden.</p> : null}
                {visibleRides.map((ride: RideAnalysis) => (
                  <article className={`import-ride-card ${ride.is_duplicate ? "duplicate" : "fresh"}`} key={`${ride.export_file_name}-${ride.external_activity_id ?? "none"}`}>
                    <div className="import-ride-head">
                      <div>
                        <strong>{(rideRowState[rideKey(ride)]?.activityName || "").trim() || suggestedOrPreviewActivityName(ride)}</strong>
                        <p>{ride.export_file_name}</p>
                      </div>
                      <span className={`import-ride-badge ${ride.is_duplicate ? "duplicate" : "fresh"}`}>
                        {ride.status === "missing_from_zip" ? "Fehlt im ZIP" : ride.is_duplicate ? "Doublette" : "Neu"}
                      </span>
                    </div>

                    <div className="import-ride-grid">
                      <div className="import-ride-field">
                        <span>Angezeigter Aktivitätsname:</span>
                        <strong>{(rideRowState[rideKey(ride)]?.activityName || "").trim() || suggestedOrPreviewActivityName(ride)}</strong>
                      </div>
                      <div className="import-ride-field">
                        <span>Namensvorschlag:</span>
                        <strong>{resolvedKnownActivityName(ride) ? "-" : ride.suggested_activity_name || "-"}</strong>
                      </div>
                      <div className="import-ride-field">
                        <span>Garmin-ID:</span>
                        <strong>{ride.external_activity_id || "-"}</strong>
                      </div>
                      <div className="import-ride-field">
                        <span>Vorschlag Garmin-ID:</span>
                        <strong>{ride.suggested_external_activity_id || "-"}</strong>
                      </div>
                      <div className="import-ride-field">
                        <span>Start:</span>
                        <strong>{formatDateTime(ride.started_at)}</strong>
                      </div>
                      <div className="import-ride-field">
                        <span>Distanz:</span>
                        <strong>{formatDistanceMeters(ride.fit_summary?.total_distance_m)}</strong>
                      </div>
                      <div className="import-ride-field">
                        <span>Dauer:</span>
                        <strong>{formatDurationSeconds(ride.fit_summary?.total_timer_time_s)}</strong>
                      </div>
                      <div className="import-ride-field">
                        <span>Sport:</span>
                        <strong>{ride.fit_summary?.sub_sport || ride.fit_summary?.sport || "-"}</strong>
                      </div>
                      <div className="import-ride-field">
                        <span>Records:</span>
                        <strong>{ride.fit_summary?.records_count ?? 0}</strong>
                      </div>
                    </div>

                    {ride.duplicate_assessment ? (
                      <div className="import-ride-assessment">
                        <div className={`import-ride-probability ${duplicateProbabilityTone(ride.duplicate_assessment.probability_pct)}`}>
                          <span>Doubletten-Wahrscheinlichkeit:</span>
                          <strong>{ride.duplicate_assessment.probability_pct}%</strong>
                          <em>{ride.duplicate_assessment.probability_label}</em>
                        </div>
                        <div className="import-ride-checks">
                          <div className="import-ride-check">
                            <span>1. Garmin-ID bereits vorhanden:</span>
                            <strong>{formatBooleanCheck(ride.duplicate_assessment.garmin_id_exists)}</strong>
                          </div>
                          <div className="import-ride-check">
                            <span>2. Aktivitaet zu Datum und Zeit vorhanden:</span>
                            <strong>{formatBooleanCheck(ride.duplicate_assessment.same_start_time_exists)}</strong>
                          </div>
                          <div className="import-ride-check">
                            <span>3. Bei gleichem Start aehnliche Werte:</span>
                            <strong>{formatBooleanCheck(ride.duplicate_assessment.similar_values_exists)}</strong>
                          </div>
                        </div>
                        {ride.duplicate_assessment.reasons.length > 0 ? (
                          <div className="import-ride-flags">
                            {ride.duplicate_assessment.reasons.map((reason: string) => (
                              <span className="import-ride-flag duplicate" key={reason}>
                                {reason}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {ride.duplicate_assessment?.garmin_id_matches.length ? (
                          <div className="import-ride-match-block">
                            <span className="import-ride-match-title">Pruefung 1: Vorhandene Garmin-ID</span>
                            {ride.duplicate_assessment.garmin_id_matches.map((match) => (
                              <p key={`assessment-id-${match.activity_id ?? match.external_activity_id ?? "candidate"}`}>
                                #{match.activity_id ?? "-"} · {match.activity_name || "-"} · Garmin-ID {match.external_activity_id || "-"} · {formatDateTime(match.started_at)}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {ride.duplicate_assessment?.same_start_time_matches.length ? (
                          <div className="import-ride-match-block">
                            <span className="import-ride-match-title">Pruefung 2: Gleiches Datum und gleiche Zeit</span>
                            {ride.duplicate_assessment.same_start_time_matches.map((match) => (
                              <p key={`assessment-start-${match.activity_id ?? match.external_activity_id ?? "candidate"}`}>
                                #{match.activity_id ?? "-"} · {match.activity_name || "-"} · Garmin-ID {match.external_activity_id || "-"} · {formatDateTime(match.started_at)} · {match.match_reasons.join(", ")}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {ride.duplicate_assessment?.similar_value_matches.length ? (
                          <div className="import-ride-match-block">
                            <span className="import-ride-match-title">Pruefung 3: Gleiche oder fast gleiche Werte</span>
                            {ride.duplicate_assessment.similar_value_matches.map((match) => (
                              <p key={`assessment-values-${match.activity_id ?? match.external_activity_id ?? "candidate"}`}>
                                #{match.activity_id ?? "-"} · {match.activity_name || "-"} · Garmin-ID {match.external_activity_id || "-"} · {formatDateTime(match.started_at)} · Score {match.match_score} · {match.match_reasons.join(", ")}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="import-ride-hashes">
                      <span>Payload-Hash: {shortHash(ride.content_sha256)}</span>
                      <span>FIT-Hash: {shortHash(ride.fit_sha256)}</span>
                    </div>

                    {ride.filename_numeric_candidates && ride.filename_numeric_candidates.length > 0 ? (
                      <div className="import-ride-hashes">
                        <span>Dateiname Zahlen: {ride.filename_numeric_candidates.join(", ")}</span>
                      </div>
                    ) : null}

                    {ride.suggestion_reasons && ride.suggestion_reasons.length > 0 ? (
                      <div className="import-ride-flags">
                        {ride.suggestion_reasons.map((reason: string) => (
                          <span className="import-ride-flag duplicate" key={reason}>
                            {reason}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {ride.suggested_activity_name_reason ? (
                      <div className="import-ride-flags">
                        <span className="import-ride-flag fresh">{ride.suggested_activity_name_reason}</span>
                      </div>
                    ) : null}

                    {ride.fit_summary?.parse_error ? <p className="error-text">FIT Parse Error: {ride.fit_summary.parse_error}</p> : null}

                    {ride.fit_summary?.metadata_messages && ride.fit_summary.metadata_messages.length > 0 ? (
                      <div className="import-ride-matches">
                        <div className="import-ride-match-block">
                          <span className="import-ride-match-title">FIT-Metadaten ohne Messdaten</span>
                          <div className="import-fit-metadata-list">
                            {ride.fit_summary.metadata_messages.map((message) => (
                              <details className="import-fit-metadata-item" key={`${ride.export_file_name}-${message.message_name}-${message.message_index}`}>
                                <summary>
                                  {message.message_name} #{message.message_index + 1}
                                </summary>
                                <div className="import-fit-metadata-fields">
                                  {Object.entries(message.fields).map(([fieldName, fieldValue]) => (
                                    <div className="import-fit-metadata-field" key={`${message.message_name}-${message.message_index}-${fieldName}`}>
                                      <span>{fieldName}:</span>
                                      <strong>{formatMetadataValue(fieldValue)}</strong>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="import-ride-flags">
                      {ride.duplicate_flags.length === 0 ? (
                        <span className="import-ride-flag fresh">Keine Doublette erkannt</span>
                      ) : (
                        ride.duplicate_flags.map((flag: string) => (
                          <span className="import-ride-flag duplicate" key={flag}>
                            {duplicateLabel(flag)}
                          </span>
                        ))
                      )}
                    </div>

                    {ride.is_duplicate ? (
                      <div className="import-ride-matches">
                        {ride.db_matches.external_activity_id.length > 0 ? (
                          <div className="import-ride-match-block">
                            <span className="import-ride-match-title">Treffer über Garmin-ID</span>
                            {ride.db_matches.external_activity_id.map((match: DbMatch) => (
                              <p key={`external-${match.fit_file_id}`}>
                                DB FIT #{match.fit_file_id} · {match.activity_name || match.file_name} · {formatDateTime(match.started_at)}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {ride.db_matches.content_sha256.length > 0 ? (
                          <div className="import-ride-match-block">
                            <span className="import-ride-match-title">Treffer über Payload-Hash</span>
                            {ride.db_matches.content_sha256.map((match: DbMatch) => (
                              <p key={`content-${match.fit_file_id}`}>
                                DB FIT #{match.fit_file_id} · {match.activity_name || match.file_name} · {formatDateTime(match.started_at)}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {ride.db_matches.file_sha256.length > 0 ? (
                          <div className="import-ride-match-block">
                            <span className="import-ride-match-title">Treffer über FIT-Hash</span>
                            {ride.db_matches.file_sha256.map((match: DbMatch) => (
                              <p key={`file-${match.fit_file_id}`}>
                                DB FIT #{match.fit_file_id} · {match.activity_name || match.file_name} · {formatDateTime(match.started_at)}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {ride.db_matches.heuristic_activity && ride.db_matches.heuristic_activity.length > 0 ? (
                          <div className="import-ride-match-block">
                            <span className="import-ride-match-title">Treffer über Heuristik</span>
                            {ride.db_matches.heuristic_activity.map((match) => (
                              <p key={`heuristic-${match.activity_id ?? match.external_activity_id ?? "candidate"}`}>
                                #{match.activity_id ?? "-"} · {match.activity_name || "-"} · Garmin-ID {match.external_activity_id || "-"} · {formatDateTime(match.started_at)} · Score {match.match_score}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {ride.is_duplicate && ride.duplicate_assessment?.garmin_id_matches.length ? (
                      <div className="import-ride-matches">
                        <div className="import-ride-match-block">
                          <span className="import-ride-match-title">Pruefung 1: Vorhandene Garmin-ID</span>
                          {ride.duplicate_assessment.garmin_id_matches.map((match) => (
                            <p key={`assessment-id-${match.activity_id ?? match.external_activity_id ?? "candidate"}`}>
                              #{match.activity_id ?? "-"} · {match.activity_name || "-"} · Garmin-ID {match.external_activity_id || "-"} · {formatDateTime(match.started_at)}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {ride.is_duplicate && ride.duplicate_assessment?.same_start_time_matches.length ? (
                      <div className="import-ride-matches">
                        <div className="import-ride-match-block">
                          <span className="import-ride-match-title">Pruefung 2: Gleiches Datum und gleiche Zeit</span>
                          {ride.duplicate_assessment.same_start_time_matches.map((match) => (
                            <p key={`assessment-start-${match.activity_id ?? match.external_activity_id ?? "candidate"}`}>
                              #{match.activity_id ?? "-"} · {match.activity_name || "-"} · Garmin-ID {match.external_activity_id || "-"} · {formatDateTime(match.started_at)} · {match.match_reasons.join(", ")}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {ride.is_duplicate && ride.duplicate_assessment?.similar_value_matches.length ? (
                      <div className="import-ride-matches">
                        <div className="import-ride-match-block">
                          <span className="import-ride-match-title">Pruefung 3: Gleiche oder fast gleiche Werte</span>
                          {ride.duplicate_assessment.similar_value_matches.map((match) => (
                            <p key={`assessment-values-${match.activity_id ?? match.external_activity_id ?? "candidate"}`}>
                              #{match.activity_id ?? "-"} · {match.activity_name || "-"} · Garmin-ID {match.external_activity_id || "-"} · {formatDateTime(match.started_at)} · Score {match.match_score} · {match.match_reasons.join(", ")}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {ride.heuristic_matches && ride.heuristic_matches.length > 0 ? (
                      <div className="import-ride-matches">
                        <div className="import-ride-match-block">
                          <span className="import-ride-match-title">Mögliche passende Garmin-Aktivitäten</span>
                          {ride.heuristic_matches.map((match) => (
                            <p key={`${ride.export_file_name}-${match.activity_id ?? match.external_activity_id ?? "candidate"}`}>
                              #{match.activity_id ?? "-"} · {match.activity_name || "-"} · Garmin-ID {match.external_activity_id || "-"} · {formatDateTime(match.started_at)} · Score {match.match_score} · {match.match_reasons.join(", ")}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
