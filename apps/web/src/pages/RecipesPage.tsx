import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type FoodItem = {
  id: string;
  name: string;
  item_kind: "base_ingredient" | "product";
  brand?: string | null;
  category?: string | null;
  base_name?: string | null;
  variant_label?: string | null;
  is_variant?: boolean;
  piece_weight_g?: number | null;
};

type FoodItemDetail = FoodItem & {
  source_label?: string | null;
  source_type?: string | null;
  usda_status?: string | null;
  health_indicator?: "very_positive" | "neutral" | "counterproductive" | null;
  kcal_per_100g?: number | null;
  protein_per_100g?: number | null;
  carbs_per_100g?: number | null;
  fat_per_100g?: number | null;
  details?: Record<string, unknown>;
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
  preparation: string | null;
  visibility: "private" | "public";
  is_favorite: boolean;
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

type AmountUnit = "g" | "ml" | "el" | "tl" | "stk";

type DraftItem = {
  food_item_id: string;
  label: string;
  category?: string | null;
  base_name?: string | null;
  variant_label?: string | null;
  piece_weight_g?: number | null;
  amount: string;
  unit: AmountUnit;
};

type RecipeSortKey = "name" | "protein" | "carbs" | "kcal";
type SortDirection = "asc" | "desc";
type PreviewDisplayMode = "recipe" | "per100g";

type DetailField = { key: string; label: string; unit: string };

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

const UNIT_OPTIONS: Array<{ value: AmountUnit; label: string }> = [
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "el", label: "EL" },
  { value: "tl", label: "TL" },
  { value: "stk", label: "Stk" },
];

function round(value: number | null | undefined): number {
  return Math.round(Number(value || 0));
}

