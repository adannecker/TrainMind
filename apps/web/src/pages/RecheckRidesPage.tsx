import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

import { apiFetch } from "../api";
import { getAuthToken } from "../auth";
import { API_BASE_URL } from "../config";

type MaxHrRecheckResult = {
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

type AchievementActivityCheck = {
  activity_id: number;
  activity_name: string;
  started_at: string | null;
  started_at_label: string | null;
  checked_scopes: string[];
  matched_count: number;
};

type AchievementRecheckStatus = {
  current_check_version: number;
  total_activities: number;
  checked_activities: number;
  open_activities: number;
  recent_checked: Array<{
    activity_id: number;
    activity_name: string;
    started_at: string | null;
    started_at_label: string | null;
    checked_at: string | null;
  }>;
};

type AchievementRecheckResult = {
  status: string;
  current_check_version: number;
  total_activities: number;
  checked_activities_before: number;
  open_activities_before: number;
  checked_now_activities: number;
  activities_with_matches: number;
  activities: AchievementActivityCheck[];
};

type HistoricalRecheckResponse = {
  status: string;
  max_hr?: MaxHrRecheckResult;
  achievements?: AchievementRecheckResult;
};

type HistoricalRecheckStatusResponse = {
  status: string;
  achievements?: AchievementRecheckStatus;
};

type HistoricalRecheckJobStatus = {
  job_id?: string | null;
  status: string;
  phase?: string | null;
  phase_label?: string | null;
  rebuild_max_hr?: boolean;
  rebuild_achievements?: boolean;
  pass_index?: number;
  pass_count?: number;
  pass_label?: string | null;
  pass_current?: number;
  pass_total?: number;
  phase_current?: number;
  phase_total?: number;
  progress_percent?: number;
  message?: string | null;
  error?: string | null;
  result?: HistoricalRecheckResponse | null;
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

function progressCardStyle(percent: number): CSSProperties {
  const safe = Math.max(0, Math.min(100, percent));
  return {
    background: `linear-gradient(90deg, rgba(31, 139, 111, 0.18) 0%, rgba(31, 139, 111, 0.18) ${safe}%, #f7fbf9 ${safe}%, #f7fbf9 100%)`,
  };
}

export function RecheckRidesPage() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AchievementRecheckStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [maxHrResult, setMaxHrResult] = useState<MaxHrRecheckResult | null>(null);
  const [achievementResult, setAchievementResult] = useState<AchievementRecheckResult | null>(null);
  const [jobStatus, setJobStatus] = useState<HistoricalRecheckJobStatus | null>(null);

  const openActivities = status?.open_activities ?? 0;
  const totalActivities = status?.total_activities ?? 0;
  const progressCurrent = jobStatus?.pass_current ?? jobStatus?.phase_current ?? 0;
  const progressTotal = jobStatus?.pass_total ?? jobStatus?.phase_total ?? 0;
  const progressPercent = jobStatus?.progress_percent ?? 0;
  const passIndex = jobStatus?.pass_index ?? 0;
  const passCount = jobStatus?.pass_count ?? 0;
  const currentLabel = jobStatus?.pass_label || jobStatus?.phase_label || "Vorbereitung";
  const phaseProgressPercent = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;
  const progressUnitLabel = currentLabel === "Auslesen" ? "Ladeschritte" : "Gecheckte Aktivitäten";

  async function loadStatus() {
    setStatusLoading(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/recheck-history/status`);
      const payload = await parseJsonSafely<HistoricalRecheckStatusResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Recheck-Status konnte nicht geladen werden.");
      }
      setStatus((payload as HistoricalRecheckStatusResponse).achievements ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Recheck-Status konnte nicht geladen werden.");
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadJobStatus() {
    const response = await apiFetch(`${API_BASE_URL}/activities/recheck-history/job-status`);
    const payload = await parseJsonSafely<HistoricalRecheckJobStatus | { detail?: string }>(response);
    if (!response.ok || !payload || !("status" in payload)) {
      throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Recheck-Jobstatus konnte nicht geladen werden.");
    }
    const job = payload as HistoricalRecheckJobStatus;
    applyJobStatus(job);
  }

  function applyJobStatus(job: HistoricalRecheckJobStatus) {
    setJobStatus(job);
    if (job.status === "running") {
      setRunning(true);
      return;
    }
    if (job.status === "completed") {
      setRunning(false);
      setMaxHrResult(job.result?.max_hr ?? null);
      setAchievementResult(job.result?.achievements ?? null);
      setMessage(job.message ?? "Historischer Recheck erfolgreich abgeschlossen.");
      return;
    }
    if (job.status === "error") {
      setRunning(false);
      setError(job.error || "Historischer Recheck fehlgeschlagen.");
    }
  }

  useEffect(() => {
    void loadJobStatus();
  }, []);

  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();

    async function streamJobStatus() {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/activities/recheck-history/job-stream`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error("Recheck-Livestream konnte nicht gestartet werden.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) {
            applyJobStatus(JSON.parse(line) as HistoricalRecheckJobStatus);
          }
          newlineIndex = buffer.indexOf("\n");
        }
      }
    }

    void streamJobStatus().catch(() => {
      void loadJobStatus();
    });
    return () => controller.abort();
  }, [running]);

  const recentChecked = useMemo(() => status?.recent_checked ?? [], [status]);

  async function runHistoricalRecheck() {
    setRunning(true);
    setMessage(null);
    setError(null);
    setJobStatus(null);
    setMaxHrResult(null);
    setAchievementResult(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/recheck-history/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rebuild_max_hr: true, rebuild_achievements: true }),
      });
      const payload = await parseJsonSafely<HistoricalRecheckJobStatus | { detail?: string }>(response);
      if (!response.ok || !payload || !("status" in payload)) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Historischer Recheck fehlgeschlagen.",
        );
      }
      setJobStatus(payload as HistoricalRecheckJobStatus);
      setMessage("Recheck wurde gestartet.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Historischer Recheck fehlgeschlagen.");
      setMaxHrResult(null);
      setAchievementResult(null);
      setRunning(false);
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Helper</p>
        <h1>Recheck Achievements</h1>
        <p className="lead">
          Hier prüfen wir bestehende Fahrten erneut, bauen MaxHF sauber historisch auf und markieren Achievement-Checks für neue Fahrten oder neue Check-Versionen.
        </p>
      </div>

      <div className="card">
        <div className="training-history-head">
          <div>
            <h2>Historische Prüfungen</h2>
            <p className="lead">
              Der Recheck berücksichtigt offene Fahrten, neue Achievement-Versionen und schreibt pro Ride, welche Bereiche geprüft wurden und welche Treffer es gab.
            </p>
          </div>
          <div className="training-history-actions">
            <button className="primary-button" type="button" disabled={running || statusLoading} onClick={() => void runHistoricalRecheck()}>
              {running ? "Prüfe..." : "Alle Checks neu laufen lassen"}
            </button>
          </div>
        </div>

        <div className="training-mini-grid">
          <div className="training-mini-card">
            <span>Gesamte Fahrten</span>
            <strong>{statusLoading ? "-" : totalActivities}</strong>
          </div>
          <div className="training-mini-card">
            <span>Bereits geprüft</span>
            <strong>{statusLoading ? "-" : status?.checked_activities ?? 0}</strong>
          </div>
          <div className="training-mini-card">
            <span>Noch offen</span>
            <strong>{statusLoading ? "-" : openActivities}</strong>
          </div>
          <div className="training-mini-card">
            <span>Achievement-Version</span>
            <strong>{statusLoading ? "-" : status?.current_check_version ?? "-"}</strong>
          </div>
        </div>

        <div className="training-info-stack">
          <div className="training-info-point">Prüft MaxHF historisch und Achievement-Treffer in einem Lauf.</div>
          <div className="training-info-point">Neue Fahrten bleiben offen, bis der Achievement-Check wirklich gelaufen ist.</div>
          <div className="training-info-point">Wenn sich die Achievement-Logik ändert, werden ältere Fahrten über die Check-Version wieder als offen erkannt.</div>
        </div>

        {message ? <p className="info-text">{message}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        {recentChecked.length ? (
          <div className="training-history-block">
            <div className="training-history-head">
              <div>
                <h3>Zuletzt geprüfte Fahrten</h3>
              </div>
            </div>
            <div className="training-history-list">
              {recentChecked.map((entry) => (
                <div key={entry.activity_id} className="training-history-item">
                  <div className="training-history-top">
                    <div className="training-history-main">
                      <strong>{entry.activity_name}</strong>
                      <span>{entry.started_at_label ?? "-"}</span>
                    </div>
                    <span className="training-history-badge">{formatDateTime(entry.checked_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {achievementResult ? (
          <div className="training-history-block">
            <div className="training-history-head">
              <div>
                <h3>Achievement Recheck Ergebnis</h3>
              </div>
            </div>
            <div className="training-mini-grid">
              <div className="training-mini-card">
                <span>Vorher geprüft</span>
                <strong>{achievementResult.checked_activities_before}</strong>
              </div>
              <div className="training-mini-card">
                <span>Vorher offen</span>
                <strong>{achievementResult.open_activities_before}</strong>
              </div>
              <div className="training-mini-card">
                <span>Jetzt verarbeitet</span>
                <strong>{achievementResult.checked_now_activities}</strong>
              </div>
              <div className="training-mini-card">
                <span>Mit Treffern</span>
                <strong>{achievementResult.activities_with_matches}</strong>
              </div>
            </div>
            <div className="training-history-list">
              {achievementResult.activities.map((entry) => (
                <div key={entry.activity_id} className="training-history-item">
                  <div className="training-history-top">
                    <div className="training-history-main">
                      <strong>{entry.activity_name}</strong>
                      <span>{entry.started_at_label ?? "-"}</span>
                    </div>
                    <Link className="training-history-badge" to={`/activities/${entry.activity_id}`}>
                      {entry.matched_count} Treffer
                    </Link>
                  </div>
                  {entry.matched_count === 0 ? (
                    <p className="training-note">Für diese Fahrt wurden diesmal keine direkten Achievement-Treffer gefunden.</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {maxHrResult ? (
          <div className="training-history-block">
            <div className="training-history-head">
              <div>
                <h3>MaxHF Recheck Ergebnis</h3>
              </div>
            </div>
            <div className="training-mini-grid">
              <div className="training-mini-card">
                <span>Geprüfte Fahrten</span>
                <strong>{maxHrResult.checked_activities}</strong>
              </div>
              <div className="training-mini-card">
                <span>Fahrten mit HF</span>
                <strong>{maxHrResult.activities_with_hr}</strong>
              </div>
              <div className="training-mini-card">
                <span>Alte Auto-MaxHF gelöscht</span>
                <strong>{maxHrResult.deleted_auto_max_hr_metrics}</strong>
              </div>
              <div className="training-mini-card">
                <span>Neue Peak-Stufen</span>
                <strong>{maxHrResult.created_max_hr_metrics}</strong>
              </div>
            </div>
            <div className="training-history-list">
              {maxHrResult.max_hr_history.map((entry) => (
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

      {running ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Recheck läuft">
          <div className="confirm-card">
            <div className="waiting-spinner" aria-hidden="true" />
            <h2>Recheck läuft</h2>
            <p>
              Achievement- und MaxHF-Checks werden gerade für deine Fahrten aktualisiert.
            </p>
            <div className="training-mini-grid">
              <div className="training-mini-card">
                <span>Durchgang</span>
                <strong>{passIndex || "-"} / {passCount || "-"}</strong>
              </div>
              <div className="training-mini-card">
                <span>Aktuell</span>
                <strong>{currentLabel}</strong>
              </div>
              <div className="training-mini-card" style={progressCardStyle(phaseProgressPercent)}>
                <span>{progressUnitLabel}</span>
                <strong>{progressCurrent} / {progressTotal || "-"}</strong>
              </div>
              <div className="training-mini-card" style={progressCardStyle(progressPercent)}>
                <span>Fortschritt</span>
                <strong>{progressPercent}%</strong>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
