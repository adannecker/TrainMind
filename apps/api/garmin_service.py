from __future__ import annotations

import os
import json
import re
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectConnectionError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from packages.db.models import Activity, ActivityLap, FitFile, FitFilePayload, User
from packages.db.session import SessionLocal


REPO_ROOT = Path(__file__).resolve().parents[2]


def _sanitize_filename(value: str, max_len: int = 80) -> str:
    text = (value or "activity").strip()
    text = re.sub(r"[^\w\-. ]+", "", text, flags=re.UNICODE)
    text = text.replace(" ", "_").strip("._")
    if not text:
        text = "activity"
    return text[:max_len]


def _extract_activity_id(item: dict[str, Any]) -> str | None:
    raw_id = (
        item.get("activityId")
        or item.get("activityIdLong")
        or item.get("summaryId")
        or item.get("id")
    )
    if raw_id is None:
        return None
    return str(raw_id)


def _nested_dict(item: dict[str, Any], key: str) -> dict[str, Any]:
    value = item.get(key)
    if isinstance(value, dict):
        return value
    return {}


def _pick_value(item: dict[str, Any], *keys: str) -> Any:
    summary = _nested_dict(item, "summaryDTO")
    for key in keys:
        if item.get(key) is not None:
            return item.get(key)
    for key in keys:
        if summary.get(key) is not None:
            return summary.get(key)
    return None


def _to_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("T", " ").replace("Z", "").replace(".0", "")
    for fmt in ("%Y-%m-%d %H:%M:%S",):
        try:
            return datetime.strptime(normalized, fmt)
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _get_duration_seconds(activity: dict[str, Any]) -> int | None:
    for key in ("duration", "movingDuration", "elapsedDuration"):
        value = _pick_value(activity, key)
        if value is None:
            continue
        try:
            return int(float(value))
        except (TypeError, ValueError):
            continue
    return None


