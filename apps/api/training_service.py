from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from packages.db.models import UserTrainingMetric, UserTrainingZoneSetting
from packages.db.session import SessionLocal

ALLOWED_METRIC_TYPES = {"ftp", "max_hr"}

DEFAULT_ZONE_COLORS: dict[str, list[str]] = {
    "ftp": ["#7C7691", "#6D8FD0", "#59B78F", "#F1D96A", "#E7A458", "#D45D76", "#B86AD6"],
    "max_hr": ["#7C7691", "#6D8FD0", "#59B78F", "#F1D96A", "#E7A458"],
}

ZONE_MODEL_DEFINITIONS: dict[str, list[dict[str, Any]]] = {
    "ftp": [
        {
            "key": "coggan_classic",
            "label": "Coggan 7 Zonen",
            "description": "Der verbreitete Standard fuer FTP-basierte Leistungszonen.",
            "is_default": True,
            "zones": [
                {"label": "Z1 Active Recovery", "min": 0.0, "max": 0.55, "detail": "Locker rollen und Erholung"},
                {"label": "Z2 Endurance", "min": 0.56, "max": 0.75, "detail": "Ruhige Grundlage"},
                {"label": "Z3 Tempo", "min": 0.76, "max": 0.9, "detail": "Zuegige Ausdauer"},
                {"label": "Z4 Lactate Threshold", "min": 0.91, "max": 1.05, "detail": "Nahe an FTP"},
                {"label": "Z5 VO2max", "min": 1.06, "max": 1.2, "detail": "Kurze harte Intervalle"},
                {"label": "Z6 Anaerobic Capacity", "min": 1.21, "max": 1.5, "detail": "Sehr harte Belastungen"},
                {"label": "Z7 Sprint Open End", "min": 1.51, "max": None, "detail": "Sprint und Spitzenleistung oberhalb von Zone 6"},
            ],
        },
        {
            "key": "ftp_6_simplified",
            "label": "Vereinfacht 6 Zonen",
            "description": "Etwas kompakter fuer alltagsnahe Trainingssteuerung mit FTP.",
            "is_default": False,
            "zones": [
                {"label": "Z1 Recovery", "min": 0.0, "max": 0.55, "detail": "Sehr locker"},
                {"label": "Z2 GA1", "min": 0.56, "max": 0.75, "detail": "Grundlagenausdauer"},
                {"label": "Z3 GA2", "min": 0.76, "max": 0.9, "detail": "Tempobereich"},
                {"label": "Z4 Schwelle", "min": 0.91, "max": 1.05, "detail": "Schwellennahe Arbeit"},
                {"label": "Z5 VO2max", "min": 1.06, "max": 1.2, "detail": "Kurze fordernde Intervalle"},
                {"label": "Z6 Anaerob+", "min": 1.21, "max": 1.5, "detail": "Anaerob und sehr hohe Spitzen"},
                {"label": "Z7 Sprint Open End", "min": 1.51, "max": None, "detail": "Open End fuer Sprints oberhalb von Zone 6"},
            ],
        },
        {
            "key": "seiler_3_power",
            "label": "Seiler 3 Zonen",
            "description": "Kompaktes 3-Zonen-Modell fuer eine grobe Intensitaetslogik.",
            "is_default": False,
            "zones": [
                {"label": "Z1 Niedrig", "min": 0.0, "max": 0.84, "detail": "Locker bis moderat"},
                {"label": "Z2 Mittel", "min": 0.85, "max": 1.0, "detail": "Schwellennaeher Bereich"},
                {"label": "Z3 Hoch", "min": 1.01, "max": 1.5, "detail": "Hohe Intensitaet oberhalb der Schwelle"},
                {"label": "Z4 Sprint Open End", "min": 1.51, "max": None, "detail": "Open End fuer sehr hohe Spitzenleistungen"},
            ],
        },
    ],
    "max_hr": [
        {
            "key": "max_hr_5_classic",
            "label": "Klassisch 5 Zonen",
            "description": "Die gaengigste Einteilung fuer MaxHF-basierte Herzfrequenzzonen.",
            "is_default": True,
            "zones": [
                {"label": "Z1 Recovery", "min": 0.5, "max": 0.6, "detail": "Sehr locker"},
                {"label": "Z2 Grundlage", "min": 0.61, "max": 0.72, "detail": "Ruhige Grundlagenausdauer"},
                {"label": "Z3 Tempo", "min": 0.73, "max": 0.82, "detail": "Kontrolliert fordernd"},
                {"label": "Z4 Schwelle", "min": 0.83, "max": 0.9, "detail": "Schwellennahe Arbeit"},
                {"label": "Z5 Hoch", "min": 0.91, "max": 1.0, "detail": "Maximal und wettkampfnah"},
            ],
        },
        {
            "key": "max_hr_5_even",
            "label": "5 Zonen zu 10 Prozent",
            "description": "Ein verbreitetes einfaches Raster in gleichmaessigen 10-Prozent-Schritten.",
            "is_default": False,
            "zones": [
                {"label": "Z1 Recovery", "min": 0.5, "max": 0.6, "detail": "Sehr locker"},
                {"label": "Z2 Grundlage", "min": 0.6, "max": 0.7, "detail": "Locker aerob"},
                {"label": "Z3 Tempo", "min": 0.7, "max": 0.8, "detail": "Stetige Belastung"},
                {"label": "Z4 Hart", "min": 0.8, "max": 0.9, "detail": "Deutlich fordernd"},
                {"label": "Z5 Maximal", "min": 0.9, "max": 1.0, "detail": "Sehr hart bis maximal"},
            ],
        },
        {
            "key": "max_hr_3_simplified",
            "label": "Vereinfacht 3 Zonen",
            "description": "Grobe Low-Mid-High-Logik fuer einfachere Auswertungen.",
            "is_default": False,
            "zones": [
                {"label": "Z1 Niedrig", "min": 0.5, "max": 0.78, "detail": "Leicht bis moderat"},
                {"label": "Z2 Mittel", "min": 0.79, "max": 0.88, "detail": "Tempo bis Schwelle"},
                {"label": "Z3 Hoch", "min": 0.89, "max": 1.0, "detail": "Hart bis maximal"},
            ],
        },
    ],
}


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


