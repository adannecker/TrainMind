from __future__ import annotations

import gzip
import io
import json
import zipfile
from datetime import date, datetime, time, timedelta
from typing import Any

from fitparse import FitFile as ParsedFitFile
from sqlalchemy import asc, delete, desc, func, or_, select

from packages.db.models import Activity, ActivityLap, ActivityRecord, ActivitySession, FitFilePayload, UserTrainingMetric
from packages.db.session import SessionLocal


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


def _to_week_start(target_day: date) -> date:
    return target_day - timedelta(days=target_day.weekday())


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
                avg_speed_mps=_fit_float(message.get_value("avg_speed") or message.get_value("enhanced_avg_speed")),
                max_speed_mps=_fit_float(message.get_value("max_speed") or message.get_value("enhanced_max_speed")),
                avg_power_w=_fit_float(message.get_value("avg_power") or message.get_value("total_average_power")),
                max_power_w=_fit_float(message.get_value("max_power")),
                avg_hr_bpm=_fit_float(message.get_value("avg_heart_rate") or message.get_value("total_average_heart_rate")),
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
                avg_speed_mps=_fit_float(message.get_value("avg_speed") or message.get_value("enhanced_avg_speed")),
                avg_power_w=_fit_float(message.get_value("avg_power") or message.get_value("total_average_power")),
                max_power_w=_fit_float(message.get_value("max_power")),
                avg_hr_bpm=_fit_float(message.get_value("avg_heart_rate") or message.get_value("total_average_heart_rate")),
                max_hr_bpm=_fit_float(message.get_value("max_heart_rate")),
            )
        )

    record_start = start_time
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
                latitude_deg=_fit_float(message.get_value("position_lat")),
                longitude_deg=_fit_float(message.get_value("position_long")),
                altitude_m=_fit_float(message.get_value("enhanced_altitude") or message.get_value("altitude")),
                speed_mps=_fit_float(message.get_value("enhanced_speed") or message.get_value("speed")),
                heart_rate_bpm=_fit_int(message.get_value("heart_rate")),
                cadence_rpm=_fit_int(message.get_value("cadence")),
                power_w=_fit_int(message.get_value("power")),
                temperature_c=_fit_float(message.get_value("temperature")),
            )
        )

    if parsed_sessions or parsed_laps or parsed_records:
        session.execute(delete(ActivitySession).where(ActivitySession.activity_id == activity.id))
        session.execute(delete(ActivityLap).where(ActivityLap.activity_id == activity.id))
        session.execute(delete(ActivityRecord).where(ActivityRecord.activity_id == activity.id))
        session.commit()
        if parsed_sessions:
            session.add_all(parsed_sessions)
        if parsed_laps:
            session.add_all(parsed_laps)
        if parsed_records:
            session.add_all(parsed_records)
        session.commit()
        sessions = session.scalars(
            select(ActivitySession).where(ActivitySession.activity_id == activity.id).order_by(ActivitySession.session_index.asc())
        ).all()
        laps = session.scalars(
            select(ActivityLap).where(ActivityLap.activity_id == activity.id).order_by(ActivityLap.lap_index.asc())
        ).all()
        records = session.scalars(
            select(ActivityRecord).where(ActivityRecord.activity_id == activity.id).order_by(ActivityRecord.record_index.asc())
        ).all()

    return sessions, laps, records


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
        rows = session.scalars(
            select(Activity)
            .where(Activity.started_at.is_not(None))
            .where(Activity.user_id == user_id)
            .where(Activity.started_at >= range_start)
            .where(Activity.started_at < range_end)
            .order_by(Activity.started_at.asc())
        ).all()

    by_day: dict[date, list[dict[str, Any]]] = {week_start + timedelta(days=i): [] for i in range(7)}

    week_moving_s = 0
    week_distance_m = 0.0
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

        stress_score = _stress_from_raw_json(row.raw_json)

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
                "avg_power_w": row.avg_power_w,
                "avg_speed_kmh": avg_speed_kmh,
                "stress_score": stress_score,
            }
        )

        if row.duration_s:
            week_moving_s += row.duration_s
        if row.distance_m:
            week_distance_m += float(row.distance_m)
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
            "stress_total": week_stress_total if week_stress_count > 0 else None,
            "stress_avg": (week_stress_total / week_stress_count) if week_stress_count > 0 else None,
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

        rows = session.scalars(stmt).all()

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

    reverse_sort = str(sort_dir).lower() != "asc"
    rows_with_value = [row for row in rows if _activity_sort_value(row, sort_by) is not None]
    rows_without_value = [row for row in rows if _activity_sort_value(row, sort_by) is None]
    rows_sorted = sorted(rows_with_value, key=lambda row: _activity_sort_value(row, sort_by), reverse=reverse_sort)
    rows = (rows_sorted + rows_without_value)[:safe_limit]

    items: list[dict[str, Any]] = []
    for row in rows:
        avg_speed_kmh = None
        if row.duration_s and row.duration_s > 0 and row.distance_m is not None:
            avg_speed_kmh = (row.distance_m / row.duration_s) * 3.6
        stress_score = _stress_from_raw_json(row.raw_json)
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
                "avg_hr_bpm": row.avg_hr_bpm,
                "avg_speed_kmh": avg_speed_kmh,
                "stress_score": stress_score,
            }
        )

    return {
        "activities": items,
        "filters": {
            "providers": [value for value in provider_options if value],
            "sports": [value for value in sport_options if value],
        },
        "summary": {
            "count": len(items),
        },
    }


