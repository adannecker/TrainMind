from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import requests
from dotenv import load_dotenv
from sqlalchemy import and_, select

from packages.db.models import NutritionFoodItem
from packages.db.session import SessionLocal


OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-4o-mini"


@dataclass
class NameRow:
    id: str
    source_name: str


def _build_messages(rows: list[NameRow]) -> list[dict[str, str]]:
    rows_json = json.dumps(
        [{"id": row.id, "source_name": row.source_name} for row in rows],
        ensure_ascii=False,
    )
    system = (
        "You normalize and translate food names.\n"
        "Task:\n"
        "1) Produce canonical German name with proper umlauts in `name_de`.\n"
        "2) Produce clean English translation in `name_en`.\n"
        "Rules:\n"
        "- Keep quantity/variant markers in parentheses, but translate them.\n"
        "- Examples: (roh)->(raw), (gekocht)->(cooked), (frisch)->(fresh), (reif)->(ripe), (Bio)->(organic), (TK)->(frozen).\n"
        "- Keep product/ingredient semantics, no recipe-like marketing phrases.\n"
        "- Use concise food naming style.\n"
        "- Do not invent brands unless source name includes one.\n"
        "- Return strictly valid JSON only.\n"
    )
    user = (
        "Convert the following rows.\n"
        "Return object with key `items`, value array of objects: "
        '{"id":"...","name_de":"...","name_en":"..."}.\n'
        f"Rows:\n{rows_json}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _call_openai(api_key: str, model: str, rows: list[NameRow], timeout_seconds: int) -> list[dict[str, str]]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": model,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
        "messages": _build_messages(rows),
    }
    response = requests.post(
        OPENAI_CHAT_COMPLETIONS_URL,
        headers=headers,
        json=payload,
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    items = parsed.get("items")
    if not isinstance(items, list):
        raise ValueError("OpenAI response missing `items` array.")
    output: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "").strip()
        name_de = str(item.get("name_de") or "").strip()
        name_en = str(item.get("name_en") or "").strip()
        if item_id and name_de and name_en:
            output.append({"id": item_id, "name_de": name_de, "name_en": name_en})
    return output


def run(batch_size: int, limit: int | None, model: str, timeout_seconds: int, dry_run: bool) -> dict[str, Any]:
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY missing. Put it in .env or env var.")

    with SessionLocal() as session:
        rows = session.scalars(
            select(NutritionFoodItem)
            .where(and_(NutritionFoodItem.deleted_at.is_(None)))
            .order_by(NutritionFoodItem.id.asc())
        ).all()

        if limit is not None and limit > 0:
            rows = rows[:limit]

        by_id = {row.id: row for row in rows}
        source_rows = [
            NameRow(
                id=row.id,
                source_name=(row.name_de or row.name_en or row.name or "").strip(),
            )
            for row in rows
        ]

        translated = 0
        processed = 0
        batches = 0
        now = datetime.utcnow()
        sample: list[dict[str, str]] = []

        for start in range(0, len(source_rows), batch_size):
            chunk = source_rows[start : start + batch_size]
            if not chunk:
                continue
            batches += 1
            print(f"[batch {batches}] translating {len(chunk)} rows ({start + 1}-{start + len(chunk)}/{len(source_rows)})")
            result_items = _call_openai(api_key=api_key, model=model, rows=chunk, timeout_seconds=timeout_seconds)
            processed += len(chunk)
            for result in result_items:
                row = by_id.get(result["id"])
                if row is None:
                    continue
                new_de = result["name_de"].strip()
                new_en = result["name_en"].strip()
                if not new_de or not new_en:
                    continue
                changed = (row.name_de or "") != new_de or (row.name_en or "") != new_en or (row.name or "") != new_de
                if changed:
                    row.name_de = new_de
                    row.name_en = new_en
                    row.name = new_de
                    row.updated_at = now
                    translated += 1
                if len(sample) < 30:
                    sample.append(
                        {
                            "id": row.id,
                            "name_de": row.name_de or "",
                            "name_en": row.name_en or "",
                        }
                    )

        if not dry_run:
            session.commit()
        else:
            session.rollback()

    out_path = os.path.join("docs", f"name-translation-sample-{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json")
    os.makedirs("docs", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(sample, f, ensure_ascii=False, indent=2)

    return {
        "total_rows": len(source_rows),
        "processed_rows": processed,
        "updated_rows": translated,
        "batches": batches,
        "dry_run": dry_run,
        "sample_file": out_path,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize/translate all food names using OpenAI.")
    parser.add_argument("--batch-size", type=int, default=60)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL)
    parser.add_argument("--timeout-seconds", type=int, default=120)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = run(
        batch_size=max(1, args.batch_size),
        limit=args.limit,
        model=args.model,
        timeout_seconds=max(30, args.timeout_seconds),
        dry_run=args.dry_run,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
