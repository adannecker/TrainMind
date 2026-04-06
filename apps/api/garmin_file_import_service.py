from __future__ import annotations

import gzip
import hashlib
import io
import json
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from fitparse import FitFile as ParsedFitFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from apps.api.achievement_service import rebuild_activity_achievement_checks
from apps.api.activity_service import _hydrate_activity_streams_from_fit, clear_activity_list_cache
from apps.api.training_service import rebuild_hf_development_cache
from packages.db.models import Activity, FitFile, FitFilePayload
from packages.db.session import SessionLocal

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORT_ROOT = REPO_ROOT / "data" / "exports"


def _unwrap_fit_payload(raw_bytes: bytes) -> bytes | None:
    if not raw_bytes:
        return None
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


def _iso_or_none(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return None


def _serialize_fit_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, tuple):
        return [_serialize_fit_value(item) for item in value]
    if isinstance(value, list):
        return [_serialize_fit_value(item) for item in value]
    return str(value)


def _read_manifest_from_zip(archive: zipfile.ZipFile) -> tuple[dict[str, Any], str]:
    manifest_names = [name for name in archive.namelist() if name.endswith("/manifest.json") or name == "manifest.json"]
    if not manifest_names:
        raise ValueError("ZIP enthält kein manifest.json.")
    manifest_name = manifest_names[0]
    try:
        return json.loads(archive.read(manifest_name).decode("utf-8")), manifest_name
    except json.JSONDecodeError as exc:
        raise ValueError(f"manifest.json ist kein gültiges JSON: {exc}") from exc


def _list_fit_entries(archive: zipfile.ZipFile) -> list[str]:
    return [
        name
        for name in archive.namelist()
        if not name.endswith("/") and name.lower().endswith(".fit")
    ]


def _fit_message_value(message: Any, field_name: str) -> Any:
    try:
        return message.get_value(field_name)
    except Exception:
        return None


def _clean_activity_name(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.lower() in {"unknown", "activity", "garmin activity"}:
        return None
    return text


def _extract_activity_name_from_fit(fit: ParsedFitFile) -> str | None:
    candidate_messages = (
        ("session", ("name", "sport_profile_name", "pool_length_unit")),
        ("workout", ("wkt_name", "name", "sport")),
        ("course", ("course_name", "name")),
        ("sport", ("name", "sub_sport", "sport")),
    )
    for message_name, field_names in candidate_messages:
        message = next(iter(fit.get_messages(message_name)), None)
        if message is None:
            continue
        for field_name in field_names:
            candidate = _clean_activity_name(_fit_message_value(message, field_name))
            if candidate:
                return candidate
    return None


def _extract_fit_metadata_messages(fit: ParsedFitFile) -> list[dict[str, Any]]:
    metadata_messages: list[dict[str, Any]] = []
    message_indexes: dict[str, int] = {}

    for message in fit.get_messages():
        message_name = str(getattr(message, "name", "") or "")
        if not message_name or message_name == "record":
            continue

        fields: dict[str, Any] = {}
        for field in getattr(message, "fields", []):
            field_name = str(getattr(field, "name", "") or "").strip()
            if not field_name:
                continue
            field_value = _serialize_fit_value(getattr(field, "value", None))
            if field_value is None:
                continue
            fields[field_name] = field_value

        if not fields:
            continue

        next_index = message_indexes.get(message_name, 0)
        message_indexes[message_name] = next_index + 1
        metadata_messages.append(
            {
                "message_name": message_name,
                "message_index": next_index,
                "fields": fields,
            }
        )

    return metadata_messages


def _read_fit_summary(fit_bytes: bytes) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "activity_name": None,
        "sport": None,
        "sub_sport": None,
        "time_created": None,
        "device_serial_number": None,
        "garmin_product": None,
        "session_start_time": None,
        "total_distance_m": None,
        "total_timer_time_s": None,
        "avg_speed_mps": None,
        "avg_power_w": None,
        "avg_hr_bpm": None,
        "records_count": 0,
        "laps_count": 0,
        "sessions_count": 0,
        "metadata_messages": [],
        "parse_error": None,
    }
    try:
        fit = ParsedFitFile(io.BytesIO(fit_bytes))
        summary["activity_name"] = _extract_activity_name_from_fit(fit)
        summary["metadata_messages"] = _extract_fit_metadata_messages(fit)

        file_id = next(iter(fit.get_messages("file_id")), None)
        if file_id is not None:
            summary["time_created"] = _iso_or_none(file_id.get_value("time_created"))
            summary["device_serial_number"] = file_id.get_value("serial_number")
            summary["garmin_product"] = file_id.get_value("garmin_product")

        sport = next(iter(fit.get_messages("sport")), None)
        if sport is not None:
            summary["sport"] = sport.get_value("sport")
            summary["sub_sport"] = sport.get_value("sub_sport")

        session = next(iter(fit.get_messages("session")), None)
        if session is not None:
            summary["session_start_time"] = _iso_or_none(session.get_value("start_time") or session.get_value("timestamp"))
            summary["total_distance_m"] = session.get_value("total_distance")
            summary["total_timer_time_s"] = session.get_value("total_timer_time")
            summary["avg_speed_mps"] = session.get_value("avg_speed") or session.get_value("enhanced_avg_speed")
            summary["avg_power_w"] = session.get_value("avg_power") or session.get_value("total_average_power")
            summary["avg_hr_bpm"] = session.get_value("avg_heart_rate") or session.get_value("total_average_heart_rate")

        summary["records_count"] = sum(1 for _ in fit.get_messages("record"))
        summary["laps_count"] = sum(1 for _ in fit.get_messages("lap"))
        summary["sessions_count"] = sum(1 for _ in fit.get_messages("session"))
    except Exception as exc:
        summary["parse_error"] = str(exc)
    return summary


def _load_db_index() -> dict[str, Any]:
    with SessionLocal() as session:
        fit_rows = session.execute(
            select(
                FitFile.id,
                FitFile.external_activity_id,
                FitFile.file_name,
                FitFile.file_sha256,
                FitFilePayload.content_sha256,
                Activity.id,
                Activity.name,
                Activity.started_at,
            )
            .join(FitFilePayload, FitFilePayload.fit_file_id == FitFile.id)
            .outerjoin(Activity, Activity.source_fit_file_id == FitFile.id)
            .where(FitFile.provider == "garmin")
        ).all()
        activity_rows = session.execute(
            select(
                Activity.id,
                Activity.external_id,
                Activity.name,
                Activity.started_at,
                Activity.duration_s,
                Activity.distance_m,
                Activity.avg_power_w,
                Activity.avg_hr_bpm,
                Activity.sport,
                Activity.provider,
            )
            .where(Activity.provider == "garmin")
        ).all()

    by_external_id: dict[str, list[dict[str, Any]]] = {}
    by_content_sha: dict[str, list[dict[str, Any]]] = {}
    by_file_sha: dict[str, list[dict[str, Any]]] = {}
    activity_by_external_id: dict[str, list[dict[str, Any]]] = {}
    garmin_activities: list[dict[str, Any]] = []

    for row in fit_rows:
        record = {
            "fit_file_id": row[0],
            "external_activity_id": row[1],
            "file_name": row[2],
            "file_sha256": row[3],
            "content_sha256": row[4],
            "activity_id": row[5],
            "activity_name": row[6],
            "started_at": _iso_or_none(row[7]),
        }
        if row[1]:
            by_external_id.setdefault(str(row[1]), []).append(record)
        if row[4]:
            by_content_sha.setdefault(str(row[4]), []).append(record)
        if row[3]:
            by_file_sha.setdefault(str(row[3]), []).append(record)

    for row in activity_rows:
        activity_record = {
            "activity_id": row[0],
            "external_activity_id": row[1],
            "activity_name": row[2],
            "started_at": _iso_or_none(row[3]),
            "duration_s": row[4],
            "distance_m": row[5],
            "avg_power_w": row[6],
            "avg_hr_bpm": row[7],
            "sport": row[8],
            "provider": row[9],
        }
        garmin_activities.append(activity_record)
        if row[1]:
            activity_by_external_id.setdefault(str(row[1]), []).append(activity_record)

    return {
        "by_external_id": by_external_id,
        "by_content_sha": by_content_sha,
        "by_file_sha": by_file_sha,
        "activity_by_external_id": activity_by_external_id,
        "garmin_activities": garmin_activities,
        "db_fit_files": len(fit_rows),
    }


