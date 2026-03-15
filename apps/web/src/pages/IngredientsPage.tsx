import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

const BASE_INGREDIENT_CATEGORIES = [
  "Alle",
  "Gemüse",
  "Obst",
  "Fleisch",
  "Fisch",
  "Eier",
  "Milchprodukte",
  "Käse",
  "Joghurt",
  "Getreide",
  "Hülsenfrüchte",
  "Nüsse",
  "Samen",
  "Öle",
  "Gewürze",
];
const PRODUCT_CATEGORIES = [
  "Alle",
  "Getränke",
  "Backwaren",
  "Süßwaren",
  "Snacks",
  "Milchprodukte",
  "Proteinprodukte",
  "Riegel",
  "Fertiggerichte",
  "Konserven",
  "Tiefkühlprodukte",
  "Saucen",
  "Supplements",
  "Cerealien",
];
const DEFAULT_DETAILS = '{"trans_fat_per_100g": null, "added_sugar_per_100g": null}';

type ItemKind = "base_ingredient" | "product";

type FoodItem = {
  id: string;
  name: string;
  name_en?: string | null;
  name_de?: string | null;
  item_kind: ItemKind;
  scope: "global" | "user";
  category: string | null;
  brand: string | null;
  barcode: string | null;
  origin_type: string;
  trust_level: string;
  verification_status: string;
  health_indicator?: "very_positive" | "neutral" | "counterproductive" | null;
  source_type: string | null;
  source_label: string | null;
  source_url: string | null;
  has_user_override: boolean;
  kcal_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  fiber_per_100g: number | null;
  sugar_per_100g: number | null;
  starch_per_100g: number | null;
  saturated_fat_per_100g: number | null;
  monounsaturated_fat_per_100g: number | null;
  polyunsaturated_fat_per_100g: number | null;
  sodium_mg_per_100g: number | null;
  potassium_mg_per_100g: number | null;
  details: Record<string, unknown>;
};

type NumericFields = {
  kcal_per_100g: string;
  protein_per_100g: string;
  carbs_per_100g: string;
  fat_per_100g: string;
  fiber_per_100g: string;
  sugar_per_100g: string;
  starch_per_100g: string;
  saturated_fat_per_100g: string;
  monounsaturated_fat_per_100g: string;
  polyunsaturated_fat_per_100g: string;
  sodium_mg_per_100g: string;
  potassium_mg_per_100g: string;
};

const NUMERIC_KEYS: Array<keyof NumericFields> = ["kcal_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g", "fiber_per_100g", "sugar_per_100g", "starch_per_100g", "saturated_fat_per_100g", "monounsaturated_fat_per_100g", "polyunsaturated_fat_per_100g", "sodium_mg_per_100g", "potassium_mg_per_100g"];

const emptyNumbers = (): NumericFields => ({
  kcal_per_100g: "", protein_per_100g: "", carbs_per_100g: "", fat_per_100g: "", fiber_per_100g: "", sugar_per_100g: "", starch_per_100g: "", saturated_fat_per_100g: "", monounsaturated_fat_per_100g: "", polyunsaturated_fat_per_100g: "", sodium_mg_per_100g: "", potassium_mg_per_100g: "",
});

