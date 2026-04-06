from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select

from packages.db.models import User, UserProfile, UserWeightLog
from packages.db.session import SessionLocal


DEFAULT_NAV_GROUP_ORDER = ["setup", "activities", "nutrition", "training", "achievements"]
VALID_NAV_GROUP_KEYS = set(DEFAULT_NAV_GROUP_ORDER)
TRAINING_CONFIG_SECTION_KEYS = ("profile", "goals", "week", "sources")


def _now() -> datetime:
    return datetime.utcnow()


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


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def _serialize_date(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _validate_weight(value: float | None, field_name: str) -> float | None:
    if value is None:
        return None
    parsed = float(value)
    if parsed <= 0 or parsed > 500:
        raise ValueError(f"{field_name} must be > 0 and <= 500.")
    return parsed


def _validate_weekly_target(value: float | None, field_name: str, *, upper_bound: float) -> float | None:
    if value is None:
        return None
    parsed = float(value)
    if parsed <= 0 or parsed > upper_bound:
        raise ValueError(f"{field_name} must be > 0 and <= {upper_bound}.")
    return parsed


def _normalize_gender(value: str | None) -> str | None:
    clean_gender = str(value or "").strip().lower()
    if not clean_gender:
        return None
    if clean_gender == "diverse":
        return "unknown"
    allowed_genders = {"male", "female", "unknown"}
    if clean_gender not in allowed_genders:
        raise ValueError("gender must be one of: male, female, unknown.")
    return clean_gender


def _normalize_nav_group_order(value: Any) -> list[str] | None:
    if value is None:
        return None
    parsed = value
    if isinstance(value, str):
        clean_value = value.strip()
        if not clean_value:
            return None
        try:
            parsed = json.loads(clean_value)
        except json.JSONDecodeError as exc:
            raise ValueError("nav_group_order must be valid JSON.") from exc
    if not isinstance(parsed, list):
        raise ValueError("nav_group_order must be a list of group keys.")
    normalized: list[str] = []
    seen: set[str] = set()
    for entry in parsed:
        key = str(entry or "").strip()
        if key not in VALID_NAV_GROUP_KEYS:
            raise ValueError("nav_group_order contains an unknown group key.")
        if key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    missing = [key for key in DEFAULT_NAV_GROUP_ORDER if key not in seen]
    return normalized + missing


def _parse_json_object(value: Any, field_name: str) -> dict[str, Any] | None:
    if value is None:
        return None
    parsed = value
    if isinstance(value, str):
        clean_value = value.strip()
        if not clean_value:
            return None
        try:
            parsed = json.loads(clean_value)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{field_name} must be valid JSON.") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"{field_name} must be an object.")
    return parsed


def _normalize_training_config(value: Any) -> dict[str, Any] | None:
    payload = _parse_json_object(value, "training_config")
    if payload is None:
        return None

    raw_sections = payload.get("sections")
    if raw_sections is None:
        raw_sections = {}
    if not isinstance(raw_sections, dict):
        raise ValueError("training_config.sections must be an object.")

    normalized_sections: dict[str, dict[str, Any]] = {}
    for section_key in TRAINING_CONFIG_SECTION_KEYS:
        raw_section = raw_sections.get(section_key) or {}
        if not isinstance(raw_section, dict):
            raise ValueError("training_config.sections entries must be objects.")

        raw_focus_ids = raw_section.get("focus_ids") or []
        if not isinstance(raw_focus_ids, list):
            raise ValueError("training_config.sections.focus_ids must be a list.")
        focus_ids: list[str] = []
        seen_ids: set[str] = set()
        for entry in raw_focus_ids:
            focus_id = str(entry or "").strip()
            if not focus_id or focus_id in seen_ids:
                continue
            seen_ids.add(focus_id)
            focus_ids.append(focus_id)

        notes = str(raw_section.get("notes") or "").strip()
        normalized_sections[section_key] = {
            "focus_ids": focus_ids,
            "notes": notes,
        }

    return {
        "sections": normalized_sections,
        "updated_at": _now().isoformat(),
    }


def _normalize_training_plan(value: Any) -> dict[str, Any] | None:
    payload = _parse_json_object(value, "training_plan")
    if payload is None:
        return None
    return payload


def _profile_payload(profile: UserProfile | None, user: User | None = None) -> dict[str, Any]:
    display_name = (user.display_name or "") if user is not None else ""
    if profile is None:
        return {
            "display_name": display_name,
            "date_of_birth": None,
            "gender": None,
            "current_weight_kg": None,
            "target_weight_kg": None,
            "start_weight_kg": None,
            "goal_start_date": None,
            "goal_end_date": None,
            "goal_period_days": None,
            "weekly_target_hours": None,
            "weekly_target_stress": None,
            "nav_group_order": None,
            "training_config": None,
            "training_plan": None,
            "updated_at": None,
        }
    goal_period_days = None
    if profile.goal_start_date and profile.goal_end_date:
        goal_period_days = int((profile.goal_end_date - profile.goal_start_date).days)
    return {
        "display_name": display_name,
        "date_of_birth": _serialize_date(profile.date_of_birth),
        "gender": _normalize_gender(profile.gender),
        "current_weight_kg": profile.current_weight_kg,
        "target_weight_kg": profile.target_weight_kg,
        "start_weight_kg": profile.start_weight_kg,
        "goal_start_date": _serialize_datetime(profile.goal_start_date),
        "goal_end_date": _serialize_datetime(profile.goal_end_date),
        "goal_period_days": goal_period_days,
        "weekly_target_hours": profile.weekly_target_hours,
        "weekly_target_stress": profile.weekly_target_stress,
        "nav_group_order": _normalize_nav_group_order(profile.nav_group_order_json),
        "training_config": _parse_json_object(profile.training_config_json, "training_config"),
        "training_plan": _parse_json_object(profile.training_plan_json, "training_plan"),
        "updated_at": _serialize_datetime(profile.updated_at),
    }


def get_user_profile(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        user = session.scalar(select(User).where(User.id == user_id))
        profile = session.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
        return _profile_payload(profile, user)


def upsert_user_profile(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    with SessionLocal() as session:
        user = session.scalar(select(User).where(User.id == user_id))
        if user is None:
            raise ValueError("User not found.")
        profile = session.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
        now = _now()
        if profile is None:
            profile = UserProfile(
                user_id=user_id,
                created_at=now,
                updated_at=now,
            )
            session.add(profile)

        if "display_name" in payload:
            clean_display_name = str(payload.get("display_name") or "").strip()
            user.display_name = clean_display_name or None
        if "date_of_birth" in payload:
            profile.date_of_birth = _parse_date(str(payload.get("date_of_birth") or "")) if payload.get("date_of_birth") else None
        if "gender" in payload:
            profile.gender = _normalize_gender(payload.get("gender"))
        if "current_weight_kg" in payload:
            profile.current_weight_kg = _validate_weight(payload.get("current_weight_kg"), "current_weight_kg")
        if "target_weight_kg" in payload:
            profile.target_weight_kg = _validate_weight(payload.get("target_weight_kg"), "target_weight_kg")
        if "start_weight_kg" in payload:
            profile.start_weight_kg = _validate_weight(payload.get("start_weight_kg"), "start_weight_kg")
        if "goal_start_date" in payload:
            profile.goal_start_date = _parse_datetime(str(payload.get("goal_start_date") or "")) if payload.get("goal_start_date") else None
        if "goal_end_date" in payload:
            profile.goal_end_date = _parse_datetime(str(payload.get("goal_end_date") or "")) if payload.get("goal_end_date") else None
        if "weekly_target_hours" in payload:
            profile.weekly_target_hours = _validate_weekly_target(payload.get("weekly_target_hours"), "weekly_target_hours", upper_bound=60.0)
        if "weekly_target_stress" in payload:
            profile.weekly_target_stress = _validate_weekly_target(payload.get("weekly_target_stress"), "weekly_target_stress", upper_bound=5000.0)
        if "nav_group_order" in payload:
            nav_group_order = _normalize_nav_group_order(payload.get("nav_group_order"))
            profile.nav_group_order_json = json.dumps(nav_group_order) if nav_group_order else None
        if "training_config" in payload:
            training_config = _normalize_training_config(payload.get("training_config"))
            profile.training_config_json = json.dumps(training_config) if training_config else None
        if "training_plan" in payload:
            training_plan = _normalize_training_plan(payload.get("training_plan"))
            profile.training_plan_json = json.dumps(training_plan) if training_plan else None
        if profile.goal_start_date and profile.goal_end_date and profile.goal_end_date < profile.goal_start_date:
            raise ValueError("goal_end_date must be on or after goal_start_date.")

        profile.updated_at = now
        session.commit()
        return _profile_payload(profile, user)


def add_weight_log(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    weight_kg = _validate_weight(payload.get("weight_kg"), "weight_kg")
    if weight_kg is None:
        raise ValueError("weight_kg is required.")
    recorded_at = _parse_datetime(str(payload.get("recorded_at") or "")) or _now()

    with SessionLocal() as session:
        now = _now()
        row = UserWeightLog(
            user_id=user_id,
            recorded_at=recorded_at,
            weight_kg=weight_kg,
            source_type=(str(payload.get("source_type") or "manual").strip().lower() or "manual"),
            source_label=(str(payload.get("source_label")).strip() if payload.get("source_label") else None),
            notes=(str(payload.get("notes")).strip() if payload.get("notes") else None),
            created_at=now,
        )
        session.add(row)

        profile = session.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
        if profile is None:
            profile = UserProfile(
                user_id=user_id,
                start_weight_kg=weight_kg,
                current_weight_kg=weight_kg,
                created_at=now,
                updated_at=now,
            )
            session.add(profile)
        else:
            profile.current_weight_kg = weight_kg
            if profile.start_weight_kg is None:
                profile.start_weight_kg = weight_kg
            profile.updated_at = now

        session.flush()
        payload_out = {
            "id": row.id,
            "recorded_at": _serialize_datetime(row.recorded_at),
            "weight_kg": row.weight_kg,
            "source_type": row.source_type,
            "source_label": row.source_label,
            "notes": row.notes,
            "created_at": _serialize_datetime(row.created_at),
        }
        session.commit()
        return payload_out


def list_weight_logs(user_id: int, limit: int = 100, from_iso: str | None = None, to_iso: str | None = None) -> dict[str, Any]:
    from_dt = _parse_datetime(from_iso) if from_iso else None
    to_dt = _parse_datetime(to_iso) if to_iso else None
    with SessionLocal() as session:
        stmt = select(UserWeightLog).where(UserWeightLog.user_id == user_id).order_by(UserWeightLog.recorded_at.desc())
        if from_dt is not None:
            stmt = stmt.where(UserWeightLog.recorded_at >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(UserWeightLog.recorded_at <= to_dt)
        rows = session.scalars(stmt.limit(max(1, min(int(limit), 500)))).all()
        return {
            "weight_logs": [
                {
                    "id": row.id,
                    "recorded_at": _serialize_datetime(row.recorded_at),
                    "weight_kg": row.weight_kg,
                    "source_type": row.source_type,
                    "source_label": row.source_label,
                    "notes": row.notes,
                    "created_at": _serialize_datetime(row.created_at),
                }
                for row in rows
            ]
        }
