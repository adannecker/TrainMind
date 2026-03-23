import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

type ItemKind = "base_ingredient" | "product";
type HealthIndicator = "very_positive" | "neutral" | "counterproductive";

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
  usda_status?: string | null;
  health_indicator?: HealthIndicator | null;
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

type DetailField = { key: string; label: string; unit: string };

const NUMERIC_FIELDS: Array<{ key: keyof NumericFields; label: string }> = [
  { key: "kcal_per_100g", label: "kcal / 100g" },
  { key: "protein_per_100g", label: "Protein / 100g" },
  { key: "carbs_per_100g", label: "Kohlenhydrate / 100g" },
  { key: "fat_per_100g", label: "Fett / 100g" },
  { key: "fiber_per_100g", label: "Ballaststoffe / 100g" },
  { key: "sugar_per_100g", label: "Zucker / 100g" },
  { key: "starch_per_100g", label: "Stärke / 100g" },
  { key: "sodium_mg_per_100g", label: "Natrium / 100g" },
  { key: "potassium_mg_per_100g", label: "Kalium / 100g" },
  { key: "saturated_fat_per_100g", label: "Gesättigte Fette / 100g" },
  { key: "monounsaturated_fat_per_100g", label: "Einfach unges. Fette / 100g" },
  { key: "polyunsaturated_fat_per_100g", label: "Mehrfach unges. Fette / 100g" },
];

const DETAIL_GROUP_ONE: DetailField[] = [
  { key: "trans_fat_per_100g", label: "Transfette", unit: "g" },
  { key: "added_sugar_per_100g", label: "Zugesetzter Zucker", unit: "g" },
  { key: "net_carbs_per_100g", label: "Netto-Kohlenhydrate", unit: "g" },
  { key: "cholesterol_mg_per_100g", label: "Cholesterin", unit: "mg" },
  { key: "salt_g_per_100g", label: "Salz", unit: "g" },
  { key: "omega3_g_per_100g", label: "Omega-3", unit: "g" },
  { key: "omega6_g_per_100g", label: "Omega-6", unit: "g" },
  { key: "calcium_mg_per_100g", label: "Calcium", unit: "mg" },
  { key: "magnesium_mg_per_100g", label: "Magnesium", unit: "mg" },
  { key: "phosphorus_mg_per_100g", label: "Phosphor", unit: "mg" },
  { key: "iron_mg_per_100g", label: "Eisen", unit: "mg" },
  { key: "zinc_mg_per_100g", label: "Zink", unit: "mg" },
  { key: "copper_mg_per_100g", label: "Kupfer", unit: "mg" },
  { key: "manganese_mg_per_100g", label: "Mangan", unit: "mg" },
  { key: "selenium_ug_per_100g", label: "Selen", unit: "µg" },
  { key: "iodine_ug_per_100g", label: "Jod", unit: "µg" },
];

const DETAIL_GROUP_TWO: DetailField[] = [
  { key: "vitamin_a_ug_per_100g", label: "Vitamin A", unit: "µg" },
  { key: "vitamin_b1_mg_per_100g", label: "Vitamin B1", unit: "mg" },
  { key: "vitamin_b2_mg_per_100g", label: "Vitamin B2", unit: "mg" },
  { key: "vitamin_b3_mg_per_100g", label: "Niacin (B3)", unit: "mg" },
  { key: "vitamin_b5_mg_per_100g", label: "Vitamin B5", unit: "mg" },
  { key: "vitamin_b6_mg_per_100g", label: "Vitamin B6", unit: "mg" },
  { key: "folate_ug_per_100g", label: "Folat", unit: "µg" },
  { key: "vitamin_b12_ug_per_100g", label: "Vitamin B12", unit: "µg" },
  { key: "vitamin_c_mg_per_100g", label: "Vitamin C", unit: "mg" },
  { key: "vitamin_d_ug_per_100g", label: "Vitamin D", unit: "µg" },
  { key: "vitamin_e_mg_per_100g", label: "Vitamin E", unit: "mg" },
  { key: "vitamin_k_ug_per_100g", label: "Vitamin K", unit: "µg" },
  { key: "biotin_ug_per_100g", label: "Biotin", unit: "µg" },
];

const ALL_DETAIL_FIELDS = [...DETAIL_GROUP_ONE, ...DETAIL_GROUP_TWO];