def delete_activity(user_id: int, activity_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        row = session.scalar(select(Activity).where(Activity.user_id == user_id, Activity.id == activity_id))
        if row is None:
            raise ValueError("Activity not found.")
        deleted_name = row.name or "Unbenannte Aktivität"
        session.delete(row)
        session.commit()
    return {"status": "deleted", "id": activity_id, "name": deleted_name}


def get_activity_detail(user_id: int, activity_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        activity = session.scalar(select(Activity).where(Activity.user_id == user_id, Activity.id == activity_id))
        if activity is None:
            raise ValueError("Activity not found.")
        sessions, laps, records = _hydrate_activity_streams_from_fit(session, activity)
        session.refresh(activity)

    avg_speed_kmh = None
    if activity.duration_s and activity.duration_s > 0 and activity.distance_m is not None:
        avg_speed_kmh = (activity.distance_m / activity.duration_s) * 3.6

    power_values = [int(row.power_w) for row in records if row.power_w is not None]
    hr_values = [int(row.heart_rate_bpm) for row in records if row.heart_rate_bpm is not None]
    cadence_values = [int(row.cadence_rpm) for row in records if row.cadence_rpm is not None]
    speed_values = [float(row.speed_mps) * 3.6 for row in records if row.speed_mps is not None]
    altitude_values = [float(row.altitude_m) for row in records if row.altitude_m is not None]

    return {
        "activity": {
            "id": activity.id,
            "external_id": activity.external_id,
            "name": activity.name or "Unbenannte Aktivitaet",
            "provider": activity.provider,
            "sport": activity.sport,
            "started_at": activity.started_at.isoformat() if activity.started_at else None,
            "duration_s": activity.duration_s,
            "duration_label": _duration_label(activity.duration_s),
            "distance_m": activity.distance_m,
            "avg_speed_kmh": avg_speed_kmh,
            "avg_power_w": activity.avg_power_w,
            "avg_hr_bpm": activity.avg_hr_bpm,
            "max_power_w": max(power_values) if power_values else None,
            "max_hr_bpm": max(hr_values) if hr_values else None,
            "max_cadence_rpm": max(cadence_values) if cadence_values else None,
            "max_speed_kmh": max(speed_values) if speed_values else None,
            "min_altitude_m": min(altitude_values) if altitude_values else None,
            "max_altitude_m": max(altitude_values) if altitude_values else None,
            "stress_score": _stress_from_raw_json(activity.raw_json),
            "records_count": len(records),
            "laps_count": len(laps),
            "sessions_count": len(sessions),
        },
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
        "laps": [
            {
                "lap_index": row.lap_index,
                "start_time": row.start_time.isoformat() if row.start_time else None,
                "total_elapsed_time_s": row.total_elapsed_time_s,
                "total_timer_time_s": row.total_timer_time_s,
                "total_distance_m": row.total_distance_m,
                "avg_speed_kmh": (row.avg_speed_mps * 3.6) if row.avg_speed_mps is not None else None,
                "avg_power_w": row.avg_power_w,
                "max_power_w": row.max_power_w,
                "avg_hr_bpm": row.avg_hr_bpm,
                "max_hr_bpm": row.max_hr_bpm,
                "duration_label": _duration_label(int(row.total_timer_time_s)) if row.total_timer_time_s is not None else _duration_label(int(row.total_elapsed_time_s)) if row.total_elapsed_time_s is not None else None,
            }
            for row in laps
        ],
        "records": [
            {
                "index": row.record_index,
                "timestamp": row.timestamp.isoformat() if row.timestamp else None,
                "elapsed_s": row.elapsed_s,
                "distance_m": row.distance_m,
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


def rebuild_historical_max_hr_from_activities(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        deleted_metrics = session.execute(
            delete(UserTrainingMetric).where(
                UserTrainingMetric.user_id == user_id,
                UserTrainingMetric.metric_type == "max_hr",
                UserTrainingMetric.source == "Automatisch aus Aktivitäten",
            )
        ).rowcount or 0

        activities = session.scalars(
            select(Activity)
            .where(Activity.user_id == user_id)
            .where(Activity.started_at.is_not(None))
            .order_by(Activity.started_at.asc(), Activity.id.asc())
        ).all()

        activity_ids = [activity.id for activity in activities]
        sessions = session.scalars(
            select(ActivitySession)
            .where(ActivitySession.activity_id.in_(activity_ids))
            .order_by(ActivitySession.activity_id.asc(), ActivitySession.session_index.asc())
        ).all() if activity_ids else []
        laps = session.scalars(
            select(ActivityLap)
            .where(ActivityLap.activity_id.in_(activity_ids))
            .order_by(ActivityLap.activity_id.asc(), ActivityLap.lap_index.asc())
        ).all() if activity_ids else []
        records = session.scalars(
            select(ActivityRecord)
            .where(ActivityRecord.activity_id.in_(activity_ids))
            .order_by(ActivityRecord.activity_id.asc(), ActivityRecord.record_index.asc())
        ).all() if activity_ids else []

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

        for activity in activities:
            checked_activities += 1
            max_hr_value = _extract_activity_max_hr(
                activity,
                sessions_by_activity.get(activity.id, []),
                laps_by_activity.get(activity.id, []),
                records_by_activity.get(activity.id, []),
            )
            if max_hr_value is None:
                continue
            activities_with_hr += 1
            if running_peak is not None and max_hr_value <= running_peak:
                continue

            running_peak = max_hr_value
            recorded_at = activity.started_at or datetime.utcnow()
            metric = UserTrainingMetric(
                user_id=user_id,
                metric_type="max_hr",
                recorded_at=recorded_at,
                value=round(float(max_hr_value), 2),
                source="Automatisch aus Aktivitäten",
                notes=f"Historischer Recheck: {activity.name or 'Aktivität'}",
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
                    "activity_name": activity.name or "Aktivität",
                }
            )

        session.commit()

    return {
        "status": "ok",
        "checked_activities": checked_activities,
        "activities_with_hr": activities_with_hr,
        "deleted_auto_max_hr_metrics": deleted_metrics,
        "created_max_hr_metrics": len(created_metrics),
        "max_hr_history": created_metrics,
    }
