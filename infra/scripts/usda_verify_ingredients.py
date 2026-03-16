from __future__ import annotations

import argparse
import csv
import json
import os
import re
import time
import unicodedata
from collections import deque
from datetime import datetime
from math import isfinite
from typing import Any

import requests
from sqlalchemy import and_, select

from packages.db.models import NutritionFoodItem, NutritionFoodItemSource
from packages.db.session import SessionLocal


USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1"
USDA_SOURCE_LABEL = "USDA FoodData Central"
USDA_SOURCE_URL = "https://fdc.nal.usda.gov/"
DEFAULT_TRACKER_FILE = os.path.join("docs", "usda-rate-tracker.json")
USDA_STATUS_UNKNOWN = "unknown"
USDA_STATUS_VALID = "valid"
USDA_STATUS_VALID_UNKNOWN = "valid_unknown"

# Keep these in sync with product view categories.
PRODUCT_CATEGORIES = {
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
}

NUMERIC_FIELD_MAPPINGS: dict[str, list[str]] = {
    "kcal_per_100g": ["1008", "208"],
    "protein_per_100g": ["1003", "203"],
    "carbs_per_100g": ["1005", "205"],
    "fat_per_100g": ["1004", "204"],
    "fiber_per_100g": ["1079", "291"],
    "sugar_per_100g": ["2000", "269"],
    "starch_per_100g": ["1009", "209"],
    "saturated_fat_per_100g": ["1258", "606"],
    "monounsaturated_fat_per_100g": ["1292", "645"],
    "polyunsaturated_fat_per_100g": ["1293", "646"],
    "sodium_mg_per_100g": ["1093", "307"],
    "potassium_mg_per_100g": ["1092", "306"],
}

DETAIL_FIELD_MAPPINGS: dict[str, list[str]] = {
    "trans_fat_per_100g": ["1257", "605"],
    "cholesterol_mg_per_100g": ["1253", "601"],
    "calcium_mg_per_100g": ["1087", "301"],
    "magnesium_mg_per_100g": ["1090", "304"],
    "phosphorus_mg_per_100g": ["1091", "305"],
    "iron_mg_per_100g": ["1089", "303"],
    "zinc_mg_per_100g": ["1095", "309"],
    "copper_mg_per_100g": ["1098", "312"],
    "manganese_mg_per_100g": ["1101", "315"],
    "selenium_ug_per_100g": ["1103", "317"],
    "iodine_ug_per_100g": ["1100", "314"],
    "vitamin_a_ug_per_100g": ["1106", "320"],
    "vitamin_b1_mg_per_100g": ["1165", "404"],
    "vitamin_b2_mg_per_100g": ["1166", "405"],
    "vitamin_b3_mg_per_100g": ["1167", "406"],
    "vitamin_b5_mg_per_100g": ["1170", "410"],
    "vitamin_b6_mg_per_100g": ["1175", "415"],
    "folate_ug_per_100g": ["1177", "417"],
    "vitamin_b12_ug_per_100g": ["1178", "418"],
    "vitamin_c_mg_per_100g": ["1162", "401"],
    "vitamin_d_ug_per_100g": ["1114", "324"],
    "vitamin_e_mg_per_100g": ["1109", "323"],
    "vitamin_k_ug_per_100g": ["1185", "430"],
    "biotin_ug_per_100g": ["1176", "416"],
}


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFKD", text or "")
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower()
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def token_set(text: str) -> set[str]:
    return {t for t in normalize(text).split(" ") if t}


def clean_query_name(text: str) -> str:
    value = (text or "").strip()
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" ,;-")
    return value