const emptyNumbers = (): NumericFields => ({
  kcal_per_100g: "",
  protein_per_100g: "",
  carbs_per_100g: "",
  fat_per_100g: "",
  fiber_per_100g: "",
  sugar_per_100g: "",
  starch_per_100g: "",
  saturated_fat_per_100g: "",
  monounsaturated_fat_per_100g: "",
  polyunsaturated_fat_per_100g: "",
  sodium_mg_per_100g: "",
  potassium_mg_per_100g: "",
});

const emptyDetails = () => Object.fromEntries(ALL_DETAIL_FIELDS.map((field) => [field.key, ""])) as Record<string, string>;

const asNum = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function mapDetailsToState(details: Record<string, unknown>) {
  const next = emptyDetails();
  for (const field of ALL_DETAIL_FIELDS) {
    next[field.key] = typeof details[field.key] === "number" ? String(details[field.key]) : "";
  }
  return next;
}

function buildDetailsPayload(values: Record<string, string>) {
  return Object.fromEntries(ALL_DETAIL_FIELDS.map((field) => [field.key, asNum(values[field.key] || "")]));
}

function healthMeta(indicator: HealthIndicator) {
  if (indicator === "very_positive") return { label: "Sehr positiv", tone: "health-very_positive", subtitle: "Hohe Nährstoffdichte und gute Basis für eine bewusste Ernährung." };
  if (indicator === "counterproductive") return { label: "Eher kontraproduktiv", tone: "health-counterproductive", subtitle: "Bewusst einsetzen und mit Kontext interpretieren." };
  return { label: "Neutral", tone: "health-neutral", subtitle: "Solide Basis ohne starken Ausschlag nach oben oder unten." };
}

function prettifyOriginType(value: string | null | undefined) {
  if (value === "trusted_source") return "Trusted Source";
  if (value === "manufacturer") return "Hersteller";
  if (value === "community") return "Community";
  if (value === "llm") return "LLM";
  if (value === "user_self") return "Selbst erfasst";
  return value || "-";
}

function normalizeCategoryLabel(value: string | null | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .trim();
}

type IngredientsPageProps = { initialKind?: ItemKind };

