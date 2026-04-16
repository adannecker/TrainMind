from __future__ import annotations

import gzip
import io
import json
import os
import zipfile
from datetime import date, datetime, time, timedelta
from copy import deepcopy
from typing import Any, Callable

from fitparse import FitFile as ParsedFitFile
from sqlalchemy import asc, delete, desc, func, or_, select

from apps.api.achievement_service import ACHIEVEMENT_CHECK_VERSION, get_activity_achievement_check_status, rebuild_activity_achievement_checks
from apps.api.llm_service import DEFAULT_OPENAI_MODEL, openai_chat_completion
from packages.db.models import Activity, ActivityLap, ActivityLlmAnalysisCache, ActivityRecord, ActivitySession, FitFilePayload, UserProfile, UserTrainingMetric
from packages.db.session import SessionLocal


_ACTIVITY_LIST_CACHE_TTL = timedelta(seconds=45)
_activity_list_cache: dict[str, tuple[datetime, dict[str, Any]]] = {}
_ACTIVITY_LLM_ANALYSIS_VERSION = 1
_ACTIVITY_LLM_TODO_NOTE = "TODO: Diese Analyse muss kuenftig zusaetzlich auf das Trainingsziel aus dem Trainingsplan angepasst werden."
MAX_HR_RECHECK_PASSES = 2
DEFAULT_WEEKLY_TARGET_HOURS = 10.0
DEFAULT_WEEKLY_TARGET_STRESS = 300.0


def _duration_label(total_seconds: int | None) -> str | None:
    if total_seconds is None:
        return None
    hours, rem = divmod(total_seconds, 3600)
    minutes, seconds = divmod(rem, 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _stress_from_raw_json(raw_json: str | None) -> float | None:
    if not raw_json:
        return None
    try:
        payload = json.loads(raw_json)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    for key in ("trainingStressScore", "activityTrainingLoad"):
        value = payload.get(key)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def _extract_summary_metric(raw_json: str | None, *keys: str) -> float | None:
    if not raw_json:
        return None
    try:
        payload = json.loads(raw_json)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None

    summary = payload.get("summaryDTO") if isinstance(payload.get("summaryDTO"), dict) else {}
    for key in keys:
        value = payload.get(key)
        if value is None:
            value = summary.get(key)
        if value is None:
            continue
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        if numeric > 0:
            return numeric
    return None


def _extract_summary_text(raw_json: str | None, *keys: str) -> str | None:
    if not raw_json:
        return None
    try:
        payload = json.loads(raw_json)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None

    summary = payload.get("summaryDTO") if isinstance(payload.get("summaryDTO"), dict) else {}
    for key in keys:
        value = payload.get(key)
        if value is None:
            value = summary.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _get_metric_value_at(session, user_id: int, metric_type: str, reference_dt: datetime | None) -> float | None:
    stmt = (
        select(UserTrainingMetric.value)
        .where(UserTrainingMetric.user_id == user_id, UserTrainingMetric.metric_type == metric_type)
        .order_by(UserTrainingMetric.recorded_at.desc(), UserTrainingMetric.id.desc())
    )
    if reference_dt is not None:
        scoped_value = session.scalar(stmt.where(UserTrainingMetric.recorded_at <= reference_dt).limit(1))
        if scoped_value is not None:
            return float(scoped_value)
    fallback_value = session.scalar(stmt.limit(1))
    return float(fallback_value) if fallback_value is not None else None


def _fit_coordinate_to_degrees(value: Any) -> float | None:
    try:
        if value is None:
            return None
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if abs(numeric) <= 180:
        return numeric
    return numeric * (180.0 / 2147483648.0)


def _build_elapsed_power_series(records: list[ActivityRecord]) -> list[tuple[int, int]]:
    series: list[tuple[int, int]] = []
    for index, row in enumerate(records):
        if row.power_w is None:
            continue
        elapsed_raw = row.elapsed_s if row.elapsed_s is not None else index
        try:
            elapsed = max(0, int(round(float(elapsed_raw))))
            power = int(round(float(row.power_w)))
        except (TypeError, ValueError):
            continue
        if series and elapsed <= series[-1][0]:
            elapsed = series[-1][0] + 1
        series.append((elapsed, power))
    return series


def _expand_power_to_seconds(series: list[tuple[int, int]], duration_s: int | None) -> list[float]:
    if not series:
        return []
    max_elapsed = series[-1][0] + 1
    total_seconds = max(max_elapsed, int(duration_s or 0))
    if total_seconds <= 0:
        total_seconds = max_elapsed
    if total_seconds <= 0:
        return []

    values: list[float] = []
    pointer = 0
    current_power = float(series[0][1])
    for second in range(total_seconds):
        while pointer + 1 < len(series) and series[pointer + 1][0] <= second:
            pointer += 1
            current_power = float(series[pointer][1])
        values.append(current_power)
    return values


def _rolling_average(values: list[float], window: int) -> list[float]:
    if not values:
        return []
    if len(values) < window:
        avg = sum(values) / len(values)
        return [avg]
    prefix: list[float] = [0.0]
    for value in values:
        prefix.append(prefix[-1] + value)
    averaged: list[float] = []
    for end in range(window, len(prefix)):
        total = prefix[end] - prefix[end - window]
        averaged.append(total / window)
    return averaged


def _estimate_calories_from_work_kj(total_work_kj: float, eff_metabolic: float = 0.24) -> float | None:
    if total_work_kj <= 0 or eff_metabolic <= 0:
        return None
    return total_work_kj / eff_metabolic / 4.184


def _compute_power_metrics(
    *,
    avg_power_w: float | None,
    duration_s: int | None,
    records: list[ActivityRecord],
    ftp_w: float | None,
) -> dict[str, float | None]:
    series = _build_elapsed_power_series(records)
    second_values = _expand_power_to_seconds(series, duration_s)

    derived_avg_power = None
    if second_values:
        derived_avg_power = sum(second_values) / len(second_values)
    effective_avg_power = float(avg_power_w) if avg_power_w is not None else derived_avg_power

    normalized_power = None
    total_work_kj = None
    if second_values:
        total_work_kj = sum(second_values) / 1000.0
        rolling_30 = _rolling_average(second_values, 30)
        if rolling_30:
            normalized_power = (sum(value ** 4 for value in rolling_30) / len(rolling_30)) ** 0.25

    variability_index = None
    if normalized_power is not None and effective_avg_power and effective_avg_power > 0:
        variability_index = normalized_power / effective_avg_power

    intensity_factor = None
    training_stress_score = None
    if normalized_power is not None and ftp_w and ftp_w > 0:
        intensity_factor = normalized_power / ftp_w
        if duration_s and duration_s > 0:
            training_stress_score = (duration_s * normalized_power * intensity_factor) / (ftp_w * 3600.0) * 100.0

    estimated_calories = None
    if total_work_kj is not None:
        estimated_calories = _estimate_calories_from_work_kj(total_work_kj)
    elif effective_avg_power is not None and duration_s and duration_s > 0:
        estimated_calories = _estimate_calories_from_work_kj((effective_avg_power * duration_s) / 1000.0)

    return {
        "normalized_power_w": normalized_power,
        "intensity_factor": intensity_factor,
        "variability_index": variability_index,
        "training_stress_score": training_stress_score,
        "estimated_calories_kcal": estimated_calories,
        "ftp_reference_w": float(ftp_w) if ftp_w is not None else None,
    }


def _resolve_activity_training_stress_score(
    session,
    *,
    activity: Activity,
    records: list[ActivityRecord] | None = None,
) -> float | None:
    training_stress_score = _stress_from_raw_json(activity.raw_json)
    if training_stress_score is None:
        training_stress_score = _extract_summary_metric(activity.raw_json, "tss", "trainingStressScore")
    if training_stress_score is not None:
        return training_stress_score

    ftp_reference_w = _get_metric_value_at(session, activity.user_id, "ftp_w", activity.started_at)
    if ftp_reference_w is None:
        return None

    resolved_records = records
    if resolved_records is None:
        resolved_records = session.scalars(
            select(ActivityRecord).where(ActivityRecord.activity_id == activity.id).order_by(ActivityRecord.record_index.asc())
        ).all()
    if not resolved_records and activity.source_fit_file_id is not None:
        _sessions, _laps, resolved_records = _hydrate_activity_streams_from_fit(session, activity)

    derived_power_metrics = _compute_power_metrics(
        avg_power_w=activity.avg_power_w,
        duration_s=activity.duration_s,
        records=resolved_records,
        ftp_w=ftp_reference_w,
    )
    return derived_power_metrics["training_stress_score"]


def _activity_list_cache_key(**parts: Any) -> str:
    return json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str)


def _get_cached_activity_list(cache_key: str) -> dict[str, Any] | None:
    cached = _activity_list_cache.get(cache_key)
    if cached is None:
        return None
    expires_at, payload = cached
    if expires_at <= datetime.utcnow():
        _activity_list_cache.pop(cache_key, None)
        return None
    return deepcopy(payload)


def _set_cached_activity_list(cache_key: str, payload: dict[str, Any]) -> None:
    _activity_list_cache[cache_key] = (datetime.utcnow() + _ACTIVITY_LIST_CACHE_TTL, deepcopy(payload))


def clear_activity_list_cache(user_id: int | None = None) -> None:
    if user_id is None:
        _activity_list_cache.clear()
        return
    marker = f'"user_id":{int(user_id)}'
    for key in list(_activity_list_cache.keys()):
        if marker in key:
            _activity_list_cache.pop(key, None)


def _to_week_start(target_day: date) -> date:
    return target_day - timedelta(days=target_day.weekday())


def _to_month_start(target_day: date) -> date:
    return target_day.replace(day=1)


def _to_month_end(target_day: date) -> date:
    month_start = _to_month_start(target_day)
    if month_start.month == 12:
        next_month_start = date(month_start.year + 1, 1, 1)
    else:
        next_month_start = date(month_start.year, month_start.month + 1, 1)
    return next_month_start - timedelta(days=1)


def _activity_sort_value(row: Activity, sort_by: str) -> Any:
    if sort_by == "name":
        return (row.name or "").lower()
    if sort_by == "sport":
        return (row.sport or "").lower()
    if sort_by == "provider":
        return (row.provider or "").lower()
    return getattr(row, sort_by, None)


def _fit_datetime(value: Any) -> datetime | None:
    return value if isinstance(value, datetime) else None


def _fit_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _fit_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _coalesce_fit_float(message, *names: str) -> float | None:
    for name in names:
        value = _fit_float(message.get_value(name))
        if value is not None:
            return value
    return None


def _segment_record_slice(
    records: list[ActivityRecord],
    *,
    activity_start: datetime | None,
    start_time: datetime | None,
    end_time: datetime | None,
    elapsed_from_s: float | None,
    elapsed_to_s: float | None,
) -> list[ActivityRecord]:
    sliced: list[ActivityRecord] = []
    for row in records:
        if row.timestamp is not None and start_time is not None:
            if row.timestamp < start_time:
                continue
            if end_time is not None and row.timestamp >= end_time:
                continue
            sliced.append(row)
            continue
        if row.elapsed_s is not None and elapsed_from_s is not None:
            if row.elapsed_s < elapsed_from_s:
                continue
            if elapsed_to_s is not None and row.elapsed_s >= elapsed_to_s:
                continue
            sliced.append(row)
            continue
        if row.timestamp is not None and activity_start is not None and elapsed_from_s is not None:
            derived_elapsed = (row.timestamp - activity_start).total_seconds()
            if derived_elapsed < elapsed_from_s:
                continue
            if elapsed_to_s is not None and derived_elapsed >= elapsed_to_s:
                continue
            sliced.append(row)
    return sliced