def _duration_label(total_seconds: int | None) -> str | None:
    if total_seconds is None:
        return None
    h, rem = divmod(total_seconds, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _upsert_laps_for_activity(session, activity_id: int, summary_payload: dict[str, Any]) -> None:
    split_summaries = summary_payload.get("splitSummaries")
    if not isinstance(split_summaries, list) or not split_summaries:
        return

    for i, split in enumerate(split_summaries):
        if not isinstance(split, dict):
            continue

        start_time = _to_datetime(split.get("startTimeLocal") or split.get("startTimeGMT"))
        duration_s = _get_duration_seconds(split)
        distance_m = split.get("distance")
        avg_speed = split.get("averageSpeed") or split.get("averageMovingSpeed")

        existing = session.scalar(
            select(ActivityLap.id).where(
                ActivityLap.activity_id == activity_id,
                ActivityLap.lap_index == i,
            )
        )
        if existing:
            continue

        session.add(
            ActivityLap(
                activity_id=activity_id,
                lap_index=i,
                start_time=start_time,
                total_elapsed_time_s=float(duration_s) if duration_s is not None else None,
                total_timer_time_s=float(duration_s) if duration_s is not None else None,
                total_distance_m=float(distance_m) if distance_m is not None else None,
                avg_speed_mps=float(avg_speed) if avg_speed is not None else None,
                avg_power_w=(
                    float(split.get("averagePower")) if split.get("averagePower") is not None else None
                ),
                max_power_w=(
                    float(split.get("maxPower")) if split.get("maxPower") is not None else None
                ),
                avg_hr_bpm=(
                    float(split.get("averageHR")) if split.get("averageHR") is not None else None
                ),
                max_hr_bpm=(
                    float(split.get("maxHR")) if split.get("maxHR") is not None else None
                ),
            )
        )


def _collect_loaded_ids() -> set[str]:
    loaded_ids: set[str] = set()
    with SessionLocal() as session:
        activity_ids = session.scalars(
            select(Activity.external_id).where(Activity.provider == "garmin")
        ).all()
        fit_file_ids = session.scalars(
            select(FitFile.external_activity_id).where(FitFile.provider == "garmin")
        ).all()

    for value in activity_ids:
        if value:
            loaded_ids.add(str(value))
    for value in fit_file_ids:
        if value:
            loaded_ids.add(str(value))
    return loaded_ids


def _build_client() -> Garmin:
    load_dotenv(dotenv_path=REPO_ROOT / ".env")
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        raise ValueError("GARMIN_EMAIL and GARMIN_PASSWORD must be set in environment or .env")

    client = Garmin(email, password)
    try:
        client.login()
    except GarminConnectAuthenticationError as exc:
        raise RuntimeError(f"Garmin authentication failed: {exc}") from exc
    except GarminConnectConnectionError as exc:
        raise RuntimeError(f"Garmin connection failed: {exc}") from exc
    return client


def _download_fit_bytes(client: Garmin, activity_id: int) -> bytes:
    try:
        return client.download_activity(activity_id, dl_fmt=client.ActivityDownloadFormat.ORIGINAL)
    except AttributeError:
        pass
    return client.download_activity_original(activity_id)


def _ensure_local_user(session, email: str) -> User:
    existing = session.scalar(select(User).where(User.email == email))
    if existing:
        return existing
    user = User(email=email, display_name="Garmin User", created_at=datetime.utcnow())
    session.add(user)
    session.flush()
    return user


def get_missing_garmin_rides(limit: int = 50) -> dict[str, Any]:
    safe_limit = max(1, min(limit, 200))
    client = _build_client()
    recent = client.get_activities(0, safe_limit)
    loaded_ids = _collect_loaded_ids()

    missing: list[dict[str, Any]] = []
    already_loaded_count = 0

    for item in recent:
        activity_id = _extract_activity_id(item)
        if activity_id is None:
            continue
        is_loaded = activity_id in loaded_ids
        if is_loaded:
            already_loaded_count += 1
            continue

        start_local_raw = _pick_value(item, "startTimeLocal", "activityStartTimeLocal")
        start_utc_raw = _pick_value(item, "startTimeGMT", "startTimeUtc")
        start_local = _to_datetime(start_local_raw)
        start_utc = _to_datetime(start_utc_raw)
        duration_s = _get_duration_seconds(item)

        missing.append(
            {
                "activity_id": activity_id,
                "name": item.get("activityName") or "Unnamed activity",
                "start_local": start_local.isoformat() if start_local else None,
                "start_utc": start_utc.isoformat() if start_utc else None,
                "duration_s": duration_s,
                "duration_label": _duration_label(duration_s),
                "distance_m": _pick_value(item, "distance"),
                "avg_power_w": _pick_value(item, "avgPower", "averagePower"),
                "avg_hr_bpm": _pick_value(item, "averageHR"),
                "avg_speed_mps": _pick_value(item, "averageSpeed", "averageMovingSpeed"),
                "avg_cadence_rpm": _pick_value(item, "averageBikingCadenceInRevPerMinute", "averageBikeCadence"),
                "calories_kcal": _pick_value(item, "calories"),
                "elevation_gain_m": _pick_value(item, "elevationGain"),
            }
        )

    missing.sort(key=lambda r: r["start_local"] or "", reverse=True)
    checked = len(recent)

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "checked_recent_rides": checked,
            "already_loaded": already_loaded_count,
            "missing": len(missing),
        },
        "rides": missing,
    }