const asNum = (value: string): number | null => {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

type IngredientsPageProps = {
  initialKind?: ItemKind;
};

export function IngredientsPage({ initialKind = "base_ingredient" }: IngredientsPageProps) {
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<FoodItem[]>([]);
  const selectedKind = initialKind;
  const [selectedCategory, setSelectedCategory] = useState("Alle");
  const [items, setItems] = useState<FoodItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<FoodItem | null>(null);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({ Alle: 0 });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [scope, setScope] = useState<"global" | "user">("user");
  const [category, setCategory] = useState(initialKind === "product" ? "Getränke" : "Gemüse");
  const [brand, setBrand] = useState("");
  const [barcode, setBarcode] = useState("");
  const [originType, setOriginType] = useState("user_self");
  const [trustLevel, setTrustLevel] = useState("medium");
  const [verificationStatus, setVerificationStatus] = useState("unverified");
  const [healthIndicator, setHealthIndicator] = useState<"very_positive" | "neutral" | "counterproductive">("neutral");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [numbers, setNumbers] = useState<NumericFields>(emptyNumbers());
  const [detailsRaw, setDetailsRaw] = useState(DEFAULT_DETAILS);
  const [llmRawText, setLlmRawText] = useState("");

  const trimmedQuery = useMemo(() => query.trim(), [query]);
  const isProductsView = selectedKind === "product";
  const activeCategories = useMemo(
    () => (isProductsView ? PRODUCT_CATEGORIES : BASE_INGREDIENT_CATEGORIES),
    [isProductsView],
  );
  const defaultCategory = activeCategories[1] ?? "";

  const loadIntoForm = (item: FoodItem) => {
    setSelectedItem(item);
    setName(item.name_de || item.name || "");
    setNameEn(item.name_en || item.name || "");
    setScope(item.scope);
    const loadedCategory = item.category && activeCategories.includes(item.category) ? item.category : defaultCategory;
    setCategory(loadedCategory);
    setBrand(item.brand || "");
    setBarcode(item.barcode || "");
    setOriginType(item.origin_type || "user_self");
    setTrustLevel(item.trust_level || "medium");
    setVerificationStatus(item.verification_status || "unverified");
    setHealthIndicator((item.health_indicator as "very_positive" | "neutral" | "counterproductive" | null) || "neutral");
    setSourceLabel(item.source_label || "");
    setSourceUrl(item.source_url || "");
    const n = emptyNumbers();
    for (const key of NUMERIC_KEYS) n[key] = item[key] == null ? "" : String(item[key]);
    setNumbers(n);
    setDetailsRaw(item.details && Object.keys(item.details).length > 0 ? JSON.stringify(item.details, null, 2) : "{}");
  };

  const toPayload = () => {
    const parsed = detailsRaw.trim() ? JSON.parse(detailsRaw) : {};
    const payload: Record<string, unknown> = {
      name: name.trim(),
      name_en: nameEn.trim() || null,
      name_de: name.trim() || null,
      scope,
      item_kind: selectedKind,
      category: category || null,
      brand: isProductsView ? (brand.trim() || null) : null,
      barcode: isProductsView ? (barcode.trim() || null) : null,
      origin_type: originType || null,
      trust_level: trustLevel || null,
      verification_status: verificationStatus || null,
      health_indicator: healthIndicator || "neutral",
      source_label: sourceLabel.trim() || null,
      source_url: sourceUrl.trim() || null,
      source_type: sourceLabel.trim() || sourceUrl.trim() ? "manual" : null,
      details: parsed,
    };
    for (const key of NUMERIC_KEYS) payload[key] = asNum(numbers[key]);
    return payload;
  };

  const loadItems = async (q = trimmedQuery, cat = selectedCategory, kind = selectedKind) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "80" });
      if (q) params.set("q", q);
      if (cat !== "Alle") params.set("category", cat);
      params.set("item_kind", kind);
      const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items?${params.toString()}`);
      const body = await parseJsonSafely<{ items: FoodItem[] } | { detail?: string }>(response);
      if (!response.ok) throw new Error(body && "detail" in body && body.detail ? body.detail : "Zutaten konnten nicht geladen werden.");
      setItems((body as { items: FoodItem[] }).items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const loadSuggestions = async (q = trimmedQuery, cat = selectedCategory, kind = selectedKind) => {
    const search = q.trim();
    if (search.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const params = new URLSearchParams({ q: search, limit: "8" });
      if (cat !== "Alle") params.set("category", cat);
      params.set("item_kind", kind);
      const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items?${params.toString()}`);
      const body = await parseJsonSafely<{ items: FoodItem[] }>(response);
      if (!response.ok || !body) {
        setSuggestions([]);
        return;
      }
      setSuggestions(body.items ?? []);
    } catch {
      setSuggestions([]);
    }
  };

  const loadCounts = async (q = trimmedQuery, kind = selectedKind) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("item_kind", kind);
    const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items/category-counts${params.toString() ? `?${params.toString()}` : ""}`);
    const body = await parseJsonSafely<{ counts: Record<string, number> }>(response);
    if (response.ok && body) setCategoryCounts(body.counts ?? { Alle: 0 });
  };

  const healthIndicatorLabel = (value: string | null | undefined) => {
    if (value === "very_positive") return "sehr positiv";
    if (value === "counterproductive") return "eher kontraproduktiv";
    return "neutral";
  };

  const saveItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() && !nameEn.trim()) return;
    setError(null);
    setMessage(null);
    try {
      const payload = toPayload();
      let response: Response;
      if (selectedItem) {
        const ok = window.confirm("Änderungen speichern? Vorhandene Werte werden überschrieben.");
        if (!ok) return;
        response = await apiFetch(`${API_BASE_URL}/nutrition/food-items/${selectedItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        response = await apiFetch(`${API_BASE_URL}/nutrition/food-items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      const body = await parseJsonSafely<FoodItem | { detail?: string }>(response);
      if (!response.ok) throw new Error(body && "detail" in body && body.detail ? body.detail : "Speichern fehlgeschlagen.");
      setMessage(isProductsView ? "Produkt gespeichert." : "Zutat gespeichert.");
      loadIntoForm(body as FoodItem);
      await loadItems();
      await loadCounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const copyLlmPrompt = async () => {
    if (!name.trim()) {
      setError("Bitte zuerst einen Zutatennamen eingeben.");
      return;
    }
    const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items/llm-prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: (nameEn.trim() || name.trim()), brand: brand.trim() || null, category: category || null }),
    });
    const body = await parseJsonSafely<{ prompt: string } | { detail?: string }>(response);
    if (!response.ok || !body || !("prompt" in body)) {
      setError(body && "detail" in body && body.detail ? body.detail : "Prompt konnte nicht erzeugt werden.");
      return;
    }
    await navigator.clipboard.writeText(body.prompt);
    setMessage("LLM-Prompt in Zwischenablage kopiert.");
  };

  const importFromLlm = async () => {
    if (!llmRawText.trim()) {
      setError("Bitte LLM-JSON einfügen.");
      return;
    }
    const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items/import-llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: llmRawText }),
    });
    const body = await parseJsonSafely<FoodItem | { detail?: string }>(response);
    if (!response.ok) {
      setError(body && "detail" in body && body.detail ? body.detail : "Import fehlgeschlagen.");
      return;
    }
    loadIntoForm(body as FoodItem);
    setLlmRawText("");
    setMessage("Zutat aus LLM-JSON importiert.");
    await loadItems();
    await loadCounts();
  };

  useEffect(() => {
    if (!activeCategories.includes(selectedCategory)) {
      setSelectedCategory("Alle");
    }
    if (!activeCategories.includes(category)) {
      setCategory(defaultCategory);
    }
  }, [activeCategories, category, defaultCategory, selectedCategory]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadItems(trimmedQuery, selectedCategory, selectedKind);
      void loadCounts(trimmedQuery, selectedKind);
      void loadSuggestions(trimmedQuery, selectedCategory, selectedKind);
    }, 200);
    return () => clearTimeout(timer);
  }, [trimmedQuery, selectedCategory, selectedKind]);

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Ernährung</p>
        <h1>{isProductsView ? "Produkte" : "Zutaten"}</h1>
        <p className="lead">{isProductsView ? "Produktdaten mit Marke/Hersteller und Barcode." : "Nur Basiszutaten ohne Produkt-Metadaten."}</p>
      </div>

      <div className="ingredients-layout">
        <div>
          <div className="card nutrition-form-card">
            <h2>{isProductsView ? "Suche und Produkt bearbeiten" : "Suche und Zutat bearbeiten"}</h2>
            <label className="settings-label">Suche ({isProductsView ? "Name, Marke, Barcode" : "Name"})
              <input
                className="settings-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 140)}
                placeholder={isProductsView ? "z.B. Skyr, Red Bull, 761..." : "z.B. Banane, Reis, Haferflocken..."}
              />
              {searchFocused && suggestions.length > 0 ? (
                <div className="ingredient-suggest-box">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className="ingredient-suggest-item"
                      onClick={() => {
                        setQuery(suggestion.name);
                        setSearchFocused(false);
                        loadIntoForm(suggestion);
                        void loadItems(suggestion.name, selectedCategory, selectedKind);
                      }}
                    >
                      <strong>{suggestion.name}</strong>
                      <span>
                        {isProductsView
                          ? [suggestion.brand, suggestion.barcode].filter(Boolean).join(" · ")
                          : suggestion.category || "-"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>

            <form className="nutrition-form" onSubmit={(e) => void saveItem(e)}>
              <label className="settings-label">Name (DE)<input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="settings-label">Name (EN / USDA)<input className="settings-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required /></label>
              <label className="settings-label">Typ<input className="settings-input" value={isProductsView ? "Produkt" : "Basiszutat"} readOnly /></label>
              <label className="settings-label">Sichtbarkeit<select className="settings-input" value={scope} onChange={(e) => setScope(e.target.value as "global" | "user")}><option value="user">Nur für mich</option><option value="global">Globaler Katalog</option></select></label>
              <label className="settings-label">Kategorie<select className="settings-input" value={category} onChange={(e) => setCategory(e.target.value)}>{activeCategories.filter((c) => c !== "Alle").map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              {isProductsView ? <label className="settings-label">Marke/Hersteller<input className="settings-input" value={brand} onChange={(e) => setBrand(e.target.value)} /></label> : null}
              {isProductsView ? <label className="settings-label">Barcode<input className="settings-input" value={barcode} onChange={(e) => setBarcode(e.target.value)} /></label> : null}
              <label className="settings-label">Herkunft<select className="settings-input" value={originType} onChange={(e) => setOriginType(e.target.value)}><option value="trusted_source">Trusted Source</option><option value="manufacturer">Hersteller</option><option value="community">Community</option><option value="llm">LLM</option><option value="user_self">Selbst erfasst</option></select></label>
              <label className="settings-label">Trust Level<select className="settings-input" value={trustLevel} onChange={(e) => setTrustLevel(e.target.value)}><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></label>
              <label className="settings-label">Verifizierung<select className="settings-input" value={verificationStatus} onChange={(e) => setVerificationStatus(e.target.value)}><option value="unverified">unverified</option><option value="source_linked">source_linked</option><option value="reviewed">reviewed</option><option value="verified">verified</option></select></label>
              <label className="settings-label">Health-Indikator<select className="settings-input" value={healthIndicator} onChange={(e) => setHealthIndicator(e.target.value as "very_positive" | "neutral" | "counterproductive")}><option value="very_positive">sehr positiv</option><option value="neutral">neutral</option><option value="counterproductive">eher kontraproduktiv</option></select></label>
              <label className="settings-label">Quelle (Label)<input className="settings-input" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} /></label>
              <label className="settings-label nutrition-span-2">Quelle (URL)<input className="settings-input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} /></label>

              <label className="settings-label">kcal/100g<input className="settings-input" type="number" value={numbers.kcal_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, kcal_per_100g: e.target.value }))} /></label>
              <label className="settings-label">Protein/100g<input className="settings-input" type="number" value={numbers.protein_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, protein_per_100g: e.target.value }))} /></label>
              <label className="settings-label">Kohlenhydrate/100g<input className="settings-input" type="number" value={numbers.carbs_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, carbs_per_100g: e.target.value }))} /></label>
              <label className="settings-label">Fett/100g<input className="settings-input" type="number" value={numbers.fat_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, fat_per_100g: e.target.value }))} /></label>

              <details className="nutrition-details-section nutrition-span-2">
                <summary>Weitere Inhaltsstoffe (aufklappen)</summary>
                <label className="settings-label">Ballaststoffe/100g<input className="settings-input" type="number" value={numbers.fiber_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, fiber_per_100g: e.target.value }))} /></label>
                <label className="settings-label">Zucker/100g<input className="settings-input" type="number" value={numbers.sugar_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, sugar_per_100g: e.target.value }))} /></label>
                <label className="settings-label">Stärke/100g<input className="settings-input" type="number" value={numbers.starch_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, starch_per_100g: e.target.value }))} /></label>
                <label className="settings-label">Gesättigte Fette/100g<input className="settings-input" type="number" value={numbers.saturated_fat_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, saturated_fat_per_100g: e.target.value }))} /></label>
                <label className="settings-label">Einfach unges. Fette/100g<input className="settings-input" type="number" value={numbers.monounsaturated_fat_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, monounsaturated_fat_per_100g: e.target.value }))} /></label>
                <label className="settings-label">Mehrfach unges. Fette/100g<input className="settings-input" type="number" value={numbers.polyunsaturated_fat_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, polyunsaturated_fat_per_100g: e.target.value }))} /></label>
                <label className="settings-label">Natrium mg/100g<input className="settings-input" type="number" value={numbers.sodium_mg_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, sodium_mg_per_100g: e.target.value }))} /></label>
                <label className="settings-label">Kalium mg/100g<input className="settings-input" type="number" value={numbers.potassium_mg_per_100g} onChange={(e) => setNumbers((p) => ({ ...p, potassium_mg_per_100g: e.target.value }))} /></label>
                <label className="settings-label nutrition-span-2">Weitere Werte als JSON<textarea className="settings-input" rows={4} value={detailsRaw} onChange={(e) => setDetailsRaw(e.target.value)} /></label>
              </details>

              <div className="settings-actions nutrition-span-2">
                <button className="primary-button" type="submit">{isProductsView ? "Produkt speichern" : "Zutat speichern"}</button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setSelectedItem(null);
                    setName("");
                    setNameEn("");
                    setHealthIndicator("neutral");
                  }}
                >
                  {isProductsView ? "Neues Produkt" : "Neue Zutat"}
                </button>
                <button className="secondary-button" type="button" onClick={() => void copyLlmPrompt()}>Prompt für LLM kopieren</button>
              </div>
            </form>

            {selectedItem ? <p className="info-text">Ausgewählt: <strong>{selectedItem.name}</strong> · Typ: <strong>{isProductsView ? "Produkt" : "Basiszutat"}</strong></p> : null}
            <label className="settings-label">LLM-JSON importieren<textarea className="settings-input" rows={8} value={llmRawText} onChange={(e) => setLlmRawText(e.target.value)} /></label>
            <div className="settings-actions"><button className="secondary-button" type="button" onClick={() => void importFromLlm()}>JSON importieren</button></div>
            {error ? <p className="error-text">{error}</p> : null}
            {message ? <p className="info-text">{message}</p> : null}
          </div>

          <div className="card nutrition-list-card">
            <h2>{isProductsView ? "Produkte" : "Zutaten"} ({items.length})</h2>
            {loading ? <p>{isProductsView ? "Lade Produkte..." : "Lade Zutaten..."}</p> : null}
            {!loading && items.length === 0 ? <p>{isProductsView ? "Keine Produkte gefunden." : "Keine Zutaten gefunden."}</p> : null}
            {!loading ? <div className="nutrition-list">{items.map((item) => (
              <article className={`nutrition-entry nutrition-entry-selectable ${selectedItem?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => loadIntoForm(item)}>
                <div className="nutrition-entry-head">
                  <strong>{item.name}</strong>
                  <span className={`health-indicator-badge health-${item.health_indicator || "neutral"}`}>{healthIndicatorLabel(item.health_indicator)}</span>
                  {isProductsView ? <span>{item.brand || "-"}</span> : null}
                  <span>{item.category || "-"}</span>
                </div>
                <div className="nutrition-entry-summary">
                  <span>kcal: {item.kcal_per_100g ?? "-"}</span><span>P: {item.protein_per_100g ?? "-"}</span><span>C: {item.carbs_per_100g ?? "-"}</span><span>F: {item.fat_per_100g ?? "-"}</span>
                  {isProductsView ? <span>Barcode: {item.barcode || "-"}</span> : null}
                  <span>Quelle: {item.source_label || item.source_type || "-"}</span>
                </div>
              </article>
            ))}</div> : null}
          </div>
        </div>

        <aside className="card ingredients-categories">
          <h2>Kategorien</h2>
          <div className="ingredients-categories-list">{activeCategories.map((cat) => (
            <button type="button" key={cat} className={cat === selectedCategory ? "nav-sub-link active" : "nav-sub-link"} onClick={() => setSelectedCategory(cat)}>
              {cat} ({categoryCounts[cat] ?? 0})
            </button>
          ))}</div>
        </aside>
      </div>
    </section>
  );
}