def match_score(local_name: str, usda_desc: str, brand_name: str | None = None) -> float:
    local_norm = normalize(local_name)
    usda_norm = normalize(usda_desc)
    if not local_norm or not usda_norm:
        return 0.0

    # Core lexical similarity.
    a = token_set(local_name)
    b = token_set(usda_desc)
    inter = len(a.intersection(b))
    union = len(a.union(b)) or 1
    jaccard = inter / union

    # Strong bonus for prefix/substring.
    prefix_bonus = 0.0
    if usda_norm.startswith(local_norm) or local_norm.startswith(usda_norm):
        prefix_bonus = 0.25
    elif local_norm in usda_norm or usda_norm in local_norm:
        prefix_bonus = 0.15

    # Weak brand penalty for branded entries when we check ingredients.
    brand_penalty = 0.0
    if brand_name:
        brand_penalty = 0.05

    score = max(0.0, min(1.0, jaccard + prefix_bonus - brand_penalty))
    return score


def search_usda(name: str, api_key: str, page_size: int = 10) -> list[dict[str, Any]]:
    url = f"{USDA_BASE_URL}/foods/search"
    candidates: list[str] = []
    primary = (name or "").strip()
    cleaned = clean_query_name(primary)
    if primary:
        candidates.append(primary)
    if cleaned and cleaned not in candidates:
        candidates.append(cleaned)

    last_exc: requests.RequestException | None = None
    for candidate in candidates:
        try:
            response = requests.get(
                url,
                params={"api_key": api_key, "query": candidate, "pageSize": page_size},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            foods = data.get("foods") or []
            return foods if isinstance(foods, list) else []
        except requests.RequestException as exc:
            last_exc = exc
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code != 400 or candidate == candidates[-1]:
                break
    if last_exc is not None:
        raise last_exc
    return []


def fetch_usda_food_details(fdc_id: int | str, api_key: str) -> dict[str, Any]:
    url = f"{USDA_BASE_URL}/food/{fdc_id}"
    response = requests.get(url, params={"api_key": api_key}, timeout=30)
    response.raise_for_status()
    data = response.json()
    return data if isinstance(data, dict) else {}


class RateTracker:
    def __init__(self, max_calls_per_hour: int, tracker_file: str) -> None:
        self.max_calls_per_hour = max(1, int(max_calls_per_hour))
        self.tracker_file = tracker_file
        self.window_seconds = 3600
        self.calls: deque[float] = deque()
        self._load()

    def _prune(self, now_ts: float) -> None:
        cutoff = now_ts - self.window_seconds
        while self.calls and self.calls[0] < cutoff:
            self.calls.popleft()

    def _load(self) -> None:
        if not self.tracker_file or not os.path.exists(self.tracker_file):
            return
        try:
            with open(self.tracker_file, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            entries = data.get("call_timestamps") if isinstance(data, dict) else None
            if isinstance(entries, list):
                for ts in entries:
                    if isinstance(ts, (int, float)):
                        self.calls.append(float(ts))
            self._prune(time.time())
        except (OSError, json.JSONDecodeError):
            self.calls.clear()

    def _save(self) -> None:
        if not self.tracker_file:
            return
        os.makedirs(os.path.dirname(self.tracker_file) or ".", exist_ok=True)
        payload = {
            "saved_at": datetime.utcnow().isoformat(),
            "max_calls_per_hour": self.max_calls_per_hour,
            "calls_last_hour": len(self.calls),
            "call_timestamps": list(self.calls),
        }
        with open(self.tracker_file, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)

    def wait_for_slot(self) -> None:
        while True:
            now_ts = time.time()
            self._prune(now_ts)
            if len(self.calls) < self.max_calls_per_hour:
                self.calls.append(now_ts)
                self._save()
                return
            wait_seconds = max(1.0, (self.calls[0] + self.window_seconds) - now_ts)
            print(f"[rate-limit] {len(self.calls)}/{self.max_calls_per_hour} Calls in der letzten Stunde. Warte {int(wait_seconds)}s...")
            time.sleep(wait_seconds)

    def stats(self) -> dict[str, int]:
        self._prune(time.time())
        used = len(self.calls)
        return {
            "used_last_hour": used,
            "remaining_this_hour": max(0, self.max_calls_per_hour - used),
            "max_calls_per_hour": self.max_calls_per_hour,
        }


def choose_best(local_name: str, foods: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, float]:
    best: dict[str, Any] | None = None
    best_score = 0.0
    for food in foods:
        desc = str(food.get("description") or "")
        brand = str(food.get("brandName") or "").strip() or None
        score = match_score(local_name, desc, brand_name=brand)
        if score > best_score:
            best = food
            best_score = score
    return best, best_score


def is_uncertain_entry(row: NutritionFoodItem) -> bool:
    usda_status = (getattr(row, "usda_status", "") or USDA_STATUS_UNKNOWN).strip().lower()
    return usda_status != USDA_STATUS_VALID


def log(msg: str) -> None:
    print(msg, flush=True)


def parse_error_code(exc: requests.RequestException) -> tuple[str, str]:
    status_code: int | None = None
    response = getattr(exc, "response", None)
    if response is not None:
        status_code = getattr(response, "status_code", None)
    if status_code is not None:
        code = f"HTTP_{status_code}"
    else:
        code = exc.__class__.__name__.upper()

    explain = {
        "HTTP_400": "Ungültige Anfrage an USDA.",
        "HTTP_401": "API-Key fehlt oder ist ungültig.",
        "HTTP_403": "USDA lehnt den Zugriff mit diesem Key ab.",
        "HTTP_404": "USDA-Endpunkt nicht gefunden.",
        "HTTP_408": "USDA Anfrage-Timeout.",
        "HTTP_429": "USDA Rate-Limit erreicht.",
        "HTTP_500": "USDA interner Serverfehler.",
        "HTTP_502": "USDA Gateway-Fehler.",
        "HTTP_503": "USDA Service vorübergehend nicht verfügbar.",
        "HTTP_504": "USDA Gateway-Timeout.",
        "CONNECTIONERROR": "Verbindungsproblem zur USDA API.",
        "TIMEOUT": "Zeitüberschreitung beim USDA-Request.",
    }.get(code, "Technischer USDA API-Fehler.")
    return code, explain


def _to_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(parsed):
        return None
    return parsed


def _normalize_unit(value: Any) -> str:
    return str(value or "").strip().lower()


def _extract_nutrients(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw = payload.get("foodNutrients") or []
    return raw if isinstance(raw, list) else []


def _extract_number(entry: dict[str, Any]) -> str:
    nutrient = entry.get("nutrient") if isinstance(entry.get("nutrient"), dict) else {}
    number = nutrient.get("number")
    if number is None:
        number = entry.get("nutrientNumber")
    return str(number or "").strip()


def _extract_name(entry: dict[str, Any]) -> str:
    nutrient = entry.get("nutrient") if isinstance(entry.get("nutrient"), dict) else {}
    name = nutrient.get("name")
    if name is None:
        name = entry.get("nutrientName")
    return str(name or "").strip().lower()


def _extract_amount(entry: dict[str, Any]) -> float | None:
    for key in ("amount", "value"):
        parsed = _to_float(entry.get(key))
        if parsed is not None:
            return parsed
    return None


def _extract_unit(entry: dict[str, Any]) -> str:
    nutrient = entry.get("nutrient") if isinstance(entry.get("nutrient"), dict) else {}
    return _normalize_unit(nutrient.get("unitName") or entry.get("unitName"))


def _convert_value(amount: float | None, unit: str, target: str) -> float | None:
    if amount is None:
        return None
    if target == "g":
        if unit in {"g", "gram", "grams"}:
            return amount
        if unit == "mg":
            return amount / 1000.0
        if unit in {"ug", "µg", "mcg"}:
            return amount / 1_000_000.0
    if target == "mg":
        if unit == "mg":
            return amount
        if unit in {"g", "gram", "grams"}:
            return amount * 1000.0
        if unit in {"ug", "µg", "mcg"}:
            return amount / 1000.0
    if target == "ug":
        if unit in {"ug", "µg", "mcg"}:
            return amount
        if unit == "mg":
            return amount * 1000.0
        if unit in {"g", "gram", "grams"}:
            return amount * 1_000_000.0
    if target == "kcal":
        return amount if unit in {"kcal", "kcalorie"} else None
    return amount


def _find_value_by_numbers(entries: list[dict[str, Any]], nutrient_numbers: list[str], target_unit: str) -> float | None:
    for number in nutrient_numbers:
        for entry in entries:
            if _extract_number(entry) != number:
                continue
            converted = _convert_value(_extract_amount(entry), _extract_unit(entry), target_unit)
            if converted is not None:
                return converted
    return None


def _sum_matching(entries: list[dict[str, Any]], patterns: list[str], target_unit: str) -> float | None:
    total = 0.0
    matched = False
    for entry in entries:
        name = _extract_name(entry)
        if not any(pattern in name for pattern in patterns):
            continue
        converted = _convert_value(_extract_amount(entry), _extract_unit(entry), target_unit)
        if converted is None:
            continue
        total += converted
        matched = True
    return total if matched else None


def extract_structured_values(payload: dict[str, Any]) -> tuple[dict[str, float | None], dict[str, float | None]]:
    entries = _extract_nutrients(payload)
    numeric_targets = {
        "kcal_per_100g": "kcal",
        "protein_per_100g": "g",
        "carbs_per_100g": "g",
        "fat_per_100g": "g",
        "fiber_per_100g": "g",
        "sugar_per_100g": "g",
        "starch_per_100g": "g",
        "saturated_fat_per_100g": "g",
        "monounsaturated_fat_per_100g": "g",
        "polyunsaturated_fat_per_100g": "g",
        "sodium_mg_per_100g": "mg",
        "potassium_mg_per_100g": "mg",
    }
    detail_targets = {
        "trans_fat_per_100g": "g",
        "cholesterol_mg_per_100g": "mg",
        "calcium_mg_per_100g": "mg",
        "magnesium_mg_per_100g": "mg",
        "phosphorus_mg_per_100g": "mg",
        "iron_mg_per_100g": "mg",
        "zinc_mg_per_100g": "mg",
        "copper_mg_per_100g": "mg",
        "manganese_mg_per_100g": "mg",
        "selenium_ug_per_100g": "ug",
        "iodine_ug_per_100g": "ug",
        "vitamin_a_ug_per_100g": "ug",
        "vitamin_b1_mg_per_100g": "mg",
        "vitamin_b2_mg_per_100g": "mg",
        "vitamin_b3_mg_per_100g": "mg",
        "vitamin_b5_mg_per_100g": "mg",
        "vitamin_b6_mg_per_100g": "mg",
        "folate_ug_per_100g": "ug",
        "vitamin_b12_ug_per_100g": "ug",
        "vitamin_c_mg_per_100g": "mg",
        "vitamin_d_ug_per_100g": "ug",
        "vitamin_e_mg_per_100g": "mg",
        "vitamin_k_ug_per_100g": "ug",
        "biotin_ug_per_100g": "ug",
    }

    numeric_values = {
        field: _find_value_by_numbers(entries, NUMERIC_FIELD_MAPPINGS[field], target_unit)
        for field, target_unit in numeric_targets.items()
    }
    detail_values = {
        field: _find_value_by_numbers(entries, DETAIL_FIELD_MAPPINGS[field], target_unit)
        for field, target_unit in detail_targets.items()
    }

    if numeric_values["sodium_mg_per_100g"] is not None:
        detail_values["salt_g_per_100g"] = numeric_values["sodium_mg_per_100g"] * 2.5 / 1000.0
    else:
        detail_values["salt_g_per_100g"] = None

    carbs = numeric_values["carbs_per_100g"]
    fiber = numeric_values["fiber_per_100g"]
    detail_values["net_carbs_per_100g"] = max(0.0, carbs - fiber) if carbs is not None and fiber is not None else None
    detail_values["added_sugar_per_100g"] = None
    detail_values["omega3_g_per_100g"] = _sum_matching(entries, ["18:3 n-3", "20:5 n-3", "22:5 n-3", "22:6 n-3"], "g")
    detail_values["omega6_g_per_100g"] = _sum_matching(entries, ["18:2 n-6", "18:3 n-6", "20:2 n-6", "20:3 n-6", "20:4 n-6"], "g")
    return numeric_values, detail_values


def merge_details(existing_details: str | None, usda_payload: dict[str, Any]) -> str:
    base: dict[str, Any] = {}
    if existing_details:
        try:
            parsed = json.loads(existing_details)
            if isinstance(parsed, dict):
                base = parsed
        except json.JSONDecodeError:
            base = {}
    base.update({key: value for key, value in usda_payload.items() if key != "usda"})
    if isinstance(usda_payload.get("usda"), dict):
        base["usda"] = usda_payload["usda"]
    return json.dumps(base, ensure_ascii=False)


def run_verify(
    limit: int | None,
    min_score: float,
    apply: bool,
    api_key: str,
    pause_seconds: float,
    max_calls_per_hour: int,
    tracker_file: str,
    only_uncertain: bool,
) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    report_rows: list[dict[str, Any]] = []
    rate = RateTracker(max_calls_per_hour=max_calls_per_hour, tracker_file=tracker_file)

    with SessionLocal() as session:
        stmt = (
            select(NutritionFoodItem)
            .where(
                and_(
                    NutritionFoodItem.user_id.is_(None),
                    NutritionFoodItem.deleted_at.is_(None),
                    NutritionFoodItem.item_kind == "base_ingredient",
                )
            )
            .order_by(NutritionFoodItem.name.asc())
        )
        all_rows = session.scalars(stmt).all()

        # We only verify ingredients here, so skip known product categories.
        ingredients = [r for r in all_rows if (r.category or "") not in PRODUCT_CATEGORIES]
        if only_uncertain:
            ingredients = [r for r in ingredients if is_uncertain_entry(r)]
        if limit is not None and limit > 0:
            ingredients = ingredients[:limit]

        matched = 0
        updated = 0
        unmatched = 0
        weak = 0
        api_errors = 0

        rate_info = rate.stats()
        log(
            f"[start] USDA-Check: {len(ingredients)} Einträge | "
            f"Rate {rate_info['used_last_hour']}/{rate_info['max_calls_per_hour']} genutzt, "
            f"{rate_info['remaining_this_hour']} verbleibend."
        )

        for idx, row in enumerate(ingredients, start=1):
            query_name = (row.name_en or row.name or "").strip()
            display_name = (row.name_de or row.name or "").strip()
            log(f"[{idx}/{len(ingredients)}] request item='{display_name}' query='{query_name}'")
            rate.wait_for_slot()
            try:
                foods = search_usda(query_name, api_key=api_key)
            except requests.RequestException as exc:
                api_errors += 1
                report_rows.append(
                    {
                        "id": row.id,
                        "name": display_name,
                        "category": row.category or "",
                        "score": 0.0,
                        "fdc_id": "",
                        "usda_description": "",
                        "status": "api_error",
                        "error_code": "",
                        "note": "",
                    }
                )
                code, explain = parse_error_code(exc)
                report_rows[-1]["error_code"] = code
                report_rows[-1]["note"] = explain
                if apply:
                    details_payload = {
                        "checked_at": datetime.utcnow().isoformat(),
                        "matched": False,
                        "status": "api_error",
                        "error_code": code,
                        "error_note": explain,
                        "query": query_name,
                    }
                    row.usda_status = USDA_STATUS_UNKNOWN
                    row.details_json = merge_details(row.details_json, details_payload)
                    row.updated_at = datetime.utcnow()
                log(f"[{idx}/{len(ingredients)}] api_error code={code} - {explain}")
                time.sleep(pause_seconds)
                continue
            best, score = choose_best(query_name, foods)

            result = {
                "id": row.id,
                "name": display_name,
                "category": row.category or "",
                "score": round(score, 4),
                "fdc_id": "",
                "usda_description": "",
                "status": "",
                "error_code": "",
                "note": "",
            }

            if best is None:
                unmatched += 1
                result["status"] = "no_match"
                result["error_code"] = "NO_MATCH"
                result["note"] = "Kein USDA Treffer für den Begriff."
                report_rows.append(result)
                if apply:
                    details_payload = {
                        "checked_at": datetime.utcnow().isoformat(),
                        "matched": False,
                        "status": "no_match",
                        "error_code": "NO_MATCH",
                        "error_note": "Kein USDA Treffer für den Begriff.",
                        "query": query_name,
                    }
                    row.usda_status = USDA_STATUS_VALID_UNKNOWN
                    row.details_json = merge_details(row.details_json, details_payload)
                    row.updated_at = datetime.utcnow()
                log(f"[{idx}/{len(ingredients)}] no_match code=NO_MATCH - Kein USDA Treffer.")
                time.sleep(pause_seconds)
                continue

            fdc_id = best.get("fdcId")
            desc = str(best.get("description") or "")
            result["fdc_id"] = str(fdc_id or "")
            result["usda_description"] = desc

            if score < min_score:
                weak += 1
                result["status"] = "weak_match"
                result["error_code"] = "WEAK_MATCH"
                result["note"] = "Treffer zu unsicher, manuelle Prüfung nötig."
                report_rows.append(result)
                if apply:
                    details_payload = {
                        "checked_at": datetime.utcnow().isoformat(),
                        "matched": False,
                        "status": "weak_match",
                        "error_code": "WEAK_MATCH",
                        "error_note": "Treffer zu unsicher, manuelle Prüfung nötig.",
                        "score": round(score, 4),
                        "fdc_id": fdc_id,
                        "description": desc,
                        "query": query_name,
                    }
                    row.usda_status = USDA_STATUS_VALID_UNKNOWN
                    row.details_json = merge_details(row.details_json, details_payload)
                    row.updated_at = datetime.utcnow()
                log(f"[{idx}/{len(ingredients)}] weak_match code=WEAK_MATCH - Unsicherer Treffer ({score:.2f}).")
                time.sleep(pause_seconds)
                continue

            matched += 1
            result["status"] = "matched"
            report_rows.append(result)

            if apply:
                detailed_food: dict[str, Any] = {}
                try:
                    rate.wait_for_slot()
                    detailed_food = fetch_usda_food_details(fdc_id, api_key=api_key) if fdc_id else {}
                except requests.RequestException as exc:
                    code, explain = parse_error_code(exc)
                    log(f"[{idx}/{len(ingredients)}] detail_error code={code} - {explain}")
                numeric_values, detail_values = extract_structured_values(detailed_food or best)
                details_payload = {
                    "checked_at": now,
                    "matched": True,
                    "score": round(score, 4),
                    "fdc_id": fdc_id,
                    "description": desc,
                    "data_type": (detailed_food or best).get("dataType"),
                    "publication_date": (detailed_food or best).get("publicationDate"),
                    **detail_values,
                    "usda": {
                        "checked_at": now,
                        "matched": True,
                        "score": round(score, 4),
                        "fdc_id": fdc_id,
                        "description": desc,
                        "data_type": (detailed_food or best).get("dataType"),
                        "publication_date": (detailed_food or best).get("publicationDate"),
                    },
                }
                row.origin_type = "trusted_source"
                row.trust_level = "high"
                row.verification_status = "source_linked"
                row.usda_status = USDA_STATUS_VALID
                row.kcal_per_100g = numeric_values["kcal_per_100g"]
                row.protein_per_100g = numeric_values["protein_per_100g"]
                row.carbs_per_100g = numeric_values["carbs_per_100g"]
                row.fat_per_100g = numeric_values["fat_per_100g"]
                row.fiber_per_100g = numeric_values["fiber_per_100g"]
                row.sugar_per_100g = numeric_values["sugar_per_100g"]
                row.starch_per_100g = numeric_values["starch_per_100g"]
                row.saturated_fat_per_100g = numeric_values["saturated_fat_per_100g"]
                row.monounsaturated_fat_per_100g = numeric_values["monounsaturated_fat_per_100g"]
                row.polyunsaturated_fat_per_100g = numeric_values["polyunsaturated_fat_per_100g"]
                row.sodium_mg_per_100g = numeric_values["sodium_mg_per_100g"]
                row.potassium_mg_per_100g = numeric_values["potassium_mg_per_100g"]
                row.name_en = desc
                if not row.name_de:
                    row.name_de = display_name
                row.name = row.name_en or row.name
                row.source_label = USDA_SOURCE_LABEL
                row.source_url = f"{USDA_SOURCE_URL}fdc-app.html#/food-details/{fdc_id}/nutrients" if fdc_id else USDA_SOURCE_URL
                row.details_json = merge_details(row.details_json, details_payload)
                row.updated_at = datetime.utcnow()

                source = session.scalar(
                    select(NutritionFoodItemSource)
                    .where(NutritionFoodItemSource.food_item_id == row.id)
                    .where(NutritionFoodItemSource.is_primary == 1)
                )
                if source is None:
                    source = NutritionFoodItemSource(
                        food_item_id=row.id,
                        source_type="trusted_source",
                        source_name=USDA_SOURCE_LABEL,
                        source_url=row.source_url,
                        citation_text=f"USDA FDC {fdc_id}" if fdc_id else "USDA FDC",
                        is_primary=1,
                        created_at=datetime.utcnow(),
                    )
                    session.add(source)
                else:
                    source.source_type = "trusted_source"
                    source.source_name = USDA_SOURCE_LABEL
                    source.source_url = row.source_url
                    source.citation_text = f"USDA FDC {fdc_id}" if fdc_id else "USDA FDC"
                updated += 1

            log(f"[{idx}/{len(ingredients)}] matched code=OK - {desc} ({score:.2f})")
            time.sleep(pause_seconds)

        if apply:
            session.commit()

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    report_path = os.path.join("docs", f"usda-verify-report-{timestamp}.csv")
    os.makedirs("docs", exist_ok=True)
    with open(report_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=["id", "name", "category", "score", "fdc_id", "usda_description", "status", "error_code", "note"],
        )
        writer.writeheader()
        writer.writerows(report_rows)

    return {
        "checked": len(report_rows),
        "matched": matched,
        "weak_match": weak,
        "no_match": unmatched,
        "api_error": api_errors,
        "updated": updated if apply else 0,
        "apply": apply,
        "report": report_path,
        "rate_tracker_file": tracker_file,
        "rate_info_end": rate.stats(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify global ingredient catalog against USDA FDC.")
    parser.add_argument("--limit", type=int, default=None, help="Optional max number of ingredients to check.")
    parser.add_argument("--min-score", type=float, default=0.55, help="Minimum score to accept a USDA match.")
    parser.add_argument("--apply", action="store_true", help="Write updates to DB. Without this, only report is generated.")
    parser.add_argument("--pause-seconds", type=float, default=0.08, help="Pause between USDA requests.")
    parser.add_argument("--max-calls-per-hour", type=int, default=100, help="USDA request limit per rolling hour.")
    parser.add_argument("--tracker-file", type=str, default=DEFAULT_TRACKER_FILE, help="Path to persist USDA call timestamps.")
    parser.add_argument("--api-key", type=str, default=None, help="USDA API key. Falls back to USDA_API_KEY env or DEMO_KEY.")
    parser.add_argument("--only-uncertain", action="store_true", help="Check only entries that are not yet high-confidence USDA linked.")
    args = parser.parse_args()

    api_key = args.api_key or os.getenv("USDA_API_KEY") or "DEMO_KEY"
    result = run_verify(
        limit=args.limit,
        min_score=args.min_score,
        apply=args.apply,
        api_key=api_key,
        pause_seconds=max(0.0, args.pause_seconds),
        max_calls_per_hour=max(1, args.max_calls_per_hour),
        tracker_file=args.tracker_file,
        only_uncertain=args.only_uncertain,
    )
    log(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