def import_selected_garmin_rides(activity_ids: list[str]) -> dict[str, Any]:
    cleaned_ids = [str(x).strip() for x in activity_ids if str(x).strip()]
    deduped_ids = list(dict.fromkeys(cleaned_ids))
    if not deduped_ids:
        return {"loaded": 0, "skipped": 0, "errors": [], "imported_ids": []}

    client = _build_client()
    email = os.getenv("GARMIN_EMAIL", "garmin@trainmind.local")
    loaded_ids: list[str] = []
    skipped_ids: list[str] = []
    errors: list[dict[str, str]] = []

    for activity_id in deduped_ids:
        try:
            numeric_id = int(activity_id)
        except ValueError:
            errors.append({"activity_id": activity_id, "reason": "Invalid activity id"})
            continue

        with SessionLocal() as session:
            existing = session.scalar(
                select(Activity.id).where(
                    Activity.provider == "garmin",
                    Activity.external_id == activity_id,
                )
            )
            if existing:
                skipped_ids.append(activity_id)
                continue

            try:
                summary = client.get_activity(numeric_id)
                fit_bytes = _download_fit_bytes(client, numeric_id)
            except Exception as exc:
                errors.append({"activity_id": activity_id, "reason": f"Garmin download failed: {exc}"})
                session.rollback()
                continue

            started_local = _to_datetime(_pick_value(summary, "startTimeLocal", "activityStartTimeLocal"))
            duration_s = _get_duration_seconds(summary)
            name = summary.get("activityName") or "Garmin activity"
            timestamp = (started_local or datetime.utcnow()).strftime("%y%m%d_%H%M")
            file_name = f"{timestamp}_{_sanitize_filename(name)}.fit"
            file_sha = sha256(fit_bytes).hexdigest()

            try:
                user = _ensure_local_user(session, email=email)
                fit_file = FitFile(
                    user_id=user.id,
                    provider="garmin",
                    external_activity_id=activity_id,
                    file_name=file_name,
                    file_path=f"data/exports/{file_name}",
                    file_sha256=file_sha,
                    imported_at=datetime.utcnow(),
                    parser_version="garmin-api-v1",
                )
                session.add(fit_file)
                session.flush()

                session.add(
                    FitFilePayload(
                        fit_file_id=fit_file.id,
                        content=fit_bytes,
                        content_size_bytes=len(fit_bytes),
                        content_sha256=file_sha,
                        compression="none",
                        created_at=datetime.utcnow(),
                    )
                )

                session.add(
                    Activity(
                        user_id=user.id,
                        source_fit_file_id=fit_file.id,
                        provider="garmin",
                        external_id=activity_id,
                        name=name,
                        sport=(
                            _nested_dict(summary, "activityTypeDTO").get("typeKey")
                            if _nested_dict(summary, "activityTypeDTO")
                            else (
                                summary.get("activityType", {}).get("typeKey")
                                if isinstance(summary.get("activityType"), dict)
                                else None
                            )
                        ),
                        started_at=started_local,
                        duration_s=duration_s,
                        distance_m=_pick_value(summary, "distance"),
                        avg_power_w=_pick_value(summary, "avgPower", "averagePower"),
                        avg_hr_bpm=_pick_value(summary, "averageHR"),
                        raw_json=json.dumps(summary, ensure_ascii=False),
                        created_at=datetime.utcnow(),
                    )
                )
                session.flush()

                created_activity = session.scalar(
                    select(Activity).where(
                        Activity.provider == "garmin",
                        Activity.external_id == activity_id,
                    )
                )
                if created_activity is not None:
                    _upsert_laps_for_activity(session, created_activity.id, summary)

                session.commit()
                loaded_ids.append(activity_id)
            except IntegrityError:
                session.rollback()
                skipped_ids.append(activity_id)
            except Exception as exc:
                session.rollback()
                errors.append({"activity_id": activity_id, "reason": f"DB save failed: {exc}"})

    return {
        "loaded": len(loaded_ids),
        "skipped": len(skipped_ids),
        "errors": errors,
        "imported_ids": loaded_ids,
    }


def repair_garmin_activities_from_raw() -> dict[str, Any]:
    updated = 0
    laps_created = 0

    with SessionLocal() as session:
        rows = session.scalars(select(Activity).where(Activity.provider == "garmin")).all()
        for row in rows:
            payload = None
            try:
                payload = json.loads(row.raw_json) if row.raw_json else None
            except Exception:
                payload = None

            if not isinstance(payload, dict):
                continue

            changed = False
            started_local = _to_datetime(_pick_value(payload, "startTimeLocal", "activityStartTimeLocal"))
            duration_s = _get_duration_seconds(payload)
            distance_m = _pick_value(payload, "distance")
            avg_power_w = _pick_value(payload, "avgPower", "averagePower")
            avg_hr_bpm = _pick_value(payload, "averageHR")
            sport = _nested_dict(payload, "activityTypeDTO").get("typeKey")

            if row.started_at is None and started_local is not None:
                row.started_at = started_local
                changed = True
            if row.duration_s is None and duration_s is not None:
                row.duration_s = duration_s
                changed = True
            if row.distance_m is None and distance_m is not None:
                row.distance_m = float(distance_m)
                changed = True
            if row.avg_power_w is None and avg_power_w is not None:
                row.avg_power_w = float(avg_power_w)
                changed = True
            if row.avg_hr_bpm is None and avg_hr_bpm is not None:
                row.avg_hr_bpm = float(avg_hr_bpm)
                changed = True
            if row.sport is None and sport:
                row.sport = sport
                changed = True

            before_laps = session.scalar(
                select(ActivityLap.id).where(ActivityLap.activity_id == row.id).limit(1)
            )
            _upsert_laps_for_activity(session, row.id, payload)
            after_laps = session.scalar(
                select(ActivityLap.id).where(ActivityLap.activity_id == row.id).limit(1)
            )
            if before_laps is None and after_laps is not None:
                laps_created += 1

            if changed:
                updated += 1

        session.commit()

    return {"updated_activities": updated, "activities_with_new_laps": laps_created}
