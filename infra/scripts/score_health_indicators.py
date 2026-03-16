from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import select

from packages.db.models import NutritionFoodItem
from packages.db.session import SessionLocal


VERY_POSITIVE_CATEGORIES = {"Gemüse", "Hülsenfrüchte"}
HELPFUL_CATEGORIES = {"Obst", "Getreide", "Joghurt", "Milchprodukte", "Eier", "Fisch", "Nüsse", "Samen"}
CAUTION_CATEGORIES = {"Käse", "Fleisch", "Öle"}


def _load_details(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _num(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed


def _detail_num(details: dict[str, Any], key: str) -> float | None:
    return _num(details.get(key))


def _append_reason(bucket: list[str], text: str) -> None:
    if text not in bucket:
        bucket.append(text)


def classify_item(item: NutritionFoodItem) -> tuple[str, dict[str, Any]]:
    details = _load_details(item.details_json)
    positives: list[str] = []
    cautions: list[str] = []
    score = 0.0

    category = (item.category or "").strip()
    kcal = _num(item.kcal_per_100g)
    protein = _num(item.protein_per_100g)
    carbs = _num(item.carbs_per_100g)
    fat = _num(item.fat_per_100g)
    fiber = _num(item.fiber_per_100g)
    sugar = _num(item.sugar_per_100g)
    sat_fat = _num(item.saturated_fat_per_100g)
    sodium = _num(item.sodium_mg_per_100g)
    cholesterol = _detail_num(details, "cholesterol_mg_per_100g")

    omega3 = _detail_num(details, "omega3_g_per_100g")
    added_sugar = _detail_num(details, "added_sugar_per_100g")
    trans_fat = _detail_num(details, "trans_fat_per_100g")
    vitamin_c = _detail_num(details, "vitamin_c_mg_per_100g")
    iron = _detail_num(details, "iron_mg_per_100g")
    magnesium = _detail_num(details, "magnesium_mg_per_100g")
    potassium = _detail_num(details, "potassium_mg_per_100g")
    name = (item.name_de or item.name or "").lower()

    if category in VERY_POSITIVE_CATEGORIES:
        score += 1.5
        _append_reason(positives, f"Kategorie {category} ist grundsätzlich nährstoffstark.")
    elif category in HELPFUL_CATEGORIES:
        score += 0.5
        _append_reason(positives, f"Kategorie {category} kann je nach Nährwertprofil gut passen.")
    elif category in CAUTION_CATEGORIES:
        score -= 0.5
        _append_reason(cautions, f"Kategorie {category} braucht mehr Kontext bei der Einordnung.")

    if category == "Obst":
        score -= 0.25
        _append_reason(cautions, "Obst ist gesund, aber nicht automatisch in der Spitzengruppe.")

    if category == "Fisch":
        score += 1.0
        _append_reason(positives, "Fisch bringt oft Protein und günstige Fettsäuren zusammen.")

    if category in {"Nüsse", "Samen"}:
        score += 1.0
        _append_reason(positives, "Nüsse und Samen liefern meist gute Fette und Mikronährstoffe.")

    if fiber is not None:
        if fiber >= 6:
            score += 1.5
            _append_reason(positives, "Hoher Ballaststoffgehalt.")
        elif fiber >= 3:
            score += 0.75
            _append_reason(positives, "Guter Ballaststoffgehalt.")
        elif fiber == 0 and carbs is not None and carbs >= 25:
            score -= 0.75
            _append_reason(cautions, "Viele Kohlenhydrate ohne Ballaststoffausgleich.")

    if protein is not None:
        if protein >= 20:
            score += 1.25
            _append_reason(positives, "Sehr proteinreich.")
        elif protein >= 10:
            score += 0.5
            _append_reason(positives, "Solider Proteingehalt.")

    if kcal is not None:
        if kcal >= 450 and category not in {"Nüsse", "Samen", "Öle"}:
            score -= 1.0
            _append_reason(cautions, "Sehr energiedicht.")
        elif kcal <= 120 and category in {"Gemüse", "Obst"}:
            score += 0.5
            _append_reason(positives, "Niedrige Energiedichte.")

    if sugar is not None:
        if sugar >= 18 and category not in {"Obst"}:
            score -= 1.25
            _append_reason(cautions, "Hoher Zuckergehalt.")
        elif sugar <= 5 and category != "Obst":
            score += 0.25

    if added_sugar is not None and added_sugar >= 8:
        score -= 1.5
        _append_reason(cautions, "Deutlich zugesetzter Zucker.")

    if sat_fat is not None:
        if sat_fat >= 8:
            score -= 1.5
            _append_reason(cautions, "Viel gesättigtes Fett.")
        elif sat_fat <= 2:
            score += 0.25

    if sodium is not None:
        if sodium >= 500:
            score -= 1.5
            _append_reason(cautions, "Hoher Natriumgehalt.")
        elif sodium <= 120:
            score += 0.25

    if cholesterol is not None and cholesterol >= 350 and category not in {"Eier"}:
        score -= 0.5
        _append_reason(cautions, "Erhöhter Cholesteringehalt.")

    if trans_fat is not None and trans_fat > 0.2:
        score -= 2.5
        _append_reason(cautions, "Enthält relevante Transfette.")

    if omega3 is not None:
        if omega3 >= 1.0:
            score += 1.5
            _append_reason(positives, "Guter Omega-3-Gehalt.")
        elif omega3 >= 0.3:
            score += 0.5

    if fat is not None and category in {"Nüsse", "Samen"} and fat >= 35:
        score += 0.5
        _append_reason(positives, "Energiedicht, aber mit typischerweise günstigem Fettprofil.")

    if vitamin_c is not None and vitamin_c >= 20:
        score += 0.75
        _append_reason(positives, "Nennenswerter Vitamin-C-Gehalt.")

    if iron is not None and iron >= 2:
        score += 0.5
        _append_reason(positives, "Liefert relevant Eisen.")

    if magnesium is not None and magnesium >= 60:
        score += 0.5
        _append_reason(positives, "Liefert relevant Magnesium.")

    if potassium is not None and potassium >= 300:
        score += 0.5
        _append_reason(positives, "Guter Kaliumgehalt.")

    if category == "Öle":
        if "oliven" in name or "olive" in name or "raps" in name or "canola" in name:
            score += 1.0
            _append_reason(positives, "Öl mit im Alltag meist günstigem Fettsäureprofil.")
        elif omega3 is not None and omega3 >= 0.8:
            score += 0.75
            _append_reason(positives, "Fettquelle mit besserem Fettsäureprofil.")
        else:
            score -= 0.25
            _append_reason(cautions, "Reine Fettquelle ohne starke Mikronährstoffdichte.")

    if category == "Käse":
        if protein is not None and protein >= 20:
            score += 0.25
            _append_reason(positives, "Käse liefert konzentriert Protein.")
        if sat_fat is not None and sat_fat >= 10:
            score -= 1.0
            _append_reason(cautions, "Käse mit hohem Anteil gesättigter Fette.")
        if sodium is not None and sodium >= 650:
            score -= 0.75
            _append_reason(cautions, "Relativ salzreich.")

    if category == "Fleisch" and protein is not None and protein >= 18 and sat_fat is not None and sat_fat <= 4:
        score += 0.25

    if category == "Eier":
        score += 0.75
        _append_reason(positives, "Eier sind nährstoffdicht und proteinreich.")
        if protein is not None and protein >= 12:
            score += 0.25
        if sat_fat is not None and sat_fat <= 3.5:
            score += 0.25

    indicator = "neutral"
    if score >= 3.0:
        indicator = "very_positive"
    elif score <= -1.75:
        indicator = "counterproductive"

    assessment = {
        "version": "health-score-v2",
        "assessed_at": datetime.utcnow().isoformat(),
        "score": round(score, 2),
        "indicator": indicator,
        "positives": positives,
        "cautions": cautions,
    }
    return indicator, assessment


def main() -> None:
    updated = 0
    distribution = {"very_positive": 0, "neutral": 0, "counterproductive": 0}

    with SessionLocal() as session:
      rows = session.scalars(
          select(NutritionFoodItem)
          .where(NutritionFoodItem.deleted_at.is_(None))
          .where(NutritionFoodItem.item_kind == "base_ingredient")
      ).all()

      for row in rows:
          details = _load_details(row.details_json)
          indicator, assessment = classify_item(row)
          details["health_assessment"] = assessment
          row.health_indicator = indicator
          row.details_json = json.dumps(details, ensure_ascii=False)
          row.updated_at = datetime.utcnow()
          distribution[indicator] += 1
          updated += 1

      session.commit()

    print(json.dumps({"updated": updated, "distribution": distribution}, ensure_ascii=False))


if __name__ == "__main__":
    main()