def list_saved_fit_dump_archives() -> dict[str, Any]:
    archives: list[dict[str, Any]] = []
    for path in sorted(EXPORT_ROOT.glob("garmin_fit_dump_*.zip"), key=lambda item: item.stat().st_mtime, reverse=True):
        stat = path.stat()
        archives.append(
            {
                "file_name": path.name,
                "relative_path": str(path.relative_to(REPO_ROOT)),
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }
        )
    return {"archives": archives}


def _build_empty_matches() -> dict[str, list[dict[str, Any]]]:
    return {
        "external_activity_id": [],
        "content_sha256": [],
        "file_sha256": [],
        "heuristic_activity": [],
    }


def _extract_numeric_candidates(value: str) -> list[str]:
    seen: set[str] = set()
    candidates: list[str] = []
    for match in re.findall(r"\d{8,}", value):
        if match not in seen:
            seen.add(match)
            candidates.append(match)
    return candidates


def _sport_similarity(left: str | None, right: str | None) -> bool:
    if not left or not right:
        return False
    return left.strip().lower() == right.strip().lower()


def _avg_speed_kmh(distance_m: float | None, duration_s: float | None) -> float | None:
    if distance_m is None or duration_s is None or duration_s <= 0:
        return None
    return (float(distance_m) / float(duration_s)) * 3.6


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _metric_similarity_score(actual: float | None, candidate: float | None, *, tight: float, loose: float, label: str) -> tuple[int, str | None]:
    if actual is None or candidate is None:
        return 0, None
    delta = abs(float(actual) - float(candidate))
    if delta <= tight:
        return 2, f"{label} sehr nah"
    if delta <= loose:
        return 1, f"{label} ähnlich"
    return -99, None


def _value_similarity_details(
    *,
    distance_m: float | None,
    duration_s: float | None,
    avg_power_w: float | None,
    avg_hr_bpm: float | None,
    avg_speed_mps: float | None,
    candidate: dict[str, Any],
    sport: str | None,
) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    candidate_distance = candidate.get("distance_m")
    if distance_m is not None and candidate_distance is not None:
        distance_delta = abs(float(candidate_distance) - float(distance_m))
        distance_ratio = distance_delta / max(float(distance_m), 1.0)
        if distance_delta <= 500 or distance_ratio <= 0.01:
            score += 4
            reasons.append("Distanz sehr nah")
        elif distance_delta <= 2000 or distance_ratio <= 0.03:
            score += 2
            reasons.append("Distanz aehnlich")
        elif distance_delta <= 5000 or distance_ratio <= 0.08:
            score += 1
            reasons.append("Distanz grob passend")

    candidate_duration = candidate.get("duration_s")
    if duration_s is not None and candidate_duration is not None:
        duration_delta = abs(float(candidate_duration) - float(duration_s))
        duration_ratio = duration_delta / max(float(duration_s), 1.0)
        if duration_delta <= 60 or duration_ratio <= 0.02:
            score += 3
            reasons.append("Dauer sehr nah")
        elif duration_delta <= 5 * 60 or duration_ratio <= 0.05:
            score += 2
            reasons.append("Dauer aehnlich")
        elif duration_delta <= 10 * 60 or duration_ratio <= 0.1:
            score += 1
            reasons.append("Dauer grob passend")

    speed_score, speed_reason = _metric_similarity_score(
        (float(avg_speed_mps) * 3.6) if avg_speed_mps is not None else None,
        _avg_speed_kmh(candidate.get("distance_m"), candidate.get("duration_s")),
        tight=0.8,
        loose=2.0,
        label="O km/h",
    )
    if speed_score > 0 and speed_reason:
        score += speed_score
        reasons.append(speed_reason)

    power_score, power_reason = _metric_similarity_score(
        avg_power_w,
        candidate.get("avg_power_w"),
        tight=10,
        loose=25,
        label="O Watt",
    )
    if power_score > 0 and power_reason:
        score += power_score
        reasons.append(power_reason)

    hr_score, hr_reason = _metric_similarity_score(
        avg_hr_bpm,
        candidate.get("avg_hr_bpm"),
        tight=4,
        loose=10,
        label="O HF",
    )
    if hr_score > 0 and hr_reason:
        score += hr_score
        reasons.append(hr_reason)

    if _sport_similarity(sport, candidate.get("sport")):
        score += 1
        reasons.append("Sport gleich")

    return score, reasons


def _match_activities_by_start_time(
    db_index: dict[str, Any],
    *,
    started_at: str | None,
    tolerance_seconds: int = 60,
) -> list[dict[str, Any]]:
    target_started_at = _parse_iso_datetime(started_at)
    if target_started_at is None:
        return []

    matches: list[dict[str, Any]] = []
    timezone_offsets = (0, 3600, -3600)
    for candidate in db_index["garmin_activities"]:
        candidate_started_at = _parse_iso_datetime(candidate.get("started_at"))
        if candidate_started_at is None:
            continue
        raw_delta_seconds = (candidate_started_at - target_started_at).total_seconds()
        adjusted_delta_seconds = min(abs(raw_delta_seconds - offset) for offset in timezone_offsets)
        if adjusted_delta_seconds <= tolerance_seconds:
            match = dict(candidate)
            match["match_score"] = max(1, tolerance_seconds - int(adjusted_delta_seconds))
            if adjusted_delta_seconds == abs(raw_delta_seconds):
                match["match_reasons"] = [f"Startzeit innerhalb von {int(adjusted_delta_seconds)} s"]
            else:
                match["match_reasons"] = [f"Startzeit passt mit moeglichem Zeitzonen-Offset ({int(abs(raw_delta_seconds))} s Differenz)"]
            matches.append(match)

    matches.sort(key=lambda item: (item.get("match_score") or 0), reverse=True)
    return matches


