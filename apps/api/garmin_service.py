from __future__ import annotations

import logging
import os
import json
import re
import time
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectConnectionError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from apps.api.achievement_service import reset_achievement_data
from apps.api.credential_service import get_service_credentials
from apps.api.training_service import create_imported_max_hr_metric_if_new_peak
from packages.db.models import Activity, ActivityLap, FitFile, FitFilePayload, UserTrainingMetric
from packages.db.session import SessionLocal


REPO_ROOT = Path(__file__).resolve().parents[2]
GARMIN_RATE_LIMIT_COOLDOWN = timedelta(minutes=15)
_garmin_rate_limited_until_by_user: dict[int, datetime] = {}
_GARMIN_TOKENSTORE_ROOT = REPO_ROOT / "data" / "garmin_tokens"
logger = logging.getLogger(__name__)


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


def _activity_type_key(item: dict[str, Any]) -> str:
    activity_type = _nested_dict(item, "activityType")
    activity_type_dto = _nested_dict(item, "activityTypeDTO")
    type_key = (
        item.get("typeKey")
        or activity_type.get("typeKey")
        or activity_type_dto.get("typeKey")
        or item.get("activityType")
    )
    return str(type_key or "").strip().lower()


def _is_cycling_activity(item: dict[str, Any]) -> bool:
    type_key = _activity_type_key(item)
    if not type_key:
        return False
    return "cycling" in type_key or "biking" in type_key


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


