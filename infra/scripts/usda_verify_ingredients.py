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
from typing import Any

import requests
from sqlalchemy import and_, select

from packages.db.models import NutritionFoodItem, NutritionFoodItemSource
from packages.db.session import SessionLocal


USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1"
USDA_SOURCE_LABEL = "USDA FoodData Central"
USDA_SOURCE_URL = "https://fdc.nal.usda.gov/"
DEFAULT_TRACKER_FILE = os.path.join("docs", "usda-rate-tracker.json")

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


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFKD", text or "")
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower()
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def token_set(text: str) -> set[str]:
    return {t for t in normalize(text).split(" ") if t}


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
    params = {
        "api_key": api_key,
        "query": name,
        "pageSize": page_size,
    }
    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()
    foods = data.get("foods") or []
    return foods if isinstance(foods, list) else []


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


def merge_details(existing_details: str | None, usda_payload: dict[str, Any]) -> str:
    base: dict[str, Any] = {}
    if existing_details:
        try:
            parsed = json.loads(existing_details)
            if isinstance(parsed, dict):
                base = parsed
        except json.JSONDecodeError:
            base = {}
    base["usda"] = usda_payload
    return json.dumps(base, ensure_ascii=False)


def run_verify(
    limit: int | None,
    min_score: float,
    apply: bool,
    api_key: str,
    pause_seconds: float,
    max_calls_per_hour: int,
    tracker_file: str,
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
        if limit is not None and limit > 0:
            ingredients = ingredients[:limit]

        matched = 0
        updated = 0
        unmatched = 0
        weak = 0
        api_errors = 0

        rate_info = rate.stats()
        print(
            f"[start] USDA-Check: {len(ingredients)} Einträge | "
            f"Rate {rate_info['used_last_hour']}/{rate_info['max_calls_per_hour']} genutzt, "
            f"{rate_info['remaining_this_hour']} verbleibend."
        )

        for idx, row in enumerate(ingredients, start=1):
            query_name = (row.name_en or row.name or "").strip()
            display_name = (row.name_de or row.name or "").strip()
            print(f"[{idx}/{len(ingredients)}] Prüfe: {display_name} | query={query_name}")
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
                        "status": f"api_error:{exc.__class__.__name__}",
                    }
                )
                print(f"[{idx}/{len(ingredients)}] api_error: {display_name} ({exc.__class__.__name__})")
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
            }

            if best is None:
                unmatched += 1
                result["status"] = "no_match"
                report_rows.append(result)
                print(f"[{idx}/{len(ingredients)}] no_match: {display_name}")
                time.sleep(pause_seconds)
                continue

            fdc_id = best.get("fdcId")
            desc = str(best.get("description") or "")
            result["fdc_id"] = str(fdc_id or "")
            result["usda_description"] = desc

            if score < min_score:
                weak += 1
                result["status"] = "weak_match"
                report_rows.append(result)
                print(f"[{idx}/{len(ingredients)}] weak_match: {display_name} -> {desc} ({score:.2f})")
                time.sleep(pause_seconds)
                continue

            matched += 1
            result["status"] = "matched"
            report_rows.append(result)

            if apply:
                details_payload = {
                    "checked_at": now,
                    "matched": True,
                    "score": round(score, 4),
                    "fdc_id": fdc_id,
                    "description": desc,
                    "data_type": best.get("dataType"),
                    "publication_date": best.get("publicationDate"),
                }
                row.origin_type = "trusted_source"
                row.trust_level = "high"
                row.verification_status = "source_linked"
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

            print(f"[{idx}/{len(ingredients)}] matched: {display_name} -> {desc} ({score:.2f})")
            time.sleep(pause_seconds)

        if apply:
            session.commit()

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    report_path = os.path.join("docs", f"usda-verify-report-{timestamp}.csv")
    os.makedirs("docs", exist_ok=True)
    with open(report_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=["id", "name", "category", "score", "fdc_id", "usda_description", "status"],
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
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