def _match_activities_by_similar_values(
    candidates: list[dict[str, Any]],
    *,
    distance_m: float | None,
    duration_s: float | None,
    avg_power_w: float | None,
    avg_hr_bpm: float | None,
    avg_speed_mps: float | None,
    sport: str | None,
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for candidate in candidates:
        score, reasons = _value_similarity_details(
            distance_m=distance_m,
            duration_s=duration_s,
            avg_power_w=avg_power_w,
            avg_hr_bpm=avg_hr_bpm,
            avg_speed_mps=avg_speed_mps,
            candidate=candidate,
            sport=sport,
        )
        if score < 4:
            continue
        match = dict(candidate)
        match["match_score"] = score
        match["match_reasons"] = reasons
        matches.append(match)

    matches.sort(key=lambda item: (item.get("match_score") or 0), reverse=True)
    return matches


def _duplicate_probability_label(probability_pct: int) -> str:
    if probability_pct >= 85:
        return "Sehr hoch"
    if probability_pct >= 65:
        return "Hoch"
    if probability_pct >= 40:
        return "Mittel"
    return "Gering"


def _build_duplicate_assessment(
    db_index: dict[str, Any],
    *,
    external_activity_id: str | None,
    started_at: str | None,
    distance_m: float | None,
    duration_s: float | None,
    avg_power_w: float | None,
    avg_hr_bpm: float | None,
    avg_speed_mps: float | None,
    sport: str | None,
    content_hash_match: bool,
    file_hash_match: bool,
    heuristic_matches: list[dict[str, Any]],
) -> dict[str, Any]:
    candidate_id = str(external_activity_id or "").strip()
    id_matches = db_index["activity_by_external_id"].get(candidate_id, []) if candidate_id else []
    same_start_matches = _match_activities_by_start_time(db_index, started_at=started_at)
    similar_value_matches = _match_activities_by_similar_values(
        same_start_matches,
        distance_m=distance_m,
        duration_s=duration_s,
        avg_power_w=avg_power_w,
        avg_hr_bpm=avg_hr_bpm,
        avg_speed_mps=avg_speed_mps,
        sport=sport,
    )

    probability_pct = 5
    reasons: list[str] = []

    if id_matches:
        probability_pct += 55
        reasons.append("Garmin-ID bereits als Aktivitaet vorhanden")
    if same_start_matches:
        probability_pct += 25
        reasons.append("Es gibt bereits eine Aktivitaet zur gleichen Startzeit")
    if similar_value_matches:
        probability_pct += 15
        reasons.append("Bei gleicher Startzeit sind die Werte sehr aehnlich")

    best_heuristic_score = int(heuristic_matches[0].get("match_score") or 0) if heuristic_matches else 0
    if best_heuristic_score >= 8:
        probability_pct += 10
    elif best_heuristic_score >= 5:
        probability_pct += 5

    if content_hash_match or file_hash_match:
        probability_pct = 100
        reasons.append("FIT-Inhalt oder Datei-Hash ist bereits vorhanden")

    probability_pct = min(probability_pct, 100)

    return {
        "garmin_id_exists": bool(id_matches),
        "garmin_id_matches": id_matches[:5],
        "same_start_time_exists": bool(same_start_matches),
        "same_start_time_matches": same_start_matches[:5],
        "similar_values_exists": bool(similar_value_matches),
        "similar_value_matches": similar_value_matches[:5],
        "probability_pct": probability_pct,
        "probability_label": _duplicate_probability_label(probability_pct),
        "reasons": reasons,
    }


def _ensure_duplicate_flag(duplicate_flags: list[str], flag: str) -> None:
    if flag not in duplicate_flags:
        duplicate_flags.append(flag)


def _build_heuristic_matches(
    db_index: dict[str, Any],
    *,
    started_at: str | None,
    distance_m: float | None,
    duration_s: float | None,
    avg_power_w: float | None,
    avg_hr_bpm: float | None,
    avg_speed_mps: float | None,
    sport: str | None,
) -> list[dict[str, Any]]:
    if not started_at:
        return []
    try:
        target_started_at = datetime.fromisoformat(started_at)
    except ValueError:
        return []

    matches: list[dict[str, Any]] = []
    for candidate in db_index["garmin_activities"]:
        candidate_started_at_raw = candidate.get("started_at")
        if not candidate_started_at_raw:
            continue
        try:
            candidate_started_at = datetime.fromisoformat(candidate_started_at_raw)
        except ValueError:
            continue

        delta_seconds = abs((candidate_started_at - target_started_at).total_seconds())
        if delta_seconds > 45 * 60:
            continue

        score = 0
        reasons: list[str] = [f"Startzeit ±{int(delta_seconds // 60)} min"]
        if delta_seconds <= 60:
            score += 4
        elif delta_seconds <= 5 * 60:
            score += 3
        elif delta_seconds <= 15 * 60:
            score += 2
        else:
            score += 1

        candidate_distance = candidate.get("distance_m")
        if distance_m is not None and candidate_distance is not None:
            distance_delta = abs(float(candidate_distance) - float(distance_m))
            distance_ratio = distance_delta / max(float(distance_m), 1.0)
            if distance_delta <= 500 or distance_ratio <= 0.01:
                score += 4
                reasons.append("Distanz sehr nah")
            elif distance_delta <= 2000 or distance_ratio <= 0.03:
                score += 2
                reasons.append("Distanz ähnlich")
            elif distance_delta <= 5000 or distance_ratio <= 0.08:
                score += 1
                reasons.append("Distanz grob passend")
            else:
                continue

        candidate_duration = candidate.get("duration_s")
        if duration_s is not None and candidate_duration is not None:
            duration_delta = abs(float(candidate_duration) - float(duration_s))
            duration_ratio = duration_delta / max(float(duration_s), 1.0)
            if duration_delta <= 60 or duration_ratio <= 0.02:
                score += 3
                reasons.append("Dauer sehr nah")
            elif duration_delta <= 5 * 60 or duration_ratio <= 0.05:
                score += 1
                reasons.append("Dauer ähnlich")
            elif duration_delta <= 10 * 60 or duration_ratio <= 0.1:
                reasons.append("Dauer grob passend")
            else:
                continue

        speed_score, speed_reason = _metric_similarity_score(
            (float(avg_speed_mps) * 3.6) if avg_speed_mps is not None else None,
            _avg_speed_kmh(candidate.get("distance_m"), candidate.get("duration_s")),
            tight=0.8,
            loose=2.0,
            label="Ø km/h",
        )
        if speed_score == -99:
            continue
        score += max(0, speed_score)
        if speed_reason:
            reasons.append(speed_reason)

        power_score, power_reason = _metric_similarity_score(
            avg_power_w,
            candidate.get("avg_power_w"),
            tight=10,
            loose=25,
            label="Ø Watt",
        )
        if power_score == -99:
            continue
        score += max(0, power_score)
        if power_reason:
            reasons.append(power_reason)

        hr_score, hr_reason = _metric_similarity_score(
            avg_hr_bpm,
            candidate.get("avg_hr_bpm"),
            tight=4,
            loose=10,
            label="Ø HF",
        )
        if hr_score == -99:
            continue
        score += max(0, hr_score)
        if hr_reason:
            reasons.append(hr_reason)

        if _sport_similarity(sport, candidate.get("sport")):
            score += 1
            reasons.append("Sport gleich")

        if score < 2:
            continue

        matches.append(
            {
                "activity_id": candidate.get("activity_id"),
                "external_activity_id": candidate.get("external_activity_id"),
                "activity_name": candidate.get("activity_name"),
                "started_at": candidate.get("started_at"),
                "duration_s": candidate.get("duration_s"),
                "distance_m": candidate.get("distance_m"),
                "sport": candidate.get("sport"),
                "match_score": score,
                "match_reasons": reasons,
            }
        )

    matches.sort(key=lambda item: (-int(item["match_score"]), item.get("started_at") or ""))
    return matches[:5]


def _build_garmin_id_suggestion(
    file_name: str,
    heuristic_matches: list[dict[str, Any]],
) -> tuple[str | None, list[str]]:
    reasons: list[str] = []
    filename_candidates = _extract_numeric_candidates(file_name)
    if heuristic_matches:
        best = heuristic_matches[0]
        best_id = str(best.get("external_activity_id") or "").strip()
        if best_id:
            reasons.append("Heuristischer Treffer aus vorhandener Garmin-Aktivität")
            if best_id in filename_candidates:
                reasons.append("Zahl im Dateinamen passt zur vorhandenen Garmin-ID")
            return best_id, reasons

    if len(filename_candidates) == 1:
        reasons.append("Einzelne lange Zahl im Dateinamen könnte Garmin-ID sein")
        return filename_candidates[0], reasons

    if filename_candidates:
        reasons.append("Mehrere lange Zahlen im Dateinamen gefunden")
        return filename_candidates[0], reasons

    return None, reasons


def _best_activity_name(
    explicit_name: str | None,
    fit_summary: dict[str, Any],
    heuristic_matches: list[dict[str, Any]],
    fallback_name: str,
) -> str:
    for candidate in (
        explicit_name,
        fit_summary.get("activity_name"),
        heuristic_matches[0].get("activity_name") if heuristic_matches else None,
        fallback_name,
    ):
        cleaned = _clean_activity_name(candidate)
        if cleaned:
            return cleaned
    return fallback_name


def _time_of_day_phrase(started_at: str | None) -> str:
    dt = _parse_iso_datetime(started_at)
    if dt is None:
        return "am Tag"
    hour = dt.hour
    if 5 <= hour < 11:
        return "am Morgen"
    if 11 <= hour < 14:
        return "am Mittag"
    if 14 <= hour < 18:
        return "am Nachmittag"
    if 18 <= hour < 23:
        return "am Abend"
    return "in der Nacht"


def _looks_virtual_activity(
    *,
    sport: str | None,
    sub_sport: str | None,
    file_name: str | None,
    fit_summary: dict[str, Any],
) -> bool:
    haystack = " ".join(
        str(part or "").lower()
        for part in (
            sport,
            sub_sport,
            file_name,
            fit_summary.get("activity_name"),
        )
    )
    return any(token in haystack for token in ("virtual", "rouvy", "zwift", "mywhoosh", "bkool", "indoor"))


def _sport_family_label(sport: str | None, sub_sport: str | None) -> str:
    haystack = f"{str(sub_sport or '').lower()} {str(sport or '').lower()}"
    if "run" in haystack:
        return "Lauf"
    if "walk" in haystack or "hike" in haystack:
        return "Einheit"
    if "swim" in haystack:
        return "Schwimmeinheit"
    return "Fahrt"


def _suggest_activity_name(
    *,
    started_at: str | None,
    sport: str | None,
    sub_sport: str | None,
    duration_s: float | None,
    distance_m: float | None,
    avg_power_w: float | None,
    file_name: str | None,
    fit_summary: dict[str, Any],
) -> tuple[str, str]:
    is_virtual = _looks_virtual_activity(
        sport=sport,
        sub_sport=sub_sport,
        file_name=file_name,
        fit_summary=fit_summary,
    )
    time_phrase = _time_of_day_phrase(started_at)
    sport_family = _sport_family_label(sport, sub_sport)
    duration_value = float(duration_s) if duration_s is not None else None
    distance_value = float(distance_m) if distance_m is not None else None
    avg_power_value = float(avg_power_w) if avg_power_w is not None else None

    if sport_family == "Fahrt":
        if is_virtual and duration_value is not None and duration_value >= 90 * 60:
            return f"Lange virtuelle Ausdauerfahrt {time_phrase}", "Aus virtueller Aktivität, Dauer und Tageszeit"
        if is_virtual and avg_power_value is not None and duration_value is not None and avg_power_value >= 200 and duration_value <= 90 * 60:
            return f"Intensives virtuelles Radtraining {time_phrase}", "Aus virtueller Aktivität, Intensität und Tageszeit"
        if is_virtual:
            return f"Virtuelle Fahrt {time_phrase}", "Aus virtueller Aktivität und Tageszeit"
        if duration_value is not None and duration_value >= 2 * 3600:
            return f"Lange Ausdauerfahrt {time_phrase}", "Aus Dauer und Tageszeit"
        if distance_value is not None and distance_value >= 70_000:
            return f"Längere Radausfahrt {time_phrase}", "Aus Distanz und Tageszeit"
        if avg_power_value is not None and duration_value is not None and avg_power_value >= 220 and duration_value <= 90 * 60:
            return f"Intensives Radtraining {time_phrase}", "Aus Leistung, Dauer und Tageszeit"
        if duration_value is not None and duration_value <= 45 * 60:
            return f"Kurze Radausfahrt {time_phrase}", "Aus Dauer und Tageszeit"
        return f"Radausfahrt {time_phrase}", "Aus Sportart und Tageszeit"

    if sport_family == "Lauf":
        if duration_value is not None and duration_value >= 75 * 60:
            return f"Längerer Lauf {time_phrase}", "Aus Sportart, Dauer und Tageszeit"
        if duration_value is not None and duration_value <= 35 * 60:
            return f"Kurzer Lauf {time_phrase}", "Aus Sportart, Dauer und Tageszeit"
        return f"Lauf {time_phrase}", "Aus Sportart und Tageszeit"

    if sport_family == "Schwimmeinheit":
        return f"Schwimmeinheit {time_phrase}", "Aus Sportart und Tageszeit"

    return f"{sport_family} {time_phrase}", "Aus Sportart und Tageszeit"


def _match_suggested_external_id(
    db_index: dict[str, Any],
    *,
    suggested_external_activity_id: str | None,
    started_at: str | None,
    distance_m: float | None,
    duration_s: float | None,
    avg_power_w: float | None,
    avg_hr_bpm: float | None,
    avg_speed_mps: float | None,
) -> list[dict[str, Any]]:
    candidate_id = str(suggested_external_activity_id or "").strip()
    if not candidate_id:
        return []
    matches = [
        item
        for item in db_index["garmin_activities"]
        if str(item.get("external_activity_id") or "").strip() == candidate_id
    ]
    if not matches:
        return []
    return _build_heuristic_matches(
        {"garmin_activities": matches},
        started_at=started_at,
        distance_m=distance_m,
        duration_s=duration_s,
        avg_power_w=avg_power_w,
        avg_hr_bpm=avg_hr_bpm,
        avg_speed_mps=avg_speed_mps,
        sport=matches[0].get("sport"),
    )


def _append_manifest_export_rides(
    archive: zipfile.ZipFile,
    manifest: dict[str, Any],
    manifest_name: str,
    db_index: dict[str, Any],
    report: dict[str, Any],
) -> tuple[int, int, int]:
    duplicates = 0
    new_items = 0
    missing_from_zip = 0
    items = [item for item in manifest.get("items", []) if item.get("status") == "exported"]

    for item in items:
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        export_file_name = str(item.get("export_file_name") or "")
        if not export_file_name:
            continue

        fit_entry_name = f"{manifest_name.rsplit('/', 1)[0]}/fits/{export_file_name}" if "/" in manifest_name else export_file_name
        if fit_entry_name not in archive.namelist():
            alt_matches = [
                name
                for name in archive.namelist()
                if name.endswith(f"/fits/{export_file_name}") or name.endswith(f"\\fits\\{export_file_name}") or name == export_file_name
            ]
            if not alt_matches:
                missing_from_zip += 1
                report["rides"].append(
                    {
                        "export_file_name": export_file_name,
                        "provider": item.get("provider") or metadata.get("provider"),
                        "external_activity_id": item.get("external_activity_id") or metadata.get("external_activity_id"),
                        "activity_name": item.get("activity_name") or metadata.get("activity_name"),
                        "started_at": item.get("started_at") or metadata.get("started_at"),
                        "status": "missing_from_zip",
                        "is_duplicate": False,
                        "duplicate_flags": [],
                        "db_matches": _build_empty_matches(),
                    }
                )
                continue
            fit_entry_name = alt_matches[0]

        fit_bytes = archive.read(fit_entry_name)
        fit_sha256 = hashlib.sha256(fit_bytes).hexdigest()
        fit_summary = _read_fit_summary(fit_bytes)
        matches = _build_empty_matches()
        duplicate_flags: list[str] = []
        external_id = str(item.get("external_activity_id") or metadata.get("external_activity_id") or "")
        content_sha = str(item.get("content_sha256") or metadata.get("content_sha256") or "")
        manifest_activity_name = str(item.get("activity_name") or metadata.get("activity_name") or "").strip()
        manifest_provider = item.get("provider") or metadata.get("provider")
        manifest_started_at = str(item.get("started_at") or metadata.get("started_at") or "")
        manifest_content_size_bytes = item.get("content_size_bytes") or metadata.get("content_size_bytes")
        resolved_started_at = str(
            fit_summary.get("session_start_time")
            or fit_summary.get("time_created")
            or manifest_started_at
            or ""
        )
        heuristic_matches = _match_suggested_external_id(
            db_index,
            suggested_external_activity_id=external_id,
            started_at=resolved_started_at,
            distance_m=fit_summary.get("total_distance_m"),
            duration_s=fit_summary.get("total_timer_time_s"),
            avg_power_w=fit_summary.get("avg_power_w"),
            avg_hr_bpm=fit_summary.get("avg_hr_bpm"),
            avg_speed_mps=fit_summary.get("avg_speed_mps"),
        ) or _build_heuristic_matches(
            db_index,
            started_at=resolved_started_at,
            distance_m=fit_summary.get("total_distance_m"),
            duration_s=fit_summary.get("total_timer_time_s"),
            avg_power_w=fit_summary.get("avg_power_w"),
            avg_hr_bpm=fit_summary.get("avg_hr_bpm"),
            avg_speed_mps=fit_summary.get("avg_speed_mps"),
            sport=fit_summary.get("sub_sport") or fit_summary.get("sport"),
        )

        if external_id and external_id in db_index["by_external_id"]:
            duplicate_flags.append("external_activity_id")
            matches["external_activity_id"] = db_index["by_external_id"][external_id]
        if content_sha and content_sha in db_index["by_content_sha"]:
            duplicate_flags.append("content_sha256")
            matches["content_sha256"] = db_index["by_content_sha"][content_sha]
        if fit_sha256 in db_index["by_file_sha"]:
            duplicate_flags.append("file_sha256")
            matches["file_sha256"] = db_index["by_file_sha"][fit_sha256]
        duplicate_assessment = _build_duplicate_assessment(
            db_index,
            external_activity_id=external_id or None,
            started_at=resolved_started_at,
            distance_m=fit_summary.get("total_distance_m"),
            duration_s=fit_summary.get("total_timer_time_s"),
            avg_power_w=fit_summary.get("avg_power_w"),
            avg_hr_bpm=fit_summary.get("avg_hr_bpm"),
            avg_speed_mps=fit_summary.get("avg_speed_mps"),
            sport=fit_summary.get("sub_sport") or fit_summary.get("sport"),
            content_hash_match=bool(content_sha and content_sha in db_index["by_content_sha"]),
            file_hash_match=bool(fit_sha256 in db_index["by_file_sha"]),
            heuristic_matches=heuristic_matches,
        )
        if duplicate_assessment["garmin_id_exists"]:
            _ensure_duplicate_flag(duplicate_flags, "external_activity_id")
        if duplicate_assessment["same_start_time_exists"] and duplicate_assessment["similar_values_exists"]:
            _ensure_duplicate_flag(duplicate_flags, "heuristic_activity")
        if duplicate_assessment["probability_pct"] >= 85:
            _ensure_duplicate_flag(duplicate_flags, "heuristic_activity")
        if heuristic_matches and int(heuristic_matches[0].get("match_score") or 0) >= 5:
            _ensure_duplicate_flag(duplicate_flags, "heuristic_activity")
            matches["heuristic_activity"] = heuristic_matches
        elif duplicate_assessment["similar_value_matches"]:
            matches["heuristic_activity"] = duplicate_assessment["similar_value_matches"]

        if duplicate_flags:
            duplicates += 1
        else:
            new_items += 1

        report["rides"].append(
            {
                "export_file_name": export_file_name,
                "provider": manifest_provider,
                "external_activity_id": external_id or None,
                "suggested_external_activity_id": external_id or None,
                "suggestion_reasons": ["Manifest enthält Garmin-ID"],
                "filename_numeric_candidates": _extract_numeric_candidates(export_file_name),
                "activity_name": _best_activity_name(
                    manifest_activity_name or None,
                    fit_summary,
                    heuristic_matches,
                    export_file_name,
                ),
                "suggested_activity_name": _suggest_activity_name(
                    started_at=resolved_started_at,
                    sport=fit_summary.get("sport"),
                    sub_sport=fit_summary.get("sub_sport"),
                    duration_s=fit_summary.get("total_timer_time_s"),
                    distance_m=fit_summary.get("total_distance_m"),
                    avg_power_w=fit_summary.get("avg_power_w"),
                    file_name=export_file_name,
                    fit_summary=fit_summary,
                )[0],
                "suggested_activity_name_reason": _suggest_activity_name(
                    started_at=resolved_started_at,
                    sport=fit_summary.get("sport"),
                    sub_sport=fit_summary.get("sub_sport"),
                    duration_s=fit_summary.get("total_timer_time_s"),
                    distance_m=fit_summary.get("total_distance_m"),
                    avg_power_w=fit_summary.get("avg_power_w"),
                    file_name=export_file_name,
                    fit_summary=fit_summary,
                )[1],
                "started_at": resolved_started_at or manifest_started_at,
                "content_sha256": content_sha or None,
                "fit_sha256": fit_sha256,
                "content_size_bytes": manifest_content_size_bytes,
                "fit_size_bytes": len(fit_bytes),
                "fit_summary": fit_summary,
                "heuristic_matches": heuristic_matches,
                "duplicate_assessment": duplicate_assessment,
                "status": "ready",
                "is_duplicate": bool(duplicate_flags),
                "duplicate_flags": duplicate_flags,
                "db_matches": matches,
            }
        )

    return duplicates, new_items, missing_from_zip


def _append_direct_fit_zip_rides(
    archive: zipfile.ZipFile,
    db_index: dict[str, Any],
    report: dict[str, Any],
) -> tuple[int, int]:
    duplicates = 0
    new_items = 0
    fit_entries = _list_fit_entries(archive)
    if not fit_entries:
        raise ValueError("ZIP enthält weder ein manifest.json noch FIT-Dateien.")

    for fit_entry_name in fit_entries:
        fit_bytes = archive.read(fit_entry_name)
        fit_sha256 = hashlib.sha256(fit_bytes).hexdigest()
        fit_summary = _read_fit_summary(fit_bytes)
        file_matches = db_index["by_file_sha"].get(fit_sha256, [])
        duplicate_flags = ["file_sha256"] if file_matches else []
        heuristic_matches = _build_heuristic_matches(
            db_index,
            started_at=fit_summary.get("session_start_time") or fit_summary.get("time_created"),
            distance_m=fit_summary.get("total_distance_m"),
            duration_s=fit_summary.get("total_timer_time_s"),
            avg_power_w=fit_summary.get("avg_power_w"),
            avg_hr_bpm=fit_summary.get("avg_hr_bpm"),
            avg_speed_mps=fit_summary.get("avg_speed_mps"),
            sport=fit_summary.get("sub_sport") or fit_summary.get("sport"),
        )
        suggested_external_activity_id, suggestion_reasons = _build_garmin_id_suggestion(
            Path(fit_entry_name).name,
            heuristic_matches,
        )
        suggested_id_matches = _match_suggested_external_id(
            db_index,
            suggested_external_activity_id=suggested_external_activity_id,
            started_at=fit_summary.get("session_start_time") or fit_summary.get("time_created"),
            distance_m=fit_summary.get("total_distance_m"),
            duration_s=fit_summary.get("total_timer_time_s"),
            avg_power_w=fit_summary.get("avg_power_w"),
            avg_hr_bpm=fit_summary.get("avg_hr_bpm"),
            avg_speed_mps=fit_summary.get("avg_speed_mps"),
        )
        heuristic_duplicate_matches = suggested_id_matches or (
            heuristic_matches if heuristic_matches and int(heuristic_matches[0].get("match_score") or 0) >= 5 else []
        )
        duplicate_assessment = _build_duplicate_assessment(
            db_index,
            external_activity_id=suggested_external_activity_id,
            started_at=fit_summary.get("session_start_time") or fit_summary.get("time_created"),
            distance_m=fit_summary.get("total_distance_m"),
            duration_s=fit_summary.get("total_timer_time_s"),
            avg_power_w=fit_summary.get("avg_power_w"),
            avg_hr_bpm=fit_summary.get("avg_hr_bpm"),
            avg_speed_mps=fit_summary.get("avg_speed_mps"),
            sport=fit_summary.get("sub_sport") or fit_summary.get("sport"),
            content_hash_match=False,
            file_hash_match=bool(file_matches),
            heuristic_matches=heuristic_matches,
        )
        if duplicate_assessment["garmin_id_exists"]:
            _ensure_duplicate_flag(duplicate_flags, "external_activity_id")
        if duplicate_assessment["same_start_time_exists"] and duplicate_assessment["similar_values_exists"]:
            _ensure_duplicate_flag(duplicate_flags, "heuristic_activity")
        if duplicate_assessment["probability_pct"] >= 85:
            _ensure_duplicate_flag(duplicate_flags, "heuristic_activity")
        if heuristic_duplicate_matches:
            _ensure_duplicate_flag(duplicate_flags, "heuristic_activity")
        if not heuristic_duplicate_matches and duplicate_assessment["similar_value_matches"]:
            heuristic_duplicate_matches = duplicate_assessment["similar_value_matches"]

        if duplicate_flags:
            duplicates += 1
        else:
            new_items += 1

        report["rides"].append(
            {
                "export_file_name": Path(fit_entry_name).name,
                "external_activity_id": None,
                "suggested_external_activity_id": suggested_external_activity_id,
                "suggestion_reasons": suggestion_reasons,
                "filename_numeric_candidates": _extract_numeric_candidates(Path(fit_entry_name).name),
                "activity_name": _best_activity_name(
                    None,
                    fit_summary,
                    suggested_id_matches or heuristic_matches,
                    Path(fit_entry_name).stem,
                ),
                "suggested_activity_name": _suggest_activity_name(
                    started_at=fit_summary.get("session_start_time") or fit_summary.get("time_created"),
                    sport=fit_summary.get("sport"),
                    sub_sport=fit_summary.get("sub_sport"),
                    duration_s=fit_summary.get("total_timer_time_s"),
                    distance_m=fit_summary.get("total_distance_m"),
                    avg_power_w=fit_summary.get("avg_power_w"),
                    file_name=Path(fit_entry_name).name,
                    fit_summary=fit_summary,
                )[0],
                "suggested_activity_name_reason": _suggest_activity_name(
                    started_at=fit_summary.get("session_start_time") or fit_summary.get("time_created"),
                    sport=fit_summary.get("sport"),
                    sub_sport=fit_summary.get("sub_sport"),
                    duration_s=fit_summary.get("total_timer_time_s"),
                    distance_m=fit_summary.get("total_distance_m"),
                    avg_power_w=fit_summary.get("avg_power_w"),
                    file_name=Path(fit_entry_name).name,
                    fit_summary=fit_summary,
                )[1],
                "started_at": fit_summary.get("session_start_time") or fit_summary.get("time_created"),
                "content_sha256": None,
                "fit_sha256": fit_sha256,
                "content_size_bytes": None,
                "fit_size_bytes": len(fit_bytes),
                "fit_summary": fit_summary,
                "heuristic_matches": heuristic_matches,
                "duplicate_assessment": duplicate_assessment,
                "status": "ready",
                "is_duplicate": bool(duplicate_flags),
                "duplicate_flags": duplicate_flags,
                "db_matches": {
                    "external_activity_id": [],
                    "content_sha256": [],
                    "file_sha256": file_matches,
                    "heuristic_activity": heuristic_duplicate_matches,
                },
            }
        )

    return duplicates, new_items


def analyze_fit_dump_zip(file_bytes: bytes, filename: str) -> dict[str, Any]:
    if not file_bytes:
        raise ValueError("Bitte eine ZIP-Datei auswählen.")

    db_index = _load_db_index()
    report: dict[str, Any] = {
        "generated_at": datetime.utcnow().isoformat(),
        "source_file_name": filename,
        "summary": {},
        "rides": [],
    }

    duplicates = 0
    new_items = 0
    missing_from_zip = 0
    detected_format = "unknown_zip"

    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes), "r")
    except zipfile.BadZipFile as exc:
        raise ValueError(f"Datei ist kein gültiges ZIP-Archiv: {exc}") from exc

    with archive:
        try:
            manifest, manifest_name = _read_manifest_from_zip(archive)
        except ValueError:
            manifest = None
            manifest_name = ""

        if manifest is not None:
            duplicates, new_items, missing_from_zip = _append_manifest_export_rides(
                archive=archive,
                manifest=manifest,
                manifest_name=manifest_name,
                db_index=db_index,
                report=report,
            )
            detected_format = "manifest_export_zip"
        else:
            duplicates, new_items = _append_direct_fit_zip_rides(
                archive=archive,
                db_index=db_index,
                report=report,
            )
            detected_format = "garmin_direct_zip"

    report["summary"] = {
        "source_file_name": filename,
        "detected_format": detected_format,
        "db_fit_files": db_index["db_fit_files"],
        "rides_in_manifest": len(report["rides"]),
        "duplicates": duplicates,
        "new": new_items,
        "missing_from_zip": missing_from_zip,
    }
    return report