export function IngredientsPage({ initialKind = "base_ingredient" }: IngredientsPageProps) {
  const selectedKind = initialKind;
  const isProductsView = selectedKind === "product";
  const activeCategories = useMemo(() => (isProductsView ? PRODUCT_CATEGORIES : BASE_INGREDIENT_CATEGORIES), [isProductsView]);
  const defaultCategory = activeCategories[1] ?? "";

  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("Alle");
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({ Alle: 0 });
  const [suggestions, setSuggestions] = useState<FoodItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<FoodItem | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [scope, setScope] = useState<"global" | "user">("user");
  const [category, setCategory] = useState(defaultCategory);
  const [brand, setBrand] = useState("");
  const [barcode, setBarcode] = useState("");
  const [originType, setOriginType] = useState("user_self");
  const [trustLevel, setTrustLevel] = useState("medium");
  const [verificationStatus, setVerificationStatus] = useState("unverified");
  const [usdaStatus, setUsdaStatus] = useState("unknown");
  const [healthIndicator, setHealthIndicator] = useState<HealthIndicator>("neutral");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [numbers, setNumbers] = useState<NumericFields>(emptyNumbers());
  const [detailValues, setDetailValues] = useState<Record<string, string>>(emptyDetails());
  const [llmRawText, setLlmRawText] = useState("");
  const suggestionRequestRef = useRef(0);
  const countRequestRef = useRef(0);

  const healthInfo = healthMeta(healthIndicator);

  const resetForm = () => {
    setSelectedItem(null);
    setName("");
    setNameEn("");
    setScope("user");
    setCategory(defaultCategory);
    setBrand("");
    setBarcode("");
    setOriginType("user_self");
    setTrustLevel("medium");
    setVerificationStatus("unverified");
    setUsdaStatus("unknown");
    setHealthIndicator("neutral");
    setSourceLabel("");
    setSourceUrl("");
    setNumbers(emptyNumbers());
    setDetailValues(emptyDetails());
    setLlmRawText("");
  };

  const loadIntoForm = (item: FoodItem) => {
    setSelectedItem(item);
    setName(item.name_de || item.name || "");
    setNameEn(item.name_en || item.name || "");
    setScope(item.scope);
    setCategory(item.category && activeCategories.includes(item.category) ? item.category : defaultCategory);
    setBrand(item.brand || "");
    setBarcode(item.barcode || "");
    setOriginType(item.origin_type || "user_self");
    setTrustLevel(item.trust_level || "medium");
    setVerificationStatus(item.verification_status || "unverified");
    setUsdaStatus(item.usda_status || "unknown");
    setHealthIndicator(item.health_indicator || "neutral");
    setSourceLabel(item.source_label || "");
    setSourceUrl(item.source_url || "");
    setNumbers({
      kcal_per_100g: item.kcal_per_100g == null ? "" : String(item.kcal_per_100g),
      protein_per_100g: item.protein_per_100g == null ? "" : String(item.protein_per_100g),
      carbs_per_100g: item.carbs_per_100g == null ? "" : String(item.carbs_per_100g),
      fat_per_100g: item.fat_per_100g == null ? "" : String(item.fat_per_100g),
      fiber_per_100g: item.fiber_per_100g == null ? "" : String(item.fiber_per_100g),
      sugar_per_100g: item.sugar_per_100g == null ? "" : String(item.sugar_per_100g),
      starch_per_100g: item.starch_per_100g == null ? "" : String(item.starch_per_100g),
      saturated_fat_per_100g: item.saturated_fat_per_100g == null ? "" : String(item.saturated_fat_per_100g),
      monounsaturated_fat_per_100g: item.monounsaturated_fat_per_100g == null ? "" : String(item.monounsaturated_fat_per_100g),
      polyunsaturated_fat_per_100g: item.polyunsaturated_fat_per_100g == null ? "" : String(item.polyunsaturated_fat_per_100g),
      sodium_mg_per_100g: item.sodium_mg_per_100g == null ? "" : String(item.sodium_mg_per_100g),
      potassium_mg_per_100g: item.potassium_mg_per_100g == null ? "" : String(item.potassium_mg_per_100g),
    });
    setDetailValues(mapDetailsToState(item.details || {}));
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      name: name.trim() || nameEn.trim(),
      name_de: name.trim() || null,
      name_en: nameEn.trim() || null,
      scope,
      item_kind: selectedKind,
      category: category || null,
      brand: isProductsView ? brand.trim() || null : null,
      barcode: isProductsView ? barcode.trim() || null : null,
      origin_type: originType,
      trust_level: trustLevel,
      verification_status: verificationStatus,
      usda_status: usdaStatus,
      health_indicator: healthIndicator,
      source_label: sourceLabel.trim() || null,
      source_url: sourceUrl.trim() || null,
      source_type: sourceLabel.trim() || sourceUrl.trim() ? "manual" : null,
      details: buildDetailsPayload(detailValues),
    };
    for (const field of NUMERIC_FIELDS) payload[field.key] = asNum(numbers[field.key]);
    return payload;
  };

  const loadCounts = async (nextQuery = query, nextKind = selectedKind) => {
    const requestId = ++countRequestRef.current;
    try {
      const params = new URLSearchParams({ item_kind: nextKind });
      if (nextQuery) params.set("q", nextQuery);
      const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items/category-counts?${params.toString()}`);
      const body = await parseJsonSafely<{ counts: Record<string, number> }>(response);
      if (requestId !== countRequestRef.current) return;
      if (!response.ok || !body) return;
      const sourceCounts = body.counts ?? { Alle: 0 };
      const normalizedCounts = new Map(Object.entries(sourceCounts).map(([key, value]) => [normalizeCategoryLabel(key), value]));
      const resolvedCounts = Object.fromEntries(
        ["Alle", ...activeCategories.filter((entry) => entry !== "Alle")].map((entry) => [
          entry,
          Number(normalizedCounts.get(normalizeCategoryLabel(entry)) ?? (entry === "Alle" ? sourceCounts.Alle : 0)),
        ]),
      ) as Record<string, number>;
      setCategoryCounts(resolvedCounts);
      setResultCount(resolvedCounts.Alle ?? 0);
    } catch {
      if (requestId !== countRequestRef.current) return;
      setCategoryCounts(Object.fromEntries(activeCategories.map((entry) => [entry, 0])) as Record<string, number>);
      setResultCount(0);
    }
  };

  const loadSuggestions = async (nextQuery = query, nextKind = selectedKind) => {
    const requestId = ++suggestionRequestRef.current;
    if (nextQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const params = new URLSearchParams({ q: nextQuery, limit: "8", item_kind: nextKind });
      const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items?${params.toString()}`);
      const body = await parseJsonSafely<{ items: FoodItem[] }>(response);
      if (requestId !== suggestionRequestRef.current) return;
      setSuggestions(response.ok && body ? body.items ?? [] : []);
    } catch {
      if (requestId !== suggestionRequestRef.current) return;
      setSuggestions([]);
    }
  };

  const saveItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() && !nameEn.trim()) {
      setError("Bitte mindestens einen Namen pflegen.");
      return;
    }
    setError(null);
    setMessage(null);
    const response = await apiFetch(
      selectedItem ? `${API_BASE_URL}/nutrition/food-items/${selectedItem.id}` : `${API_BASE_URL}/nutrition/food-items`,
      {
        method: selectedItem ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      },
    );
    const body = await parseJsonSafely<FoodItem | { detail?: string }>(response);
    if (!response.ok) {
      setError(body && "detail" in body && body.detail ? body.detail : "Speichern fehlgeschlagen.");
      return;
    }
    const saved = body as FoodItem;
    loadIntoForm(saved);
    setQuery(saved.name);
    setMessage(isProductsView ? "Produkt gespeichert." : "Zutat gespeichert.");
    await loadCounts(saved.name, selectedKind);
    await loadSuggestions(saved.name, selectedKind);
  };

  const copyLlmPrompt = async () => {
    const lookupName = nameEn.trim() || name.trim();
    if (!lookupName) {
      setError("Bitte zuerst einen Namen eingeben.");
      return;
    }
    const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items/llm-prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: lookupName, brand: brand.trim() || null, category: category || null }),
    });
    const body = await parseJsonSafely<{ prompt: string } | { detail?: string }>(response);
    if (!response.ok || !body || !("prompt" in body)) {
      setError(body && "detail" in body && body.detail ? body.detail : "Prompt konnte nicht erzeugt werden.");
      return;
    }
    await navigator.clipboard.writeText(body.prompt);
    setMessage("LLM-Prompt in die Zwischenablage kopiert.");
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
    const imported = body as FoodItem;
    loadIntoForm(imported);
    setQuery(imported.name);
    setLlmRawText("");
    setMessage("Zutat aus LLM-JSON importiert.");
    await loadCounts(imported.name, selectedKind);
    await loadSuggestions(imported.name, selectedKind);
  };

  useEffect(() => {
    if (!activeCategories.includes(selectedCategory)) setSelectedCategory("Alle");
    if (!activeCategories.includes(category)) setCategory(defaultCategory);
  }, [activeCategories, category, defaultCategory, selectedCategory]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCounts(query, selectedKind);
      void loadSuggestions(query, selectedKind);
    }, 180);
    return () => clearTimeout(timer);
  }, [activeCategories, query, selectedKind]);

  const renderNumberField = (key: keyof NumericFields, label: string) => (
    <label className="settings-label" key={key}>
      {label}
      <input
        className="settings-input"
        type="number"
        value={numbers[key]}
        onChange={(event) => setNumbers((prev) => ({ ...prev, [key]: event.target.value }))}
      />
    </label>
  );

  const renderDetailField = (field: DetailField) => (
    <label className="settings-label" key={field.key}>
      {field.label} / 100g ({field.unit})
      <input
        className="settings-input"
        type="number"
        value={detailValues[field.key] || ""}
        onChange={(event) => setDetailValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
      />
    </label>
  );

  return (
    <section className="page">
      <div className="hero ingredients-hero">
        <div className="ingredients-hero-head">
          <div>
            <p className="eyebrow">Ernährung</p>
            <h1>{isProductsView ? "Produkte" : "Zutaten"}</h1>
            <p className="lead">
              {isProductsView
                ? "Produktdaten mit Marke, Barcode und nachvollziehbarer Herkunft der Nährwerte."
                : "Zutaten mit Makros, Mikronährstoffen und klarer Gesundheits-Einordnung pflegen."}
            </p>
          </div>
          <div className="ingredients-hero-search">
            <label className="settings-label">
              Suche
              <input
                className="settings-input ingredients-search-input"
                value={query}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setQuery(nextValue);
                  setSearchFocused(true);
                  if (selectedItem && nextValue.trim() !== (selectedItem.name || "").trim()) {
                    setSelectedItem(null);
                  }
                }}
                onFocus={() => {
                  setSearchFocused(true);
                  void loadSuggestions(query, selectedKind);
                }}
                onBlur={() => setTimeout(() => setSearchFocused(false), 140)}
                placeholder={isProductsView ? "Name, Marke oder Barcode" : "Zutat suchen"}
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
                      }}
                    >
                      <strong>{suggestion.name}</strong>
                      <span>{[suggestion.category, isProductsView ? suggestion.brand : null, suggestion.source_label || suggestion.source_type].filter(Boolean).join(" · ")}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>
            <div className="ingredients-search-meta">
              <span>{resultCount} Treffer</span>
              <span>{selectedCategory === "Alle" ? "Alle Kategorien" : selectedCategory}</span>
              <span>{selectedItem ? `Aktiv: ${selectedItem.name}` : "Neue Eingabe"}</span>
            </div>
          </div>
        </div>

        <div className="ingredients-category-row">
          {activeCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={cat === selectedCategory ? "ingredients-category-pill active" : "ingredients-category-pill"}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat} <span>{categoryCounts[cat] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <form className="ingredients-editor" onSubmit={(event) => void saveItem(event)}>
        <section className="card ingredients-section">
          <div className="section-title-row">
            <div>
              <h2>Basis Infos</h2>
              <p className="lead">Name, Typ, Kategorie, Sichtbarkeit und der visuelle Health-Indikator.</p>
            </div>
          </div>
          <div className="ingredients-basis-layout">
            <div className="ingredients-basis-grid">
              <label className="settings-label">
                Name DE
                <input className="settings-input" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="settings-label">
                Name EN / USDA
                <input className="settings-input" value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
              </label>
              <label className="settings-label">
                Typ
                <input className="settings-input" value={isProductsView ? "Produkt" : "Basiszutat"} readOnly />
              </label>
              <label className="settings-label">
                Kategorie
                <select className="settings-input" value={category} onChange={(event) => setCategory(event.target.value)}>
                  {activeCategories.filter((cat) => cat !== "Alle").map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-label">
                Sichtbarkeit
                <select className="settings-input" value={scope} onChange={(event) => setScope(event.target.value as "global" | "user")}>
                  <option value="user">Nur für mich</option>
                  <option value="global">Globaler Katalog</option>
                </select>
              </label>
              {isProductsView ? (
                <label className="settings-label">
                  Marke / Hersteller
                  <input className="settings-input" value={brand} onChange={(event) => setBrand(event.target.value)} />
                </label>
              ) : null}
              {isProductsView ? (
                <label className="settings-label">
                  Barcode
                  <input className="settings-input" value={barcode} onChange={(event) => setBarcode(event.target.value)} />
                </label>
              ) : null}
            </div>

            <aside className="ingredients-health-card">
              <span className={`health-indicator-badge ${healthInfo.tone}`}>{healthInfo.label}</span>
              <strong>Health Einschätzung</strong>
              <p>{healthInfo.subtitle}</p>
              <label className="settings-label">
                Visueller Indikator
                <select className="settings-input" value={healthIndicator} onChange={(event) => setHealthIndicator(event.target.value as HealthIndicator)}>
                  <option value="very_positive">Sehr positiv</option>
                  <option value="neutral">Neutral</option>
                  <option value="counterproductive">Eher kontraproduktiv</option>
                </select>
              </label>
              <div className="settings-status-grid">
                <div className="settings-status-chip">
                  <span>Quelle</span>
                  <strong>{selectedItem?.source_label || selectedItem?.source_type || "manuell"}</strong>
                </div>
                <div className="settings-status-chip">
                  <span>Override</span>
                  <strong>{selectedItem?.has_user_override ? "Ja" : "Nein"}</strong>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="card ingredients-section">
          <div className="section-title-row">
            <div>
              <h2>Hauptinfos</h2>
              <p className="lead">Makros und Basiswerte, die für Alltag und Auswertung direkt relevant sind.</p>
            </div>
          </div>
          <div className="ingredients-macro-grid">
            {NUMERIC_FIELDS.map((field) => renderNumberField(field.key, field.label))}
          </div>
        </section>

        <section className="card ingredients-section">
          <div className="section-title-row">
            <div>
              <h2>Herkunft der Informationen</h2>
              <p className="lead">Quellenlage, Trustlevel, Verifizierung und USDA-Bezug.</p>
            </div>
          </div>
          <div className="ingredients-origin-grid">
            <label className="settings-label">
              Herkunft
              <select className="settings-input" value={originType} onChange={(event) => setOriginType(event.target.value)}>
                <option value="trusted_source">Trusted Source</option>
                <option value="manufacturer">Hersteller</option>
                <option value="community">Community</option>
                <option value="llm">LLM</option>
                <option value="user_self">Selbst erfasst</option>
              </select>
            </label>
            <label className="settings-label">
              Trust Level
              <select className="settings-input" value={trustLevel} onChange={(event) => setTrustLevel(event.target.value)}>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </label>
            <label className="settings-label">
              Verifizierung
              <select className="settings-input" value={verificationStatus} onChange={(event) => setVerificationStatus(event.target.value)}>
                <option value="unverified">unverified</option>
                <option value="source_linked">source_linked</option>
                <option value="reviewed">reviewed</option>
                <option value="verified">verified</option>
              </select>
            </label>
            <label className="settings-label">
              USDA Status
              <select className="settings-input" value={usdaStatus} onChange={(event) => setUsdaStatus(event.target.value)}>
                <option value="unknown">unknown</option>
                <option value="valid">valid</option>
                <option value="valid_unknown">valid_unknown</option>
              </select>
            </label>
            <label className="settings-label">
              Quellen-Label
              <input className="settings-input" value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} />
            </label>
            <label className="settings-label">
              Quellen-URL
              <input className="settings-input" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
            </label>
            <div className="settings-status-chip">
              <span>Quellart</span>
              <strong>{prettifyOriginType(selectedItem?.source_type || originType)}</strong>
            </div>
            <div className="settings-status-chip">
              <span>Aktive Health-Wertung</span>
              <strong>{healthInfo.label}</strong>
            </div>
          </div>
        </section>

        <div className="ingredients-details-columns">
          <section className="card ingredients-section">
            <div className="section-title-row">
              <div>
                <h2>Weitere Inhaltsstoffe 1</h2>
                <p className="lead">Fette, Zuckerformen und wichtige Mineralstoffe für die Alltagsbewertung.</p>
              </div>
            </div>
            <div className="ingredients-details-grid">{DETAIL_GROUP_ONE.map(renderDetailField)}</div>
          </section>

          <section className="card ingredients-section">
            <div className="section-title-row">
              <div>
                <h2>Inhaltsstoffe 2</h2>
                <p className="lead">Vitamine und Mikronährstoffe für gesundheitsbewusste Nutzer.</p>
              </div>
            </div>
            <div className="ingredients-details-grid">{DETAIL_GROUP_TWO.map(renderDetailField)}</div>
          </section>
        </div>

        <section className="card ingredients-section">
          <div className="section-title-row">
            <div>
              <h2>LLM</h2>
              <p className="lead">Prompt erzeugen, JSON einfügen und strukturierte Werte direkt übernehmen.</p>
            </div>
          </div>
          <label className="settings-label">
            LLM JSON
            <textarea className="settings-input" rows={10} value={llmRawText} onChange={(event) => setLlmRawText(event.target.value)} />
          </label>
          <div className="settings-actions">
            <button className="primary-button" type="submit">
              {selectedItem ? (isProductsView ? "Produkt aktualisieren" : "Zutat aktualisieren") : isProductsView ? "Produkt speichern" : "Zutat speichern"}
            </button>
            <button className="secondary-button" type="button" onClick={resetForm}>
              {isProductsView ? "Neues Produkt" : "Neue Zutat"}
            </button>
            <button className="secondary-button" type="button" onClick={() => void copyLlmPrompt()}>
              Prompt kopieren
            </button>
            <button className="secondary-button" type="button" onClick={() => void importFromLlm()}>
              JSON importieren
            </button>
          </div>
          {selectedItem ? (
            <p className="info-text">
              Aktiv geladen: <strong>{selectedItem.name}</strong> - {selectedItem.category || "ohne Kategorie"} - {selectedItem.source_label || selectedItem.source_type || "manuell"}
            </p>
          ) : null}
          {error ? <p className="error-text">{error}</p> : null}
          {message ? <p className="info-text">{message}</p> : null}
        </section>
      </form>
    </section>
  );
}
