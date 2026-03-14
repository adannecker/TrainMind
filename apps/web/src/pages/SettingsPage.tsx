import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type CredentialStatus = {
  provider: string;
  has_encrypted_credentials: boolean;
  has_env_credentials: boolean;
  active_source: "db" | "env" | "none";
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text) as T;
}

export function SettingsPage() {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/garmin/credentials-status`);
      const payload = await parseJsonSafely<CredentialStatus | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Failed to load credential status"
        );
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

  async function saveCredentials(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim() || saving) {
      return;
    }
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
        throw new Error(
          typeof payload === "object" && payload && payload.detail
            ? payload.detail
            : "Failed to save credentials"
        );
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

  useEffect(() => {
    void loadStatus();
  }, []);

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Setup</p>
        <h1>Einstellungen</h1>
        <p className="lead">Provider-Zugänge einmalig hinterlegen. Speicherung erfolgt verschlüsselt in der DB.</p>
      </div>

      <div className="card">
        <h2>Garmin Zugang</h2>
        {loading ? <p>Status wird geladen...</p> : null}
        {!loading && status ? (
          <p className="info-text">
            Quelle aktiv: <strong>{status.active_source}</strong> | Verschlüsselt gespeichert:{" "}
            <strong>{status.has_encrypted_credentials ? "Ja" : "Nein"}</strong>
          </p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p className="info-text">{message}</p> : null}

        <form className="settings-form" onSubmit={(e) => void saveCredentials(e)}>
          <label className="settings-label">
            E-Mail
            <input
              className="settings-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="settings-label">
            Passwort
            <input
              className="settings-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
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
    </section>
  );
}
