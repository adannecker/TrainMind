from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select

from packages.db.models import Activity
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


def get_weekly_activities(reference_date: str | None = None) -> dict[str, Any]:
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


def get_available_activity_weeks() -> dict[str, Any]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(Activity.started_at).where(Activity.started_at.is_not(None)).order_by(Activity.started_at.desc())
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
