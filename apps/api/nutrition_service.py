from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import func, or_, select

from packages.db.models import (
    NutritionFoodItem,
    NutritionFoodItemOverride,
    NutritionFoodItemSource,
    NutritionMealEntry,
    NutritionMealEntryItem,
    NutritionRecipe,
    NutritionRecipeItem,
    NutritionSyncEvent,
)
from packages.db.session import SessionLocal

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


def _now() -> datetime:
    return datetime.utcnow()


def _new_id() -> str:
    return str(uuid4())


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _calc_macro(per_100g: float | None, amount_g: float) -> float | None:
    if per_100g is None:
        return None
    return float(per_100g) * float(amount_g) / 100.0


FOOD_SCALAR_FIELDS = [
    "name",
    "name_en",
    "name_de",
    "item_kind",
    "category",
    "brand",
    "barcode",
    "health_indicator",
    "kcal_per_100g",
    "protein_per_100g",
    "carbs_per_100g",
    "fat_per_100g",
    "fiber_per_100g",
    "sugar_per_100g",
    "starch_per_100g",
    "saturated_fat_per_100g",
    "monounsaturated_fat_per_100g",
    "polyunsaturated_fat_per_100g",
    "sodium_mg_per_100g",
    "potassium_mg_per_100g",
]


def _normalize_item_kind(value: str | None, *, barcode: str | None = None) -> str:
    raw = (value or "").strip().lower()
    if raw in {"base_ingredient", "product"}:
        return raw
    if (barcode or "").strip():
        return "product"
    return "base_ingredient"


def _normalize_origin_type(value: str | None, default_scope: str) -> str:
    raw = (value or "").strip().lower()
    allowed = {"trusted_source", "manufacturer", "community", "llm", "user_self"}
    if raw in allowed:
        return raw
    return "trusted_source" if default_scope == "global" else "user_self"


def _normalize_verification_status(value: str | None) -> str:
    raw = (value or "").strip().lower()
    allowed = {"unverified", "source_linked", "reviewed", "verified"}
    return raw if raw in allowed else "unverified"


def _default_trust_level(origin_type: str) -> str:
    if origin_type == "trusted_source":
        return "high"
    if origin_type in {"manufacturer", "community"}:
        return "medium"
    if origin_type == "llm":
        return "low"
    return "medium"


def _normalize_trust_level(value: str | None, origin_type: str) -> str:
    raw = (value or "").strip().lower()
    allowed = {"low", "medium", "high"}
    if raw in allowed:
        return raw
    return _default_trust_level(origin_type)


def _normalize_usda_status(value: str | None) -> str:
    raw = (value or "").strip().lower()
    allowed = {"unknown", "valid", "valid_unknown"}
    return raw if raw in allowed else "unknown"


def _normalize_health_indicator(value: str | None) -> str:
    raw = (value or "").strip().lower()
    allowed = {"very_positive", "neutral", "counterproductive"}
    return raw if raw in allowed else "neutral"


def _record_sync_event(session, user_id: int, entity_type: str, entity_id: str, op: str, payload: dict[str, Any]) -> None:
    session.add(
        NutritionSyncEvent(
            user_id=user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            op=op,
            payload_json=json.dumps(payload, ensure_ascii=False),
            updated_at=_now(),
        )
    )


def _entry_payload(session, entry: NutritionMealEntry) -> dict[str, Any]:
    items = session.scalars(
        select(NutritionMealEntryItem)
        .where(NutritionMealEntryItem.meal_entry_id == entry.id)
        .where(NutritionMealEntryItem.deleted_at.is_(None))
        .order_by(NutritionMealEntryItem.created_at.asc())
    ).all()
    return {
        "id": entry.id,
        "consumed_at": _serialize_datetime(entry.consumed_at),
        "meal_type": entry.meal_type,
        "notes": entry.notes,
        "source": entry.source,
        "created_at": _serialize_datetime(entry.created_at),
        "updated_at": _serialize_datetime(entry.updated_at),
        "deleted_at": _serialize_datetime(entry.deleted_at),
        "items": [
            {
                "id": i.id,
                "food_item_id": i.food_item_id,
                "source_recipe_id": i.source_recipe_id,
                "custom_name": i.custom_name,
                "amount_g": i.amount_g,
                "kcal": i.kcal,
                "protein_g": i.protein_g,
                "carbs_g": i.carbs_g,
                "fat_g": i.fat_g,
                "updated_at": _serialize_datetime(i.updated_at),
                "deleted_at": _serialize_datetime(i.deleted_at),
            }
            for i in items
        ],
    }


def _upsert_items_for_entry(session, user_id: int, entry_id: str, items: list[dict[str, Any]]) -> None:
    now = _now()
    existing = session.scalars(
        select(NutritionMealEntryItem)
        .where(NutritionMealEntryItem.meal_entry_id == entry_id)
        .where(NutritionMealEntryItem.deleted_at.is_(None))
    ).all()
    for item in existing:
        item.deleted_at = now
        item.updated_at = now

    for raw in items:
        amount_g = float(raw.get("amount_g") or 0)
        if amount_g <= 0:
            raise ValueError("Each item amount_g must be > 0.")

        food_item_id = raw.get("food_item_id")
        source_recipe_id = raw.get("source_recipe_id")
        food_item = None
        if food_item_id:
            food_item = session.scalar(
                select(NutritionFoodItem)
                .where(NutritionFoodItem.id == str(food_item_id))
                .where(or_(NutritionFoodItem.user_id == user_id, NutritionFoodItem.user_id.is_(None)))
                .where(NutritionFoodItem.deleted_at.is_(None))
            )
            if food_item is None:
                raise ValueError(f"food_item_id not found for user: {food_item_id}")
        if source_recipe_id:
            recipe = session.scalar(
                select(NutritionRecipe)
                .where(NutritionRecipe.id == str(source_recipe_id))
                .where(or_(NutritionRecipe.user_id == user_id, NutritionRecipe.visibility == "public"))
                .where(NutritionRecipe.deleted_at.is_(None))
            )
            if recipe is None:
                raise ValueError(f"source_recipe_id not found for user: {source_recipe_id}")

        kcal = raw.get("kcal")
        protein_g = raw.get("protein_g")
        carbs_g = raw.get("carbs_g")
        fat_g = raw.get("fat_g")

        if food_item is not None:
            if kcal is None:
                kcal = _calc_macro(food_item.kcal_per_100g, amount_g)
            if protein_g is None:
                protein_g = _calc_macro(food_item.protein_per_100g, amount_g)
            if carbs_g is None:
                carbs_g = _calc_macro(food_item.carbs_per_100g, amount_g)
            if fat_g is None:
                fat_g = _calc_macro(food_item.fat_per_100g, amount_g)

        session.add(
            NutritionMealEntryItem(
                id=str(raw.get("id") or _new_id()),
                meal_entry_id=entry_id,
                food_item_id=str(food_item_id) if food_item_id else None,
                source_recipe_id=str(source_recipe_id) if source_recipe_id else None,
                custom_name=(str(raw.get("custom_name")).strip() if raw.get("custom_name") else None),
                amount_g=amount_g,
                kcal=float(kcal) if kcal is not None else None,
                protein_g=float(protein_g) if protein_g is not None else None,
                carbs_g=float(carbs_g) if carbs_g is not None else None,
                fat_g=float(fat_g) if fat_g is not None else None,
                created_at=now,
                updated_at=now,
                deleted_at=None,
            )
        )


