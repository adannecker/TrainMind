import { FormEvent, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_BASE_URL } from "../config";

const MIN_PASSWORD_LENGTH = 14;

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

export function SetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passwordChecks = useMemo(
    () => [
      { label: `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen`, passed: password.length >= MIN_PASSWORD_LENGTH },
      { label: "Mindestens 1 Kleinbuchstabe", passed: /[a-z]/.test(password) },
      { label: "Mindestens 1 Großbuchstabe", passed: /[A-Z]/.test(password) },
      { label: "Mindestens 1 Zahl", passed: /\d/.test(password) },
      { label: "Mindestens 1 Sonderzeichen", passed: /[^A-Za-z0-9]/.test(password) },
      { label: "Keine Leerzeichen am Anfang oder Ende", passed: password.length > 0 && password.trim() === password },
    ],
    [password]
  );
  const passwordIsStrong = passwordChecks.every((check) => check.passed);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("Einladungslink fehlt oder ist unvollständig.");
      return;
    }
    if (!password.trim()) {
      setError("Bitte ein Passwort eingeben.");
      return;
    }
    if (!passwordIsStrong) {
      setError("Das Passwort erfüllt die Sicherheitsanforderungen noch nicht.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = await parseJsonSafely<{ status?: string; detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && payload.detail ? payload.detail : "Passwort konnte nicht gesetzt werden.");
      }
      setMessage("Passwort gesetzt. Du wirst jetzt zur Anmeldung weitergeleitet.");
      setPassword("");
      setConfirmPassword("");
      window.setTimeout(() => {
        navigate("/", { replace: true });
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page login-page">
      <div className="card login-card">
        <p className="eyebrow">TrainMind</p>
        <h1>Passwort setzen</h1>
        <p className="lead">Nutze deinen Einladungslink, um ein Passwort für deinen Account festzulegen.</p>
        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p className="info-text">{message}</p> : null}
        <form className="settings-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="settings-label">
            Neues Passwort
            <input className="settings-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <div className="settings-invite-box">
            <strong>Passwort-Anforderungen</strong>
            <div className="settings-password-rules">
              {passwordChecks.map((check) => (
                <p key={check.label} className="password-rule-text">
                  <span className={`password-rule-icon ${check.passed ? "password-rule-icon-success" : "password-rule-icon-fail"}`} aria-hidden="true">
                    {check.passed ? "✓" : "X"}
                  </span>
                  <span>{check.label}</span>
                </p>
              ))}
            </div>
          </div>
          <label className="settings-label">
            Passwort wiederholen
            <input className="settings-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          </label>
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Speichere..." : "Passwort setzen"}
          </button>
        </form>
      </div>
    </section>
  );
}