def _derive_record_metrics(records: list[ActivityRecord]) -> dict[str, float | None]:
    power_values = [float(row.power_w) for row in records if row.power_w is not None]
    hr_values = [float(row.heart_rate_bpm) for row in records if row.heart_rate_bpm is not None]
    speed_values = [float(row.speed_mps) * 3.6 for row in records if row.speed_mps is not None]
    return {
        "avg_power_w": (sum(power_values) / len(power_values)) if power_values else None,
        "max_power_w": max(power_values) if power_values else None,
        "avg_hr_bpm": (sum(hr_values) / len(hr_values)) if hr_values else None,
        "max_hr_bpm": max(hr_values) if hr_values else None,
        "avg_speed_kmh": (sum(speed_values) / len(speed_values)) if speed_values else None,
    }


def _unwrap_fit_payload(raw_bytes: bytes) -> bytes | None:
    if not raw_bytes:
        return None

    # Native FIT files usually contain ".FIT" in the header bytes.
    if len(raw_bytes) >= 12 and b".FIT" in raw_bytes[:16]:
        return raw_bytes

    if raw_bytes[:2] == b"\x1f\x8b":
        try:
            inflated = gzip.decompress(raw_bytes)
            if len(inflated) >= 12 and b".FIT" in inflated[:16]:
                return inflated
        except Exception:
            return None

    if raw_bytes[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
                names = archive.namelist()
                fit_names = [name for name in names if name.lower().endswith(".fit")]
                target_name = fit_names[0] if fit_names else (names[0] if names else None)
                if not target_name:
                    return None
                extracted = archive.read(target_name)
                if len(extracted) >= 12 and b".FIT" in extracted[:16]:
                    return extracted
        except Exception:
            return None

    return None


def _parse_json_payload(raw_json: str | None) -> dict[str, Any]:
    if not raw_json:
        return {}
    try:
        payload = json.loads(raw_json)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _derive_activity_environment(
    *,
    provider: str | None,
    sport: str | None,
    name: str | None,
    raw_json: str | None,
    variability_index: float | None = None,
) -> dict[str, Any]:
    provider_text = str(provider or "").strip()
    sport_text = str(sport or "").strip()
    name_text = str(name or "").strip()
    raw_text = str(raw_json or "")
    search_text = " ".join([provider_text, sport_text, name_text, raw_text]).lower()

    virtual_platforms = {
        "rouvy": "ROUVY",
        "zwift": "Zwift",
        "trainerroad": "TrainerRoad",
        "bkool": "BKOOL",
        "rgt": "RGT",
        "mywhoosh": "MyWhoosh",
        "kinomap": "Kinomap",
        "systm": "Wahoo SYSTM",
        "wahoo systm": "Wahoo SYSTM",
        "xert": "Xert",
        "fulgaz": "Fulgaz",
    }
    sport_keywords = (
        "virtual_ride",
        "virtual ride",
        "indoor_cycling",
        "indoor cycling",
        "trainer",
        "smart trainer",
    )

    platform_label = None
    for keyword, label in virtual_platforms.items():
        if keyword in search_text:
            platform_label = label
            break

    is_virtual_ride = platform_label is not None or any(keyword in search_text for keyword in sport_keywords)
    is_indoor_ride = is_virtual_ride or "indoor" in search_text or "trainer" in search_text
    likely_power_controlled = bool(is_virtual_ride and variability_index is not None and variability_index <= 1.03)

    evidence: list[str] = []
    if platform_label:
        evidence.append(f"Plattform erkannt: {platform_label}")
    if sport_text and any(keyword in sport_text.lower() for keyword in ("virtual", "indoor", "trainer")):
        evidence.append(f"Sport-Klassifikation: {sport_text}")
    if name_text and any(keyword in name_text.lower() for keyword in ("workout", "inside", "tempo", "threshold", "interval", "erg")):
        evidence.append(f"Strukturierter Name: {name_text}")
    if likely_power_controlled:
        evidence.append("Sehr niedriger Variability Index spricht fuer eine stark gesteuerte Leistung")

    if is_virtual_ride:
        environment_label = f"Virtueller Ride{f' ({platform_label})' if platform_label else ''}"
    elif is_indoor_ride:
        environment_label = "Indoor Ride"
    else:
        environment_label = "Outdoor oder unbekannt"

    interpretation_note = (
        "Bei virtuellen oder trainergesteuerten Einheiten kann eine sehr gleichmaessige Leistung teilweise durch Plattform oder Erg-Steuerung entstehen und sollte nicht nur als Pacing-Qualitaet interpretiert werden."
        if is_virtual_ride
        else "Keine klare virtuelle Ride-Umgebung erkannt."
    )

    return {
        "environment_label": environment_label,
        "is_virtual_ride": is_virtual_ride,
        "is_indoor_ride": is_indoor_ride,
        "virtual_platform": platform_label,
        "likely_power_controlled": likely_power_controlled,
        "interpretation_note": interpretation_note,
        "evidence": evidence,
    }


def _hydrate_activity_streams_from_fit(session, activity: Activity) -> tuple[list[ActivitySession], list[ActivityLap], list[ActivityRecord]]:
    sessions = session.scalars(
        select(ActivitySession).where(ActivitySession.activity_id == activity.id).order_by(ActivitySession.session_index.asc())
    ).all()
    laps = session.scalars(
        select(ActivityLap).where(ActivityLap.activity_id == activity.id).order_by(ActivityLap.lap_index.asc())
    ).all()
    records = session.scalars(
        select(ActivityRecord).where(ActivityRecord.activity_id == activity.id).order_by(ActivityRecord.record_index.asc())
    ).all()

    if sessions and laps and records:
        has_usable_elapsed = any(record.elapsed_s is not None and float(record.elapsed_s) >= 0 for record in records)
        if has_usable_elapsed:
            return sessions, laps, records
    if activity.source_fit_file_id is None:
        return sessions, laps, records

    payload = session.scalar(select(FitFilePayload).where(FitFilePayload.fit_file_id == activity.source_fit_file_id))
    if payload is None or not payload.content:
        return sessions, laps, records

    fit_bytes = _unwrap_fit_payload(payload.content)
    if not fit_bytes:
        return sessions, laps, records

    try:
        fit = ParsedFitFile(io.BytesIO(fit_bytes))
    except Exception:
        return sessions, laps, records
    start_time = activity.started_at

    parsed_sessions: list[ActivitySession] = []
    parsed_laps: list[ActivityLap] = []
    parsed_records: list[ActivityRecord] = []

    for index, message in enumerate(fit.get_messages("session")):
        parsed_sessions.append(
            ActivitySession(
                activity_id=activity.id,
                session_index=index,
                start_time=_fit_datetime(message.get_value("start_time")) or _fit_datetime(message.get_value("timestamp")) or start_time,
                total_elapsed_time_s=_fit_float(message.get_value("total_elapsed_time")),
                total_timer_time_s=_fit_float(message.get_value("total_timer_time")),
                total_distance_m=_fit_float(message.get_value("total_distance")),
                avg_speed_mps=_coalesce_fit_float(message, "avg_speed", "enhanced_avg_speed", "average_speed"),
                max_speed_mps=_coalesce_fit_float(message, "max_speed", "enhanced_max_speed", "maximum_speed"),
                avg_power_w=_coalesce_fit_float(message, "avg_power", "total_average_power", "average_power"),
                max_power_w=_fit_float(message.get_value("max_power")),
                avg_hr_bpm=_coalesce_fit_float(message, "avg_heart_rate", "total_average_heart_rate", "total_average_hr", "average_heart_rate"),
                max_hr_bpm=_fit_float(message.get_value("max_heart_rate")),
            )
        )

    for index, message in enumerate(fit.get_messages("lap"), start=1):
        parsed_laps.append(
            ActivityLap(
                activity_id=activity.id,
                lap_index=index,
                start_time=_fit_datetime(message.get_value("start_time")) or _fit_datetime(message.get_value("timestamp")) or start_time,
                total_elapsed_time_s=_fit_float(message.get_value("total_elapsed_time")),
                total_timer_time_s=_fit_float(message.get_value("total_timer_time")),
                total_distance_m=_fit_float(message.get_value("total_distance")),
                avg_speed_mps=_coalesce_fit_float(message, "avg_speed", "enhanced_avg_speed", "average_speed"),
                avg_power_w=_coalesce_fit_float(message, "avg_power", "total_average_power", "average_power"),
                max_power_w=_fit_float(message.get_value("max_power")),
                avg_hr_bpm=_coalesce_fit_float(message, "avg_heart_rate", "total_average_heart_rate", "total_average_hr", "average_heart_rate"),
                max_hr_bpm=_fit_float(message.get_value("max_heart_rate")),
            )
        )

    record_start = parsed_sessions[0].start_time if parsed_sessions and parsed_sessions[0].start_time is not None else None
    for index, message in enumerate(fit.get_messages("record")):
        record_time = _fit_datetime(message.get_value("timestamp"))
        if record_start is None and record_time is not None:
            record_start = record_time
        elapsed_s = None
        if record_time is not None and record_start is not None:
            elapsed_s = float((record_time - record_start).total_seconds())
        parsed_records.append(
            ActivityRecord(
                activity_id=activity.id,
                record_index=index,
                timestamp=record_time,
                elapsed_s=elapsed_s,
                distance_m=_fit_float(message.get_value("distance")),
                latitude_deg=_fit_coordinate_to_degrees(message.get_value("position_lat")),
                longitude_deg=_fit_coordinate_to_degrees(message.get_value("position_long")),
                altitude_m=_fit_float(message.get_value("enhanced_altitude") or message.get_value("altitude")),
                speed_mps=_fit_float(message.get_value("enhanced_speed") or message.get_value("speed")),
                heart_rate_bpm=_fit_int(message.get_value("heart_rate")),
                cadence_rpm=_fit_int(message.get_value("cadence")),
                power_w=_fit_int(message.get_value("power")),
                temperature_c=_fit_float(message.get_value("temperature")),
            )
        )

    if parsed_sessions or parsed_laps or parsed_records:
        try:
            # SessionLocal runs with autoflush=False.
            # If callers have queued lap/session/record inserts for this activity,
            # we must flush first so the bulk deletes below can remove them before
            # re-inserting parsed FIT rows with identical unique keys.
            session.flush()
            session.execute(delete(ActivitySession).where(ActivitySession.activity_id == activity.id))
            session.execute(delete(ActivityLap).where(ActivityLap.activity_id == activity.id))
            session.execute(delete(ActivityRecord).where(ActivityRecord.activity_id == activity.id))
            session.flush()
            if parsed_sessions:
                session.add_all(parsed_sessions)
            if parsed_laps:
                session.add_all(parsed_laps)
            if parsed_records:
                session.add_all(parsed_records)
            session.commit()
        except Exception:
            session.rollback()
            raise

        sessions = session.scalars(
            select(ActivitySession).where(ActivitySession.activity_id == activity.id).order_by(ActivitySession.session_index.asc())
        ).all()
        laps = session.scalars(
            select(ActivityLap).where(ActivityLap.activity_id == activity.id).order_by(ActivityLap.lap_index.asc())
        ).all()
        records = session.scalars(
            select(ActivityRecord).where(ActivityRecord.activity_id == activity.id).order_by(ActivityRecord.record_index.asc())
        ).all()
        clear_activity_list_cache(user_id=int(activity.user_id))

    return sessions, laps, records


def _resolve_activity_total_ascent_m(session, activity: Activity) -> float:
    summary_altitude_gain_m = _extract_summary_metric(
        activity.raw_json,
        "elevationGain",
        "totalAscent",
        "totalAscentInMeters",
        "elevationGainInMeters",
    )
    if summary_altitude_gain_m is not None:
        return max(0.0, float(summary_altitude_gain_m))

    altitude_rows = session.scalars(
        select(ActivityRecord.altitude_m)
        .where(ActivityRecord.activity_id == activity.id)
        .where(ActivityRecord.altitude_m.is_not(None))
        .order_by(ActivityRecord.record_index.asc())
    ).all()
    altitude_values = [float(value) for value in altitude_rows if value is not None]
    if not altitude_values and activity.source_fit_file_id is not None:
        try:
            _sessions, _laps, hydrated_records = _hydrate_activity_streams_from_fit(session, activity)
            altitude_values = [float(row.altitude_m) for row in hydrated_records if row.altitude_m is not None]
        except Exception:
            session.rollback()
            altitude_values = []
    if not altitude_values:
        return 0.0
    return round(max(0.0, float(_sum_positive_deltas(altitude_values))), 1)


def get_weekly_activities(user_id: int, reference_date: str | None = None) -> dict[str, Any]:
    if reference_date:
        ref_day = date.fromisoformat(reference_date)
    else:
        ref_day = datetime.utcnow().date()

    week_start = _to_week_start(ref_day)
    week_end = week_start + timedelta(days=6)
    range_start = datetime.combine(week_start, time.min)
    range_end = datetime.combine(week_end + timedelta(days=1), time.min)

    with SessionLocal() as session:
        profile = session.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
        rows = session.scalars(
            select(Activity)
            .where(Activity.started_at.is_not(None))
            .where(Activity.user_id == user_id)
            .where(Activity.started_at >= range_start)
            .where(Activity.started_at < range_end)
            .order_by(Activity.started_at.asc())
        ).all()

        weekly_target_hours = float(profile.weekly_target_hours) if profile and profile.weekly_target_hours is not None else DEFAULT_WEEKLY_TARGET_HOURS
        weekly_target_stress = float(profile.weekly_target_stress) if profile and profile.weekly_target_stress is not None else DEFAULT_WEEKLY_TARGET_STRESS
        goal_is_custom = bool(profile and (profile.weekly_target_hours is not None or profile.weekly_target_stress is not None))

        by_day: dict[date, list[dict[str, Any]]] = {week_start + timedelta(days=i): [] for i in range(7)}

        week_moving_s = 0
        week_distance_m = 0.0
        week_total_ascent_m = 0.0
        week_stress_total = 0.0
        week_stress_count = 0

        for row in rows:
            start_time = row.started_at
            if start_time is None:
                continue

            end_time = None
            if row.duration_s is not None:
                end_time = start_time + timedelta(seconds=row.duration_s)

            avg_speed_kmh = None
            if row.duration_s and row.duration_s > 0 and row.distance_m is not None:
                avg_speed_kmh = (row.distance_m / row.duration_s) * 3.6

            stress_score = _resolve_activity_training_stress_score(session, activity=row)
            total_ascent_m = round(_resolve_activity_total_ascent_m(session, row), 1)

            by_day[start_time.date()].append(
                {
                    "id": row.id,
                    "name": row.name or "Unbenannte Aktivität",
                    "provider": row.provider,
                    "start_time": start_time.isoformat(),
                    "end_time": end_time.isoformat() if end_time else None,
                    "duration_s": row.duration_s,
                    "duration_label": _duration_label(row.duration_s),
                    "distance_m": row.distance_m,
                    "total_ascent_m": total_ascent_m,
                    "avg_power_w": row.avg_power_w,
                    "avg_speed_kmh": avg_speed_kmh,
                    "stress_score": stress_score,
                }
            )

            if row.duration_s:
                week_moving_s += row.duration_s
            if row.distance_m:
                week_distance_m += float(row.distance_m)
            week_total_ascent_m += float(total_ascent_m)
            if stress_score is not None:
                week_stress_total += stress_score
                week_stress_count += 1

        weekday_labels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
        days: list[dict[str, Any]] = []
        for i in range(7):
            day = week_start + timedelta(days=i)
            activities = by_day[day]

            day_moving_s = sum(a["duration_s"] or 0 for a in activities)
            day_distance_m = sum(float(a["distance_m"] or 0) for a in activities)
            day_total_ascent_m = round(sum(float(a["total_ascent_m"] or 0) for a in activities), 1)
            stress_values = [float(a["stress_score"]) for a in activities if a["stress_score"] is not None]

            days.append(
                {
                    "date": day.isoformat(),
                    "weekday_short": weekday_labels[i],
                    "activities": activities,
                    "summary": {
                        "activities_count": len(activities),
                        "moving_time_s": day_moving_s,
                        "moving_time_label": _duration_label(day_moving_s),
                        "distance_m": day_distance_m,
                        "total_ascent_m": day_total_ascent_m,
                        "stress_total": sum(stress_values) if stress_values else None,
                        "stress_avg": (sum(stress_values) / len(stress_values)) if stress_values else None,
                    },
                }
            )

        return {
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "days": days,
            "summary": {
                "activities_count": len(rows),
                "moving_time_s": week_moving_s,
                "moving_time_label": _duration_label(week_moving_s),
                "distance_m": week_distance_m,
                "total_ascent_m": round(week_total_ascent_m, 1),
                "stress_total": week_stress_total if week_stress_count > 0 else None,
                "stress_avg": (week_stress_total / week_stress_count) if week_stress_count > 0 else None,
                "goal": {
                    "target_hours": weekly_target_hours,
                    "target_stress": weekly_target_stress,
                    "is_custom": goal_is_custom,
                },
            },
        }


def get_available_activity_weeks(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(Activity.started_at)
            .where(Activity.started_at.is_not(None))
            .where(Activity.user_id == user_id)
            .order_by(Activity.started_at.desc())
        ).all()

    week_counts: dict[date, int] = {}
    for started_at in rows:
        if started_at is None:
            continue
        week_start = _to_week_start(started_at.date())
        week_counts[week_start] = week_counts.get(week_start, 0) + 1

    weeks = []
    for week_start, count in sorted(week_counts.items(), key=lambda x: x[0], reverse=True):
        week_end = week_start + timedelta(days=6)
        weeks.append(
            {
                "week_start": week_start.isoformat(),
                "week_end": week_end.isoformat(),
                "activities_count": count,
            }
        )

    return {"weeks": weeks}


def get_monthly_activities(user_id: int, reference_date: str | None = None) -> dict[str, Any]:
    if reference_date:
        ref_day = date.fromisoformat(reference_date)
    else:
        ref_day = datetime.utcnow().date()

    month_start = _to_month_start(ref_day)
    month_end = _to_month_end(ref_day)
    range_start = datetime.combine(month_start, time.min)
    range_end = datetime.combine(month_end + timedelta(days=1), time.min)

    with SessionLocal() as session:
        rows = session.scalars(
            select(Activity)
            .where(Activity.started_at.is_not(None))
            .where(Activity.user_id == user_id)
            .where(Activity.started_at >= range_start)
            .where(Activity.started_at < range_end)
            .order_by(Activity.started_at.asc())
        ).all()

        by_day: dict[date, list[dict[str, Any]]] = {month_start + timedelta(days=i): [] for i in range((month_end - month_start).days + 1)}
        month_moving_s = 0
        month_distance_m = 0.0
        month_total_ascent_m = 0.0
        month_stress_total = 0.0
        month_stress_count = 0

        for row in rows:
            start_time = row.started_at
            if start_time is None:
                continue

            end_time = None
            if row.duration_s is not None:
                end_time = start_time + timedelta(seconds=row.duration_s)

            avg_speed_kmh = None
            if row.duration_s and row.duration_s > 0 and row.distance_m is not None:
                avg_speed_kmh = (row.distance_m / row.duration_s) * 3.6

            stress_score = _resolve_activity_training_stress_score(session, activity=row)
            total_ascent_m = round(_resolve_activity_total_ascent_m(session, row), 1)
            payload = {
                "id": row.id,
                "name": row.name or "Unbenannte Aktivität",
                "provider": row.provider,
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat() if end_time else None,
                "duration_s": row.duration_s,
                "duration_label": _duration_label(row.duration_s),
                "distance_m": row.distance_m,
                "total_ascent_m": total_ascent_m,
                "avg_power_w": row.avg_power_w,
                "avg_speed_kmh": avg_speed_kmh,
                "stress_score": stress_score,
            }
            by_day[start_time.date()].append(payload)

            if row.duration_s:
                month_moving_s += row.duration_s
            if row.distance_m:
                month_distance_m += float(row.distance_m)
            month_total_ascent_m += float(total_ascent_m)
            if stress_score is not None:
                month_stress_total += stress_score
                month_stress_count += 1

        weekday_labels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
        days: list[dict[str, Any]] = []
        cursor = month_start
        while cursor <= month_end:
            activities = by_day[cursor]
            day_moving_s = sum(a["duration_s"] or 0 for a in activities)
            day_distance_m = sum(float(a["distance_m"] or 0) for a in activities)
            day_total_ascent_m = round(sum(float(a["total_ascent_m"] or 0) for a in activities), 1)
            stress_values = [float(a["stress_score"]) for a in activities if a["stress_score"] is not None]
            days.append(
                {
                    "date": cursor.isoformat(),
                    "day": cursor.day,
                    "weekday_short": weekday_labels[cursor.weekday()],
                    "activities": activities,
                    "summary": {
                        "activities_count": len(activities),
                        "moving_time_s": day_moving_s,
                        "moving_time_label": _duration_label(day_moving_s),
                        "distance_m": day_distance_m,
                        "total_ascent_m": day_total_ascent_m,
                        "stress_total": sum(stress_values) if stress_values else None,
                        "stress_avg": (sum(stress_values) / len(stress_values)) if stress_values else None,
                    },
                }
            )
            cursor += timedelta(days=1)

        return {
            "month_start": month_start.isoformat(),
            "month_end": month_end.isoformat(),
            "month_label": month_start.strftime("%B %Y"),
            "days": days,
            "summary": {
                "activities_count": len(rows),
                "moving_time_s": month_moving_s,
                "moving_time_label": _duration_label(month_moving_s),
                "distance_m": month_distance_m,
                "total_ascent_m": round(month_total_ascent_m, 1),
                "stress_total": month_stress_total if month_stress_count > 0 else None,
                "stress_avg": (month_stress_total / month_stress_count) if month_stress_count > 0 else None,
                "active_days": len([day for day in days if day["summary"]["activities_count"] > 0]),
            },
        }


def get_available_activity_months(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(Activity.started_at)
            .where(Activity.started_at.is_not(None))
            .where(Activity.user_id == user_id)
            .order_by(Activity.started_at.desc())
        ).all()

    month_counts: dict[date, int] = {}
    for started_at in rows:
        if started_at is None:
            continue
        month_start = _to_month_start(started_at.date())
        month_counts[month_start] = month_counts.get(month_start, 0) + 1

    months = []
    for month_start, count in sorted(month_counts.items(), key=lambda item: item[0], reverse=True):
        month_end = _to_month_end(month_start)
        months.append(
            {
                "month_start": month_start.isoformat(),
                "month_end": month_end.isoformat(),
                "month_label": month_start.strftime("%B %Y"),
                "activities_count": count,
            }
        )

    return {"months": months}


def list_activities(
    user_id: int,
    query: str | None = None,
    provider: str | None = None,
    sport: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    avg_power_min: float | None = None,
    avg_power_max: float | None = None,
    avg_hr_min: float | None = None,
    avg_hr_max: float | None = None,
    avg_speed_min: float | None = None,
    avg_speed_max: float | None = None,
    distance_min_km: float | None = None,
    distance_max_km: float | None = None,
    duration_min_min: float | None = None,
    duration_max_min: float | None = None,
    sort_by: str = "started_at",
    sort_dir: str = "desc",
    limit: int = 250,
) -> dict[str, Any]:
    cache_key = _activity_list_cache_key(
        user_id=user_id,
        query=query,
        provider=provider,
        sport=sport,
        date_from=date_from,
        date_to=date_to,
        avg_power_min=avg_power_min,
        avg_power_max=avg_power_max,
        avg_hr_min=avg_hr_min,
        avg_hr_max=avg_hr_max,
        avg_speed_min=avg_speed_min,
        avg_speed_max=avg_speed_max,
        distance_min_km=distance_min_km,
        distance_max_km=distance_max_km,
        duration_min_min=duration_min_min,
        duration_max_min=duration_max_min,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
    )
    cached = _get_cached_activity_list(cache_key)
    if cached is not None:
        return cached

    valid_sort_fields = {
        "started_at": Activity.started_at,
        "name": func.lower(func.coalesce(Activity.name, "")),
        "sport": func.lower(func.coalesce(Activity.sport, "")),
        "provider": func.lower(func.coalesce(Activity.provider, "")),
        "duration_s": Activity.duration_s,
        "distance_m": Activity.distance_m,
        "avg_power_w": Activity.avg_power_w,
        "avg_hr_bpm": Activity.avg_hr_bpm,
    }
    sort_column = valid_sort_fields.get(sort_by, Activity.started_at)
    sort_direction = desc if str(sort_dir).lower() != "asc" else asc

    from_dt: datetime | None = None
    to_dt: datetime | None = None
    if date_from:
        from_dt = datetime.combine(date.fromisoformat(date_from), time.min)
    if date_to:
        to_dt = datetime.combine(date.fromisoformat(date_to) + timedelta(days=1), time.min)

    clean_query = (query or "").strip()
    clean_provider = (provider or "").strip().lower()
    clean_sport = (sport or "").strip().lower()
    safe_limit = max(1, min(int(limit), 1000))

    with SessionLocal() as session:
        stmt = select(Activity).where(Activity.user_id == user_id)

        if clean_query:
            like_term = f"%{clean_query.lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(func.coalesce(Activity.name, "")).like(like_term),
                    func.lower(func.coalesce(Activity.provider, "")).like(like_term),
                    func.lower(func.coalesce(Activity.sport, "")).like(like_term),
                    func.coalesce(Activity.external_id, "").like(f"%{clean_query}%"),
                )
            )
        if clean_provider:
            stmt = stmt.where(func.lower(func.coalesce(Activity.provider, "")) == clean_provider)
        if clean_sport:
            stmt = stmt.where(func.lower(func.coalesce(Activity.sport, "")) == clean_sport)
        if from_dt is not None:
            stmt = stmt.where(Activity.started_at.is_not(None)).where(Activity.started_at >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(Activity.started_at.is_not(None)).where(Activity.started_at < to_dt)
        if avg_power_min is not None:
            stmt = stmt.where(Activity.avg_power_w.is_not(None)).where(Activity.avg_power_w >= float(avg_power_min))
        if avg_power_max is not None:
            stmt = stmt.where(Activity.avg_power_w.is_not(None)).where(Activity.avg_power_w <= float(avg_power_max))
        if avg_hr_min is not None:
            stmt = stmt.where(Activity.avg_hr_bpm.is_not(None)).where(Activity.avg_hr_bpm >= float(avg_hr_min))
        if avg_hr_max is not None:
            stmt = stmt.where(Activity.avg_hr_bpm.is_not(None)).where(Activity.avg_hr_bpm <= float(avg_hr_max))
        if avg_speed_min is not None:
            stmt = stmt.where(Activity.duration_s.is_not(None), Activity.duration_s > 0, Activity.distance_m.is_not(None))
            stmt = stmt.where(((Activity.distance_m / Activity.duration_s) * 3.6) >= float(avg_speed_min))
        if avg_speed_max is not None:
            stmt = stmt.where(Activity.duration_s.is_not(None), Activity.duration_s > 0, Activity.distance_m.is_not(None))
            stmt = stmt.where(((Activity.distance_m / Activity.duration_s) * 3.6) <= float(avg_speed_max))
        if distance_min_km is not None:
            stmt = stmt.where(Activity.distance_m.is_not(None)).where(Activity.distance_m >= float(distance_min_km) * 1000.0)
        if distance_max_km is not None:
            stmt = stmt.where(Activity.distance_m.is_not(None)).where(Activity.distance_m <= float(distance_max_km) * 1000.0)
        if duration_min_min is not None:
            stmt = stmt.where(Activity.duration_s.is_not(None)).where(Activity.duration_s >= float(duration_min_min) * 60.0)
        if duration_max_min is not None:
            stmt = stmt.where(Activity.duration_s.is_not(None)).where(Activity.duration_s <= float(duration_max_min) * 60.0)

        rows = session.scalars(
            stmt.order_by(sort_direction(sort_column).nulls_last(), Activity.id.desc()).limit(safe_limit)
        ).all()

        provider_options = session.scalars(
            select(Activity.provider)
            .where(Activity.user_id == user_id, Activity.provider.is_not(None))
            .distinct()
            .order_by(asc(Activity.provider))
        ).all()
        sport_options = session.scalars(
            select(Activity.sport)
            .where(Activity.user_id == user_id, Activity.sport.is_not(None))
            .distinct()
            .order_by(asc(Activity.sport))
        ).all()

        items: list[dict[str, Any]] = []
        for row in rows:
            avg_speed_kmh = None
            if row.duration_s and row.duration_s > 0 and row.distance_m is not None:
                avg_speed_kmh = (row.distance_m / row.duration_s) * 3.6
            stress_score = _resolve_activity_training_stress_score(session, activity=row)
            items.append(
                {
                    "id": row.id,
                    "external_id": row.external_id,
                    "name": row.name or "Unbenannte Aktivität",
                    "provider": row.provider,
                    "sport": row.sport,
                    "started_at": row.started_at.isoformat() if row.started_at else None,
                    "duration_s": row.duration_s,
                    "duration_label": _duration_label(row.duration_s),
                    "distance_m": row.distance_m,
                    "avg_power_w": row.avg_power_w,
                    "max_power_w": _extract_summary_metric(row.raw_json, "maxPower"),
                    "avg_hr_bpm": row.avg_hr_bpm,
                    "max_hr_bpm": _extract_summary_metric(row.raw_json, "maxHR"),
                    "avg_speed_kmh": avg_speed_kmh,
                    "stress_score": stress_score,
                }
            )

    result = {
        "activities": items,
        "filters": {
            "providers": [value for value in provider_options if value],
            "sports": [value for value in sport_options if value],
        },
        "summary": {
            "count": len(items),
        },
    }
    _set_cached_activity_list(cache_key, result)
    return result


def delete_activity(user_id: int, activity_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        row = session.scalar(select(Activity).where(Activity.user_id == user_id, Activity.id == activity_id))
        if row is None:
            raise ValueError("Activity not found.")
        deleted_name = row.name or "Unbenannte AktivitÃ¤t"
        session.delete(row)
        session.commit()
    clear_activity_list_cache(user_id=user_id)
    return {"status": "deleted", "id": activity_id, "name": deleted_name}


def get_activity_detail(user_id: int, activity_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        activity = session.scalar(select(Activity).where(Activity.user_id == user_id, Activity.id == activity_id))
        if activity is None:
            raise ValueError("Activity not found.")
        sessions, laps, records = _hydrate_activity_streams_from_fit(session, activity)
        session.refresh(activity)
        ftp_reference_w = _get_metric_value_at(session, user_id=user_id, metric_type="ftp", reference_dt=activity.started_at)
        max_hr_reference_bpm = _get_metric_value_at(session, user_id=user_id, metric_type="max_hr", reference_dt=activity.started_at)
        llm_cache_row = session.scalar(
            select(ActivityLlmAnalysisCache).where(
                ActivityLlmAnalysisCache.user_id == user_id,
                ActivityLlmAnalysisCache.activity_id == activity_id,
            )
        )
        llm_analysis_status = _build_activity_llm_status(
            analysis_version=int(llm_cache_row.analysis_version) if llm_cache_row is not None else None,
            generated_at=(llm_cache_row.generated_at or llm_cache_row.updated_at or llm_cache_row.created_at) if llm_cache_row is not None else None,
            model=llm_cache_row.model if llm_cache_row is not None else None,
        )
        llm_analysis = _serialize_activity_llm_cache(llm_cache_row) if llm_cache_row is not None else None

    avg_speed_kmh = None
    if activity.duration_s and activity.duration_s > 0 and activity.distance_m is not None:
        avg_speed_kmh = (activity.distance_m / activity.duration_s) * 3.6

    power_values = [int(row.power_w) for row in records if row.power_w is not None]
    hr_values = [int(row.heart_rate_bpm) for row in records if row.heart_rate_bpm is not None]
    cadence_values = [int(row.cadence_rpm) for row in records if row.cadence_rpm is not None]
    speed_values = [float(row.speed_mps) * 3.6 for row in records if row.speed_mps is not None]
    altitude_values = [float(row.altitude_m) for row in records if row.altitude_m is not None]
    avg_cadence_rpm = round(sum(cadence_values) / len(cadence_values), 1) if cadence_values else None
    summary_altitude_gain_m = _extract_summary_metric(
        activity.raw_json,
        "elevationGain",
        "totalAscent",
        "totalAscentInMeters",
        "elevationGainInMeters",
    )
    summary_min_altitude_m = _extract_summary_metric(activity.raw_json, "minElevation", "minimumElevation")
    summary_max_altitude_m = _extract_summary_metric(activity.raw_json, "maxElevation", "maximumElevation")
    altitude_gain_m = summary_altitude_gain_m if summary_altitude_gain_m is not None else _sum_positive_deltas(altitude_values)
    longest_climb_m = _derive_longest_climb_gain(altitude_values)
    time_metrics = _derive_time_metrics(
        activity_duration_s=activity.duration_s,
        raw_json=activity.raw_json,
        sessions=sessions,
    )
    derived_power_metrics = _compute_power_metrics(
        avg_power_w=activity.avg_power_w,
        duration_s=activity.duration_s,
        records=records,
        ftp_w=ftp_reference_w,
    )
    calories_kcal = _extract_summary_metric(activity.raw_json, "calories", "totalCalories", "estimatedCalories")
    if calories_kcal is None:
        calories_kcal = derived_power_metrics["estimated_calories_kcal"]
    normalized_power_w = _extract_summary_metric(
        activity.raw_json,
        "normalizedPower",
        "normPower",
        "normalizedPowerInWatts",
        "weightedAveragePower",
    )
    if normalized_power_w is None:
        normalized_power_w = derived_power_metrics["normalized_power_w"]
    intensity_factor = _extract_summary_metric(activity.raw_json, "intensityFactor", "intensity_factor")
    if intensity_factor is None:
        intensity_factor = derived_power_metrics["intensity_factor"]
    variability_index = _extract_summary_metric(activity.raw_json, "variabilityIndex", "variability_index")
    if variability_index is None:
        variability_index = derived_power_metrics["variability_index"]
    training_stress_score = _stress_from_raw_json(activity.raw_json)
    if training_stress_score is None:
        training_stress_score = _extract_summary_metric(activity.raw_json, "tss", "trainingStressScore")
    if training_stress_score is None:
        training_stress_score = derived_power_metrics["training_stress_score"]
    aerobic_training_effect = _extract_summary_metric(activity.raw_json, "aerobicTrainingEffect")
    anaerobic_training_effect = _extract_summary_metric(activity.raw_json, "anaerobicTrainingEffect")
    aerobic_training_effect_message = _extract_summary_text(activity.raw_json, "aerobicTrainingEffectMessage")
    anaerobic_training_effect_message = _extract_summary_text(activity.raw_json, "anaerobicTrainingEffectMessage")
    if max_hr_reference_bpm is None and hr_values:
        max_hr_reference_bpm = float(max(hr_values))
    environment = _derive_activity_environment(
        provider=activity.provider,
        sport=activity.sport,
        name=activity.name,
        raw_json=activity.raw_json,
        variability_index=variability_index,
    )

    payload = {
        "activity": {
            "id": activity.id,
            "external_id": activity.external_id,
            "name": activity.name or "Unbenannte Aktivitaet",
            "provider": activity.provider,
            "sport": activity.sport,
            "environment_label": environment["environment_label"],
            "is_virtual_ride": environment["is_virtual_ride"],
            "is_indoor_ride": environment["is_indoor_ride"],
            "virtual_platform": environment["virtual_platform"],
            "likely_power_controlled": environment["likely_power_controlled"],
            "environment_note": environment["interpretation_note"],
            "started_at": activity.started_at.isoformat() if activity.started_at else None,
            "duration_s": activity.duration_s,
            "duration_label": _duration_label(activity.duration_s),
            "distance_m": activity.distance_m,
            "avg_speed_kmh": avg_speed_kmh,
            "avg_power_w": activity.avg_power_w,
            "avg_hr_bpm": activity.avg_hr_bpm,
            "max_power_w": max(power_values) if power_values else None,
            "max_hr_bpm": max(hr_values) if hr_values else None,
            "normalized_power_w": normalized_power_w,
            "intensity_factor": intensity_factor,
            "variability_index": variability_index,
            "training_stress_score": training_stress_score,
            "aerobic_training_effect": aerobic_training_effect,
            "anaerobic_training_effect": anaerobic_training_effect,
            "aerobic_training_effect_message": aerobic_training_effect_message,
            "anaerobic_training_effect_message": anaerobic_training_effect_message,
            "calories_kcal": calories_kcal,
            "ftp_reference_w": ftp_reference_w,
            "max_hr_reference_bpm": max_hr_reference_bpm,
            "avg_cadence_rpm": avg_cadence_rpm,
            "max_cadence_rpm": max(cadence_values) if cadence_values else None,
            "max_speed_kmh": max(speed_values) if speed_values else None,
            "min_altitude_m": summary_min_altitude_m if summary_min_altitude_m is not None else min(altitude_values) if altitude_values else None,
            "max_altitude_m": summary_max_altitude_m if summary_max_altitude_m is not None else max(altitude_values) if altitude_values else None,
            "total_ascent_m": altitude_gain_m,
            "longest_climb_m": longest_climb_m,
            "moving_time_s": time_metrics["moving_time_s"],
            "moving_time_label": _duration_label(time_metrics["moving_time_s"]),
            "paused_time_s": time_metrics["paused_time_s"],
            "paused_time_label": _duration_label(time_metrics["paused_time_s"]),
            "stress_score": training_stress_score,
            "achievements_checked_at": activity.achievements_checked_at.isoformat() if activity.achievements_checked_at else None,
            "achievements_check_version": activity.achievements_check_version,
            "records_count": len(records),
            "laps_count": len(laps),
            "sessions_count": len(sessions),
        },
        "llm_analysis_status": llm_analysis_status,
        "llm_analysis": llm_analysis,
        "achievement_analysis": _parse_json_payload(activity.achievements_summary_json),
        "sessions": [
            {
                "session_index": row.session_index,
                "start_time": row.start_time.isoformat() if row.start_time else None,
                "total_elapsed_time_s": row.total_elapsed_time_s,
                "total_timer_time_s": row.total_timer_time_s,
                "total_distance_m": row.total_distance_m,
                "avg_speed_kmh": (row.avg_speed_mps * 3.6) if row.avg_speed_mps is not None else None,
                "max_speed_kmh": (row.max_speed_mps * 3.6) if row.max_speed_mps is not None else None,
                "avg_power_w": row.avg_power_w,
                "max_power_w": row.max_power_w,
                "avg_hr_bpm": row.avg_hr_bpm,
                "max_hr_bpm": row.max_hr_bpm,
            }
            for row in sessions
        ],
        "laps": [],
        "records": [
            {
                "index": row.record_index,
                "timestamp": row.timestamp.isoformat() if row.timestamp else None,
                "elapsed_s": row.elapsed_s,
                "distance_m": row.distance_m,
                "latitude_deg": _fit_coordinate_to_degrees(row.latitude_deg),
                "longitude_deg": _fit_coordinate_to_degrees(row.longitude_deg),
                "heart_rate_bpm": row.heart_rate_bpm,
                "power_w": row.power_w,
                "speed_mps": row.speed_mps,
                "speed_kmh": (float(row.speed_mps) * 3.6) if row.speed_mps is not None else None,
                "altitude_m": row.altitude_m,
                "cadence_rpm": row.cadence_rpm,
            }
            for row in records
        ],
    }

    for lap_index, row in enumerate(laps):
        start_time = row.start_time
        duration_seconds = row.total_timer_time_s if row.total_timer_time_s is not None else row.total_elapsed_time_s
        next_start_time = laps[lap_index + 1].start_time if lap_index + 1 < len(laps) else None
        end_time = None
        if start_time is not None and duration_seconds is not None:
            end_time = start_time + timedelta(seconds=float(duration_seconds))
        if end_time is None:
            end_time = next_start_time

        elapsed_from_s = None
        elapsed_to_s = None
        if activity.started_at is not None and start_time is not None:
            elapsed_from_s = max(0.0, (start_time - activity.started_at).total_seconds())
            if end_time is not None:
                elapsed_to_s = max(elapsed_from_s, (end_time - activity.started_at).total_seconds())
        elif duration_seconds is not None and lap_index > 0:
            previous_elapsed = payload["laps"][-1]["_elapsed_to_s"] if payload["laps"] else 0.0
            elapsed_from_s = float(previous_elapsed or 0.0)
            elapsed_to_s = elapsed_from_s + float(duration_seconds)

        slice_records = _segment_record_slice(
            records,
            activity_start=activity.started_at,
            start_time=start_time,
            end_time=end_time,
            elapsed_from_s=elapsed_from_s,
            elapsed_to_s=elapsed_to_s,
        )
        derived_metrics = _derive_record_metrics(slice_records)
        payload["laps"].append(
            {
                "lap_index": row.lap_index,
                "start_time": row.start_time.isoformat() if row.start_time else None,
                "total_elapsed_time_s": row.total_elapsed_time_s,
                "total_timer_time_s": row.total_timer_time_s,
                "total_distance_m": row.total_distance_m,
                "avg_speed_kmh": (row.avg_speed_mps * 3.6) if row.avg_speed_mps is not None else derived_metrics["avg_speed_kmh"],
                "avg_power_w": row.avg_power_w if row.avg_power_w is not None else derived_metrics["avg_power_w"],
                "max_power_w": row.max_power_w if row.max_power_w is not None else derived_metrics["max_power_w"],
                "avg_hr_bpm": row.avg_hr_bpm if row.avg_hr_bpm is not None else derived_metrics["avg_hr_bpm"],
                "max_hr_bpm": row.max_hr_bpm if row.max_hr_bpm is not None else derived_metrics["max_hr_bpm"],
                "duration_label": _duration_label(int(row.total_timer_time_s)) if row.total_timer_time_s is not None else _duration_label(int(row.total_elapsed_time_s)) if row.total_elapsed_time_s is not None else None,
                "_elapsed_to_s": elapsed_to_s,
            }
        )

    for lap in payload["laps"]:
        lap.pop("_elapsed_to_s", None)

    return payload


def _extract_json_object_from_text(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        raise RuntimeError("LLM response was empty.")
    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise RuntimeError("LLM response did not contain valid JSON.")

    payload = json.loads(text[start : end + 1])
    if not isinstance(payload, dict):
        raise RuntimeError("LLM response JSON must be an object.")
    return payload


def _normalize_text_list(value: Any, *, max_items: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for raw_item in value:
        text = str(raw_item or "").strip()
        if not text or text in items:
            continue
        items.append(text)
        if len(items) >= max_items:
            break
    return items


def _normalize_fact_rows(value: Any, *, max_items: int = 12) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    rows: list[dict[str, str]] = []
    for raw_item in value:
        if not isinstance(raw_item, dict):
            continue
        label = str(raw_item.get("label") or "").strip()
        metric_value = str(raw_item.get("value") or "").strip()
        fact = str(raw_item.get("fact") or raw_item.get("detail") or "").strip()
        if not label or not metric_value:
            continue
        rows.append(
            {
                "label": label,
                "value": metric_value,
                "fact": fact,
            }
        )
        if len(rows) >= max_items:
            break
    return rows


def _extract_chat_message_content(body: dict[str, Any]) -> str:
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first_choice = choices[0] if isinstance(choices[0], dict) else {}
    message = first_choice.get("message") if isinstance(first_choice, dict) else {}
    if not isinstance(message, dict):
        return ""
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = str(item.get("text") or "").strip()
                if text:
                    parts.append(text)
        return "\n".join(parts)
    return str(content or "")


def _build_payload_record_series(records: list[dict[str, Any]], value_key: str) -> list[tuple[int, float]]:
    series: list[tuple[int, float]] = []
    for index, row in enumerate(records):
        raw_value = row.get(value_key)
        if raw_value is None:
            continue
        elapsed = row.get("elapsed_s", index)
        try:
            second = int(round(float(elapsed)))
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        if second < 0:
            continue
        if series and second <= series[-1][0]:
            second = series[-1][0] + 1
        series.append((second, value))
    return series


def _expand_series(series: list[tuple[int, float]], duration_s: float | None) -> list[float]:
    if not series:
        return []
    max_index = max(second for second, _value in series) + 1
    if duration_s is not None:
        max_index = max(max_index, int(max(0, round(float(duration_s)))))
    if max_index <= 0:
        return []

    expanded: list[float] = []
    cursor = 0
    last_value = float(series[0][1])
    for second, value in series:
        while cursor < second and cursor < max_index:
            expanded.append(last_value)
            cursor += 1
        if cursor >= max_index:
            break
        last_value = float(value)
        expanded.append(last_value)
        cursor = second + 1
    while cursor < max_index:
        expanded.append(last_value)
        cursor += 1
    return expanded


def _safe_round(value: Any, digits: int = 1) -> float | None:
    try:
        if value is None:
            return None
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def _serialize_utc_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat() + "Z"


def _build_activity_llm_status(
    *,
    analysis_version: int | None,
    generated_at: datetime | None,
    model: str | None,
) -> dict[str, Any]:
    current_version = _ACTIVITY_LLM_ANALYSIS_VERSION
    is_current = analysis_version == current_version if analysis_version is not None else False
    return {
        "available": analysis_version is not None,
        "analysis_version": analysis_version,
        "current_version": current_version,
        "is_current": is_current,
        "has_newer_version": bool(analysis_version is not None and analysis_version < current_version),
        "generated_at": _serialize_utc_datetime(generated_at),
        "model": model,
    }


def _normalize_activity_llm_context_snapshot(value: dict[str, Any] | None) -> dict[str, Any]:
    snapshot = value if isinstance(value, dict) else {}
    return {
        "records_count": int(snapshot.get("records_count") or 0),
        "laps_count": int(snapshot.get("laps_count") or 0),
        "sessions_count": int(snapshot.get("sessions_count") or 0),
        "ftp_reference_w": _safe_round(snapshot.get("ftp_reference_w"), 0),
        "max_hr_reference_bpm": _safe_round(snapshot.get("max_hr_reference_bpm"), 0),
        "environment_label": snapshot.get("environment_label"),
        "is_virtual_ride": bool(snapshot.get("is_virtual_ride")),
        "virtual_platform": snapshot.get("virtual_platform"),
        "likely_power_controlled": bool(snapshot.get("likely_power_controlled")),
    }


def _build_activity_llm_response(
    *,
    activity_id: int,
    activity_name: str | None,
    generated_at: datetime | None,
    model: str | None,
    analysis_version: int,
    context_snapshot: dict[str, Any] | None,
    analysis_payload: dict[str, Any] | None,
    from_cache: bool,
) -> dict[str, Any]:
    normalized_analysis = analysis_payload if isinstance(analysis_payload, dict) else {}
    summary = str(normalized_analysis.get("summary") or "").strip()
    if not summary:
        raise RuntimeError("LLM response did not contain a usable summary.")

    normalized_context = _normalize_activity_llm_context_snapshot(context_snapshot)
    todo_items = _normalize_text_list(normalized_analysis.get("todo"), max_items=4)
    if not todo_items:
        todo_items = [_ACTIVITY_LLM_TODO_NOTE]

    return {
        "activity_id": activity_id,
        "activity_name": str(activity_name or "Aktivitaet").strip() or "Aktivitaet",
        "generated_at": _serialize_utc_datetime(generated_at) or _serialize_utc_datetime(datetime.utcnow()),
        "model": str(model or DEFAULT_OPENAI_MODEL).strip() or DEFAULT_OPENAI_MODEL,
        "analysis_version": int(analysis_version),
        "current_version": _ACTIVITY_LLM_ANALYSIS_VERSION,
        "from_cache": from_cache,
        "is_current": int(analysis_version) == _ACTIVITY_LLM_ANALYSIS_VERSION,
        "has_newer_version": int(analysis_version) < _ACTIVITY_LLM_ANALYSIS_VERSION,
        "context_snapshot": normalized_context,
        "analysis": {
            "headline": str(normalized_analysis.get("headline") or "LLM Trainingsanalyse").strip() or "LLM Trainingsanalyse",
            "summary": summary,
            "deep_analysis": _normalize_text_list(normalized_analysis.get("deep_analysis"), max_items=8),
            "numbers_and_facts": _normalize_fact_rows(normalized_analysis.get("numbers_and_facts"), max_items=12),
            "performance_signals": _normalize_text_list(normalized_analysis.get("performance_signals"), max_items=8),
            "coaching_recommendations": _normalize_text_list(normalized_analysis.get("coaching_recommendations"), max_items=8),
            "todo": todo_items,
        },
    }


def _serialize_activity_llm_cache(cache_row: ActivityLlmAnalysisCache) -> dict[str, Any]:
    return _build_activity_llm_response(
        activity_id=cache_row.activity_id,
        activity_name=cache_row.activity_name,
        generated_at=cache_row.generated_at or cache_row.updated_at or cache_row.created_at,
        model=cache_row.model,
        analysis_version=int(cache_row.analysis_version),
        context_snapshot=_parse_json_payload(cache_row.context_snapshot_json),
        analysis_payload=_parse_json_payload(cache_row.analysis_json),
        from_cache=True,
    )


def _upsert_activity_llm_analysis_cache(
    session,
    *,
    user_id: int,
    activity_id: int,
    activity_name: str | None,
    generated_at: datetime,
    model: str | None,
    analysis_version: int,
    context_snapshot: dict[str, Any],
    analysis_payload: dict[str, Any],
) -> ActivityLlmAnalysisCache:
    cache_row = session.scalar(
        select(ActivityLlmAnalysisCache).where(
            ActivityLlmAnalysisCache.user_id == user_id,
            ActivityLlmAnalysisCache.activity_id == activity_id,
        )
    )
    now = datetime.utcnow()
    if cache_row is None:
        cache_row = ActivityLlmAnalysisCache(
            user_id=user_id,
            activity_id=activity_id,
            created_at=now,
            updated_at=now,
            analysis_json="{}",
        )
        session.add(cache_row)

    cache_row.activity_name = str(activity_name or "").strip() or None
    cache_row.analysis_version = int(analysis_version)
    cache_row.model = str(model or "").strip() or None
    cache_row.generated_at = generated_at
    cache_row.context_snapshot_json = json.dumps(context_snapshot, ensure_ascii=False)
    cache_row.analysis_json = json.dumps(analysis_payload, ensure_ascii=False)
    cache_row.updated_at = now
    return cache_row


def _summarize_numeric_series(values: list[float], *, digits: int = 1) -> dict[str, float] | None:
    if not values:
        return None
    return {
        "avg": round(sum(values) / len(values), digits),
        "min": round(min(values), digits),
        "max": round(max(values), digits),
    }


def _best_window_average(values: list[float], window: int) -> float | None:
    if window <= 0 or len(values) < window:
        return None
    prefix: list[float] = [0.0]
    for value in values:
        prefix.append(prefix[-1] + value)
    best: float | None = None
    for end in range(window, len(prefix)):
        avg = (prefix[end] - prefix[end - window]) / window
        if best is None or avg > best:
            best = avg
    return best


def _summarize_best_window_averages(values: list[float], windows: list[tuple[str, int]], *, digits: int = 1) -> dict[str, float]:
    summary: dict[str, float] = {}
    for label, seconds in windows:
        best = _best_window_average(values, seconds)
        if best is None:
            continue
        summary[label] = round(best, digits)
    return summary


def _sum_positive_deltas(values: list[float], *, min_step: float = 0.5) -> float | None:
    if len(values) < 2:
        return None
    gain = 0.0
    for previous, current in zip(values, values[1:]):
        delta = current - previous
        if delta > min_step:
            gain += delta
    return round(gain, 1)


def _derive_longest_climb_gain(values: list[float], *, min_step: float = 0.5) -> float | None:
    if len(values) < 2:
        return None
    best_gain = 0.0
    current_gain = 0.0
    climbing = False
    for previous, current in zip(values, values[1:]):
        delta = float(current) - float(previous)
        if delta > min_step:
            current_gain += delta
            climbing = True
            if current_gain > best_gain:
                best_gain = current_gain
            continue
        if delta < -min_step and climbing:
            current_gain = 0.0
            climbing = False
    return round(best_gain, 1) if best_gain > 0 else None


def _derive_time_metrics(
    *,
    activity_duration_s: int | None,
    raw_json: str | None,
    sessions: list[ActivitySession],
) -> dict[str, int | None]:
    moving_time_s: int | None = None
    elapsed_time_s: int | None = None

    timer_values = [float(row.total_timer_time_s) for row in sessions if row.total_timer_time_s is not None and row.total_timer_time_s > 0]
    elapsed_values = [float(row.total_elapsed_time_s) for row in sessions if row.total_elapsed_time_s is not None and row.total_elapsed_time_s > 0]

    if timer_values:
        moving_time_s = int(round(sum(timer_values)))
    elif activity_duration_s is not None and activity_duration_s > 0:
        moving_time_s = int(activity_duration_s)

    if elapsed_values:
        elapsed_time_s = int(round(sum(elapsed_values)))
    else:
        raw_elapsed_s = _extract_summary_metric(raw_json, "elapsedDuration", "elapsed_time", "totalElapsedDuration", "totalElapsedTime")
        if raw_elapsed_s is not None and raw_elapsed_s > 0:
            elapsed_time_s = int(round(raw_elapsed_s))

    if elapsed_time_s is None:
        elapsed_time_s = moving_time_s
    if moving_time_s is None:
        moving_time_s = elapsed_time_s

    paused_time_s = None
    if moving_time_s is not None and elapsed_time_s is not None:
        paused_time_s = max(0, int(elapsed_time_s) - int(moving_time_s))

    return {
        "moving_time_s": moving_time_s,
        "elapsed_time_s": elapsed_time_s,
        "paused_time_s": paused_time_s,
    }


def _summarize_zone_distribution(values: list[float], reference_value: float | None, bands: list[tuple[str, float | None, float | None]]) -> list[dict[str, Any]]:
    if not values or reference_value is None or reference_value <= 0:
        return []
    total = len(values)
    summary: list[dict[str, Any]] = []
    for label, min_ratio, max_ratio in bands:
        seconds = 0
        for value in values:
            ratio = float(value) / float(reference_value)
            if min_ratio is not None and ratio < min_ratio:
                continue
            if max_ratio is not None and ratio > max_ratio:
                continue
            seconds += 1
        if seconds <= 0:
            continue
        summary.append(
            {
                "label": label,
                "seconds": seconds,
                "share_percent": round((seconds / total) * 100.0, 1),
            }
        )
    return summary


def _derive_aerobic_drift_percent(power_values: list[float], hr_values: list[float]) -> float | None:
    paired = [
        (float(power), float(hr))
        for power, hr in zip(power_values, hr_values)
        if power > 0 and hr > 0
    ]
    if len(paired) < 600:
        return None

    half = len(paired) // 2
    if half < 300:
        return None

    first_half = paired[:half]
    second_half = paired[half:]
    first_power = sum(power for power, _hr in first_half) / len(first_half)
    second_power = sum(power for power, _hr in second_half) / len(second_half)
    if first_power <= 0 or second_power <= 0:
        return None

    first_ratio = (sum(hr for _power, hr in first_half) / len(first_half)) / first_power
    second_ratio = (sum(hr for _power, hr in second_half) / len(second_half)) / second_power
    if first_ratio <= 0:
        return None

    return round(((second_ratio / first_ratio) - 1.0) * 100.0, 1)


def _build_activity_llm_context(detail: dict[str, Any], max_hr_reference_bpm: float | None) -> dict[str, Any]:
    activity = detail.get("activity") or {}
    record_rows = detail.get("records") or []
    lap_rows = detail.get("laps") or []
    session_rows = detail.get("sessions") or []
    achievement_analysis = detail.get("achievement_analysis") or {}

    duration_s = activity.get("duration_s")
    ftp_reference_w = _safe_round(activity.get("ftp_reference_w"), 0)

    power_values = _expand_series(_build_payload_record_series(record_rows, "power_w"), duration_s)
    hr_values = _expand_series(_build_payload_record_series(record_rows, "heart_rate_bpm"), duration_s)
    cadence_values = _expand_series(_build_payload_record_series(record_rows, "cadence_rpm"), duration_s)
    speed_values = _expand_series(_build_payload_record_series(record_rows, "speed_kmh"), duration_s)
    altitude_values = _expand_series(_build_payload_record_series(record_rows, "altitude_m"), duration_s)

    best_power_averages = _summarize_best_window_averages(
        power_values,
        [("30s", 30), ("1m", 60), ("5m", 300), ("10m", 600), ("20m", 1200)],
        digits=1,
    )
    best_hr_averages = _summarize_best_window_averages(
        hr_values,
        [("1m", 60), ("5m", 300), ("20m", 1200)],
        digits=1,
    )

    altitude_summary = _summarize_numeric_series(altitude_values, digits=1)
    if altitude_summary is not None:
        altitude_summary["gain"] = _sum_positive_deltas(altitude_values) or 0.0

    lap_limit = 40
    achievement_matches_raw = achievement_analysis.get("matched") if isinstance(achievement_analysis, dict) else []
    achievement_matches = achievement_matches_raw if isinstance(achievement_matches_raw, list) else []
    checked_scopes = achievement_analysis.get("checked_scopes") if isinstance(achievement_analysis, dict) else []
    checked_scopes = checked_scopes if isinstance(checked_scopes, list) else []
    matched_count = achievement_analysis.get("matched_count") if isinstance(achievement_analysis, dict) else 0
    try:
        matched_count = int(matched_count or 0)
    except (TypeError, ValueError):
        matched_count = 0

    return {
        "activity_summary": activity,
        "ride_environment": {
            "environment_label": activity.get("environment_label"),
            "is_virtual_ride": bool(activity.get("is_virtual_ride")),
            "is_indoor_ride": bool(activity.get("is_indoor_ride")),
            "virtual_platform": activity.get("virtual_platform"),
            "likely_power_controlled": bool(activity.get("likely_power_controlled")),
            "interpretation_note": activity.get("environment_note"),
        },
        "reference_metrics": {
            "ftp_reference_w": ftp_reference_w,
            "max_hr_reference_bpm": _safe_round(max_hr_reference_bpm, 0),
            "training_goal_alignment_ready": False,
        },
        "data_availability": {
            "records_present": bool(record_rows),
            "power_series_available": bool(power_values),
            "heart_rate_series_available": bool(hr_values),
            "cadence_series_available": bool(cadence_values),
            "speed_series_available": bool(speed_values),
            "altitude_series_available": bool(altitude_values),
            "records_count": int(activity.get("records_count") or 0),
            "laps_count": int(activity.get("laps_count") or 0),
            "sessions_count": int(activity.get("sessions_count") or 0),
        },
        "derived_metrics": {
            "power_best_averages_w": best_power_averages,
            "heart_rate_best_averages_bpm": best_hr_averages,
            "power_zone_time_by_ftp": _summarize_zone_distribution(
                power_values,
                ftp_reference_w,
                [
                    ("<55% FTP", None, 0.55),
                    ("56-75% FTP", 0.56, 0.75),
                    ("76-90% FTP", 0.76, 0.90),
                    ("91-105% FTP", 0.91, 1.05),
                    ("106-120% FTP", 1.06, 1.20),
                    (">120% FTP", 1.21, None),
                ],
            ),
            "heart_rate_zone_time_by_max_hr": _summarize_zone_distribution(
                hr_values,
                max_hr_reference_bpm,
                [
                    ("50-60% MaxHF", 0.50, 0.60),
                    ("61-72% MaxHF", 0.61, 0.72),
                    ("73-82% MaxHF", 0.73, 0.82),
                    ("83-90% MaxHF", 0.83, 0.90),
                    ("91-100% MaxHF", 0.91, 1.00),
                ],
            ),
            "cadence_summary_rpm": _summarize_numeric_series(cadence_values, digits=1),
            "speed_summary_kmh": _summarize_numeric_series(speed_values, digits=1),
            "altitude_summary_m": altitude_summary,
            "aerobic_drift_percent": _derive_aerobic_drift_percent(power_values, hr_values),
            "efficiency_factor_np_per_bpm": (
                round(float(activity["normalized_power_w"]) / float(activity["avg_hr_bpm"]), 3)
                if activity.get("normalized_power_w") is not None and activity.get("avg_hr_bpm")
                else None
            ),
        },
        "sessions": session_rows,
        "laps": lap_rows[:lap_limit],
        "laps_truncated_count": max(0, len(lap_rows) - lap_limit),
        "achievement_context": {
            "matched_count": matched_count,
            "checked_scopes": checked_scopes,
            "matched_titles": [
                str(match.get("title") or "").strip()
                for match in achievement_matches[:12]
                if isinstance(match, dict) and str(match.get("title") or "").strip()
            ],
        },
        "todo_context": [
            _ACTIVITY_LLM_TODO_NOTE,
        ],
    }


def _legacy_derive_activity_llm_analysis(user_id: int, activity_id: int) -> dict[str, Any]:
    detail = get_activity_detail(user_id=user_id, activity_id=activity_id)
    activity_summary = detail.get("activity") or {}
    max_hr_reference_bpm = _safe_round(activity_summary.get("max_hr_reference_bpm"), 0)
    if max_hr_reference_bpm is None:
        max_hr_reference_bpm = _safe_round(activity_summary.get("max_hr_bpm"), 0)

    context = _build_activity_llm_context(detail, max_hr_reference_bpm)
    prompt = (
        "Analysiere die folgende Ausdauer-AktivitÃ¤t tiefgehend auf Deutsch.\n"
        "Nutze nur die bereitgestellten Daten und erfinde keine fehlenden Werte.\n"
        "Bewerte Belastungsprofil, Pacing, Herzfrequenzverhalten, Effizienz, Steuerbarkeit, ErmÃ¼dungssignale und den wahrscheinlichen Trainingsreiz.\n"
        "Formuliere konkret, coachend und datenbasiert statt generisch.\n"
        "Wenn Daten fehlen, benenne die LÃ¼cke klar.\n"
        "BerÃ¼cksichtige die Ride-Umgebung ausdrÃ¼cklich. Bei virtuellen oder trainergesteuerten Einheiten kann eine sehr gleichmÃ¤ÃŸige Leistung durch die Plattform oder Erg-Steuerung mitverursacht sein.\n"
        "Der Abgleich mit einem Trainingsziel aus dem Trainingsplan ist noch NICHT umgesetzt und muss als TODO erwÃ¤hnt werden.\n\n"
        "Return valid JSON only with this schema:\n"
        "{\n"
        '  "headline": "kurze Ãœberschrift",\n'
        '  "summary": "4-6 SÃ¤tze auf Deutsch",\n'
        '  "deep_analysis": ["mindestens 4 prÃ¤zise Beobachtungen"],\n'
        '  "numbers_and_facts": [\n'
        '    {"label": "kurzes Label", "value": "konkreter Wert", "fact": "kurze Einordnung"}\n'
        "  ],\n"
        '  "performance_signals": ["mindestens 4 Punkte"],\n'
        '  "coaching_recommendations": ["mindestens 4 konkrete Empfehlungen"],\n'
        '  "todo": ["TODO: Diese Analyse muss kÃ¼nftig zusÃ¤tzlich auf das Trainingsziel aus dem Trainingsplan angepasst werden."]\n'
        "}\n"
        "Use short labels in numbers_and_facts and prioritize the most relevant numbers.\n\n"
        "Kontext:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}"
    )

    model = os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_OPENAI_MODEL
    body = openai_chat_completion(
        user_id=user_id,
        feature_key="activity_analysis:derive",
        system_prompt=(
            "You are an experienced German-speaking cycling coach and performance analyst. "
            "Return valid JSON only and do not use markdown."
        ),
        user_prompt=prompt,
        temperature=0.35,
        timeout=60,
    )
    content = _extract_chat_message_content(body)
    parsed = _extract_json_object_from_text(content)
    summary = str(parsed.get("summary") or "").strip()
    if not summary:
        raise RuntimeError("LLM response did not contain a usable summary.")

    todo_items = _normalize_text_list(parsed.get("todo"), max_items=4)
    if not todo_items:
        todo_items = context["todo_context"]

    return {
        "activity_id": activity_id,
        "activity_name": str(detail.get("activity", {}).get("name") or "AktivitÃ¤t"),
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "model": model,
        "analysis_version": _ACTIVITY_LLM_ANALYSIS_VERSION,
        "context_snapshot": {
            "records_count": int(detail.get("activity", {}).get("records_count") or 0),
            "laps_count": int(detail.get("activity", {}).get("laps_count") or 0),
            "sessions_count": int(detail.get("activity", {}).get("sessions_count") or 0),
            "ftp_reference_w": _safe_round(detail.get("activity", {}).get("ftp_reference_w"), 0),
            "max_hr_reference_bpm": _safe_round(max_hr_reference_bpm, 0),
            "environment_label": detail.get("activity", {}).get("environment_label"),
            "is_virtual_ride": bool(detail.get("activity", {}).get("is_virtual_ride")),
            "virtual_platform": detail.get("activity", {}).get("virtual_platform"),
            "likely_power_controlled": bool(detail.get("activity", {}).get("likely_power_controlled")),
        },
        "analysis": {
            "headline": str(parsed.get("headline") or "LLM Trainingsanalyse").strip() or "LLM Trainingsanalyse",
            "summary": summary,
            "deep_analysis": _normalize_text_list(parsed.get("deep_analysis"), max_items=8),
            "numbers_and_facts": _normalize_fact_rows(parsed.get("numbers_and_facts"), max_items=12),
            "performance_signals": _normalize_text_list(parsed.get("performance_signals"), max_items=8),
            "coaching_recommendations": _normalize_text_list(parsed.get("coaching_recommendations"), max_items=8),
            "todo": todo_items,
        },
    }


def derive_activity_llm_analysis(user_id: int, activity_id: int, *, force_refresh: bool = False) -> dict[str, Any]:
    with SessionLocal() as session:
        activity_row = session.scalar(select(Activity).where(Activity.user_id == user_id, Activity.id == activity_id))
        if activity_row is None:
            raise ValueError("Activity not found.")
        cache_row = session.scalar(
            select(ActivityLlmAnalysisCache).where(
                ActivityLlmAnalysisCache.user_id == user_id,
                ActivityLlmAnalysisCache.activity_id == activity_id,
            )
        )
        if not force_refresh and cache_row is not None and int(cache_row.analysis_version) == _ACTIVITY_LLM_ANALYSIS_VERSION:
            return _serialize_activity_llm_cache(cache_row)

    detail = get_activity_detail(user_id=user_id, activity_id=activity_id)
    activity_summary = detail.get("activity") or {}
    max_hr_reference_bpm = _safe_round(activity_summary.get("max_hr_reference_bpm"), 0)
    if max_hr_reference_bpm is None:
        max_hr_reference_bpm = _safe_round(activity_summary.get("max_hr_bpm"), 0)

    context = _build_activity_llm_context(detail, max_hr_reference_bpm)
    context_snapshot = {
        "records_count": int(activity_summary.get("records_count") or 0),
        "laps_count": int(activity_summary.get("laps_count") or 0),
        "sessions_count": int(activity_summary.get("sessions_count") or 0),
        "ftp_reference_w": _safe_round(activity_summary.get("ftp_reference_w"), 0),
        "max_hr_reference_bpm": _safe_round(max_hr_reference_bpm, 0),
        "environment_label": activity_summary.get("environment_label"),
        "is_virtual_ride": bool(activity_summary.get("is_virtual_ride")),
        "virtual_platform": activity_summary.get("virtual_platform"),
        "likely_power_controlled": bool(activity_summary.get("likely_power_controlled")),
    }
    prompt = (
        f"Analyse-Version: {_ACTIVITY_LLM_ANALYSIS_VERSION}\n"
        "Analysiere die folgende Ausdauer-Aktivitaet tiefgehend auf Deutsch.\n"
        "Nutze nur die bereitgestellten Daten und erfinde keine fehlenden Werte.\n"
        "Bewerte Belastungsprofil, Pacing, Herzfrequenzverhalten, Effizienz, Steuerbarkeit, Ermuedungssignale und den wahrscheinlichen Trainingsreiz.\n"
        "Formuliere konkret, coachend und datenbasiert statt generisch.\n"
        "Wenn Daten fehlen, benenne die Luecke klar.\n"
        "Beruecksichtige die Ride-Umgebung ausdruecklich. Bei virtuellen oder trainergesteuerten Einheiten kann eine sehr gleichmaessige Leistung durch die Plattform oder Erg-Steuerung mitverursacht sein.\n"
        "Der Abgleich mit einem Trainingsziel aus dem Trainingsplan ist noch NICHT umgesetzt und muss als TODO erwaehnt werden.\n\n"
        "Return valid JSON only with this schema:\n"
        "{\n"
        '  "headline": "kurze Ueberschrift",\n'
        '  "summary": "4-6 Saetze auf Deutsch",\n'
        '  "deep_analysis": ["mindestens 4 praezise Beobachtungen"],\n'
        '  "numbers_and_facts": [\n'
        '    {"label": "kurzes Label", "value": "konkreter Wert", "fact": "kurze Einordnung"}\n'
        "  ],\n"
        '  "performance_signals": ["mindestens 4 Punkte"],\n'
        '  "coaching_recommendations": ["mindestens 4 konkrete Empfehlungen"],\n'
        f'  "todo": ["{_ACTIVITY_LLM_TODO_NOTE}"]\n'
        "}\n"
        "Use short labels in numbers_and_facts and prioritize the most relevant numbers.\n\n"
        "Kontext:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}"
    )

    body = openai_chat_completion(
        user_id=user_id,
        feature_key="activity_analysis:derive",
        system_prompt=(
            "You are an experienced German-speaking cycling coach and performance analyst. "
            "Return valid JSON only and do not use markdown."
        ),
        user_prompt=prompt,
        temperature=0.35,
        timeout=60,
    )
    model = str(body.get("model") or os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_OPENAI_MODEL).strip() or DEFAULT_OPENAI_MODEL
    content = _extract_chat_message_content(body)
    parsed = _extract_json_object_from_text(content)

    todo_items = _normalize_text_list(parsed.get("todo"), max_items=4)
    if not todo_items:
        todo_items = context["todo_context"]

    generated_at = datetime.utcnow()
    analysis_payload = {
        "headline": str(parsed.get("headline") or "LLM Trainingsanalyse").strip() or "LLM Trainingsanalyse",
        "summary": str(parsed.get("summary") or "").strip(),
        "deep_analysis": _normalize_text_list(parsed.get("deep_analysis"), max_items=8),
        "numbers_and_facts": _normalize_fact_rows(parsed.get("numbers_and_facts"), max_items=12),
        "performance_signals": _normalize_text_list(parsed.get("performance_signals"), max_items=8),
        "coaching_recommendations": _normalize_text_list(parsed.get("coaching_recommendations"), max_items=8),
        "todo": todo_items,
    }
    response = _build_activity_llm_response(
        activity_id=activity_id,
        activity_name=str(activity_summary.get("name") or "Aktivitaet"),
        generated_at=generated_at,
        model=model,
        analysis_version=_ACTIVITY_LLM_ANALYSIS_VERSION,
        context_snapshot=context_snapshot,
        analysis_payload=analysis_payload,
        from_cache=False,
    )

    with SessionLocal() as session:
        _upsert_activity_llm_analysis_cache(
            session,
            user_id=user_id,
            activity_id=activity_id,
            activity_name=response["activity_name"],
            generated_at=generated_at,
            model=model,
            analysis_version=_ACTIVITY_LLM_ANALYSIS_VERSION,
            context_snapshot=response["context_snapshot"],
            analysis_payload=response["analysis"],
        )
        session.commit()

    return response


def _extract_activity_max_hr(
    activity: Activity,
    sessions: list[ActivitySession],
    laps: list[ActivityLap],
    records: list[ActivityRecord],
) -> float | None:
    candidates: list[float] = []

    if activity.raw_json:
        try:
            payload = json.loads(activity.raw_json)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            summary_value = payload.get("maxHR")
            if summary_value is None and isinstance(payload.get("summaryDTO"), dict):
                summary_value = payload["summaryDTO"].get("maxHR")
            try:
                if summary_value is not None:
                    candidates.append(float(summary_value))
            except (TypeError, ValueError):
                pass

    for session in sessions:
        if session.max_hr_bpm is not None:
            candidates.append(float(session.max_hr_bpm))
    for lap in laps:
        if lap.max_hr_bpm is not None:
            candidates.append(float(lap.max_hr_bpm))
    for record in records:
        if record.heart_rate_bpm is not None:
            candidates.append(float(record.heart_rate_bpm))

    valid = [value for value in candidates if value > 0]
    return max(valid) if valid else None


def _extract_activity_max_power(
    activity: Activity,
    sessions: list[ActivitySession],
    laps: list[ActivityLap],
    records: list[ActivityRecord],
) -> float | None:
    candidates: list[float] = []

    if activity.raw_json:
        try:
            payload = json.loads(activity.raw_json)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            summary_value = payload.get("maxPower")
            if summary_value is None and isinstance(payload.get("summaryDTO"), dict):
                summary_value = payload["summaryDTO"].get("maxPower")
            try:
                if summary_value is not None:
                    candidates.append(float(summary_value))
            except (TypeError, ValueError):
                pass

    for session in sessions:
        if session.max_power_w is not None:
            candidates.append(float(session.max_power_w))
    for lap in laps:
        if lap.max_power_w is not None:
            candidates.append(float(lap.max_power_w))
    for record in records:
        if record.power_w is not None:
            candidates.append(float(record.power_w))

    valid = [value for value in candidates if value > 0]
    return max(valid) if valid else None


def rebuild_historical_max_hr_from_activities(
    user_id: int,
    progress_callback: Callable[[str, int, int, int, int], None] | None = None,
) -> dict[str, Any]:
    with SessionLocal() as session:
        preload_steps = 5
        if progress_callback is not None:
            progress_callback("Auslesen", 1, MAX_HR_RECHECK_PASSES, 0, preload_steps)
        deleted_metrics = session.execute(
            delete(UserTrainingMetric).where(
                UserTrainingMetric.user_id == user_id,
                UserTrainingMetric.metric_type == "max_hr",
                UserTrainingMetric.source == "Automatisch aus AktivitÃ¤ten",
            )
        ).rowcount or 0
        if progress_callback is not None:
            progress_callback("Auslesen", 1, MAX_HR_RECHECK_PASSES, 1, preload_steps)

        activities = session.scalars(
            select(Activity)
            .where(Activity.user_id == user_id)
            .where(Activity.started_at.is_not(None))
            .order_by(Activity.started_at.asc(), Activity.id.asc())
        ).all()
        if progress_callback is not None:
            progress_callback("Auslesen", 1, MAX_HR_RECHECK_PASSES, 2, preload_steps)

        activity_ids = [activity.id for activity in activities]
        sessions = session.scalars(
            select(ActivitySession)
            .where(ActivitySession.activity_id.in_(activity_ids))
            .order_by(ActivitySession.activity_id.asc(), ActivitySession.session_index.asc())
        ).all() if activity_ids else []
        if progress_callback is not None:
            progress_callback("Auslesen", 1, MAX_HR_RECHECK_PASSES, 3, preload_steps)
        laps = session.scalars(
            select(ActivityLap)
            .where(ActivityLap.activity_id.in_(activity_ids))
            .order_by(ActivityLap.activity_id.asc(), ActivityLap.lap_index.asc())
        ).all() if activity_ids else []
        if progress_callback is not None:
            progress_callback("Auslesen", 1, MAX_HR_RECHECK_PASSES, 4, preload_steps)
        records = session.scalars(
            select(ActivityRecord)
            .where(ActivityRecord.activity_id.in_(activity_ids))
            .order_by(ActivityRecord.activity_id.asc(), ActivityRecord.record_index.asc())
        ).all() if activity_ids else []
        if progress_callback is not None:
            progress_callback("Auslesen", 1, MAX_HR_RECHECK_PASSES, 5, preload_steps)

        sessions_by_activity: dict[int, list[ActivitySession]] = {}
        for row in sessions:
            sessions_by_activity.setdefault(row.activity_id, []).append(row)
        laps_by_activity: dict[int, list[ActivityLap]] = {}
        for row in laps:
            laps_by_activity.setdefault(row.activity_id, []).append(row)
        records_by_activity: dict[int, list[ActivityRecord]] = {}
        for row in records:
            records_by_activity.setdefault(row.activity_id, []).append(row)

        running_peak: float | None = None
        created_metrics: list[dict[str, Any]] = []
        checked_activities = 0
        activities_with_hr = 0

        total_activities = len(activities)
        if progress_callback is not None:
            progress_callback("HF analysieren", 2, MAX_HR_RECHECK_PASSES, 0, total_activities)

        for activity in activities:
            checked_activities += 1
            max_hr_value = _extract_activity_max_hr(
                activity,
                sessions_by_activity.get(activity.id, []),
                laps_by_activity.get(activity.id, []),
                records_by_activity.get(activity.id, []),
            )
            if max_hr_value is None:
                if progress_callback is not None:
                    progress_callback("HF analysieren", 2, MAX_HR_RECHECK_PASSES, checked_activities, total_activities)
                continue
            activities_with_hr += 1
            if running_peak is not None and max_hr_value <= running_peak:
                if progress_callback is not None:
                    progress_callback("HF analysieren", 2, MAX_HR_RECHECK_PASSES, checked_activities, total_activities)
                continue

            running_peak = max_hr_value
            recorded_at = activity.started_at or datetime.utcnow()
            metric = UserTrainingMetric(
                user_id=user_id,
                metric_type="max_hr",
                recorded_at=recorded_at,
                value=round(float(max_hr_value), 2),
                source="Automatisch aus AktivitÃ¤ten",
                notes=f"Historischer Recheck: {activity.name or 'AktivitÃ¤t'}",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(metric)
            session.flush()
            created_metrics.append(
                {
                    "id": metric.id,
                    "value": metric.value,
                    "recorded_at": metric.recorded_at.isoformat(),
                    "activity_id": activity.id,
                    "activity_name": activity.name or "AktivitÃ¤t",
                }
            )
            if progress_callback is not None:
                progress_callback("HF analysieren", 2, MAX_HR_RECHECK_PASSES, checked_activities, total_activities)

        session.commit()

    return {
        "status": "ok",
        "checked_activities": checked_activities,
        "activities_with_hr": activities_with_hr,
        "deleted_auto_max_hr_metrics": deleted_metrics,
        "created_max_hr_metrics": len(created_metrics),
        "max_hr_history": created_metrics,
    }

