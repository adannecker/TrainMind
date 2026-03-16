import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type SettingsTab = "personal" | "garmin" | "weight" | "llm";

type CredentialStatus = {
  provider: string;
  has_encrypted_credentials: boolean;
  has_env_credentials: boolean;
  active_source: "db" | "env" | "none";
};

type LlmStatus = {
  provider: string;
  configured: boolean;
  key_hint: string | null;
};

type UserProfile = {
  display_name: string;
  date_of_birth: string | null;
  gender: string | null;
  current_weight_kg: number | null;
  target_weight_kg: number | null;
  start_weight_kg: number | null;
  goal_start_date: string | null;
  goal_end_date: string | null;
  goal_period_days: number | null;
  updated_at: string | null;
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

const tabs: Array<{ id: SettingsTab; label: string; description: string }> = [
  { id: "personal", label: "Persönliche Daten", description: "Name und Zielrahmen pflegen" },
  { id: "garmin", label: "Garmin Zugang", description: "Zugangsdaten sicher hinterlegen" },
  { id: "weight", label: "Gewicht", description: "Verlauf und Messpunkte verwalten" },
  { id: "llm", label: "LLM Zugang", description: "OpenAI-Konfiguration prüfen" },
];

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

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("personal");

  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [llmLoading, setLlmLoading] = useState(true);
  const [llmError, setLlmError] = useState<string | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("unknown");
  const [currentWeight, setCurrentWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [startWeight, setStartWeight] = useState("");
  const [goalStartDate, setGoalStartDate] = useState("");
  const [goalEndDate, setGoalEndDate] = useState("");
  const [logWeight, setLogWeight] = useState("");
  const [logDate, setLogDate] = useState("");
  const [logNotes, setLogNotes] = useState("");

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/garmin/credentials-status`);
      const payload = await parseJsonSafely<CredentialStatus | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Failed to load credential status");
      }
      if (!payload) {
        throw new Error("Failed to load credential status: empty response");
      }
      setStatus(payload as CredentialStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function loadLlmStatus() {
    setLlmLoading(true);
    setLlmError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/llm/status`);
      const payload = await parseJsonSafely<LlmStatus | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "LLM-Status konnte nicht geladen werden.");
      }
      setLlmStatus(payload as LlmStatus);
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLlmLoading(false);
    }
  }

  async function loadProfile() {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const [profileRes, logsRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/profile`),
        apiFetch(`${API_BASE_URL}/profile/weight-logs?limit=30`),
      ]);
      const profileBody = await parseJsonSafely<UserProfile | { detail?: string }>(profileRes);
      const logsBody = await parseJsonSafely<{ weight_logs: WeightLog[] } | { detail?: string }>(logsRes);
      if (!profileRes.ok) {
        throw new Error(typeof profileBody === "object" && profileBody && "detail" in profileBody && profileBody.detail ? profileBody.detail : "Profil konnte nicht geladen werden.");
      }
      if (!logsRes.ok) {
        throw new Error(typeof logsBody === "object" && logsBody && "detail" in logsBody && logsBody.detail ? logsBody.detail : "Gewichtsverlauf konnte nicht geladen werden.");
      }
      const p = profileBody as UserProfile;
      setProfile(p);
      setDisplayName(p.display_name || "");
      setDateOfBirth(p.date_of_birth || "");
      setGender(p.gender || "unknown");
      setCurrentWeight(p.current_weight_kg == null ? "" : String(p.current_weight_kg));
      setTargetWeight(p.target_weight_kg == null ? "" : String(p.target_weight_kg));
      setStartWeight(p.start_weight_kg == null ? "" : String(p.start_weight_kg));
      setGoalStartDate(toLocalInputValue(p.goal_start_date));
      setGoalEndDate(toLocalInputValue(p.goal_end_date));
      setWeightLogs(((logsBody as { weight_logs: WeightLog[] }).weight_logs ?? []).slice());
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProfileLoading(false);
    }
  }

  async function saveCredentials(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim() || saving) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/garmin/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });
      const payload = await parseJsonSafely<{ status?: string; detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && payload.detail ? payload.detail : "Failed to save credentials");
      }
      setPassword("");
      setMessage("Garmin-Zugang verschlüsselt in der DB gespeichert.");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (profileSaving) return;
    setProfileSaving(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const toNumberOrNull = (v: string) => {
        const t = v.trim();
        if (!t) return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };
      const response = await apiFetch(`${API_BASE_URL}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          date_of_birth: dateOfBirth || null,
          gender: gender || null,
          current_weight_kg: toNumberOrNull(currentWeight),
          target_weight_kg: toNumberOrNull(targetWeight),
          start_weight_kg: toNumberOrNull(startWeight),
          goal_start_date: goalStartDate || null,
          goal_end_date: goalEndDate || null,
        }),
      });
      const payload = await parseJsonSafely<UserProfile | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Profil konnte nicht gespeichert werden.");
      }
      const next = payload as UserProfile;
      setProfile(next);
      setDisplayName(next.display_name || "");
      setDateOfBirth(next.date_of_birth || "");
      setGender(next.gender || "unknown");
      window.dispatchEvent(new CustomEvent("trainmind:user-label-updated", { detail: { displayName: next.display_name || "" } }));
      setProfileMessage("Persönliche Daten gespeichert.");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProfileSaving(false);
    }
  }

  async function addLog(e: FormEvent) {
    e.preventDefault();
    const w = Number(logWeight);
    if (!Number.isFinite(w) || w <= 0) {
      setProfileError("Bitte ein gültiges Gewicht eingeben.");
      return;
    }
    setProfileError(null);
    setProfileMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/profile/weight-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recorded_at: logDate || null,
          weight_kg: w,
          notes: logNotes.trim() || null,
          source_type: "manual",
        }),
      });
      const payload = await parseJsonSafely<WeightLog | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Gewichtseintrag konnte nicht gespeichert werden.");
      }
      setLogWeight("");
      setLogDate("");
      setLogNotes("");
      setProfileMessage("Gewichtseintrag gespeichert.");
      await loadProfile();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  useEffect(() => {
    void loadStatus();
    void loadProfile();
    void loadLlmStatus();
  }, []);

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Setup</p>
        <h1>Einstellungen</h1>
        <p className="lead">Persönliche Daten, Provider-Zugänge, Gewicht und LLM-Konfiguration an einer Stelle verwalten.</p>
      </div>

      <div className="settings-tabs-layout">
        <aside className="settings-tabs-nav card">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab-button ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <strong>{tab.label}</strong>
              <span>{tab.description}</span>
            </button>
          ))}
        </aside>

        <div className="settings-tab-panel">
          {activeTab === "personal" ? (
            <div className="card">
              <div className="section-title-row">
                <h2>Persönliche Daten</h2>
              </div>
              {profileLoading ? <p>Profil wird geladen...</p> : null}
              {profileError ? <p className="error-text">{profileError}</p> : null}
              {profileMessage ? <p className="info-text">{profileMessage}</p> : null}

              <form className="nutrition-form" onSubmit={(e) => void saveProfile(e)}>
                <label className="settings-label">
                  Benutzername
                  <input className="settings-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="z. B. Achim" />
                </label>
                <label className="settings-label">
                  Geburtsdatum
                  <input className="settings-input" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                </label>
                <label className="settings-label">
                  Geschlecht
                  <select className="settings-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="unknown">Keine Angabe</option>
                    <option value="male">Männlich</option>
                    <option value="female">Weiblich</option>
                    <option value="diverse">Divers</option>
                  </select>
                </label>
                <div className="settings-actions nutrition-span-2">
                  <button className="primary-button" type="submit" disabled={profileSaving}>
                    {profileSaving ? "Speichere..." : "Persönliche Daten speichern"}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => void loadProfile()} disabled={profileLoading || profileSaving}>
                    Aktualisieren
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {activeTab === "garmin" ? (
            <div className="card">
              <div className="section-title-row">
                <h2>Garmin Zugang</h2>
              </div>
              {loading ? <p>Status wird geladen...</p> : null}
              {!loading && status ? (
                <div className="settings-status-grid">
                  <div className="settings-status-chip">
                    <span>Aktive Quelle</span>
                    <strong>{status.active_source}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>DB verschlüsselt</span>
                    <strong>{status.has_encrypted_credentials ? "Ja" : "Nein"}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Env vorhanden</span>
                    <strong>{status.has_env_credentials ? "Ja" : "Nein"}</strong>
                  </div>
                </div>
              ) : null}
              {error ? <p className="error-text">{error}</p> : null}
              {message ? <p className="info-text">{message}</p> : null}

              <form className="settings-form settings-form-wide" onSubmit={(e) => void saveCredentials(e)}>
                <label className="settings-label">
                  Garmin E-Mail
                  <input className="settings-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
                </label>
                <label className="settings-label">
                  Garmin Passwort
                  <input className="settings-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                </label>
                <div className="settings-actions">
                  <button className="primary-button" type="submit" disabled={saving}>
                    {saving ? "Speichere..." : "Verschlüsselt speichern"}
                  </button>
                  <button className="secondary-button" type="button" disabled={loading || saving} onClick={() => void loadStatus()}>
                    Status aktualisieren
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {activeTab === "weight" ? (
            <div className="settings-weight-stack">
              <div className="card">
                <div className="section-title-row">
                  <h2>Gewicht und Ziele</h2>
                </div>
                {profileError ? <p className="error-text">{profileError}</p> : null}
                {profileMessage ? <p className="info-text">{profileMessage}</p> : null}
                <form className="nutrition-form" onSubmit={(e) => void saveProfile(e)}>
                  <label className="settings-label">
                    Aktuelles Gewicht (kg)
                    <input className="settings-input" type="number" step="0.1" value={currentWeight} onChange={(e) => setCurrentWeight(e.target.value)} />
                  </label>
                  <label className="settings-label">
                    Zielgewicht (kg)
                    <input className="settings-input" type="number" step="0.1" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} />
                  </label>
                  <label className="settings-label">
                    Startgewicht (kg)
                    <input className="settings-input" type="number" step="0.1" value={startWeight} onChange={(e) => setStartWeight(e.target.value)} />
                  </label>
                  <label className="settings-label">
                    Ziel-Start
                    <input className="settings-input" type="datetime-local" value={goalStartDate} onChange={(e) => setGoalStartDate(e.target.value)} />
                  </label>
                  <label className="settings-label">
                    Ziel-Ende
                    <input className="settings-input" type="datetime-local" value={goalEndDate} onChange={(e) => setGoalEndDate(e.target.value)} />
                  </label>
                  <div className="settings-label">
                    Zeitraum
                    <div className="settings-input settings-static-field">
                      {profile?.goal_period_days != null ? `${profile.goal_period_days} Tage` : "-"}
                    </div>
                  </div>
                  <div className="settings-actions nutrition-span-2">
                    <button className="primary-button" type="submit" disabled={profileSaving}>
                      {profileSaving ? "Speichere..." : "Gewicht und Ziele speichern"}
                    </button>
                    <button className="secondary-button" type="button" onClick={() => void loadProfile()} disabled={profileLoading || profileSaving}>
                      Aktualisieren
                    </button>
                  </div>
                </form>

                <form className="nutrition-form" onSubmit={(e) => void addLog(e)}>
                  <label className="settings-label">
                    Gewicht (kg)
                    <input className="settings-input" type="number" step="0.1" value={logWeight} onChange={(e) => setLogWeight(e.target.value)} required />
                  </label>
                  <label className="settings-label">
                    Zeitpunkt
                    <input className="settings-input" type="datetime-local" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
                  </label>
                  <label className="settings-label nutrition-span-2">
                    Notiz
                    <input className="settings-input" value={logNotes} onChange={(e) => setLogNotes(e.target.value)} placeholder="optional" />
                  </label>
                  <div className="settings-actions nutrition-span-2">
                    <button className="primary-button" type="submit">Gewicht eintragen</button>
                  </div>
                </form>
              </div>

              <div className="card">
                <div className="section-title-row">
                  <h2>Gewichtsverlauf</h2>
                </div>
                <div className="nutrition-list settings-weight-list">
                  {weightLogs.length === 0 ? <p>Noch keine Einträge.</p> : null}
                  {weightLogs.map((row) => (
                    <article className="nutrition-entry" key={row.id}>
                      <div className="nutrition-entry-head">
                        <strong>{row.weight_kg.toFixed(1)} kg</strong>
                        <span>{new Date(row.recorded_at).toLocaleString()}</span>
                      </div>
                      {row.notes ? <p className="nutrition-notes">{row.notes}</p> : null}
                    </article>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "llm" ? (
            <div className="card">
              <div className="section-title-row">
                <h2>LLM Zugang</h2>
              </div>
              {llmLoading ? <p>LLM-Status wird geladen...</p> : null}
              {llmError ? <p className="error-text">{llmError}</p> : null}
              {!llmLoading && llmStatus ? (
                <>
                  <div className="settings-status-grid">
                    <div className="settings-status-chip">
                      <span>Provider</span>
                      <strong>{llmStatus.provider}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Konfiguriert</span>
                      <strong>{llmStatus.configured ? "Ja" : "Nein"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Key-Hinweis</span>
                      <strong>{llmStatus.key_hint ?? "-"}</strong>
                    </div>
                  </div>
                  <p className="info-text">
                    Der OpenAI-Schlüssel wird serverseitig aus `.env` gelesen. Änderungen an `.env` werden nach einem API-Neustart sichtbar.
                  </p>
                  <div className="settings-actions">
                    <button className="secondary-button" type="button" onClick={() => void loadLlmStatus()}>
                      Status aktualisieren
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