def create_entry(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    consumed_at = _parse_datetime(str(payload.get("consumed_at") or ""))
    if consumed_at is None:
        raise ValueError("consumed_at is required (ISO datetime).")

    entry_id = str(payload.get("id") or _new_id())
    items = payload.get("items") or []
    if not isinstance(items, list):
        raise ValueError("items must be a list.")

    now = _now()
    with SessionLocal() as session:
        existing = session.scalar(
            select(NutritionMealEntry)
            .where(NutritionMealEntry.id == entry_id)
            .where(NutritionMealEntry.user_id == user_id)
        )
        if existing is not None and existing.deleted_at is None:
            raise ValueError("Entry already exists.")

        entry = NutritionMealEntry(
            id=entry_id,
            user_id=user_id,
            consumed_at=consumed_at,
            meal_type=(str(payload.get("meal_type")).strip() if payload.get("meal_type") else None),
            notes=(str(payload.get("notes")).strip() if payload.get("notes") else None),
            source=(str(payload.get("source") or "manual").strip() or "manual"),
            created_at=now,
            updated_at=now,
            deleted_at=None,
        )
        session.add(entry)
        _upsert_items_for_entry(session, user_id=user_id, entry_id=entry_id, items=items)
        session.flush()
        data = _entry_payload(session, entry)
        _record_sync_event(session, user_id, "meal_entry", entry_id, "upsert", data)
        session.commit()
        return data


def list_entries(user_id: int, from_iso: str | None = None, to_iso: str | None = None) -> dict[str, Any]:
    from_dt = _parse_datetime(from_iso) if from_iso else None
    to_dt = _parse_datetime(to_iso) if to_iso else None

    with SessionLocal() as session:
        stmt = (
            select(NutritionMealEntry)
            .where(NutritionMealEntry.user_id == user_id)
            .where(NutritionMealEntry.deleted_at.is_(None))
            .order_by(NutritionMealEntry.consumed_at.desc())
        )
        if from_dt is not None:
            stmt = stmt.where(NutritionMealEntry.consumed_at >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(NutritionMealEntry.consumed_at <= to_dt)
        rows = session.scalars(stmt).all()
        return {"entries": [_entry_payload(session, row) for row in rows]}


def update_entry(user_id: int, entry_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    with SessionLocal() as session:
        entry = session.scalar(
            select(NutritionMealEntry)
            .where(NutritionMealEntry.id == entry_id)
            .where(NutritionMealEntry.user_id == user_id)
            .where(NutritionMealEntry.deleted_at.is_(None))
        )
        if entry is None:
            raise ValueError("Entry not found.")

        if "consumed_at" in payload and payload.get("consumed_at"):
            parsed = _parse_datetime(str(payload.get("consumed_at")))
            if parsed is None:
                raise ValueError("Invalid consumed_at.")
            entry.consumed_at = parsed
        if "meal_type" in payload:
            entry.meal_type = (str(payload.get("meal_type")).strip() if payload.get("meal_type") else None)
        if "notes" in payload:
            entry.notes = (str(payload.get("notes")).strip() if payload.get("notes") else None)
        if "source" in payload and payload.get("source"):
            entry.source = str(payload.get("source")).strip()
        if "items" in payload:
            items = payload.get("items") or []
            if not isinstance(items, list):
                raise ValueError("items must be a list.")
            _upsert_items_for_entry(session, user_id=user_id, entry_id=entry_id, items=items)

        entry.updated_at = now
        data = _entry_payload(session, entry)
        _record_sync_event(session, user_id, "meal_entry", entry_id, "upsert", data)
        session.commit()
        return data


def delete_entry(user_id: int, entry_id: str) -> dict[str, Any]:
    now = _now()
    with SessionLocal() as session:
        entry = session.scalar(
            select(NutritionMealEntry)
            .where(NutritionMealEntry.id == entry_id)
            .where(NutritionMealEntry.user_id == user_id)
            .where(NutritionMealEntry.deleted_at.is_(None))
        )
        if entry is None:
            raise ValueError("Entry not found.")

        entry.deleted_at = now
        entry.updated_at = now

        items = session.scalars(
            select(NutritionMealEntryItem)
            .where(NutritionMealEntryItem.meal_entry_id == entry_id)
            .where(NutritionMealEntryItem.deleted_at.is_(None))
        ).all()
        for item in items:
            item.deleted_at = now
            item.updated_at = now

        payload = {"id": entry_id, "deleted_at": _serialize_datetime(now)}
        _record_sync_event(session, user_id, "meal_entry", entry_id, "delete", payload)
        session.commit()
        return {"status": "deleted", "id": entry_id}


def run_sync(user_id: int, last_sync_at: str | None, changes: list[dict[str, Any]]) -> dict[str, Any]:
    applied = 0
    for change in changes:
        entity_type = str(change.get("entity_type") or "").strip().lower()
        op = str(change.get("op") or "").strip().lower()
        payload = change.get("payload") or {}
        if entity_type != "meal_entry":
            continue
        if op == "delete":
            entity_id = str(change.get("entity_id") or payload.get("id") or "").strip()
            if entity_id:
                try:
                    delete_entry(user_id=user_id, entry_id=entity_id)
                    applied += 1
                except ValueError:
                    continue
        elif op == "upsert":
            entity_id = str(change.get("entity_id") or payload.get("id") or "").strip()
            if entity_id:
                try:
                    update_entry(user_id=user_id, entry_id=entity_id, payload=payload)
                except ValueError:
                    create_entry(user_id=user_id, payload={**payload, "id": entity_id})
                applied += 1

    last_dt = _parse_datetime(last_sync_at) if last_sync_at else None
    now = _now()
    with SessionLocal() as session:
        stmt = (
            select(NutritionSyncEvent)
            .where(NutritionSyncEvent.user_id == user_id)
            .order_by(NutritionSyncEvent.updated_at.asc(), NutritionSyncEvent.id.asc())
        )
        if last_dt is not None:
            stmt = stmt.where(NutritionSyncEvent.updated_at > last_dt)
        events = session.scalars(stmt.limit(1000)).all()

    server_changes: list[dict[str, Any]] = []
    for event in events:
        server_changes.append(
            {
                "entity_type": event.entity_type,
                "entity_id": event.entity_id,
                "op": event.op,
                "updated_at": _serialize_datetime(event.updated_at),
                "payload": json.loads(event.payload_json) if event.payload_json else {},
            }
        )

    return {
        "server_time": _serialize_datetime(now),
        "applied_changes": applied,
        "server_changes": server_changes,
    }


def _food_item_payload(
    item: NutritionFoodItem,
    override: NutritionFoodItemOverride | None = None,
    primary_source: NutritionFoodItemSource | None = None,
) -> dict[str, Any]:
    details: dict[str, Any] = {}
    if item.details_json:
        try:
            parsed = json.loads(item.details_json)
            if isinstance(parsed, dict):
                details = parsed
        except json.JSONDecodeError:
            details = {}
    source_type = primary_source.source_type if primary_source else None
    source_name = primary_source.source_name if primary_source else item.source_label
    source_url = primary_source.source_url if primary_source else item.source_url
    payload: dict[str, Any] = {
        "id": item.id,
        "base_item_id": item.id,
        "scope": "global" if item.user_id is None else "user",
        "owner_user_id": item.user_id,
        "has_user_override": override is not None,
        "origin_type": item.origin_type,
        "trust_level": item.trust_level,
        "verification_status": item.verification_status,
        "usda_status": item.usda_status,
        "health_indicator": item.health_indicator,
        "source_type": source_type,
        "source_label": source_name,
        "source_url": source_url,
        "name": item.name_de or item.name_en or item.name,
        "name_en": item.name_en or item.name,
        "name_de": item.name_de,
        "item_kind": item.item_kind or "base_ingredient",
        "category": item.category,
        "brand": item.brand,
        "barcode": item.barcode,
        "kcal_per_100g": item.kcal_per_100g,
        "protein_per_100g": item.protein_per_100g,
        "carbs_per_100g": item.carbs_per_100g,
        "fat_per_100g": item.fat_per_100g,
        "fiber_per_100g": item.fiber_per_100g,
        "sugar_per_100g": item.sugar_per_100g,
        "starch_per_100g": item.starch_per_100g,
        "saturated_fat_per_100g": item.saturated_fat_per_100g,
        "monounsaturated_fat_per_100g": item.monounsaturated_fat_per_100g,
        "polyunsaturated_fat_per_100g": item.polyunsaturated_fat_per_100g,
        "sodium_mg_per_100g": item.sodium_mg_per_100g,
        "potassium_mg_per_100g": item.potassium_mg_per_100g,
        "details": details,
        "created_at": _serialize_datetime(item.created_at),
        "updated_at": _serialize_datetime(item.updated_at),
        "deleted_at": _serialize_datetime(item.deleted_at),
    }
    if override is None:
        return payload

    for field in FOOD_SCALAR_FIELDS:
        value = getattr(override, field)
        if value is not None:
            payload[field] = value

    if override.details_json:
        try:
            parsed = json.loads(override.details_json)
            if isinstance(parsed, dict):
                payload["details"] = parsed
        except json.JSONDecodeError:
            pass
    payload["updated_at"] = _serialize_datetime(max(item.updated_at, override.updated_at))
    return payload


def list_food_items(
    user_id: int,
    query: str | None = None,
    category: str | None = None,
    item_kind: str | None = None,
    limit: int = 30,
) -> dict[str, Any]:
    q = (query or "").strip()
    category_filter = (category or "").strip()
    kind_filter = _normalize_item_kind(item_kind) if (item_kind or "").strip() else ""
    with SessionLocal() as session:
        stmt = (
            select(NutritionFoodItem)
            .where(or_(NutritionFoodItem.user_id == user_id, NutritionFoodItem.user_id.is_(None)))
            .where(NutritionFoodItem.deleted_at.is_(None))
            .order_by(NutritionFoodItem.updated_at.desc())
        )
        if q:
            like = f"%{q}%"
            stmt = stmt.where(
                or_(
                    NutritionFoodItem.name.ilike(like),
                    NutritionFoodItem.name_en.ilike(like),
                    NutritionFoodItem.name_de.ilike(like),
                    NutritionFoodItem.brand.ilike(like),
                    NutritionFoodItem.barcode.ilike(like),
                )
            )
        if category_filter and category_filter.lower() != "alle":
            stmt = stmt.where(NutritionFoodItem.category == category_filter)
        if kind_filter:
            stmt = stmt.where(NutritionFoodItem.item_kind == kind_filter)
            if kind_filter == "product":
                stmt = stmt.where(NutritionFoodItem.category.in_(PRODUCT_CATEGORIES))
            elif kind_filter == "base_ingredient":
                stmt = stmt.where(
                    or_(
                        NutritionFoodItem.category.is_(None),
                        ~NutritionFoodItem.category.in_(PRODUCT_CATEGORIES),
                    )
                )
        raw_items = session.scalars(stmt.limit(max(limit * 3, limit))).all()
        if not raw_items:
            return {"items": []}

        item_ids = [item.id for item in raw_items]
        override_rows = session.scalars(
            select(NutritionFoodItemOverride)
            .where(NutritionFoodItemOverride.user_id == user_id)
            .where(NutritionFoodItemOverride.food_item_id.in_(item_ids))
            .where(NutritionFoodItemOverride.deleted_at.is_(None))
            .order_by(NutritionFoodItemOverride.updated_at.desc())
        ).all()
        override_map: dict[str, NutritionFoodItemOverride] = {}
        for row in override_rows:
            if row.food_item_id not in override_map:
                override_map[row.food_item_id] = row

        source_rows = session.scalars(
            select(NutritionFoodItemSource)
            .where(NutritionFoodItemSource.food_item_id.in_(item_ids))
            .order_by(NutritionFoodItemSource.is_primary.desc(), NutritionFoodItemSource.created_at.desc())
        ).all()
        source_map: dict[str, NutritionFoodItemSource] = {}
        for source in source_rows:
            if source.food_item_id not in source_map:
                source_map[source.food_item_id] = source

        merged = [
            _food_item_payload(item, override=override_map.get(item.id), primary_source=source_map.get(item.id))
            for item in raw_items
        ]
        merged.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
        return {"items": merged[:limit]}


def get_food_item_category_counts(user_id: int, query: str | None = None, item_kind: str | None = None) -> dict[str, Any]:
    q = (query or "").strip()
    kind_filter = _normalize_item_kind(item_kind) if (item_kind or "").strip() else ""
    with SessionLocal() as session:
        stmt = (
            select(
                NutritionFoodItem.category,
                func.count(NutritionFoodItem.id),
            )
            .where(or_(NutritionFoodItem.user_id == user_id, NutritionFoodItem.user_id.is_(None)))
            .where(NutritionFoodItem.deleted_at.is_(None))
        )
        if kind_filter:
            stmt = stmt.where(NutritionFoodItem.item_kind == kind_filter)
            if kind_filter == "product":
                stmt = stmt.where(NutritionFoodItem.category.in_(PRODUCT_CATEGORIES))
            elif kind_filter == "base_ingredient":
                stmt = stmt.where(
                    or_(
                        NutritionFoodItem.category.is_(None),
                        ~NutritionFoodItem.category.in_(PRODUCT_CATEGORIES),
                    )
                )
        if q:
            like = f"%{q}%"
            stmt = stmt.where(
                or_(
                    NutritionFoodItem.name.ilike(like),
                    NutritionFoodItem.name_en.ilike(like),
                    NutritionFoodItem.name_de.ilike(like),
                    NutritionFoodItem.brand.ilike(like),
                    NutritionFoodItem.barcode.ilike(like),
                )
            )
        rows = session.execute(stmt.group_by(NutritionFoodItem.category)).all()
        counts: dict[str, int] = {}
        total = 0
        for category, count in rows:
            c = int(count or 0)
            total += c
            key = str(category or "Unkategorisiert")
            counts[key] = c
        counts["Alle"] = total
        return {"counts": counts}


def create_food_item(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    base_name = str(payload.get("name") or "").strip()
    name_en = str(payload.get("name_en") or "").strip() or base_name
    name_de = str(payload.get("name_de") or "").strip() or base_name
    if not (name_en or name_de):
        raise ValueError("name or name_en/name_de is required.")
    canonical_name = name_en or name_de

    scope = (str(payload.get("scope") or "user").strip().lower() or "user")
    if scope not in {"user", "global"}:
        scope = "user"
    origin_type = _normalize_origin_type(str(payload.get("origin_type") or ""), default_scope=scope)
    verification_status = _normalize_verification_status(str(payload.get("verification_status") or ""))
    trust_level = _normalize_trust_level(str(payload.get("trust_level") or ""), origin_type=origin_type)
    usda_status = _normalize_usda_status(str(payload.get("usda_status") or ""))
    health_indicator = _normalize_health_indicator(str(payload.get("health_indicator") or ""))

    source_label = str(payload.get("source_label")).strip() if payload.get("source_label") else None
    source_url = str(payload.get("source_url")).strip() if payload.get("source_url") else None
    source_type = str(payload.get("source_type")).strip().lower() if payload.get("source_type") else None
    barcode = str(payload.get("barcode")).strip() if payload.get("barcode") else None
    brand = str(payload.get("brand")).strip() if payload.get("brand") else None
    item_kind = _normalize_item_kind(str(payload.get("item_kind") or ""), barcode=barcode)
    if item_kind == "product" and not (brand or barcode):
        raise ValueError("Produkte brauchen mindestens Marke/Hersteller oder Barcode.")

    now = _now()
    with SessionLocal() as session:
        item = NutritionFoodItem(
            id=str(payload.get("id") or _new_id()),
            user_id=(None if scope == "global" else user_id),
            name=canonical_name,
            name_en=(name_en or canonical_name),
            name_de=(name_de or None),
            item_kind=item_kind,
            category=(str(payload.get("category")).strip() if payload.get("category") else None),
            brand=brand,
            barcode=barcode,
            origin_type=origin_type,
            trust_level=trust_level,
            verification_status=verification_status,
            usda_status=usda_status,
            health_indicator=health_indicator,
            source_label=source_label,
            source_url=source_url,
            kcal_per_100g=float(payload["kcal_per_100g"]) if payload.get("kcal_per_100g") is not None else None,
            protein_per_100g=float(payload["protein_per_100g"]) if payload.get("protein_per_100g") is not None else None,
            carbs_per_100g=float(payload["carbs_per_100g"]) if payload.get("carbs_per_100g") is not None else None,
            fat_per_100g=float(payload["fat_per_100g"]) if payload.get("fat_per_100g") is not None else None,
            fiber_per_100g=float(payload["fiber_per_100g"]) if payload.get("fiber_per_100g") is not None else None,
            sugar_per_100g=float(payload["sugar_per_100g"]) if payload.get("sugar_per_100g") is not None else None,
            starch_per_100g=float(payload["starch_per_100g"]) if payload.get("starch_per_100g") is not None else None,
            saturated_fat_per_100g=(
                float(payload["saturated_fat_per_100g"]) if payload.get("saturated_fat_per_100g") is not None else None
            ),
            monounsaturated_fat_per_100g=(
                float(payload["monounsaturated_fat_per_100g"])
                if payload.get("monounsaturated_fat_per_100g") is not None
                else None
            ),
            polyunsaturated_fat_per_100g=(
                float(payload["polyunsaturated_fat_per_100g"])
                if payload.get("polyunsaturated_fat_per_100g") is not None
                else None
            ),
            sodium_mg_per_100g=float(payload["sodium_mg_per_100g"]) if payload.get("sodium_mg_per_100g") is not None else None,
            potassium_mg_per_100g=(
                float(payload["potassium_mg_per_100g"]) if payload.get("potassium_mg_per_100g") is not None else None
            ),
            details_json=(
                json.dumps(payload["details"], ensure_ascii=False)
                if isinstance(payload.get("details"), dict) and payload.get("details")
                else None
            ),
            created_at=now,
            updated_at=now,
            deleted_at=None,
        )
        session.add(item)
        session.flush()
        if source_type or source_label or source_url:
            session.add(
                NutritionFoodItemSource(
                    food_item_id=item.id,
                    source_type=(source_type or origin_type),
                    source_name=source_label,
                    source_url=source_url,
                    citation_text=(str(payload.get("source_citation")).strip() if payload.get("source_citation") else None),
                    is_primary=1,
                    created_at=now,
                )
            )
        session.commit()
        return _food_item_payload(item)


def update_food_item(user_id: int, item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with SessionLocal() as session:
        item = session.scalar(
            select(NutritionFoodItem)
            .where(NutritionFoodItem.id == item_id)
            .where(or_(NutritionFoodItem.user_id == user_id, NutritionFoodItem.user_id.is_(None)))
            .where(NutritionFoodItem.deleted_at.is_(None))
        )
        if item is None:
            raise ValueError("Food item not found.")

        if item.user_id is None:
            override = session.scalar(
                select(NutritionFoodItemOverride)
                .where(NutritionFoodItemOverride.user_id == user_id)
                .where(NutritionFoodItemOverride.food_item_id == item_id)
                .where(NutritionFoodItemOverride.deleted_at.is_(None))
                .order_by(NutritionFoodItemOverride.updated_at.desc())
            )
            if override is None:
                override = NutritionFoodItemOverride(
                    id=_new_id(),
                    user_id=user_id,
                    food_item_id=item_id,
                    created_at=_now(),
                    updated_at=_now(),
                    deleted_at=None,
                )
                session.add(override)

            for field in FOOD_SCALAR_FIELDS:
                if field in payload:
                    value = payload.get(field)
                    if isinstance(value, str):
                        value = value.strip() or None
                    if field == "item_kind":
                        value = _normalize_item_kind(
                            str(value or ""),
                            barcode=str(payload.get("barcode") or item.barcode or ""),
                        )
                    elif value is not None and field in {
                        "kcal_per_100g",
                        "protein_per_100g",
                        "carbs_per_100g",
                        "fat_per_100g",
                        "fiber_per_100g",
                        "sugar_per_100g",
                        "starch_per_100g",
                        "saturated_fat_per_100g",
                        "monounsaturated_fat_per_100g",
                        "polyunsaturated_fat_per_100g",
                        "sodium_mg_per_100g",
                        "potassium_mg_per_100g",
                    }:
                        value = float(value)
                    setattr(override, field, value)

            if "details" in payload:
                override.details_json = (
                    json.dumps(payload["details"], ensure_ascii=False)
                    if isinstance(payload.get("details"), dict) and payload.get("details")
                    else None
                )

            override.updated_at = _now()
            session.commit()
            primary_source = session.scalar(
                select(NutritionFoodItemSource)
                .where(NutritionFoodItemSource.food_item_id == item_id)
                .order_by(NutritionFoodItemSource.is_primary.desc(), NutritionFoodItemSource.created_at.desc())
            )
            return _food_item_payload(item, override=override, primary_source=primary_source)

        if "name" in payload:
            simple_name = str(payload.get("name") or "").strip()
            if not simple_name:
                raise ValueError("name cannot be empty.")
            if "name_en" not in payload:
                payload["name_en"] = simple_name
            if "name_de" not in payload:
                payload["name_de"] = simple_name
        if "name_en" in payload or "name_de" in payload:
            resolved_name_en = str(payload.get("name_en") or item.name_en or item.name or "").strip()
            resolved_name_de = str(payload.get("name_de") or item.name_de or "").strip()
            if not (resolved_name_en or resolved_name_de):
                raise ValueError("name_en or name_de cannot both be empty.")
            item.name_en = resolved_name_en or resolved_name_de
            item.name_de = resolved_name_de or None
            item.name = item.name_en or item.name_de or item.name
        if "category" in payload:
            item.category = str(payload.get("category")).strip() if payload.get("category") else None
        if "brand" in payload:
            item.brand = str(payload.get("brand")).strip() if payload.get("brand") else None
        if "barcode" in payload:
            item.barcode = str(payload.get("barcode")).strip() if payload.get("barcode") else None
        if "item_kind" in payload or "barcode" in payload:
            item.item_kind = _normalize_item_kind(
                str(payload.get("item_kind") or item.item_kind or ""),
                barcode=str(payload.get("barcode") or item.barcode or ""),
            )
        if "kcal_per_100g" in payload:
            item.kcal_per_100g = float(payload["kcal_per_100g"]) if payload.get("kcal_per_100g") is not None else None
        if "protein_per_100g" in payload:
            item.protein_per_100g = float(payload["protein_per_100g"]) if payload.get("protein_per_100g") is not None else None
        if "carbs_per_100g" in payload:
            item.carbs_per_100g = float(payload["carbs_per_100g"]) if payload.get("carbs_per_100g") is not None else None
        if "fat_per_100g" in payload:
            item.fat_per_100g = float(payload["fat_per_100g"]) if payload.get("fat_per_100g") is not None else None
        if "fiber_per_100g" in payload:
            item.fiber_per_100g = float(payload["fiber_per_100g"]) if payload.get("fiber_per_100g") is not None else None
        if "sugar_per_100g" in payload:
            item.sugar_per_100g = float(payload["sugar_per_100g"]) if payload.get("sugar_per_100g") is not None else None
        if "starch_per_100g" in payload:
            item.starch_per_100g = float(payload["starch_per_100g"]) if payload.get("starch_per_100g") is not None else None
        if "saturated_fat_per_100g" in payload:
            item.saturated_fat_per_100g = (
                float(payload["saturated_fat_per_100g"]) if payload.get("saturated_fat_per_100g") is not None else None
            )
        if "monounsaturated_fat_per_100g" in payload:
            item.monounsaturated_fat_per_100g = (
                float(payload["monounsaturated_fat_per_100g"])
                if payload.get("monounsaturated_fat_per_100g") is not None
                else None
            )
        if "polyunsaturated_fat_per_100g" in payload:
            item.polyunsaturated_fat_per_100g = (
                float(payload["polyunsaturated_fat_per_100g"])
                if payload.get("polyunsaturated_fat_per_100g") is not None
                else None
            )
        if "sodium_mg_per_100g" in payload:
            item.sodium_mg_per_100g = (
                float(payload["sodium_mg_per_100g"]) if payload.get("sodium_mg_per_100g") is not None else None
            )
        if "potassium_mg_per_100g" in payload:
            item.potassium_mg_per_100g = (
                float(payload["potassium_mg_per_100g"]) if payload.get("potassium_mg_per_100g") is not None else None
            )
        if "details" in payload:
            item.details_json = (
                json.dumps(payload["details"], ensure_ascii=False)
                if isinstance(payload.get("details"), dict) and payload.get("details")
                else None
            )
        if "origin_type" in payload:
            item.origin_type = _normalize_origin_type(str(payload.get("origin_type") or ""), default_scope="user")
        if "verification_status" in payload:
            item.verification_status = _normalize_verification_status(str(payload.get("verification_status") or ""))
        if "usda_status" in payload:
            item.usda_status = _normalize_usda_status(str(payload.get("usda_status") or ""))
        if "health_indicator" in payload:
            item.health_indicator = _normalize_health_indicator(str(payload.get("health_indicator") or ""))
        if "trust_level" in payload:
            item.trust_level = _normalize_trust_level(
                str(payload.get("trust_level") or ""),
                origin_type=item.origin_type,
            )
        if "source_label" in payload:
            item.source_label = str(payload.get("source_label")).strip() if payload.get("source_label") else None
        if "source_url" in payload:
            item.source_url = str(payload.get("source_url")).strip() if payload.get("source_url") else None

        item.updated_at = _now()
        session.commit()
        return _food_item_payload(item)


def _normalize_recipe_visibility(value: str | None) -> str:
    raw = (value or "").strip().lower()
    return raw if raw in {"private", "public"} else "private"


def _recipe_payload(session, recipe: NutritionRecipe) -> dict[str, Any]:
    item_rows = session.scalars(
        select(NutritionRecipeItem)
        .where(NutritionRecipeItem.recipe_id == recipe.id)
        .where(NutritionRecipeItem.deleted_at.is_(None))
        .order_by(NutritionRecipeItem.sort_index.asc(), NutritionRecipeItem.created_at.asc())
    ).all()
    if not item_rows:
        return {
            "id": recipe.id,
            "name": recipe.name,
            "notes": recipe.notes,
            "visibility": recipe.visibility,
            "created_at": _serialize_datetime(recipe.created_at),
            "updated_at": _serialize_datetime(recipe.updated_at),
            "deleted_at": _serialize_datetime(recipe.deleted_at),
            "total_weight_g": 0.0,
            "kcal": 0.0,
            "protein_g": 0.0,
            "carbs_g": 0.0,
            "fat_g": 0.0,
            "kcal_per_100g": None,
            "protein_per_100g": None,
            "carbs_per_100g": None,
            "fat_per_100g": None,
            "items": [],
        }

    food_item_ids = [row.food_item_id for row in item_rows]
    food_items = session.scalars(
        select(NutritionFoodItem)
        .where(NutritionFoodItem.id.in_(food_item_ids))
        .where(NutritionFoodItem.deleted_at.is_(None))
    ).all()
    by_food_id = {row.id: row for row in food_items}

    total_weight = 0.0
    total_kcal = 0.0
    total_protein = 0.0
    total_carbs = 0.0
    total_fat = 0.0
    items: list[dict[str, Any]] = []
    for row in item_rows:
        food = by_food_id.get(row.food_item_id)
        if food is None:
            continue
        amount = float(row.amount_g)
        kcal = float(_calc_macro(food.kcal_per_100g, amount) or 0.0)
        protein = float(_calc_macro(food.protein_per_100g, amount) or 0.0)
        carbs = float(_calc_macro(food.carbs_per_100g, amount) or 0.0)
        fat = float(_calc_macro(food.fat_per_100g, amount) or 0.0)

        total_weight += amount
        total_kcal += kcal
        total_protein += protein
        total_carbs += carbs
        total_fat += fat
        items.append(
            {
                "id": row.id,
                "food_item_id": row.food_item_id,
                "food_name": food.name_de or food.name_en or food.name,
                "food_kind": food.item_kind,
                "amount_g": amount,
                "kcal": kcal,
                "protein_g": protein,
                "carbs_g": carbs,
                "fat_g": fat,
            }
        )

    factor = (100.0 / total_weight) if total_weight > 0 else None
    return {
        "id": recipe.id,
        "name": recipe.name,
        "notes": recipe.notes,
        "visibility": recipe.visibility,
        "created_at": _serialize_datetime(recipe.created_at),
        "updated_at": _serialize_datetime(recipe.updated_at),
        "deleted_at": _serialize_datetime(recipe.deleted_at),
        "total_weight_g": total_weight,
        "kcal": total_kcal,
        "protein_g": total_protein,
        "carbs_g": total_carbs,
        "fat_g": total_fat,
        "kcal_per_100g": (total_kcal * factor) if factor is not None else None,
        "protein_per_100g": (total_protein * factor) if factor is not None else None,
        "carbs_per_100g": (total_carbs * factor) if factor is not None else None,
        "fat_per_100g": (total_fat * factor) if factor is not None else None,
        "items": items,
    }


def _upsert_recipe_items(session, recipe_id: str, user_id: int, items: list[dict[str, Any]]) -> None:
    if not isinstance(items, list) or len(items) == 0:
        raise ValueError("Recipe needs at least one item.")

    now = _now()
    existing = session.scalars(
        select(NutritionRecipeItem)
        .where(NutritionRecipeItem.recipe_id == recipe_id)
        .where(NutritionRecipeItem.deleted_at.is_(None))
    ).all()
    for item in existing:
        item.deleted_at = now
        item.updated_at = now

    for index, raw in enumerate(items):
        food_item_id = str(raw.get("food_item_id") or "").strip()
        if not food_item_id:
            raise ValueError("Recipe item requires food_item_id.")
        amount_g = float(raw.get("amount_g") or 0.0)
        if amount_g <= 0:
            raise ValueError("Recipe item amount_g must be > 0.")

        food_item = session.scalar(
            select(NutritionFoodItem)
            .where(NutritionFoodItem.id == food_item_id)
            .where(or_(NutritionFoodItem.user_id == user_id, NutritionFoodItem.user_id.is_(None)))
            .where(NutritionFoodItem.deleted_at.is_(None))
        )
        if food_item is None:
            raise ValueError(f"food_item_id not found for user: {food_item_id}")

        session.add(
            NutritionRecipeItem(
                id=str(raw.get("id") or _new_id()),
                recipe_id=recipe_id,
                food_item_id=food_item_id,
                amount_g=amount_g,
                sort_index=int(raw.get("sort_index") or index),
                created_at=now,
                updated_at=now,
                deleted_at=None,
            )
        )


def create_recipe(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Recipe name is required.")
    visibility = _normalize_recipe_visibility(str(payload.get("visibility") or "private"))
    now = _now()
    recipe_id = str(payload.get("id") or _new_id())
    items = payload.get("items") or []
    with SessionLocal() as session:
        recipe = NutritionRecipe(
            id=recipe_id,
            user_id=user_id,
            name=name,
            notes=(str(payload.get("notes")).strip() if payload.get("notes") else None),
            visibility=visibility,
            created_at=now,
            updated_at=now,
            deleted_at=None,
        )
        session.add(recipe)
        _upsert_recipe_items(session, recipe_id=recipe_id, user_id=user_id, items=items)
        session.flush()
        data = _recipe_payload(session, recipe)
        _record_sync_event(session, user_id, "recipe", recipe_id, "upsert", data)
        session.commit()
        return data


def list_recipes(user_id: int, query: str | None = None) -> dict[str, Any]:
    q = (query or "").strip()
    with SessionLocal() as session:
        stmt = (
            select(NutritionRecipe)
            .where(or_(NutritionRecipe.user_id == user_id, NutritionRecipe.visibility == "public"))
            .where(NutritionRecipe.deleted_at.is_(None))
            .order_by(NutritionRecipe.updated_at.desc())
        )
        if q:
            like = f"%{q}%"
            stmt = stmt.where(or_(NutritionRecipe.name.ilike(like), NutritionRecipe.notes.ilike(like)))
        rows = session.scalars(stmt.limit(200)).all()
        return {"recipes": [_recipe_payload(session, row) for row in rows]}


def update_recipe(user_id: int, recipe_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with SessionLocal() as session:
        recipe = session.scalar(
            select(NutritionRecipe)
            .where(NutritionRecipe.id == recipe_id)
            .where(NutritionRecipe.user_id == user_id)
            .where(NutritionRecipe.deleted_at.is_(None))
        )
        if recipe is None:
            raise ValueError("Recipe not found.")

        if "name" in payload:
            name = str(payload.get("name") or "").strip()
            if not name:
                raise ValueError("Recipe name cannot be empty.")
            recipe.name = name
        if "notes" in payload:
            recipe.notes = (str(payload.get("notes")).strip() if payload.get("notes") else None)
        if "visibility" in payload:
            recipe.visibility = _normalize_recipe_visibility(str(payload.get("visibility") or "private"))
        if "items" in payload:
            _upsert_recipe_items(session, recipe_id=recipe.id, user_id=user_id, items=payload.get("items") or [])

        recipe.updated_at = _now()
        data = _recipe_payload(session, recipe)
        _record_sync_event(session, user_id, "recipe", recipe.id, "upsert", data)
        session.commit()
        return data


def create_entry_from_recipe(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    recipe_id = str(payload.get("recipe_id") or "").strip()
    if not recipe_id:
        raise ValueError("recipe_id is required.")
    consumed_amount_g = float(payload.get("amount_g") or 0.0)
    if consumed_amount_g <= 0:
        raise ValueError("amount_g must be > 0.")
    consumed_at = _parse_datetime(str(payload.get("consumed_at") or ""))
    if consumed_at is None:
        raise ValueError("consumed_at is required (ISO datetime).")

    with SessionLocal() as session:
        recipe = session.scalar(
            select(NutritionRecipe)
            .where(NutritionRecipe.id == recipe_id)
            .where(or_(NutritionRecipe.user_id == user_id, NutritionRecipe.visibility == "public"))
            .where(NutritionRecipe.deleted_at.is_(None))
        )
        if recipe is None:
            raise ValueError("Recipe not found.")

        data = _recipe_payload(session, recipe)
        total_weight = float(data.get("total_weight_g") or 0.0)
        if total_weight <= 0:
            raise ValueError("Recipe has no usable total weight.")
        scale = consumed_amount_g / total_weight
        kcal = float(data.get("kcal") or 0.0) * scale
        protein_g = float(data.get("protein_g") or 0.0) * scale
        carbs_g = float(data.get("carbs_g") or 0.0) * scale
        fat_g = float(data.get("fat_g") or 0.0) * scale

    return create_entry(
        user_id=user_id,
        payload={
            "consumed_at": consumed_at.isoformat(),
            "meal_type": payload.get("meal_type"),
            "notes": payload.get("notes"),
            "source": "recipe",
            "items": [
                {
                    "custom_name": f"Rezept: {data['name']}",
                    "source_recipe_id": recipe_id,
                    "amount_g": consumed_amount_g,
                    "kcal": kcal,
                    "protein_g": protein_g,
                    "carbs_g": carbs_g,
                    "fat_g": fat_g,
                }
            ],
        },
    )


def build_food_item_llm_prompt(name: str, brand: str | None = None, category: str | None = None) -> dict[str, str]:
    n = name.strip()
    if not n:
        raise ValueError("name is required.")
    b = (brand or "").strip()
    c = (category or "").strip()
    brand_line = f'"brand": "{b}",' if b else '"brand": null,'
    category_line = f'"category": "{c}",' if c else '"category": null,'

    prompt = (
        "Ermittle möglichst realistische Nährwerte pro 100g für folgende Zutat/Produkt.\n"
        "Nutze wenn verfügbar USDA FoodData Central als Primärquelle.\n"
        "Antworte nur als JSON ohne Markdown, ohne Erklärung.\n\n"
        "Format:\n"
        "{\n"
        f'  "name": "{n}",\n'
        '  "name_en": <string|null>,\n'
        '  "name_de": <string|null>,\n'
        '  "item_kind": "base_ingredient",\n'
        f"  {category_line}\n"
        f"  {brand_line}\n"
        '  "kcal_per_100g": <number|null>,\n'
        '  "protein_per_100g": <number|null>,\n'
        '  "carbs_per_100g": <number|null>,\n'
        '  "fat_per_100g": <number|null>,\n'
        '  "fiber_per_100g": <number|null>,\n'
        '  "sugar_per_100g": <number|null>,\n'
        '  "starch_per_100g": <number|null>,\n'
        '  "saturated_fat_per_100g": <number|null>,\n'
        '  "monounsaturated_fat_per_100g": <number|null>,\n'
        '  "polyunsaturated_fat_per_100g": <number|null>,\n'
        '  "sodium_mg_per_100g": <number|null>,\n'
        '  "potassium_mg_per_100g": <number|null>,\n'
        '  "origin_type": "llm",\n'
        '  "verification_status": "unverified",\n'
        '  "usda_status": "unknown",\n'
        '  "health_indicator": "neutral",\n'
        '  "trust_level": "low",\n'
        '  "source_type": "trusted_source",\n'
        '  "source_label": "USDA FoodData Central",\n'
        '  "source_url": "https://fdc.nal.usda.gov/",\n'
        '  "details": {\n'
        '    "trans_fat_per_100g": <number|null>,\n'
        '    "added_sugar_per_100g": <number|null>,\n'
        '    "net_carbs_per_100g": <number|null>,\n'
        '    "cholesterol_mg_per_100g": <number|null>,\n'
        '    "vitamin_c_mg_per_100g": <number|null>,\n'
        '    "calcium_mg_per_100g": <number|null>,\n'
        '    "magnesium_mg_per_100g": <number|null>\n'
        "  }\n"
        "}\n"
    )
    return {"prompt": prompt}


def import_food_item_from_llm(user_id: int, raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("raw_text is required.")

    cleaned = text
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].strip()
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("Imported content must be a JSON object.")

    payload = {
        "name": data.get("name"),
        "name_en": data.get("name_en"),
        "name_de": data.get("name_de"),
        "category": data.get("category"),
        "item_kind": data.get("item_kind"),
        "brand": data.get("brand"),
        "barcode": data.get("barcode"),
        "scope": data.get("scope") or "user",
        "origin_type": data.get("origin_type") or "llm",
        "verification_status": data.get("verification_status") or "unverified",
        "usda_status": data.get("usda_status") or "unknown",
        "health_indicator": data.get("health_indicator") or "neutral",
        "trust_level": data.get("trust_level") or "low",
        "source_label": data.get("source_label"),
        "source_url": data.get("source_url"),
        "source_type": data.get("source_type") or "llm",
        "source_citation": data.get("source_citation"),
        "kcal_per_100g": data.get("kcal_per_100g"),
        "protein_per_100g": data.get("protein_per_100g"),
        "carbs_per_100g": data.get("carbs_per_100g"),
        "fat_per_100g": data.get("fat_per_100g"),
        "fiber_per_100g": data.get("fiber_per_100g"),
        "sugar_per_100g": data.get("sugar_per_100g"),
        "starch_per_100g": data.get("starch_per_100g"),
        "saturated_fat_per_100g": data.get("saturated_fat_per_100g"),
        "monounsaturated_fat_per_100g": data.get("monounsaturated_fat_per_100g"),
        "polyunsaturated_fat_per_100g": data.get("polyunsaturated_fat_per_100g"),
        "sodium_mg_per_100g": data.get("sodium_mg_per_100g"),
        "potassium_mg_per_100g": data.get("potassium_mg_per_100g"),
        "details": data.get("details") if isinstance(data.get("details"), dict) else None,
    }
    return create_food_item(user_id=user_id, payload=payload)
