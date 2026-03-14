import { FormEvent, useState } from "react";
import { API_BASE_URL } from "../config";
import { setAuthToken } from "../auth";

type LoginResponse = {
  token: string;
  user_id: number;
  email: string;
  expires_at: string;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text) as T;
}

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim() || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });
      const payload = await parseJsonSafely<LoginResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Login failed"
        );
      }
      if (!payload || !("token" in payload)) {
        throw new Error("Login failed: empty response");
      }
      setAuthToken(payload.token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page login-page">
      <div className="card login-card">
        <p className="eyebrow">TrainMind Hub</p>
        <h1>Login</h1>
        <p className="lead">Bitte mit deinem lokalen TrainMind-Account anmelden.</p>
        {error ? <p className="error-text">{error}</p> : null}
        <form className="settings-form" onSubmit={(e) => void handleSubmit(e)}>
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
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Anmelden..." : "Anmelden"}
          </button>
        </form>
      </div>
    </section>
  );
}

