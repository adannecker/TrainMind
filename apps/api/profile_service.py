from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select

from packages.db.models import User, UserProfile, UserWeightLog
from packages.db.session import SessionLocal


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
            "updated_at": None,
        }
    goal_period_days = None
    if profile.goal_start_date and profile.goal_end_date:
        goal_period_days = int((profile.goal_end_date - profile.goal_start_date).days)
    return {
        "display_name": display_name,
        "date_of_birth": _serialize_date(profile.date_of_birth),
        "gender": profile.gender,
        "current_weight_kg": profile.current_weight_kg,
        "target_weight_kg": profile.target_weight_kg,
        "start_weight_kg": profile.start_weight_kg,
        "goal_start_date": _serialize_datetime(profile.goal_start_date),
        "goal_end_date": _serialize_datetime(profile.goal_end_date),
        "goal_period_days": goal_period_days,
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
            clean_gender = str(payload.get("gender") or "").strip().lower()
            allowed_genders = {"male", "female", "diverse", "unknown"}
            if clean_gender and clean_gender not in allowed_genders:
                raise ValueError("gender must be one of: male, female, diverse, unknown.")
            profile.gender = clean_gender or None
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