def _serialize_missing_ride(item: dict[str, Any]) -> dict[str, Any] | None:
    activity_id = _extract_activity_id(item)
    if activity_id is None:
        return None
    start_local_raw = _pick_value(item, "startTimeLocal", "activityStartTimeLocal")
    start_utc_raw = _pick_value(item, "startTimeGMT", "startTimeUtc")
    start_local = _to_datetime(start_local_raw)
    start_utc = _to_datetime(start_utc_raw)
    duration_s = _get_duration_seconds(item)
    return {
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


def _collect_loaded_ids(user_id: int) -> set[str]:
    loaded_ids: set[str] = set()
    with SessionLocal() as session:
        activity_ids = session.scalars(
            select(Activity.external_id).where(Activity.provider == "garmin", Activity.user_id == user_id)
        ).all()
        fit_file_ids = session.scalars(
            select(FitFile.external_activity_id).where(FitFile.provider == "garmin", FitFile.user_id == user_id)
        ).all()

    for value in activity_ids:
        if value:
            loaded_ids.add(str(value))
    for value in fit_file_ids:
        if value:
            loaded_ids.add(str(value))
    return loaded_ids


def _is_rate_limit_error(exc: Exception) -> bool:
    message = str(exc)
    return "429" in message or "Too Many Requests" in message


def _garmin_tokenstore_path(user_id: int, email: str) -> Path:
    email_hash = sha256(email.strip().lower().encode("utf-8")).hexdigest()[:16]
    return _GARMIN_TOKENSTORE_ROOT / f"user_{user_id}" / email_hash


def _ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass


def _tokenstore_has_session(path: Path) -> bool:
    return path.exists() and any(path.glob("*.json"))


def _persist_client_session(client: Garmin, tokenstore_path: Path) -> None:
    garth_client = getattr(client, "garth", None)
    dump = getattr(garth_client, "dump", None)
    if dump is None:
        return

    _ensure_private_dir(tokenstore_path)
    dump(str(tokenstore_path))
    for json_file in tokenstore_path.glob("*.json"):
        try:
            os.chmod(json_file, 0o600)
        except OSError:
            pass


def _build_client(user_id: int) -> Garmin:
    blocked_until = _garmin_rate_limited_until_by_user.get(user_id)
    if blocked_until and blocked_until > datetime.utcnow():
        retry_minutes = max(1, int((blocked_until - datetime.utcnow()).total_seconds() // 60) + 1)
        raise RuntimeError(
            f"Garmin blockiert den Login gerade wegen zu vieler Anfragen (HTTP 429). "
            f"Bitte in etwa {retry_minutes} Minute(n) erneut versuchen."
        )

    load_dotenv(dotenv_path=REPO_ROOT / ".env")
    stored = get_service_credentials("garmin", user_id=user_id)
    if stored is not None:
        email, password = stored
    else:
        email = os.getenv("GARMIN_EMAIL")
        password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        raise ValueError("GARMIN_EMAIL and GARMIN_PASSWORD must be set in environment or .env")

    tokenstore_path = _garmin_tokenstore_path(user_id=user_id, email=email)
    if _tokenstore_has_session(tokenstore_path):
        try:
            logger.info("Attempting Garmin token login for user_id=%s", user_id)
            client = Garmin()
            client.login(str(tokenstore_path))
            _garmin_rate_limited_until_by_user.pop(user_id, None)
            logger.info("Garmin token login successful for user_id=%s", user_id)
            return client
        except Exception as exc:
            if _is_rate_limit_error(exc):
                _garmin_rate_limited_until_by_user[user_id] = datetime.utcnow() + GARMIN_RATE_LIMIT_COOLDOWN
                raise RuntimeError(
                    "Garmin blockiert den Login gerade wegen zu vieler Anfragen (HTTP 429). "
                    "Bitte etwa 15 Minuten warten und es dann erneut versuchen."
                ) from exc
            logger.warning("Garmin token login failed for user_id=%s: %s", user_id, exc)

    _ensure_private_dir(tokenstore_path)
    client = Garmin(email, password)
    try:
        logger.info("Attempting Garmin credential login for user_id=%s", user_id)
        client.login()
        _persist_client_session(client, tokenstore_path)
        _garmin_rate_limited_until_by_user.pop(user_id, None)
        logger.info("Garmin credential login successful for user_id=%s", user_id)
    except GarminConnectAuthenticationError as exc:
        if _is_rate_limit_error(exc):
            _garmin_rate_limited_until_by_user[user_id] = datetime.utcnow() + GARMIN_RATE_LIMIT_COOLDOWN
            raise RuntimeError(
                "Garmin blockiert den Login gerade wegen zu vieler Anfragen (HTTP 429). "
                "Bitte etwa 15 Minuten warten und es dann erneut versuchen."
            ) from exc
        raise RuntimeError(f"Garmin authentication failed: {exc}") from exc
    except GarminConnectConnectionError as exc:
        if _is_rate_limit_error(exc):
            _garmin_rate_limited_until_by_user[user_id] = datetime.utcnow() + GARMIN_RATE_LIMIT_COOLDOWN
            raise RuntimeError(
                "Garmin blockiert den Login gerade wegen zu vieler Anfragen (HTTP 429). "
                "Bitte etwa 15 Minuten warten und es dann erneut versuchen."
            ) from exc
        raise RuntimeError(f"Garmin connection failed: {exc}") from exc
    return client


def _download_fit_bytes(client: Garmin, activity_id: int) -> bytes:
    try:
        return client.download_activity(activity_id, dl_fmt=client.ActivityDownloadFormat.ORIGINAL)
    except AttributeError:
        pass
    return client.download_activity_original(activity_id)


def get_missing_garmin_rides(user_id: int, limit: int = 50) -> dict[str, Any]:
    safe_limit = max(1, min(limit, 200))
    client = _build_client(user_id=user_id)
    recent = client.get_activities(0, safe_limit)
    loaded_ids = _collect_loaded_ids(user_id=user_id)

    missing: list[dict[str, Any]] = []
    already_loaded_count = 0

    for item in recent:
        serialized = _serialize_missing_ride(item)
        if serialized is None:
            continue
        activity_id = serialized["activity_id"]
        is_loaded = activity_id in loaded_ids
        if is_loaded:
            already_loaded_count += 1
            continue
        missing.append(serialized)

    missing.sort(key=lambda r: r["start_local"] or "", reverse=True)
    checked = len(recent)

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "mode": "recent",
        "summary": {
            "checked_recent_rides": checked,
            "already_loaded": already_loaded_count,
            "missing": len(missing),
        },
        "rides": missing,
    }


def get_missing_garmin_rides_for_period(
    user_id: int,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    page_size: int = 100,
    max_pages: int = 24,
) -> dict[str, Any]:
    if start_year < 2000 or start_year > 2100 or end_year < 2000 or end_year > 2100:
        raise ValueError("year must be between 2000 and 2100.")
    if start_month < 1 or start_month > 12 or end_month < 1 or end_month > 12:
        raise ValueError("month must be between 1 and 12.")

    safe_page_size = max(20, min(page_size, 100))
    safe_max_pages = max(1, min(max_pages, 60))
    client = _build_client(user_id=user_id)
    loaded_ids = _collect_loaded_ids(user_id=user_id)

    target_start = datetime(start_year, start_month, 1)
    target_end = datetime(end_year + (1 if end_month == 12 else 0), 1 if end_month == 12 else end_month + 1, 1)
    if target_end <= target_start:
        raise ValueError("end period must be the same as or after start period.")

    missing: list[dict[str, Any]] = []
    already_loaded_count = 0
    checked_total = 0
    pages_scanned = 0
    reached_older_activities = False

    for page_index in range(safe_max_pages):
      start = page_index * safe_page_size
      batch = client.get_activities(start, safe_page_size)
      pages_scanned += 1
      if not batch:
          break

      batch_has_target_month = False
      batch_is_entirely_older = True

      for item in batch:
          serialized = _serialize_missing_ride(item)
          if serialized is None:
              continue
          checked_total += 1
          activity_time = _to_datetime(_pick_value(item, "startTimeLocal", "activityStartTimeLocal")) or _to_datetime(
              _pick_value(item, "startTimeGMT", "startTimeUtc")
          )
          if activity_time is None:
              continue
          if activity_time >= target_end:
              batch_is_entirely_older = False
              continue
          if activity_time < target_start:
              continue

          batch_has_target_month = True
          batch_is_entirely_older = False
          activity_id = serialized["activity_id"]
          if activity_id in loaded_ids:
              already_loaded_count += 1
              continue
          missing.append(serialized)

      if batch_has_target_month:
          continue

      latest_item_time = _to_datetime(_pick_value(batch[0], "startTimeLocal", "activityStartTimeLocal")) or _to_datetime(
          _pick_value(batch[0], "startTimeGMT", "startTimeUtc")
      )
      oldest_item_time = _to_datetime(_pick_value(batch[-1], "startTimeLocal", "activityStartTimeLocal")) or _to_datetime(
          _pick_value(batch[-1], "startTimeGMT", "startTimeUtc")
      )

      if latest_item_time is not None and latest_item_time < target_start:
          reached_older_activities = True
          break
      if oldest_item_time is not None and oldest_item_time < target_start and batch_is_entirely_older:
          reached_older_activities = True
          break

    missing.sort(key=lambda r: r["start_local"] or r["start_utc"] or "", reverse=True)

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "mode": "period",
        "period": {
            "start_year": start_year,
            "start_month": start_month,
            "end_year": end_year,
            "end_month": end_month,
        },
        "summary": {
            "checked_recent_rides": checked_total,
            "already_loaded": already_loaded_count,
            "missing": len(missing),
            "pages_scanned": pages_scanned,
            "reached_older_activities": reached_older_activities,
        },
        "rides": missing,
    }


def get_imported_garmin_summary(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        activity_count = len(
            session.scalars(select(Activity.id).where(Activity.user_id == user_id, Activity.provider == "garmin")).all()
        )
        fit_file_count = len(
            session.scalars(select(FitFile.id).where(FitFile.user_id == user_id, FitFile.provider == "garmin")).all()
        )
        auto_max_hr_count = len(
            session.scalars(
                select(UserTrainingMetric.id).where(
                    UserTrainingMetric.user_id == user_id,
                    UserTrainingMetric.metric_type == "max_hr",
                    UserTrainingMetric.source == "Automatisch aus Aktivitäten",
                )
            ).all()
        )
    return {
        "status": "ok",
        "activities": activity_count,
        "fit_files": fit_file_count,
        "derived_max_hr_metrics": auto_max_hr_count,
    }


def _import_selected_garmin_rides_with_client(
    client: Garmin,
    user_id: int,
    activity_ids: list[str],
    sleep_seconds: float = 0.0,
) -> dict[str, Any]:
    cleaned_ids = [str(x).strip() for x in activity_ids if str(x).strip()]
    deduped_ids = list(dict.fromkeys(cleaned_ids))
    if not deduped_ids:
        return {"loaded": 0, "skipped": 0, "errors": [], "imported_ids": [], "interesting_updates": []}

    loaded_ids: list[str] = []
    skipped_ids: list[str] = []
    errors: list[dict[str, str]] = []
    interesting_updates: list[dict[str, Any]] = []
    safe_sleep_seconds = max(0.0, float(sleep_seconds))

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
                    Activity.user_id == user_id,
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
                fit_file = FitFile(
                    user_id=user_id,
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
                        user_id=user_id,
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
                        Activity.user_id == user_id,
                    )
                )
                if created_activity is not None:
                    _upsert_laps_for_activity(session, created_activity.id, summary)

                session.commit()
                max_hr_bpm = _pick_value(summary, "maxHR")
                if max_hr_bpm is not None:
                    try:
                        new_metric = create_imported_max_hr_metric_if_new_peak(
                            user_id=user_id,
                            value=max_hr_bpm,
                            recorded_at=started_local,
                            source="Automatisch aus Aktivitäten",
                            notes=f"Import aus Garmin: {name}",
                        )
                        if new_metric is not None:
                            interesting_updates.append(
                                {
                                    "kind": "new_max_hr_peak",
                                    "metric_id": new_metric["id"],
                                    "value": new_metric["value"],
                                    "recorded_at": new_metric["recorded_at"],
                                    "source": new_metric["source"],
                                    "activity_name": name,
                                    "activity_id": activity_id,
                                }
                            )
                    except Exception:
                        pass
                loaded_ids.append(activity_id)
            except IntegrityError:
                session.rollback()
                skipped_ids.append(activity_id)
            except Exception as exc:
                session.rollback()
                errors.append({"activity_id": activity_id, "reason": f"DB save failed: {exc}"})

        if safe_sleep_seconds > 0:
            time.sleep(safe_sleep_seconds)

    return {
        "loaded": len(loaded_ids),
        "skipped": len(skipped_ids),
        "errors": errors,
        "imported_ids": loaded_ids,
        "interesting_updates": interesting_updates,
    }


def import_selected_garmin_rides(user_id: int, activity_ids: list[str]) -> dict[str, Any]:
    client = _build_client(user_id=user_id)
    return _import_selected_garmin_rides_with_client(client=client, user_id=user_id, activity_ids=activity_ids)


def ingest_recent_garmin_rides(
    user_id: int,
    days_back: int = 3,
    batch_size: int = 20,
    sleep_seconds: float = 1.0,
) -> dict[str, Any]:
    safe_days_back = max(0, min(days_back, 30))
    safe_batch_size = max(1, min(batch_size, 100))
    safe_sleep_seconds = max(0.0, min(float(sleep_seconds), 5.0))

    client = _build_client(user_id=user_id)
    loaded_ids = _collect_loaded_ids(user_id=user_id)
    cutoff_date = datetime.utcnow().date() - timedelta(days=safe_days_back)

    start = 0
    checked_total = 0
    pages_scanned = 0
    skipped_non_cycling = 0
    skipped_missing_date = 0
    skipped_already_loaded = 0
    selected_ids: list[str] = []
    stop_reason = "exhausted"

    while True:
        activities = client.get_activities(start, safe_batch_size)
        pages_scanned += 1
        if not activities:
            break

        reached_cutoff = False

        for activity in activities:
            checked_total += 1
            activity_id = _extract_activity_id(activity)
            if not activity_id:
                continue

            if not _is_cycling_activity(activity):
                skipped_non_cycling += 1
                continue

            activity_time = _to_datetime(_pick_value(activity, "startTimeLocal", "activityStartTimeLocal")) or _to_datetime(
                _pick_value(activity, "startTimeGMT", "startTimeUtc")
            )
            if activity_time is None:
                skipped_missing_date += 1
                continue

            if activity_time.date() < cutoff_date:
                stop_reason = "cutoff_reached"
                reached_cutoff = True
                break

            if activity_id in loaded_ids:
                skipped_already_loaded += 1
                continue

            selected_ids.append(activity_id)
            loaded_ids.add(activity_id)

        if reached_cutoff:
            break

        start += safe_batch_size

    import_result = _import_selected_garmin_rides_with_client(
        client=client,
        user_id=user_id,
        activity_ids=selected_ids,
        sleep_seconds=safe_sleep_seconds,
    )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "mode": "recent-ingest",
        "window": {
            "days_back": safe_days_back,
            "batch_size": safe_batch_size,
            "sleep_seconds": safe_sleep_seconds,
            "cutoff_date": cutoff_date.isoformat(),
        },
        "summary": {
            "checked_recent_rides": checked_total,
            "pages_scanned": pages_scanned,
            "selected_for_import": len(selected_ids),
            "already_loaded": skipped_already_loaded,
            "skipped_non_cycling": skipped_non_cycling,
            "skipped_missing_date": skipped_missing_date,
            "stop_reason": stop_reason,
        },
        "import_result": import_result,
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


def reset_imported_garmin_data(user_id: int, delete_derived_metrics: bool = False) -> dict[str, Any]:
    with SessionLocal() as session:
        activity_ids = session.scalars(
            select(Activity.id).where(Activity.user_id == user_id, Activity.provider == "garmin")
        ).all()
        fit_file_ids = session.scalars(
            select(FitFile.id).where(FitFile.user_id == user_id, FitFile.provider == "garmin")
        ).all()

        deleted_metrics = 0
        if delete_derived_metrics:
            deleted_metrics = session.execute(
                delete(UserTrainingMetric).where(
                    UserTrainingMetric.user_id == user_id,
                    UserTrainingMetric.metric_type == "max_hr",
                    UserTrainingMetric.source == "Automatisch aus Aktivitäten",
                )
            ).rowcount or 0

        deleted_activities = session.execute(
            delete(Activity).where(Activity.user_id == user_id, Activity.provider == "garmin")
        ).rowcount or 0
        deleted_fit_files = session.execute(
            delete(FitFile).where(FitFile.user_id == user_id, FitFile.provider == "garmin")
        ).rowcount or 0
        session.commit()

    reset_achievement_data(user_id=user_id)
    return {
        "status": "deleted",
        "deleted_activities": deleted_activities,
        "deleted_fit_files": deleted_fit_files,
        "deleted_derived_metrics": deleted_metrics,
        "activity_ids_found": len(activity_ids),
        "fit_file_ids_found": len(fit_file_ids),
    }