function round1(value: number | null | undefined): number {
  return Math.round(Number(value || 0) * 10) / 10;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function valuePer100(totalValue: number | null | undefined, totalWeight: number): number {
  if (!Number.isFinite(Number(totalValue)) || totalWeight <= 0) return 0;
  return (Number(totalValue || 0) / totalWeight) * 100;
}

function formatPer100Value(value: number | null | undefined, unit: string): string {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return `0 ${unit}`;
  if (unit === "g") {
    const abs = Math.abs(numeric);
    if (abs >= 1) return `${round1(numeric)} g`;
    if (abs >= 0.001) return `${Math.round(numeric * 1000)} mg`;
    return `${Math.round(numeric * 1000000)} µg`;
  }
  if (unit === "mg") {
    const abs = Math.abs(numeric);
    if (abs >= 1) return `${round1(numeric)} mg`;
    return `${Math.round(numeric * 1000)} µg`;
  }
  if (unit === "µg" || unit === "Âµg") {
    return `${round1(numeric)} µg`;
  }
  return `${round1(numeric)} ${unit}`;
}

function formatDisplayValue(
  totalValue: number | null | undefined,
  totalWeight: number,
  unit: string,
  mode: PreviewDisplayMode,
): string {
  if (mode === "per100g") {
    return formatPer100Value(valuePer100(totalValue, totalWeight), unit);
  }
  const numeric = Number(totalValue || 0);
  if (!Number.isFinite(numeric)) return `0 ${unit}`;
  if (unit === "g") {
    const abs = Math.abs(numeric);
    if (abs >= 1) return `${round1(numeric)} g`;
    if (abs >= 0.001) return `${Math.round(numeric * 1000)} mg`;
    return `${Math.round(numeric * 1000000)} µg`;
  }
  if (unit === "mg") {
    const abs = Math.abs(numeric);
    if (abs >= 1) return `${round1(numeric)} mg`;
    return `${Math.round(numeric * 1000)} µg`;
  }
  if (unit === "µg" || unit === "Âµg") {
    return `${round1(numeric)} µg`;
  }
  return `${round1(numeric)} ${unit}`;
}

function coverageMeta(knownCount: number, partialCount: number, unknownCount: number) {
  if (unknownCount === 0) {
    return {
      label: "Gut abgedeckt",
      tone: "up",
      icon: "👍",
      detail: `${knownCount} Zutaten gut bekannt, ${partialCount} teilweise bekannt, ${unknownCount} noch dünn dokumentiert.`,
    };
  }
  if (partialCount > 0) {
    return {
      label: "Teilweise abgedeckt",
      tone: "flat",
      icon: "➜",
      detail: `${knownCount} Zutaten gut bekannt, ${partialCount} teilweise bekannt, ${unknownCount} noch dünn dokumentiert.`,
    };
  }
  return {
    label: "Dünn dokumentiert",
    tone: "down",
    icon: "👎",
    detail: `${knownCount} Zutaten gut bekannt, ${partialCount} teilweise bekannt, ${unknownCount} noch dünn dokumentiert.`,
  };
}

function amountToGrams(item: DraftItem): number {
  const raw = Number(item.amount || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (item.unit === "g") return raw;
  if (item.unit === "stk") {
    if (item.piece_weight_g && item.piece_weight_g > 0) return raw * item.piece_weight_g;
    const lowerBase = (item.base_name || item.label).toLowerCase();
    const lowerVariant = (item.variant_label || "").toLowerCase();
    if (lowerBase === "ei") {
      if (lowerVariant === "klein") return raw * 44;
      if (lowerVariant === "gross" || lowerVariant === "groß") return raw * 63;
      return raw * 53;
    }
    return raw * 100;
  }

  const lower = item.label.toLowerCase();
  const category = (item.category || "").toLowerCase();
  const isLiquid =
    item.unit === "ml" ||
    category.includes("getränk") ||
    lower.includes("öl") ||
    lower.includes("milk") ||
    lower.includes("milch") ||
    lower.includes("wasser") ||
    lower.includes("juice") ||
    lower.includes("saft") ||
    lower.includes("essig") ||
    lower.includes("brühe") ||
    lower.includes("joghurt");

  let milliliters = raw;
  if (item.unit === "el") milliliters = raw * 15;
  if (item.unit === "tl") milliliters = raw * 5;

  if (isLiquid) {
    if (lower.includes("öl")) return milliliters * 0.92;
    if (lower.includes("honig")) return milliliters * 1.4;
    return milliliters;
  }

  if (item.unit === "ml") return raw;
  if (lower.includes("gewürz") || lower.includes("curry") || lower.includes("zimt") || lower.includes("paprika")) {
    return milliliters * 0.45;
  }
  if (lower.includes("haferflocken") || lower.includes("mehl") || lower.includes("grieß") || lower.includes("reis")) {
    return milliliters * 0.55;
  }
  if (lower.includes("chiasamen") || lower.includes("leinsamen") || lower.includes("hanfsamen")) {
    return milliliters * 0.7;
  }
  return milliliters * 0.65;
}

function formatFoodItemSuggestion(item: FoodItem): string {
  if (item.base_name && item.variant_label) return `${item.base_name} (${item.variant_label})`;
  return item.name;
}

export function RecipesPage() {
  const hoverCloseTimeoutRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const [openMenuRecipeId, setOpenMenuRecipeId] = useState<string | null>(null);
  const [hoveredRecipeId, setHoveredRecipeId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Recipe | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [hoverCardPosition, setHoverCardPosition] = useState<{ top: number; left: number } | null>(null);

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [preparation, setPreparation] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [showPrivate, setShowPrivate] = useState(true);
  const [showPublic, setShowPublic] = useState(true);
  const [sortBy, setSortBy] = useState<RecipeSortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const [ingredientSearch, setIngredientSearch] = useState("");
  const [recipeSearch, setRecipeSearch] = useState("");
  const [suggestions, setSuggestions] = useState<FoodItem[]>([]);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDetailsById, setPreviewDetailsById] = useState<Record<string, FoodItemDetail>>({});
  const [previewDisplayMode, setPreviewDisplayMode] = useState<PreviewDisplayMode>("per100g");

  const visibleRecipes = useMemo(
    () =>
      recipes.filter((recipe) => {
        if (recipe.visibility === "private") return showPrivate;
        const visibilityVisible = showPublic;
        if (!visibilityVisible) return false;
        return true;
      }),
    [recipes, showPrivate, showPublic],
  );
  const filteredRecipes = useMemo(
    () => visibleRecipes.filter((recipe) => (!favoriteOnly ? true : recipe.is_favorite)),
    [favoriteOnly, visibleRecipes],
  );
  const sortedRecipes = useMemo(() => {
    const entries = [...filteredRecipes];
    entries.sort((a, b) => {
      const directionFactor = sortDirection === "asc" ? 1 : -1;
      if (sortBy === "protein") {
        return (((a.protein_per_100g || 0) - (b.protein_per_100g || 0)) * directionFactor) || a.name.localeCompare(b.name, "de");
      }
      if (sortBy === "carbs") {
        return (((a.carbs_per_100g || 0) - (b.carbs_per_100g || 0)) * directionFactor) || a.name.localeCompare(b.name, "de");
      }
      if (sortBy === "kcal") {
        return (((a.kcal_per_100g || 0) - (b.kcal_per_100g || 0)) * directionFactor) || a.name.localeCompare(b.name, "de");
      }
      return a.name.localeCompare(b.name, "de") * directionFactor;
    });
    return entries;
  }, [sortBy, sortDirection, filteredRecipes]);
  const activeRecipe = useMemo(() => sortedRecipes.find((recipe) => recipe.id === activeRecipeId) || null, [activeRecipeId, sortedRecipes]);
  const previewRecipe = useMemo(
    () => sortedRecipes.find((recipe) => recipe.id === (openMenuRecipeId || hoveredRecipeId)) || null,
    [hoveredRecipeId, openMenuRecipeId, sortedRecipes],
  );

  function toggleSort(nextKey: RecipeSortKey) {
    if (sortBy === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(nextKey);
    setSortDirection(nextKey === "name" ? "asc" : "desc");
  }

  function sortShortLabel(current: RecipeSortKey) {
    if (current === "protein") return "Prot";
    if (current === "carbs") return "Carb";
    if (current === "kcal") return "kcal";
    return "Name";
  }

  function cancelHoverClose() {
    if (hoverCloseTimeoutRef.current != null) {
      window.clearTimeout(hoverCloseTimeoutRef.current);
      hoverCloseTimeoutRef.current = null;
    }
  }

  function scheduleHoverClose() {
    cancelHoverClose();
    hoverCloseTimeoutRef.current = window.setTimeout(() => {
      if (!openMenuRecipeId) {
        setHoveredRecipeId(null);
        setHoverCardPosition(null);
      }
      hoverCloseTimeoutRef.current = null;
    }, 120);
  }

  function openRecipeHover(recipeId: string, anchor: HTMLElement) {
    cancelHoverClose();
    const rect = anchor.getBoundingClientRect();
    setHoveredRecipeId(recipeId);
    setHoverCardPosition({
      top: Math.max(16, rect.top - 6),
      left: Math.max(24, rect.left - 356),
    });
  }

  async function loadRecipes(query = recipeSearch.trim()) {
    setLoading(true);
    try {
      setOpenMenuRecipeId(null);
      setMenuPosition(null);
      const url = query ? `${API_BASE_URL}/nutrition/recipes?q=${encodeURIComponent(query)}` : `${API_BASE_URL}/nutrition/recipes`;
      const response = await apiFetch(url);
      const payload = (await response.json()) as { recipes?: Recipe[]; detail?: string };
      if (!response.ok) throw new Error(payload.detail || "Rezepte konnten nicht geladen werden.");
      setRecipes(payload.recipes || []);
      setActiveRecipeId((prev) => (prev && (payload.recipes || []).some((recipe) => recipe.id === prev) ? prev : payload.recipes?.[0]?.id || null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function searchItems(query: string) {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items?q=${encodeURIComponent(query)}&limit=8`);
    const payload = (await response.json()) as { items?: FoodItem[]; detail?: string };
    if (!response.ok) throw new Error(payload.detail || "Suche fehlgeschlagen.");
    setSuggestions(payload.items || []);
  }

  function resetForm() {
    setHoveredRecipeId(null);
    setHoverCardPosition(null);
    setOpenMenuRecipeId(null);
    setActiveRecipeId(null);
    setName("");
    setNotes("");
    setPreparation("");
    setVisibility("private");
    setIsFavorite(false);
    setDraftItems([]);
    setIngredientSearch("");
    setSuggestions([]);
  }

  function loadRecipeIntoForm(recipe: Recipe) {
    setHoveredRecipeId(recipe.id);
    setOpenMenuRecipeId(null);
    setMenuPosition(null);
    setActiveRecipeId(recipe.id);
    setName(recipe.name);
    setNotes(recipe.notes || "");
    setPreparation(recipe.preparation || "");
    setVisibility(recipe.visibility);
    setIsFavorite(Boolean(recipe.is_favorite));
    setDraftItems(
      recipe.items.map((item) => ({
        food_item_id: item.food_item_id,
        label: item.food_name,
        base_name: item.food_name,
        variant_label: null,
        piece_weight_g: null,
        amount: String(round(item.amount_g)),
        unit: "g",
      })),
    );
  }

  function addDraftItem(item: FoodItem) {
    setDraftItems((prev) => [
      ...prev,
      {
        food_item_id: item.id,
        label: formatFoodItemSuggestion(item),
        category: item.category,
        base_name: item.base_name || item.name,
        variant_label: item.variant_label || null,
        piece_weight_g: item.piece_weight_g ?? null,
        amount: item.piece_weight_g ? "1" : "100",
        unit: item.piece_weight_g ? "stk" : "g",
      },
    ]);
    setIngredientSearch("");
    setSuggestions([]);
  }

  function updateDraftItem(index: number, patch: Partial<DraftItem>) {
    setDraftItems((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeDraftItem(index: number) {
    setDraftItems((prev) => prev.filter((_, i) => i !== index));
  }

  function ingredientKnowledge(item: FoodItemDetail | undefined) {
    if (!item) return { label: "Unbekannt", tone: "counterproductive", detailCount: 0 };
    const macroCount = [item.kcal_per_100g, item.protein_per_100g, item.carbs_per_100g, item.fat_per_100g].filter(
      (value) => value != null,
    ).length;
    const detailCount = Object.entries(item.details || {}).filter(([key, value]) => {
      if (key === "usda" || key === "health_assessment" || key === "catalog_version" || key === "seed_note" || key === "seeded_at") {
        return false;
      }
      return typeof value === "number" && Number.isFinite(value);
    }).length;
    if (macroCount === 4 && (detailCount >= 3 || item.usda_status === "valid")) {
      return { label: "Gut bekannt", tone: "very_positive", detailCount };
    }
    if (macroCount >= 3 || detailCount >= 1) {
      return { label: "Teilweise bekannt", tone: "neutral", detailCount };
    }
    return { label: "Noch dünn", tone: "counterproductive", detailCount };
  }

  async function openPreview() {
    if (!activeRecipeId) {
      setError("Bitte zuerst ein Rezept auswählen.");
      return;
    }
    if (draftItems.length === 0) {
      setError("Bitte zuerst Zutaten zum Rezept hinzufügen.");
      return;
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    setError(null);
    try {
      const uniqueIds = Array.from(new Set(draftItems.map((item) => item.food_item_id)));
      const entries = await Promise.all(
        uniqueIds.map(async (id) => {
          const response = await apiFetch(`${API_BASE_URL}/nutrition/food-items/${id}`);
          const payload = (await response.json()) as FoodItemDetail | { detail?: string };
          if (!response.ok) throw new Error("detail" in payload && payload.detail ? payload.detail : "Zutatendetails konnten nicht geladen werden.");
          return [id, payload as FoodItemDetail] as const;
        }),
      );
      setPreviewDetailsById(Object.fromEntries(entries));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function saveRecipe(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) {
      setError("Bitte einen Rezeptnamen eingeben.");
      return;
    }
    if (draftItems.length === 0) {
      setError("Bitte mindestens eine Zutat oder ein Produkt hinzufügen.");
      return;
    }

    const items = draftItems
      .map((row, index) => ({
        food_item_id: row.food_item_id,
        amount_g: amountToGrams(row),
        sort_index: index,
      }))
      .filter((row) => row.amount_g > 0);

    if (items.length === 0) {
      setError("Bitte gültige Mengen eingeben.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: name.trim(),
        notes: notes.trim() || null,
        preparation: preparation.trim() || null,
        visibility,
        is_favorite: isFavorite,
        items,
      };
      const url = activeRecipeId ? `${API_BASE_URL}/nutrition/recipes/${activeRecipeId}` : `${API_BASE_URL}/nutrition/recipes`;
      const method = activeRecipeId ? "PATCH" : "POST";
      const response = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as Recipe | { detail?: string };
      if (!response.ok) throw new Error("detail" in body && body.detail ? body.detail : "Rezept konnte nicht gespeichert werden.");
      const recipe = body as Recipe;
      setOpenMenuRecipeId(null);
      setMenuPosition(null);
      setMessage(activeRecipeId ? "Rezept aktualisiert." : "Rezept gespeichert.");
      await loadRecipes(recipeSearch.trim());
      loadRecipeIntoForm(recipe);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecipe(recipe: Recipe) {
    setError(null);
    setMessage(null);
    setOpenMenuRecipeId(null);
    setMenuPosition(null);
    setHoveredRecipeId(null);
    setHoverCardPosition(null);
    const response = await apiFetch(`${API_BASE_URL}/nutrition/recipes/${recipe.id}`, { method: "DELETE" });
    const body = (await response.json()) as { detail?: string };
    if (!response.ok) {
      setError(body.detail || "Rezept konnte nicht gelöscht werden.");
      return;
    }
    if (activeRecipeId === recipe.id) {
      resetForm();
    }
    setDeleteCandidate(null);
    setMessage("Rezept gelöscht.");
    await loadRecipes(recipeSearch.trim());
  }

  async function duplicateRecipe(recipe: Recipe) {
    setError(null);
    setMessage(null);
    setOpenMenuRecipeId(null);
    setMenuPosition(null);
    setHoveredRecipeId(null);
    setHoverCardPosition(null);
    const payload = {
      name: `${recipe.name} Kopie`,
      notes: recipe.notes,
      preparation: recipe.preparation,
      visibility: "private",
      is_favorite: false,
      items: recipe.items.map((item, index) => ({
        food_item_id: item.food_item_id,
        amount_g: item.amount_g,
        sort_index: index,
      })),
    };
    const response = await apiFetch(`${API_BASE_URL}/nutrition/recipes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as Recipe | { detail?: string };
    if (!response.ok) {
      setError("detail" in body && body.detail ? body.detail : "Rezept konnte nicht dupliziert werden.");
      return;
    }
    const duplicated = body as Recipe;
    setMessage("Rezept dupliziert.");
    await loadRecipes(recipeSearch.trim());
    loadRecipeIntoForm(duplicated);
  }

  async function setRecipeFavorite(recipe: Recipe, nextFavorite: boolean) {
    setError(null);
    const response = await apiFetch(`${API_BASE_URL}/nutrition/recipes/${recipe.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorite: nextFavorite }),
    });
    const body = (await response.json()) as Recipe | { detail?: string };
    if (!response.ok) {
      setError("detail" in body && body.detail ? body.detail : "Favorit konnte nicht gespeichert werden.");
      return;
    }
    await loadRecipes(recipeSearch.trim());
    if (activeRecipeId === recipe.id) {
      setIsFavorite(nextFavorite);
      loadRecipeIntoForm(body as Recipe);
    }
  }

  useEffect(() => {
    void loadRecipes();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void searchItems(ingredientSearch).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unknown error");
      });
    }, 180);
    return () => window.clearTimeout(t);
  }, [ingredientSearch]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadRecipes(recipeSearch.trim());
    }, 180);
    return () => window.clearTimeout(t);
  }, [recipeSearch]);

  useEffect(
    () => () => {
      cancelHoverClose();
    },
    [],
  );

  useEffect(() => {
    if (activeRecipeId && !sortedRecipes.some((recipe) => recipe.id === activeRecipeId)) {
      setActiveRecipeId(sortedRecipes[0]?.id || null);
    }
    if (hoveredRecipeId && !sortedRecipes.some((recipe) => recipe.id === hoveredRecipeId)) {
      setHoveredRecipeId(null);
      setHoverCardPosition(null);
    }
    if (openMenuRecipeId && !sortedRecipes.some((recipe) => recipe.id === openMenuRecipeId)) {
      setOpenMenuRecipeId(null);
      setMenuPosition(null);
    }
  }, [activeRecipeId, hoveredRecipeId, openMenuRecipeId, sortedRecipes]);

  useEffect(() => {
    if (!sortMenuOpen) return;
    const close = () => setSortMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [sortMenuOpen]);

  const hasSuggestions = useMemo(() => suggestions.length > 0 && ingredientSearch.trim().length > 0, [suggestions, ingredientSearch]);
  const previewRows = useMemo(
    () =>
      draftItems.map((row) => {
        const detail = previewDetailsById[row.food_item_id];
        const amountG = amountToGrams(row);
        const kcal = detail?.kcal_per_100g != null ? (detail.kcal_per_100g * amountG) / 100 : null;
        const protein = detail?.protein_per_100g != null ? (detail.protein_per_100g * amountG) / 100 : null;
        const carbs = detail?.carbs_per_100g != null ? (detail.carbs_per_100g * amountG) / 100 : null;
        const fat = detail?.fat_per_100g != null ? (detail.fat_per_100g * amountG) / 100 : null;
        return { row, detail, amountG, kcal, protein, carbs, fat, knowledge: ingredientKnowledge(detail) };
      }),
    [draftItems, previewDetailsById],
  );
  const previewKnownCount = previewRows.filter((entry) => entry.knowledge.tone === "very_positive").length;
  const previewPartialCount = previewRows.filter((entry) => entry.knowledge.tone === "neutral").length;
  const previewUnknownCount = previewRows.filter((entry) => entry.knowledge.tone === "counterproductive").length;
  const previewTotalWeight = previewRows.reduce((sum, entry) => sum + entry.amountG, 0);
  const previewCoverage = coverageMeta(previewKnownCount, previewPartialCount, previewUnknownCount);
  const previewTotals = useMemo(() => {
    const totals: Record<string, number> = {
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      sugar: 0,
      starch: 0,
      saturated_fat: 0,
      monounsaturated_fat: 0,
      polyunsaturated_fat: 0,
      sodium: 0,
      potassium: 0,
    };
    const details = Object.fromEntries([...DETAIL_GROUP_ONE, ...DETAIL_GROUP_TWO].map((field) => [field.key, 0])) as Record<string, number>;

    for (const entry of previewRows) {
      const detail = entry.detail;
      const factor = entry.amountG / 100;
      if (!detail || factor <= 0) continue;
      totals.kcal += (detail.kcal_per_100g || 0) * factor;
      totals.protein += (detail.protein_per_100g || 0) * factor;
      totals.carbs += (detail.carbs_per_100g || 0) * factor;
      totals.fat += (detail.fat_per_100g || 0) * factor;
      totals.fiber += (num((detail as Record<string, unknown>).fiber_per_100g) || 0) * factor;
      totals.sugar += (num((detail as Record<string, unknown>).sugar_per_100g) || 0) * factor;
      totals.starch += (num((detail as Record<string, unknown>).starch_per_100g) || 0) * factor;
      totals.saturated_fat += (num((detail as Record<string, unknown>).saturated_fat_per_100g) || 0) * factor;
      totals.monounsaturated_fat += (num((detail as Record<string, unknown>).monounsaturated_fat_per_100g) || 0) * factor;
      totals.polyunsaturated_fat += (num((detail as Record<string, unknown>).polyunsaturated_fat_per_100g) || 0) * factor;
      totals.sodium += (num((detail as Record<string, unknown>).sodium_mg_per_100g) || 0) * factor;
      totals.potassium += (num((detail as Record<string, unknown>).potassium_mg_per_100g) || 0) * factor;
      for (const field of [...DETAIL_GROUP_ONE, ...DETAIL_GROUP_TWO]) {
        details[field.key] += (num(detail.details?.[field.key]) || 0) * factor;
      }
    }
    return { totals, details };
  }, [previewRows]);

  return (
    <section
      className="page"
      onClick={() => {
        setOpenMenuRecipeId(null);
        setMenuPosition(null);
      }}
    >
      <div className="hero">
        <p className="eyebrow">Ernährung</p>
        <h1>Rezepte</h1>
        <p className="lead">Rezepte bauen, wiederfinden, öffentlich teilen und direkt als Mahlzeit übernehmen.</p>
      </div>

      <div className="ingredients-layout recipes-layout">
        <div className="recipes-editor-stack">
          <div className="card">
            <div className="section-title-row">
              <h2>{activeRecipeId ? "Rezept bearbeiten" : "Rezept erstellen"}</h2>
              <div className="settings-actions">
                <button className="secondary-button" type="button" onClick={resetForm}>
                  Neues Rezept
                </button>
              </div>
            </div>

            <form className="nutrition-form" onSubmit={(event) => void saveRecipe(event)}>
              <label className="settings-label">
                Name
                <input className="settings-input" value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
              <div className="settings-label">
                Sichtbarkeit
                <div className="recipe-visibility-control">
                  <select className="settings-input" value={visibility} onChange={(event) => setVisibility(event.target.value as "private" | "public")}>
                    <option value="private">Nur für mich</option>
                    <option value="public">Öffentlich</option>
                  </select>
                  <button
                    className={isFavorite ? "recipe-inline-star active" : "recipe-inline-star"}
                    type="button"
                    onClick={() => setIsFavorite((prev) => !prev)}
                    title={isFavorite ? "Favorit entfernen" : "Als Favorit markieren"}
                  >
                    ★
                  </button>
                </div>
              </div>
              <label className="settings-label nutrition-span-2">
                Notizen
                <input className="settings-input" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <label className="settings-label nutrition-span-2">
                Zubereitung
                <textarea className="settings-input settings-textarea" value={preparation} onChange={(event) => setPreparation(event.target.value)} rows={4} />
              </label>
              <label className="settings-label nutrition-span-2">
                Zutat oder Produkt suchen
                <input
                  className="settings-input"
                  value={ingredientSearch}
                  onChange={(event) => setIngredientSearch(event.target.value)}
                  placeholder="z. B. Kichererbsen, Olivenöl, Joghurt"
                />
                {hasSuggestions ? (
                  <div className="ingredient-suggest-box">
                    {suggestions.map((item) => (
                      <button key={item.id} className="ingredient-suggest-item" type="button" onClick={() => addDraftItem(item)}>
                        <strong>{formatFoodItemSuggestion(item)}</strong>
                        <span>{[item.item_kind === "product" ? "Produkt" : "Zutat", item.category, item.variant_label ? `Variante: ${item.variant_label}` : null, item.brand].filter(Boolean).join(" · ")}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>

              <div className="nutrition-span-2">
                {draftItems.length === 0 ? <p>Noch keine Bestandteile hinzugefügt.</p> : null}
                {draftItems.map((row, index) => (
                  <div key={`${row.food_item_id}-${index}`} className="recipe-draft-row recipe-draft-row-wide">
                    <span>{row.label}</span>
                    <input
                      className="settings-input"
                      type="number"
                      min="0"
                      step="0.1"
                      value={row.amount}
                      onChange={(event) => updateDraftItem(index, { amount: event.target.value })}
                    />
                    <select
                      className="settings-input"
                      value={row.unit}
                      onChange={(event) => updateDraftItem(index, { unit: event.target.value as AmountUnit })}
                    >
                      {UNIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span>{round(amountToGrams(row))} g</span>
                    <button className="icon-button danger" type="button" onClick={() => removeDraftItem(index)} title="Entfernen">
                      x
                    </button>
                  </div>
                ))}
              </div>

              <div className="settings-actions nutrition-span-2">
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? "Speichere..." : activeRecipeId ? "Rezept aktualisieren" : "Rezept speichern"}
                </button>
                {activeRecipeId ? (
                  <button className="secondary-button" type="button" onClick={() => void openPreview()}>
                    Übersicht anzeigen
                  </button>
                ) : null}
              </div>
            </form>
          </div>

          {error ? <p className="error-text">{error}</p> : null}
          {message ? <p className="info-text">{message}</p> : null}
        </div>

        <aside className="card ingredients-categories recipes-sidebar">
          <div className="section-title-row">
            <h2>Rezepte</h2>
            <button className="secondary-button" type="button" onClick={() => void loadRecipes(recipeSearch.trim())} disabled={loading}>
              Aktualisieren
            </button>
          </div>
          <label className="settings-label">
            Rezeptsuche
            <input
              className="settings-input"
              value={recipeSearch}
              onChange={(event) => setRecipeSearch(event.target.value)}
              placeholder="Eigene und öffentliche Rezepte suchen"
            />
          </label>
          <div className="recipe-visibility-filters">
            <button
              type="button"
              className={showPrivate ? "recipe-visibility-pill active private" : "recipe-visibility-pill private"}
              onClick={() => setShowPrivate((prev) => !prev)}
            >
              Privat
            </button>
            <button
              type="button"
              className={showPublic ? "recipe-visibility-pill active public" : "recipe-visibility-pill public"}
              onClick={() => setShowPublic((prev) => !prev)}
            >
              Öffentlich
            </button>
            <div className="recipe-sort-wrap" onClick={(event) => event.stopPropagation()}>
              <button className="recipe-sort-chip active" type="button" onClick={() => setSortMenuOpen((prev) => !prev)}>
                {sortShortLabel(sortBy)} {sortDirection === "asc" ? "↑" : "↓"}
              </button>
              {sortMenuOpen ? (
                <div className="recipe-sort-popover">
                  <div className="recipe-sort-grid">
                    <button type="button" className={sortBy === "name" ? "recipe-sort-chip active" : "recipe-sort-chip"} onClick={() => toggleSort("name")}>
                      Name {sortBy === "name" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </button>
                    <button type="button" className={sortBy === "carbs" ? "recipe-sort-chip active" : "recipe-sort-chip"} onClick={() => toggleSort("carbs")}>
                      Carb {sortBy === "carbs" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </button>
                    <button type="button" className={sortBy === "protein" ? "recipe-sort-chip active" : "recipe-sort-chip"} onClick={() => toggleSort("protein")}>
                      Prot {sortBy === "protein" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </button>
                    <button type="button" className={sortBy === "kcal" ? "recipe-sort-chip active" : "recipe-sort-chip"} onClick={() => toggleSort("kcal")}>
                      kcal {sortBy === "kcal" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={favoriteOnly ? "recipe-favorite-filter active" : "recipe-favorite-filter"}
              onClick={() => setFavoriteOnly((prev) => !prev)}
              title="Nur Favoriten anzeigen"
            >
              ★
            </button>
          </div>
          {loading ? <p>Lade Rezepte...</p> : null}
          {!loading && visibleRecipes.length === 0 ? <p>Keine Rezepte gefunden.</p> : null}
          {!loading ? (
            <div className="nutrition-list recipes-list">
              {sortedRecipes.map((recipe) => (
                <div
                  key={recipe.id}
                  className={`recipe-list-item recipe-list-item-${recipe.visibility} ${activeRecipeId === recipe.id ? "selected" : ""}`}
                  onClick={() => loadRecipeIntoForm(recipe)}
                  onMouseEnter={(event) => openRecipeHover(recipe.id, event.currentTarget)}
                  onMouseLeave={() => scheduleHoverClose()}
                  onFocus={(event) => openRecipeHover(recipe.id, event.currentTarget)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      loadRecipeIntoForm(recipe);
                    }
                  }}
                >
                  <span>{recipe.name}</span>
                  <button
                    type="button"
                    className={recipe.is_favorite ? "recipe-inline-star active" : "recipe-inline-star"}
                    onClick={(event) => {
                      event.stopPropagation();
                      void setRecipeFavorite(recipe, !recipe.is_favorite);
                    }}
                    title={recipe.is_favorite ? "Favorit entfernen" : "Als Favorit markieren"}
                  >
                    ★
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>

      {previewRecipe && hoverCardPosition ? (
        <div
          className="recipe-hover-card"
          style={{ top: hoverCardPosition.top, left: hoverCardPosition.left }}
          onMouseEnter={() => cancelHoverClose()}
          onMouseLeave={() => scheduleHoverClose()}
        >
          <div className="nutrition-entry-head recipe-hover-card-head">
            <strong>{previewRecipe.name}</strong>
            <span>{previewRecipe.visibility === "public" ? "Öffentlich" : "Privat"}</span>
            <div className="recipe-card-menu">
              <button
                className="icon-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  cancelHoverClose();
                  const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  const isClosing = openMenuRecipeId === previewRecipe.id;
                  setOpenMenuRecipeId(isClosing ? null : previewRecipe.id);
                  setMenuPosition(
                    isClosing
                      ? null
                      : {
                          top: rect.bottom + 6,
                          left: Math.max(16, rect.right - 180),
                        },
                  );
                }}
                title="Aktionen"
              >
                ...
              </button>
            </div>
          </div>
          <div className="nutrition-entry-summary">
            <span>{round(previewRecipe.total_weight_g)} g</span>
            <span>{round(previewRecipe.kcal)} kcal</span>
            <span>P: {round(previewRecipe.protein_g)} g</span>
            <span>C: {round(previewRecipe.carbs_g)} g</span>
            <span>F: {round(previewRecipe.fat_g)} g</span>
          </div>
          <div className="nutrition-entry-items">
            {previewRecipe.items.slice(0, 5).map((item) => (
              <div className="nutrition-item" key={item.id}>
                <strong>{item.food_name}</strong>
                <span>{round(item.amount_g)} g</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {openMenuRecipeId && menuPosition ? (
        <div
          className="recipe-card-menu-popover recipe-card-menu-popover-floating"
          style={{ top: menuPosition.top, left: menuPosition.left }}
          onClick={(event) => event.stopPropagation()}
        >
          {(() => {
            const recipe = visibleRecipes.find((entry) => entry.id === openMenuRecipeId) || recipes.find((entry) => entry.id === openMenuRecipeId);
            if (!recipe) return null;
            return (
              <>
                <button type="button" className="recipe-card-menu-item" onClick={() => loadRecipeIntoForm(recipe)}>
                  Bearbeiten
                </button>
                <button type="button" className="recipe-card-menu-item" onClick={() => void duplicateRecipe(recipe)}>
                  Duplizieren
                </button>
                <button
                  type="button"
                  className="recipe-card-menu-item danger"
                  onClick={() => {
                    setOpenMenuRecipeId(null);
                    setMenuPosition(null);
                    setDeleteCandidate(recipe);
                  }}
                >
                  Löschen
                </button>
              </>
            );
          })()}
        </div>
      ) : null}

      {deleteCandidate ? (
        <div className="confirm-overlay" onClick={() => setDeleteCandidate(null)}>
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <h2>Rezept löschen</h2>
            <p>
              Soll <strong>{deleteCandidate.name}</strong> wirklich gelöscht werden?
            </p>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" onClick={() => setDeleteCandidate(null)}>
                Abbrechen
              </button>
              <button className="primary-button" type="button" onClick={() => void deleteRecipe(deleteCandidate)}>
                Löschen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewOpen ? (
        <div
          className="confirm-overlay"
          onClick={() => {
            setPreviewOpen(false);
          }}
        >
          <div className="confirm-card recipe-preview-overlay" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <div>
                <h2>Rezeptübersicht</h2>
                <p className="lead">{name.trim() || "Aktueller Rezeptentwurf"}</p>
              </div>
              <div className="recipe-preview-mode-toggle">
                <button
                  type="button"
                  className={previewDisplayMode === "recipe" ? "recipe-preview-mode-button active" : "recipe-preview-mode-button"}
                  onClick={() => setPreviewDisplayMode("recipe")}
                >
                  Rezept
                </button>
                <button
                  type="button"
                  className={previewDisplayMode === "per100g" ? "recipe-preview-mode-button active" : "recipe-preview-mode-button"}
                  onClick={() => setPreviewDisplayMode("per100g")}
                >
                  / 100 g
                </button>
              </div>
              <button className="icon-button" type="button" onClick={() => setPreviewOpen(false)}>
                x
              </button>
            </div>

            {previewLoading ? <p>Lade Zutatendetails...</p> : null}
            {!previewLoading ? (
              <>
                <div className="settings-status-grid">
                  <div className="settings-status-chip">
                    <span>Zutaten gesamt</span>
                    <strong>{previewRows.length}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Gut bekannt</span>
                    <strong>{previewKnownCount}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Teilweise bekannt</span>
                    <strong>{previewPartialCount}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Noch dünn</span>
                    <strong>{previewUnknownCount}</strong>
                  </div>
                </div>

                <section className="card ingredients-section recipe-preview-section">
                  <div className="section-title-row">
                    <div>
                      <h2>Basis Infos</h2>
                      <p className="lead">Zusammenfassung des gewählten Rezepts und Datenabdeckung der Zutaten.</p>
                    </div>
                  </div>
                  <div className="ingredients-basis-layout">
                    <div className="ingredients-basis-grid">
                      <div className="settings-status-chip">
                        <span>Name</span>
                        <strong>{name.trim() || "Aktueller Rezeptentwurf"}</strong>
                      </div>
                      <div className="settings-status-chip">
                        <span>Sichtbarkeit</span>
                        <strong>{visibility === "public" ? "Öffentlich" : "Privat"}</strong>
                      </div>
                      <div className="settings-status-chip">
                        <span>Zutaten</span>
                        <strong>{previewRows.length}</strong>
                      </div>
                      <div className="settings-status-chip">
                        <span>Gesamtgewicht</span>
                        <strong>{round(previewTotalWeight)} g</strong>
                      </div>
                    </div>
                    <aside className="ingredients-health-card recipe-coverage-card">
                      <span className="recipe-coverage-heading">Inhaltsstoff-Status</span>
                      <div className={`recipe-coverage-indicator recipe-coverage-${previewCoverage.tone}`}>
                        <span className="recipe-coverage-thumb" aria-hidden="true">
                          {previewCoverage.icon}
                        </span>
                        <div className="recipe-coverage-copy">
                          <span className="recipe-coverage-label">{previewCoverage.label}</span>
                          <span className="recipe-coverage-hint">Mehr Details</span>
                        </div>
                        <div className="recipe-coverage-popover">
                          <strong>{previewCoverage.label}</strong>
                          <p>{previewCoverage.detail}</p>
                        </div>
                      </div>
                    </aside>
                  </div>
                </section>

                <section className="card ingredients-section recipe-preview-section">
                  <div className="section-title-row">
                    <div>
                      <h2>Hauptinfos</h2>
                      <p className="lead">Kumulierte Makronährstoffe und Basiswerte über alle Zutaten des Rezepts.</p>
                    </div>
                  </div>
                  <div className="ingredients-macro-grid">
                    <div className="settings-status-chip">
                      <span>kcal</span>
                      <strong>
                        {previewDisplayMode === "per100g"
                          ? `${round1(valuePer100(previewTotals.totals.kcal, previewTotalWeight))} kcal`
                          : `${round1(previewTotals.totals.kcal)} kcal`}
                      </strong>
                    </div>
                    <div className="settings-status-chip"><span>Protein</span><strong>{formatDisplayValue(previewTotals.totals.protein, previewTotalWeight, "g", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Kohlenhydrate</span><strong>{formatDisplayValue(previewTotals.totals.carbs, previewTotalWeight, "g", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Fett</span><strong>{formatDisplayValue(previewTotals.totals.fat, previewTotalWeight, "g", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Ballaststoffe</span><strong>{formatDisplayValue(previewTotals.totals.fiber, previewTotalWeight, "g", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Zucker</span><strong>{formatDisplayValue(previewTotals.totals.sugar, previewTotalWeight, "g", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Stärke</span><strong>{formatDisplayValue(previewTotals.totals.starch, previewTotalWeight, "g", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Natrium</span><strong>{formatDisplayValue(previewTotals.totals.sodium, previewTotalWeight, "mg", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Kalium</span><strong>{formatDisplayValue(previewTotals.totals.potassium, previewTotalWeight, "mg", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Gesättigte Fette</span><strong>{formatDisplayValue(previewTotals.totals.saturated_fat, previewTotalWeight, "g", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Einfach unges. Fett</span><strong>{formatDisplayValue(previewTotals.totals.monounsaturated_fat, previewTotalWeight, "g", previewDisplayMode)}</strong></div>
                    <div className="settings-status-chip"><span>Mehrfach unges. Fett</span><strong>{formatDisplayValue(previewTotals.totals.polyunsaturated_fat, previewTotalWeight, "g", previewDisplayMode)}</strong></div>
                  </div>
                </section>

                <div className="ingredients-details-columns">
                  <section className="card ingredients-section recipe-preview-section">
                    <div className="section-title-row">
                      <div>
                        <h2>Weitere Inhaltsstoffe 1</h2>
                        <p className="lead">Kumulierte zusätzliche Inhaltsstoffe und Mineralstoffe.</p>
                      </div>
                    </div>
                    <div className="ingredients-details-grid">
                      {DETAIL_GROUP_ONE.map((field) => (
                        <div key={field.key} className="settings-status-chip">
                          <span>{field.label}</span>
                          <strong>
                            {formatDisplayValue(previewTotals.details[field.key], previewTotalWeight, field.unit, previewDisplayMode)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="card ingredients-section recipe-preview-section">
                    <div className="section-title-row">
                      <div>
                        <h2>Inhaltsstoffe 2</h2>
                        <p className="lead">Vitamine und Mikronährstoffe über alle Zutaten des Rezepts.</p>
                      </div>
                    </div>
                    <div className="ingredients-details-grid">
                      {DETAIL_GROUP_TWO.map((field) => (
                        <div key={field.key} className="settings-status-chip">
                          <span>{field.label}</span>
                          <strong>
                            {formatDisplayValue(previewTotals.details[field.key], previewTotalWeight, field.unit, previewDisplayMode)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <section className="card ingredients-section recipe-preview-section">
                  <div className="section-title-row">
                    <div>
                      <h2>Zutaten im Detail</h2>
                      <p className="lead">Einzelbeiträge und Datenqualität jeder verwendeten Zutat.</p>
                    </div>
                  </div>
                  <div className="recipe-preview-list">
                    {previewRows.map(({ row, detail, amountG, kcal, protein, carbs, fat, knowledge }, index) => (
                      <article key={`${row.food_item_id}-${index}`} className="nutrition-entry">
                        <div className="nutrition-entry-head">
                          <strong>{row.label}</strong>
                          <span className={`health-indicator-badge health-${knowledge.tone}`}>{knowledge.label}</span>
                        </div>
                        <div className="nutrition-entry-summary">
                          <span>
                            Menge: {row.amount} {row.unit.toUpperCase()} ≈ {round(amountG)} g
                          </span>
                          <span>Quelle: {detail?.source_label || detail?.source_type || "-"}</span>
                          <span>USDA: {detail?.usda_status || "-"}</span>
                        </div>
                        <div className="nutrition-entry-summary">
                          <span>kcal: {round1(kcal)}</span>
                          <span>P: {round1(protein)} g</span>
                          <span>C: {round1(carbs)} g</span>
                          <span>F: {round1(fat)} g</span>
                          <span>Zusatzwerte: {knowledge.detailCount}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
