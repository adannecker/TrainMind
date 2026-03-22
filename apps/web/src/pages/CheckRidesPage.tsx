import { useEffect, useMemo, useState } from "react";
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
  summary: {
    checked_recent_rides: number;
    already_loaded: number;
    missing: number;
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

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text) as T;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return "-";
  }
  return dt.toLocaleString("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatDistanceMeters(value: number | null): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${(value / 1000).toFixed(1)} km`;
}

function formatNumber(value: number | null, suffix: string): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${Math.round(value)} ${suffix}`;
}

export function CheckRidesPage() {
  const [data, setData] = useState<RidesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importCurrent, setImportCurrent] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importCurrentName, setImportCurrentName] = useState<string>("");
  const [celebration, setCelebration] = useState<InterestingUpdate | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleteDerivedMetrics, setDeleteDerivedMetrics] = useState(false);

  async function loadRides() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/garmin/new-rides?limit=80`);
      const payload = await parseJsonSafely<RidesResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Failed to load rides"
        );
      }
      if (!payload) {
        throw new Error("Failed to load rides: empty response from API");
      }
      setData(payload as RidesResponse);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function importSelected() {
    if (selectedIds.size === 0 || importing) {
      return;
    }
    setImporting(true);
    setImportMessage(null);
    setImportCurrent(0);
    setImportCurrentName("");

    try {
      const selectedList = (data?.rides ?? []).filter((ride) => selectedIds.has(ride.activity_id));
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

        const payload = (await parseJsonSafely<
          | {
              loaded: number;
              skipped: number;
              errors: Array<{ activity_id: string; reason: string }>;
              interesting_updates?: InterestingUpdate[];
            }
          | { detail?: string }
        >(response)) as
          | {
              loaded: number;
              skipped: number;
              errors: Array<{ activity_id: string; reason: string }>;
              interesting_updates?: InterestingUpdate[];
            }
          | { detail?: string }
          | null;

        if (!response.ok) {
          throw new Error(
            typeof payload === "object" && payload && "detail" in payload && payload.detail
              ? payload.detail
              : "Import failed"
          );
        }
        if (!payload || !("loaded" in payload)) {
          throw new Error("Import failed: empty response from API");
        }

        const okPayload = payload as {
          loaded: number;
          skipped: number;
          errors: Array<{ activity_id: string; reason: string }>;
        };
        loaded += okPayload.loaded;
        skipped += okPayload.skipped;
        errors += okPayload.errors.length;
        interestingUpdates.push(...(okPayload.interesting_updates ?? []));
        setImportCurrent(i + 1);
      }

      setImportMessage(`Import finished: loaded ${loaded}, skipped ${skipped}, errors ${errors}.`);
      await loadRides();
      if (interestingUpdates.length > 0) {
        const newestPeak = [...interestingUpdates]
          .filter((item) => item.kind === "new_max_hr_peak")
          .sort((a, b) => b.value - a.value)[0];
        if (newestPeak) {
          setCelebration(newestPeak);
        }
      }
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : "Import failed");
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
        throw new Error(payload.detail || "Reset fehlgeschlagen");
      }
      setImportMessage(
        `Reset fertig: ${payload.deleted_activities ?? 0} Aktivitäten, ${payload.deleted_fit_files ?? 0} FIT-Dateien und ${payload.deleted_derived_metrics ?? 0} abgeleitete MaxHF-Werte gelöscht.`
      );
      setShowResetConfirm(false);
      await loadRides();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : "Reset fehlgeschlagen");
    } finally {
      setResetting(false);
    }
  }

  useEffect(() => {
    void loadRides();
  }, []);

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
      if (checked) {
        next.add(activityId);
      } else {
        next.delete(activityId);
      }
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
        <p className="lead">
          Vergleich der neuesten Garmin-Rides mit bereits gespeicherten Aktivitäten.
        </p>
      </div>

      <div className="ride-summary">
        <div className="card">
          <h2>Übersicht</h2>
          {loading ? (
            <p>Lade Daten...</p>
          ) : error ? (
            <p className="error-text">{error}</p>
          ) : (
            <div className="stats-line">
              <span>Geprüft: {data?.summary.checked_recent_rides ?? 0}</span>
              <span>Bereits geladen: {data?.summary.already_loaded ?? 0}</span>
              <span>Fehlend: {data?.summary.missing ?? 0}</span>
              <button
                className="secondary-button"
                type="button"
                disabled={importing}
                onClick={() => void loadRides()}
              >
                Neu laden
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={importing || resetting}
                onClick={() => setShowResetConfirm(true)}
              >
                Alle importierten Fahrten löschen
              </button>
            </div>
          )}
          {importMessage ? <p className="info-text">{importMessage}</p> : null}
        </div>
      </div>

      <div className="card rides-table-wrap">
        <div className="table-toolbar">
          <h2>Fehlende Rides (neueste zuerst)</h2>
          <button
            className="primary-button"
            type="button"
            disabled={selectedIds.size === 0 || importing}
            onClick={() => void importSelected()}
          >
            {importing ? "Lade..." : `Ausgewählte laden (${selectedIds.size})`}
          </button>
        </div>

        <div className="table-scroll">
          <table className="rides-table">
            <thead>
              <tr>
                <th>
                  <label className="checkbox-header">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={importing}
                      onChange={(e) => toggleAll(e.target.checked)}
                      aria-label="Alle auswählen"
                    />
                    <span>Select all</span>
                  </label>
                </th>
                <th>Datum/Zeit Start</th>
                <th>Name</th>
                <th>Dauer</th>
                <th>Distanz</th>
                <th>Ø Watt</th>
                <th>Ø HF</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !error && (data?.rides.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={7}>Keine fehlenden Rides gefunden.</td>
                </tr>
              ) : null}
              {data?.rides.map((ride) => (
                <tr key={ride.activity_id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(ride.activity_id)}
                      disabled={importing}
                      onChange={(e) => toggleSingle(ride.activity_id, e.target.checked)}
                      aria-label={`Ride ${ride.name} auswählen`}
                    />
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

      {importing ? (
        <div className="import-overlay" role="status" aria-live="polite" aria-label="Import läuft">
          <div className="import-overlay-card">
            <div className="progress-ring-wrap">
              <svg width="110" height="110" className="progress-ring" aria-hidden="true">
                <circle className="progress-ring-bg" cx="55" cy="55" r={ringRadius} />
                <circle
                  className="progress-ring-value"
                  cx="55"
                  cy="55"
                  r={ringRadius}
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                />
              </svg>
              <div className="progress-ring-label">
                {importCurrent}/{importTotal}
              </div>
            </div>
            <p className="import-overlay-title">Rides werden importiert</p>
            <p className="import-overlay-subtitle">
              {importCurrentName ? `Aktuell: ${importCurrentName}` : "Bitte warten..."}
            </p>
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
            <p className="lead">
              Beim Import wurde ein neuer Spitzenwert gefunden und direkt in den Grunddaten gespeichert.
            </p>
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
            <h2>Garmin-Import zurücksetzen</h2>
            <p>Alle lokal importierten Garmin-Fahrten werden gelöscht und können danach erneut importiert werden.</p>
            <label className="settings-label">
              <span>Zusatzoption</span>
              <span className="settings-static-field">
                <input
                  type="checkbox"
                  checked={deleteDerivedMetrics}
                  onChange={(event) => setDeleteDerivedMetrics(event.target.checked)}
                />
                <span style={{ marginLeft: "0.5rem" }}>Automatisch erzeugte MaxHF-Werte ebenfalls löschen</span>
              </span>
            </label>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" disabled={resetting} onClick={() => setShowResetConfirm(false)}>
                Abbrechen
              </button>
              <button className="primary-button" type="button" disabled={resetting} onClick={() => void resetImported()}>
                {resetting ? "Lösche..." : "Jetzt löschen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
