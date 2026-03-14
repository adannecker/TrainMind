import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type FoodItem = {
  id: string;
  name: string;
  item_kind: "base_ingredient" | "product";
  brand?: string | null;
};

type RecipeItem = {
  id: string;
  food_item_id: string;
  food_name: string;
  food_kind: "base_ingredient" | "product";
  amount_g: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type Recipe = {
  id: string;
  name: string;
  notes: string | null;
  visibility: "private" | "public";
  total_weight_g: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  kcal_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  items: RecipeItem[];
};

function toDateTimeLocalNow(): string {
  const dt = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function round(value: number | null | undefined): number {
  return Math.round(Number(value || 0));
}

export function RecipesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");

  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<FoodItem[]>([]);
  const [draftItems, setDraftItems] = useState<Array<{ food_item_id: string; label: string; amount_g: string }>>([]);

  const [consumeAt, setConsumeAt] = useState(toDateTimeLocalNow());
  const [consumeMealType, setConsumeMealType] = useState("snack");
  const [consumeAmountByRecipe, setConsumeAmountByRecipe] = useState<Record<string, string>>({});

  async function loadRecipes() {
    setLoading(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/nutrition/recipes`);
      const payload = (await response.json()) as { recipes?: Recipe[]; detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail || "Rezepte konnten nicht geladen werden.");
      }
      setRecipes(payload.recipes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function searchItems(query: string) {
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items?q=${encodeURIComponent(q)}&limit=8`);
    const payload = (await response.json()) as { items?: FoodItem[]; detail?: string };
    if (!response.ok) {
      throw new Error(payload.detail || "Suche fehlgeschlagen");
    }
    setSuggestions(payload.items || []);
  }

  function addDraftItem(item: FoodItem) {
    setDraftItems((prev) => [...prev, { food_item_id: item.id, label: item.name, amount_g: "100" }]);
    setSearch("");
    setSuggestions([]);
  }

  function updateDraftItem(index: number, amount_g: string) {
    setDraftItems((prev) => prev.map((row, i) => (i === index ? { ...row, amount_g } : row)));
  }

  function removeDraftItem(index: number) {
    setDraftItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function createRecipe(e: FormEvent) {
    e.preventDefault();
    if (saving) {
      return;
    }
    if (!name.trim()) {
      setError("Bitte einen Rezeptnamen eingeben.");
      return;
    }
    if (draftItems.length === 0) {
      setError("Bitte mindestens eine Zutat oder ein Produkt hinzufügen.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: name.trim(),
        notes: notes.trim() || null,
        visibility,
        items: draftItems.map((row, i) => ({
          food_item_id: row.food_item_id,
          amount_g: Number(row.amount_g || 0),
          sort_index: i,
        })),
      };
      const response = await apiFetch(`${API_BASE_URL}/nutrition/recipes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(body.detail || "Rezept konnte nicht gespeichert werden.");
      }
      setMessage("Rezept gespeichert.");
      setName("");
      setNotes("");
      setVisibility("private");
      setDraftItems([]);
      await loadRecipes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function consumeRecipe(recipe: Recipe) {
    const amount = Number(consumeAmountByRecipe[recipe.id] || 0);
    if (amount <= 0) {
      setError("Bitte eine Menge in Gramm eingeben.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/nutrition/entries/from-recipe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe_id: recipe.id,
          amount_g: amount,
          consumed_at: new Date(consumeAt).toISOString(),
          meal_type: consumeMealType,
          notes: null,
        }),
      });
      const body = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(body.detail || "Rezept konnte nicht als Mahlzeit erfasst werden.");
      }
      setMessage(`Erfasst: ${recipe.name} (${round(amount)} g).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  useEffect(() => {
    void loadRecipes();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void searchItems(search).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unknown error");
      });
    }, 180);
    return () => window.clearTimeout(t);
  }, [search]);

  const hasSuggestions = useMemo(() => suggestions.length > 0 && search.trim().length > 0, [suggestions, search]);

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Ernährung</p>
        <h1>Rezepte</h1>
        <p className="lead">Rezepte aus Zutaten und Produkten erstellen und später grammbasiert als Mahlzeit erfassen.</p>
      </div>

      <div className="card">
        <h2>Rezept erstellen</h2>
        <form className="nutrition-form" onSubmit={(e) => void createRecipe(e)}>
          <label className="settings-label">
            Name
            <input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="settings-label">
            Sichtbarkeit
            <select className="settings-input" value={visibility} onChange={(e) => setVisibility(e.target.value as "private" | "public")}>
              <option value="private">Nur für mich</option>
              <option value="public">Öffentlich</option>
            </select>
          </label>
          <label className="settings-label nutrition-span-2">
            Notizen
            <input className="settings-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="settings-label nutrition-span-2">
            Zutat oder Produkt suchen
            <input
              className="settings-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="z.B. Kichererbsen, Kidneybohnen, Olivenöl"
            />
            {hasSuggestions ? (
              <div className="ingredient-suggest-box">
                {suggestions.map((item) => (
                  <button key={item.id} className="ingredient-suggest-item" type="button" onClick={() => addDraftItem(item)}>
                    <strong>{item.name}</strong>
                    <span>{item.item_kind === "product" ? "Produkt" : "Zutat"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </label>
          <div className="nutrition-span-2">
            {draftItems.length === 0 ? <p>Noch keine Bestandteile hinzugefügt.</p> : null}
            {draftItems.map((row, idx) => (
              <div key={`${row.food_item_id}-${idx}`} className="recipe-draft-row">
                <span>{row.label}</span>
                <input
                  className="settings-input"
                  type="number"
                  min="1"
                  value={row.amount_g}
                  onChange={(e) => updateDraftItem(idx, e.target.value)}
                />
                <span>g</span>
                <button className="icon-button danger" type="button" onClick={() => removeDraftItem(idx)} title="Entfernen">
                  🗑
                </button>
              </div>
            ))}
          </div>
          <div className="settings-actions nutrition-span-2">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "Speichere..." : "Rezept speichern"}
            </button>
          </div>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p className="info-text">{message}</p> : null}
      </div>

      <div className="card">
        <h2>Rezept essen (in Erfassung übernehmen)</h2>
        <div className="settings-form">
          <label className="settings-label">
            Zeitpunkt
            <input className="settings-input" type="datetime-local" value={consumeAt} onChange={(e) => setConsumeAt(e.target.value)} />
          </label>
          <label className="settings-label">
            Mahlzeit
            <select className="settings-input" value={consumeMealType} onChange={(e) => setConsumeMealType(e.target.value)}>
              <option value="breakfast">Frühstück</option>
              <option value="lunch">Mittagessen</option>
              <option value="dinner">Abendessen</option>
              <option value="snack">Snack</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="section-title-row">
          <h2>Meine Rezepte</h2>
          <button className="secondary-button" type="button" onClick={() => void loadRecipes()} disabled={loading}>
            Aktualisieren
          </button>
        </div>
        {loading ? <p>Lade Rezepte...</p> : null}
        {!loading && recipes.length === 0 ? <p>Noch keine Rezepte vorhanden.</p> : null}
        {!loading ? (
          <div className="nutrition-list">
            {recipes.map((recipe) => (
              <article className="nutrition-entry" key={recipe.id}>
                <div className="nutrition-entry-head">
                  <strong>{recipe.name}</strong>
                  <span>{recipe.visibility === "public" ? "Öffentlich" : "Privat"}</span>
                </div>
                <div className="nutrition-entry-summary">
                  <span>Gesamt: {round(recipe.total_weight_g)} g</span>
                  <span>kcal: {round(recipe.kcal)}</span>
                  <span>P: {round(recipe.protein_g)} g</span>
                  <span>C: {round(recipe.carbs_g)} g</span>
                  <span>F: {round(recipe.fat_g)} g</span>
                </div>
                <div className="nutrition-entry-summary">
                  <span>/100g kcal: {round(recipe.kcal_per_100g)}</span>
                  <span>P: {round(recipe.protein_per_100g)} g</span>
                  <span>C: {round(recipe.carbs_per_100g)} g</span>
                  <span>F: {round(recipe.fat_per_100g)} g</span>
                </div>
                <div className="nutrition-entry-items">
                  {recipe.items.map((item) => (
                    <div className="nutrition-item" key={item.id}>
                      <strong>{item.food_name}</strong>
                      <span>
                        {round(item.amount_g)} g · {round(item.kcal)} kcal
                      </span>
                    </div>
                  ))}
                </div>
                <div className="recipe-consume-row">
                  <input
                    className="settings-input"
                    type="number"
                    min="1"
                    placeholder="Verzehrte Menge (g)"
                    value={consumeAmountByRecipe[recipe.id] ?? ""}
                    onChange={(e) =>
                      setConsumeAmountByRecipe((prev) => ({
                        ...prev,
                        [recipe.id]: e.target.value,
                      }))
                    }
                  />
                  <button className="primary-button" type="button" onClick={() => void consumeRecipe(recipe)}>
                    In Erfassung übernehmen
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
