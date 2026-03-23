import { useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type HistoricalRecheckResponse = {
  status: string;
  max_hr?: {
    status: string;
    checked_activities: number;
    activities_with_hr: number;
    deleted_auto_max_hr_metrics: number;
    created_max_hr_metrics: number;
    max_hr_history: Array<{
      id: number;
      value: number;
      recorded_at: string;
      activity_id: number;
      activity_name: string;
    }>;
  };
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function formatDateTime(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}

export function RecheckRidesPage() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<HistoricalRecheckResponse["max_hr"] | null>(null);

  async function runHistoricalRecheck() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/recheck-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rebuild_max_hr: true }),
      });
      const payload = await parseJsonSafely<HistoricalRecheckResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Historischer Recheck fehlgeschlagen.",
        );
      }
      const body = payload as HistoricalRecheckResponse;
      setResult(body.max_hr ?? null);
      setMessage("Historischer MaxHF-Recheck wurde erfolgreich durchgeführt.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Historischer Recheck fehlgeschlagen.");
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Setup</p>
        <h1>Recheck all Rides</h1>
        <p className="lead">
          Hier können wir bestehende Fahrten historisch erneut prüfen und daraus abgeleitete Werte sauber neu aufbauen.
        </p>
      </div>

      <div className="card">
        <div className="training-history-head">
          <div>
            <h2>Historische Prüfungen</h2>
            <p className="lead">
              Aktuell verfügbar: MaxHF aus allen vorhandenen Fahrten chronologisch neu aufbauen.
            </p>
          </div>
          <div className="training-history-actions">
            <button className="primary-button" type="button" disabled={running} onClick={() => void runHistoricalRecheck()}>
              {running ? "Prüfe..." : "MaxHF historisch neu aufbauen"}
            </button>
          </div>
        </div>

        <div className="training-info-stack">
          <div className="training-info-point">
            Startet beim ältesten Ride und übernimmt dort den ersten belastbaren MaxHF-Wert.
          </div>
          <div className="training-info-point">
            Danach wird nur noch gespeichert, wenn später ein echter neuer Höchstwert gefunden wird.
          </div>
          <div className="training-info-point">
            Niedrigere Werte aus neueren Fahrten überschreiben dadurch keinen früheren höheren Peak mehr.
          </div>
        </div>

        {message ? <p className="info-text">{message}</p> : null}

        {result ? (
          <div className="training-history-block">
            <div className="training-history-head">
              <div>
                <h3>MaxHF Recheck Ergebnis</h3>
              </div>
            </div>
            <div className="training-mini-grid">
              <div className="training-mini-card">
                <span>Geprüfte Fahrten</span>
                <strong>{result.checked_activities}</strong>
              </div>
              <div className="training-mini-card">
                <span>Fahrten mit HF</span>
                <strong>{result.activities_with_hr}</strong>
              </div>
              <div className="training-mini-card">
                <span>Alte Auto-MaxHF gelöscht</span>
                <strong>{result.deleted_auto_max_hr_metrics}</strong>
              </div>
              <div className="training-mini-card">
                <span>Neue Peak-Stufen erstellt</span>
                <strong>{result.created_max_hr_metrics}</strong>
              </div>
            </div>

            <div className="training-history-list">
              {result.max_hr_history.map((entry) => (
                <div key={entry.id} className="training-history-item">
                  <div className="training-history-top">
                    <div className="training-history-main">
                      <strong>{entry.activity_name}</strong>
                      <span>{formatDateTime(entry.recorded_at)}</span>
                    </div>
                    <span className="training-history-badge">{Math.round(entry.value)} bpm</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