def get_available_zone_models(metric_type: str) -> list[dict[str, Any]]:
    normalized = _normalize_metric_type(metric_type)
    definitions = ZONE_MODEL_DEFINITIONS.get(normalized, [])
    return [
        {
            "key": definition["key"],
            "label": definition["label"],
            "description": definition["description"],
            "is_default": bool(definition.get("is_default")),
        }
        for definition in definitions
    ]


def get_zone_model(metric_type: str, model_key: str | None = None) -> dict[str, Any]:
    normalized = _normalize_metric_type(metric_type)
    definitions = ZONE_MODEL_DEFINITIONS.get(normalized, [])
    if not definitions:
        raise ValueError(f"No zone models configured for {normalized}.")
    if model_key:
        for definition in definitions:
            if definition["key"] == model_key:
                return definition
        raise ValueError(f"Unknown zone model '{model_key}' for metric_type '{normalized}'.")
    for definition in definitions:
        if definition.get("is_default"):
            return definition
    return definitions[0]


def _default_upper_bounds(metric_type: str, model_key: str) -> list[float]:
    definition = get_zone_model(metric_type, model_key)
    return [float(zone["max"]) for zone in definition["zones"][:-1] if zone["max"] is not None]


def _default_colors(metric_type: str, zone_count: int) -> list[str]:
    palette = DEFAULT_ZONE_COLORS.get(metric_type, [])
    if len(palette) >= zone_count:
        return palette[:zone_count]
    return palette + [palette[-1] if palette else "#f2eff7"] * max(0, zone_count - len(palette))


def _parse_zone_config(raw_json: str | None) -> dict[str, Any]:
    if not raw_json:
        return {}
    try:
        payload = json.loads(raw_json)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _validate_hex_color(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) != 7 or not text.startswith("#"):
        raise ValueError("custom_colors must use #RRGGBB format.")
    try:
        int(text[1:], 16)
    except ValueError as exc:
        raise ValueError("custom_colors must use #RRGGBB format.") from exc
    return text.upper()


