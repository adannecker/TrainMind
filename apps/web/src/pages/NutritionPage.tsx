import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type EntryItem = {
  id: string;
  custom_name: string | null;
  amount_g: number;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
};

type Entry = {
  id: string;
  consumed_at: string;
  meal_type: string | null;
  notes: string | null;
  items: EntryItem[];
};

type ListResponse = {
  entries: Entry[];
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text) as T;
}

function formatDateTime(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return value;
  }
  return dt.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}

function sumOf(items: EntryItem[], key: "kcal" | "protein_g" | "carbs_g" | "fat_g"): number {
  return items.reduce((acc, i) => acc + Number(i[key] ?? 0), 0);
}

function toDateTimeLocalNow(): string {
  const dt = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function NutritionPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);

  const [consumedAt, setConsumedAt] = useState(toDateTimeLocalNow());
  const [mealType, setMealType] = useState("snack");
  const [itemName, setItemName] = useState("");
  const [amountG, setAmountG] = useState("300");
  const [kcal, setKcal] = useState("");
  const [notes, setNotes] = useState("");

  async function loadEntries() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/nutrition/entries`);
      const payload = await parseJsonSafely<ListResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Failed to load nutrition entries",
        );
      }
      setEntries((payload as ListResponse).entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function createEntry(e: FormEvent) {
    e.preventDefault();
    if (saving) {
      return;
    }
    if (!itemName.trim() || Number(amountG) <= 0) {
      setError("Bitte Name und eine Menge > 0g angeben.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        consumed_at: new Date(consumedAt).toISOString(),
        meal_type: mealType || null,
        notes: notes.trim() || null,
        source: "manual",
        items: [
          {
            custom_name: itemName.trim(),
            amount_g: Number(amountG),
            kcal: kcal ? Number(kcal) : null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
          },
        ],
      };

      const response = await apiFetch(`${API_BASE_URL}/nutrition/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await parseJsonSafely<Entry | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof body === "object" && body && "detail" in body && body.detail ? body.detail : "Create failed",
        );
      }

      setMessage("Eintrag gespeichert.");
      setItemName("");
      setNotes("");
      setKcal("");
      setAmountG("300");
      setConsumedAt(toDateTimeLocalNow());
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entryId: string) {
    const ok = window.confirm("Eintrag wirklich löschen?");
    if (!ok) {
      return;
    }
    try {
      const response = await apiFetch(`${API_BASE_URL}/nutrition/entries/${entryId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await parseJsonSafely<{ detail?: string }>(response);
        throw new Error(payload?.detail || "Delete failed");
      }
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  useEffect(() => {
    void loadEntries();
  }, []);

  return (
    <section className="page mobile-mirror-page">
      <div className="hero mobile-mirror-hero">
        <p className="eyebrow">Nutrition</p>
        <h1>Ernährung erfassen</h1>
        <p className="lead">Web-Ansicht im App-Stil für schnelles Iterieren.</p>
      </div>

      <div className="mobile-mirror-stack">
        <div className="card nutrition-form-card mobile-mirror-card">
          <h2>Neuer Eintrag</h2>
          <form className="nutrition-form mobile-mirror-form" onSubmit={(e) => void createEntry(e)}>
            <label className="settings-label nutrition-span-2">
              Was?
              <input className="settings-input" value={itemName} onChange={(e) => setItemName(e.target.value)} required />
            </label>
            <label className="settings-label">
              Menge (g)
              <input className="settings-input" type="number" min="1" value={amountG} onChange={(e) => setAmountG(e.target.value)} required />
            </label>
            <label className="settings-label">
              kcal
              <input className="settings-input" type="number" min="0" value={kcal} onChange={(e) => setKcal(e.target.value)} />
            </label>
            <label className="settings-label nutrition-span-2">
              Zeitpunkt
              <input
                className="settings-input"
                type="datetime-local"
                value={consumedAt}
                onChange={(e) => setConsumedAt(e.target.value)}
                required
              />
            </label>
            <label className="settings-label nutrition-span-2">
              Mahlzeit
              <select className="settings-input" value={mealType} onChange={(e) => setMealType(e.target.value)}>
                <option value="breakfast">Frühstück</option>
                <option value="lunch">Mittagessen</option>
                <option value="dinner">Abendessen</option>
                <option value="snack">Snack</option>
              </select>
            </label>
            <label className="settings-label nutrition-span-2">
              Notizen
              <input className="settings-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="settings-actions nutrition-span-2 mobile-mirror-actions">
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "Speichere..." : "Speichern"}
              </button>
            </div>
          </form>
          {error ? <p className="error-text">{error}</p> : null}
          {message ? <p className="info-text">{message}</p> : null}
        </div>

        <div className="card nutrition-list-card mobile-mirror-card">
          <div className="mobile-mirror-list-head">
            <h2>Letzte Einträge</h2>
            <button className="secondary-button" type="button" onClick={() => void loadEntries()} disabled={loading || saving}>
              Aktualisieren
            </button>
          </div>
          {loading ? <p>Lade Einträge...</p> : null}
          {!loading && entries.length === 0 ? <p>Noch keine Einträge.</p> : null}
          {!loading ? (
            <div className="nutrition-list">
              {entries.map((entry) => (
                <article className="nutrition-entry mobile-mirror-entry" key={entry.id}>
                  <div className="nutrition-entry-head">
                    <strong>{formatDateTime(entry.consumed_at)}</strong>
                    <button
                      className="icon-button danger"
                      type="button"
                      title="Eintrag löschen"
                      aria-label="Eintrag löschen"
                      onClick={() => void deleteEntry(entry.id)}
                    >
                      🗑
                    </button>
                  </div>
                  <div className="nutrition-entry-items">
                    {entry.items.map((item) => (
                      <div key={item.id} className="nutrition-item">
                        <strong>{item.custom_name || "Item"}</strong>
                        <span>
                          {Math.round(item.amount_g)}g · {Math.round(item.kcal ?? 0)} kcal
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="nutrition-entry-summary">
                    <span>Kcal: {Math.round(sumOf(entry.items, "kcal"))}</span>
                    <span>P: {Math.round(sumOf(entry.items, "protein_g"))} g</span>
                    <span>C: {Math.round(sumOf(entry.items, "carbs_g"))} g</span>
                    <span>F: {Math.round(sumOf(entry.items, "fat_g"))} g</span>
                  </div>
                  {entry.notes ? <p className="nutrition-notes">Notiz: {entry.notes}</p> : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