def analyze_saved_fit_dump_zip(file_name: str) -> dict[str, Any]:
    safe_name = Path(file_name).name
    if not safe_name.lower().endswith(".zip"):
        raise ValueError("Bitte eine ZIP-Datei auswählen.")
    target = EXPORT_ROOT / safe_name
    if not target.exists():
        raise ValueError("Die ausgewählte ZIP-Datei wurde auf dem Server nicht gefunden.")
    return analyze_fit_dump_zip(file_bytes=target.read_bytes(), filename=safe_name)


def _selection_name_override(raw_value: Any) -> str | None:
    cleaned = _clean_activity_name(raw_value)
    if cleaned:
        return cleaned
    return None


def _build_import_file_path(file_name: str) -> str:
    safe_name = Path(file_name).name
    return f"data/imports/{safe_name}"


def _collect_selected_manifest_items(
    archive: zipfile.ZipFile,
    manifest: dict[str, Any],
    manifest_name: str,
    selections_by_name: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    prepared: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    items = [item for item in manifest.get("items", []) if item.get("status") == "exported"]

    for item in items:
        export_file_name = str(item.get("export_file_name") or "")
        if not export_file_name or export_file_name not in selections_by_name:
            continue

        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        fit_entry_name = f"{manifest_name.rsplit('/', 1)[0]}/fits/{export_file_name}" if "/" in manifest_name else export_file_name
        if fit_entry_name not in archive.namelist():
            alt_matches = [
                name
                for name in archive.namelist()
                if name.endswith(f"/fits/{export_file_name}") or name.endswith(f"\\fits\\{export_file_name}") or name == export_file_name
            ]
            if not alt_matches:
                errors.append({"export_file_name": export_file_name, "reason": "FIT-Datei fehlt im ZIP."})
                continue
            fit_entry_name = alt_matches[0]

        fit_bytes = archive.read(fit_entry_name)
        fit_summary = _read_fit_summary(fit_bytes)
        manifest_started_at = str(item.get("started_at") or metadata.get("started_at") or "")
        resolved_started_at = str(
            fit_summary.get("session_start_time")
            or fit_summary.get("time_created")
            or manifest_started_at
            or ""
        )
        manifest_activity_name = str(item.get("activity_name") or metadata.get("activity_name") or "").strip()
        provider = str(item.get("provider") or metadata.get("provider") or "garmin").strip() or "garmin"
        external_activity_id = str(item.get("external_activity_id") or metadata.get("external_activity_id") or "").strip() or None
        content_sha256 = str(item.get("content_sha256") or metadata.get("content_sha256") or "").strip() or hashlib.sha256(fit_bytes).hexdigest()
        raw_json = metadata.get("activity_raw_json")

        prepared.append(
            {
                "export_file_name": export_file_name,
                "fit_bytes": fit_bytes,
                "fit_summary": fit_summary,
                "provider": provider,
                "external_activity_id": external_activity_id,
                "activity_name": manifest_activity_name or None,
                "started_at": resolved_started_at or manifest_started_at or None,
                "content_sha256": content_sha256,
                "content_size_bytes": item.get("content_size_bytes") or metadata.get("content_size_bytes") or len(fit_bytes),
                "raw_json": raw_json,
                "name_override": _selection_name_override(selections_by_name[export_file_name].get("activity_name")),
            }
        )

    return prepared, errors


def _collect_selected_direct_fit_items(
    archive: zipfile.ZipFile,
    selections_by_name: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    prepared: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    fit_entries = _list_fit_entries(archive)
    fit_entries_by_basename = {Path(name).name: name for name in fit_entries}

    for export_file_name, selection in selections_by_name.items():
        fit_entry_name = fit_entries_by_basename.get(export_file_name)
        if fit_entry_name is None:
            errors.append({"export_file_name": export_file_name, "reason": "FIT-Datei fehlt im ZIP."})
            continue

        fit_bytes = archive.read(fit_entry_name)
        fit_summary = _read_fit_summary(fit_bytes)
        suggested_external_activity_id, _ = _build_garmin_id_suggestion(export_file_name, [])
        suggested_name, _ = _suggest_activity_name(
            started_at=fit_summary.get("session_start_time") or fit_summary.get("time_created"),
            sport=fit_summary.get("sport"),
            sub_sport=fit_summary.get("sub_sport"),
            duration_s=fit_summary.get("total_timer_time_s"),
            distance_m=fit_summary.get("total_distance_m"),
            avg_power_w=fit_summary.get("avg_power_w"),
            file_name=export_file_name,
            fit_summary=fit_summary,
        )
        prepared.append(
            {
                "export_file_name": export_file_name,
                "fit_bytes": fit_bytes,
                "fit_summary": fit_summary,
                "provider": "garmin",
                "external_activity_id": suggested_external_activity_id,
                "activity_name": _best_activity_name(None, fit_summary, [], Path(export_file_name).stem) or suggested_name,
                "started_at": fit_summary.get("session_start_time") or fit_summary.get("time_created"),
                "content_sha256": hashlib.sha256(fit_bytes).hexdigest(),
                "content_size_bytes": len(fit_bytes),
                "raw_json": None,
                "name_override": _selection_name_override(selection.get("activity_name")),
            }
        )

    return prepared, errors


def import_fit_dump_zip(file_bytes: bytes, filename: str, user_id: int, selections: list[dict[str, Any]]) -> dict[str, Any]:
    if not filename.lower().endswith(".zip"):
        raise ValueError("Bitte eine ZIP-Datei auswählen.")
    if not selections:
        raise ValueError("Bitte mindestens eine Fahrt zum Import auswählen.")

    selections_by_name: dict[str, dict[str, Any]] = {}
    for selection in selections:
        export_file_name = str(selection.get("export_file_name") or "").strip()
        if not export_file_name:
            continue
        selections_by_name[export_file_name] = selection
    if not selections_by_name:
        raise ValueError("Keine gültigen Fahrten für den Import ausgewählt.")

    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes), "r")
    except zipfile.BadZipFile as exc:
        raise ValueError(f"Datei ist kein gültiges ZIP-Archiv: {exc}") from exc

    prepared_items: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    detected_format = "garmin_direct_zip"

    with archive:
        try:
            manifest, manifest_name = _read_manifest_from_zip(archive)
        except ValueError:
            manifest = None
            manifest_name = ""

        if manifest is not None:
            prepared_items, errors = _collect_selected_manifest_items(
                archive=archive,
                manifest=manifest,
                manifest_name=manifest_name,
                selections_by_name=selections_by_name,
            )
            detected_format = "manifest_export_zip"
        else:
            prepared_items, errors = _collect_selected_direct_fit_items(
                archive=archive,
                selections_by_name=selections_by_name,
            )

    imported_items: list[dict[str, Any]] = []
    imported_activity_ids: list[int] = []
    skipped_items: list[dict[str, Any]] = []
    seen_external_ids: set[tuple[str, str]] = set()
    seen_hashes: set[str] = set()

    with SessionLocal() as session:
        for item in prepared_items:
            export_file_name = str(item["export_file_name"])
            provider = str(item.get("provider") or "garmin").strip() or "garmin"
            fit_bytes = bytes(item["fit_bytes"])
            fit_summary = dict(item.get("fit_summary") or {})
            file_sha256 = hashlib.sha256(fit_bytes).hexdigest()
            content_sha256 = str(item.get("content_sha256") or file_sha256)
            external_activity_id = str(item.get("external_activity_id") or "").strip() or None
            if external_activity_id is None:
                external_activity_id = f"trainmind-import:{file_sha256}"
            started_at = _parse_iso_datetime(str(item.get("started_at") or ""))
            activity_name = _selection_name_override(item.get("name_override")) or _clean_activity_name(item.get("activity_name"))
            if not activity_name:
                activity_name = _best_activity_name(
                    None,
                    fit_summary,
                    [],
                    Path(export_file_name).stem,
                )
            if activity_name == Path(export_file_name).stem:
                activity_name = _selection_name_override(item.get("name_override")) or _suggest_activity_name(
                    started_at=str(item.get("started_at") or ""),
                    sport=fit_summary.get("sport"),
                    sub_sport=fit_summary.get("sub_sport"),
                    duration_s=fit_summary.get("total_timer_time_s"),
                    distance_m=fit_summary.get("total_distance_m"),
                    avg_power_w=fit_summary.get("avg_power_w"),
                    file_name=export_file_name,
                    fit_summary=fit_summary,
                )[0]

            duplicate_reason: str | None = None
            if (provider, external_activity_id) in seen_external_ids:
                duplicate_reason = "Garmin-ID ist im aktuellen Import doppelt."
            elif content_sha256 in seen_hashes or file_sha256 in seen_hashes:
                duplicate_reason = "FIT-Inhalt ist im aktuellen Import doppelt."
            else:
                existing_activity = session.scalar(
                    select(Activity).where(
                        Activity.provider == provider,
                        Activity.external_id == external_activity_id,
                    )
                )
                if existing_activity is not None:
                    duplicate_reason = "Aktivität mit gleicher Garmin-ID existiert bereits."
                else:
                    existing_payload = session.scalar(
                        select(FitFilePayload).where(FitFilePayload.content_sha256 == content_sha256)
                    )
                    if existing_payload is not None:
                        duplicate_reason = "FIT-Inhalt existiert bereits in der DB."

            if duplicate_reason:
                skipped_items.append({"export_file_name": export_file_name, "reason": duplicate_reason})
                continue

            raw_json = item.get("raw_json")
            if isinstance(raw_json, (dict, list)):
                raw_json_text = json.dumps(raw_json, ensure_ascii=False)
            elif isinstance(raw_json, str):
                raw_json_text = raw_json
            else:
                raw_json_text = None

            fit_file = FitFile(
                user_id=user_id,
                provider=provider,
                external_activity_id=external_activity_id,
                file_name=Path(export_file_name).name,
                file_path=_build_import_file_path(export_file_name),
                file_sha256=file_sha256,
                imported_at=datetime.utcnow(),
                parser_version="garmin-file-import-v1",
            )
            session.add(fit_file)

            try:
                session.flush()
                session.add(
                    FitFilePayload(
                        fit_file_id=fit_file.id,
                        content=fit_bytes,
                        content_size_bytes=int(item.get("content_size_bytes") or len(fit_bytes)),
                        content_sha256=content_sha256,
                        compression="none",
                        created_at=datetime.utcnow(),
                    )
                )
                session.add(
                    Activity(
                        user_id=user_id,
                        source_fit_file_id=fit_file.id,
                        provider=provider,
                        external_id=external_activity_id,
                        name=activity_name,
                        sport=fit_summary.get("sub_sport") or fit_summary.get("sport"),
                        started_at=started_at,
                        duration_s=int(round(float(fit_summary.get("total_timer_time_s") or 0))) or None,
                        distance_m=float(fit_summary.get("total_distance_m")) if fit_summary.get("total_distance_m") is not None else None,
                        avg_power_w=float(fit_summary.get("avg_power_w")) if fit_summary.get("avg_power_w") is not None else None,
                        avg_hr_bpm=float(fit_summary.get("avg_hr_bpm")) if fit_summary.get("avg_hr_bpm") is not None else None,
                        raw_json=raw_json_text,
                        created_at=datetime.utcnow(),
                    )
                )
                session.flush()
                created_activity = session.scalar(
                    select(Activity).where(Activity.user_id == user_id, Activity.source_fit_file_id == fit_file.id)
                )
                if created_activity is not None:
                    _hydrate_activity_streams_from_fit(session, created_activity)
                session.commit()
                if created_activity is not None:
                    imported_activity_ids.append(int(created_activity.id))
                imported_items.append(
                    {
                        "export_file_name": export_file_name,
                        "provider": provider,
                        "external_activity_id": external_activity_id,
                        "activity_name": activity_name,
                    }
                )
                seen_external_ids.add((provider, external_activity_id))
                seen_hashes.add(content_sha256)
                seen_hashes.add(file_sha256)
            except IntegrityError:
                session.rollback()
                skipped_items.append({"export_file_name": export_file_name, "reason": "Eintrag existiert bereits."})
            except Exception as exc:
                session.rollback()
                errors.append({"export_file_name": export_file_name, "reason": str(exc)})

    unresolved = [name for name in selections_by_name if name not in {item["export_file_name"] for item in prepared_items}]
    for export_file_name in unresolved:
        errors.append({"export_file_name": export_file_name, "reason": "Ausgewählte Fahrt wurde im ZIP nicht gefunden."})

    result = {
        "source_file_name": filename,
        "detected_format": detected_format,
        "requested": len(selections_by_name),
        "imported": len(imported_items),
        "skipped": len(skipped_items),
        "errors": errors,
        "skipped_items": skipped_items,
        "imported_items": imported_items,
    }
    if imported_items:
        try:
            result["hf_analysis"] = rebuild_hf_development_cache(user_id=user_id, activity_ids=imported_activity_ids)
        except Exception as exc:
            result["hf_analysis_rebuild_error"] = str(exc)
        try:
            result["achievements"] = rebuild_activity_achievement_checks(user_id=user_id)
        except Exception as exc:
            result["achievement_rebuild_error"] = str(exc)
        clear_activity_list_cache(user_id=user_id)
    return result