def _validate_zone_config(metric_type: str, model_key: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    definition = get_zone_model(metric_type, model_key)
    zones = definition["zones"]
    default_upper_bounds = _default_upper_bounds(metric_type, model_key)
    default_colors = _default_colors(metric_type, len(zones))
    incoming = payload or {}

    custom_upper_bounds = incoming.get("custom_upper_bounds")
    if custom_upper_bounds is None:
        normalized_upper_bounds = default_upper_bounds
    else:
        if not isinstance(custom_upper_bounds, list) or len(custom_upper_bounds) != len(default_upper_bounds):
            raise ValueError("custom_upper_bounds has an invalid length.")
        normalized_upper_bounds = [round(float(value), 4) for value in custom_upper_bounds]
        for index, value in enumerate(normalized_upper_bounds):
            min_allowed = float(zones[index]["min"])
            max_allowed = float(zones[index + 1]["max"]) if zones[index + 1]["max"] is not None else max(value, 2.0)
            if value <= min_allowed:
                raise ValueError("custom_upper_bounds must stay above the lower edge of the zone.")
            if index < len(normalized_upper_bounds) - 1 and value >= normalized_upper_bounds[index + 1]:
                raise ValueError("custom_upper_bounds must be strictly increasing.")
            if zones[index]["max"] is not None and index == len(normalized_upper_bounds) - 1 and metric_type == "ftp":
                max_allowed = 3.0
            if value > max_allowed:
                raise ValueError("custom_upper_bounds exceeds the allowed range.")

    custom_colors = incoming.get("custom_colors")
    if custom_colors is None:
        normalized_colors = default_colors
    else:
        if not isinstance(custom_colors, list) or len(custom_colors) != len(zones):
            raise ValueError("custom_colors has an invalid length.")
        normalized_colors = [_validate_hex_color(color) for color in custom_colors]

    return {
        "custom_upper_bounds": normalized_upper_bounds,
        "custom_colors": normalized_colors,
        "is_default": normalized_upper_bounds == default_upper_bounds and normalized_colors == default_colors,
    }


def _serialize_zone_setting(metric_type: str, model_key: str | None = None, raw_config_json: str | None = None) -> dict[str, Any]:
    definition = get_zone_model(metric_type, model_key)
    config = _validate_zone_config(metric_type, definition["key"], _parse_zone_config(raw_config_json))
    return {
        "metric_type": metric_type,
        "model_key": definition["key"],
        "label": definition["label"],
        "description": definition["description"],
        "is_default": bool(definition.get("is_default")),
        "custom_upper_bounds": config["custom_upper_bounds"],
        "custom_colors": config["custom_colors"],
        "has_customizations": not config["is_default"],
    }


def get_user_zone_model_settings(user_id: int) -> dict[str, dict[str, Any]]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(UserTrainingZoneSetting)
            .where(UserTrainingZoneSetting.user_id == user_id)
            .order_by(UserTrainingZoneSetting.metric_type.asc(), UserTrainingZoneSetting.id.asc())
        ).all()

    settings: dict[str, dict[str, Any]] = {}
    for metric_type in ALLOWED_METRIC_TYPES:
        matching = next((row for row in rows if row.metric_type == metric_type), None)
        settings[metric_type] = _serialize_zone_setting(
            metric_type,
            matching.model_key if matching else None,
            matching.config_json if matching else None,
        )
    return settings


def list_training_metrics(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(UserTrainingMetric)
            .where(UserTrainingMetric.user_id == user_id)
            .order_by(UserTrainingMetric.metric_type.asc(), UserTrainingMetric.recorded_at.desc(), UserTrainingMetric.id.desc())
        ).all()
        grouped: dict[str, Any] = {
            "ftp": [],
            "max_hr": [],
            "zone_settings": get_user_zone_model_settings(user_id),
            "available_zone_models": {
                "ftp": get_available_zone_models("ftp"),
                "max_hr": get_available_zone_models("max_hr"),
            },
        }
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


def upsert_training_zone_setting(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    metric_type = _normalize_metric_type(payload.get("metric_type"))
    model_key = str(payload.get("model_key") or "").strip()
    definition = get_zone_model(metric_type, model_key)
    config = _validate_zone_config(metric_type, definition["key"], payload.get("config"))
    config_json = None if config["is_default"] else json.dumps(
        {
            "custom_upper_bounds": config["custom_upper_bounds"],
            "custom_colors": config["custom_colors"],
        }
    )

    with SessionLocal() as session:
        row = session.scalar(
            select(UserTrainingZoneSetting).where(
                UserTrainingZoneSetting.user_id == user_id,
                UserTrainingZoneSetting.metric_type == metric_type,
            )
        )
        now = _now()
        if row is None:
            row = UserTrainingZoneSetting(
                user_id=user_id,
                metric_type=metric_type,
                model_key=definition["key"],
                config_json=config_json,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
        else:
            row.model_key = definition["key"]
            row.config_json = config_json
            row.updated_at = now
        session.flush()
        session.commit()
    return _serialize_zone_setting(metric_type, definition["key"], config_json)


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
