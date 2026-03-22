from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from packages.db.models import UserTrainingMetric
from packages.db.session import SessionLocal

ALLOWED_METRIC_TYPES = {"ftp", "max_hr"}


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


def _normalize_metric_type(value: str | None) -> str:
    metric_type = str(value or "").strip().lower()
    if metric_type == "maxhf":
        metric_type = "max_hr"
    if metric_type not in ALLOWED_METRIC_TYPES:
        raise ValueError("metric_type must be one of: ftp, max_hr.")
    return metric_type


def _validate_metric_value(metric_type: str, value: float | int | None) -> float:
    if value is None:
        raise ValueError("value is required.")
    parsed = float(value)
    if metric_type == "ftp" and (parsed <= 0 or parsed > 2000):
        raise ValueError("FTP must be > 0 and <= 2000.")
    if metric_type == "max_hr" and (parsed <= 0 or parsed > 260):
        raise ValueError("MaxHF must be > 0 and <= 260.")
    return round(parsed, 2)


def _serialize_metric(row: UserTrainingMetric) -> dict[str, Any]:
    return {
        "id": row.id,
        "metric_type": row.metric_type,
        "recorded_at": _serialize_datetime(row.recorded_at),
        "value": row.value,
        "source": row.source,
        "notes": row.notes,
        "created_at": _serialize_datetime(row.created_at),
        "updated_at": _serialize_datetime(row.updated_at),
    }


def list_training_metrics(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(UserTrainingMetric)
            .where(UserTrainingMetric.user_id == user_id)
            .order_by(UserTrainingMetric.metric_type.asc(), UserTrainingMetric.recorded_at.desc(), UserTrainingMetric.id.desc())
        ).all()
        grouped: dict[str, list[dict[str, Any]]] = {"ftp": [], "max_hr": []}
        for row in rows:
            grouped.setdefault(row.metric_type, []).append(_serialize_metric(row))
        return grouped


def get_current_metric_peak(user_id: int, metric_type: str) -> float | None:
    normalized = _normalize_metric_type(metric_type)
    with SessionLocal() as session:
        rows = session.scalars(
            select(UserTrainingMetric.value)
            .where(UserTrainingMetric.user_id == user_id, UserTrainingMetric.metric_type == normalized)
            .order_by(UserTrainingMetric.value.desc(), UserTrainingMetric.recorded_at.desc(), UserTrainingMetric.id.desc())
        ).all()
        return float(rows[0]) if rows else None


def create_training_metric(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    metric_type = _normalize_metric_type(payload.get("metric_type"))
    value = _validate_metric_value(metric_type, payload.get("value"))
    recorded_at = _parse_datetime(str(payload.get("recorded_at") or "")) or _now()
    source = str(payload.get("source") or "").strip()
    if not source:
        raise ValueError("source is required.")
    notes = str(payload.get("notes") or "").strip() or None

    with SessionLocal() as session:
        now = _now()
        row = UserTrainingMetric(
            user_id=user_id,
            metric_type=metric_type,
            recorded_at=recorded_at,
            value=value,
            source=source,
            notes=notes,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.flush()
        payload_out = _serialize_metric(row)
        session.commit()
        return payload_out


def create_imported_max_hr_metric_if_new_peak(
    user_id: int,
    value: float | int | None,
    recorded_at: datetime | None,
    source: str,
    notes: str | None = None,
) -> dict[str, Any] | None:
    parsed_value = _validate_metric_value("max_hr", value)
    current_peak = get_current_metric_peak(user_id=user_id, metric_type="max_hr")
    if current_peak is not None and parsed_value <= current_peak:
        return None
    return create_training_metric(
        user_id=user_id,
        payload={
            "metric_type": "max_hr",
            "recorded_at": _serialize_datetime(recorded_at),
            "value": parsed_value,
            "source": source,
            "notes": notes,
        },
    )


def update_training_metric(user_id: int, metric_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    with SessionLocal() as session:
        row = session.scalar(
            select(UserTrainingMetric).where(UserTrainingMetric.id == metric_id, UserTrainingMetric.user_id == user_id)
        )
        if row is None:
            raise ValueError("Training metric not found.")

        metric_type = row.metric_type
        if "metric_type" in payload and payload.get("metric_type") is not None:
            metric_type = _normalize_metric_type(payload.get("metric_type"))
            row.metric_type = metric_type
        if "value" in payload:
            row.value = _validate_metric_value(metric_type, payload.get("value"))
        if "recorded_at" in payload:
            row.recorded_at = _parse_datetime(str(payload.get("recorded_at") or "")) or _now()
        if "source" in payload:
            source = str(payload.get("source") or "").strip()
            if not source:
                raise ValueError("source is required.")
            row.source = source
        if "notes" in payload:
            row.notes = str(payload.get("notes") or "").strip() or None

        row.updated_at = _now()
        session.flush()
        payload_out = _serialize_metric(row)
        session.commit()
        return payload_out


def delete_training_metric(user_id: int, metric_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        row = session.scalar(
            select(UserTrainingMetric).where(UserTrainingMetric.id == metric_id, UserTrainingMetric.user_id == user_id)
        )
        if row is None:
            raise ValueError("Training metric not found.")
        payload_out = _serialize_metric(row)
        session.delete(row)
        session.commit()
        return {"status": "deleted", "metric": payload_out}
