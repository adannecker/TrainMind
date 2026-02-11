import { useEffect, useMemo, useState } from "react";

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

const API_BASE_URL = "http://127.0.0.1:8000";

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

  async function loadRides() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/garmin/new-rides?limit=80`);
      const payload = (await response.json()) as RidesResponse | { detail?: string };
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Failed to load rides"
        );
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

      for (let i = 0; i < selectedList.length; i += 1) {
        const ride = selectedList[i];
        setImportCurrentName(ride.name);

        const response = await fetch(`${API_BASE_URL}/garmin/import-rides`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activity_ids: [ride.activity_id] }),
        });

        const payload = (await response.json()) as
          | { loaded: number; skipped: number; errors: Array<{ activity_id: string; reason: string }> }
          | { detail?: string };

        if (!response.ok) {
          throw new Error(
            typeof payload === "object" && payload && "detail" in payload && payload.detail
              ? payload.detail
              : "Import failed"
          );
        }

        const okPayload = payload as {
          loaded: number;
          skipped: number;
          errors: Array<{ activity_id: string; reason: string }>;
        };
        loaded += okPayload.loaded;
        skipped += okPayload.skipped;
        errors += okPayload.errors.length;
        setImportCurrent(i + 1);
      }

      setImportMessage(`Import finished: loaded ${loaded}, skipped ${skipped}, errors ${errors}.`);
      await loadRides();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      setImportCurrentName("");
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
    </section>
  );
}
