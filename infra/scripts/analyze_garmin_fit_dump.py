from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from fitparse import FitFile as ParsedFitFile
from sqlalchemy import select

from packages.db.models import Activity, FitFile, FitFilePayload
from packages.db.session import SessionLocal


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXPORT_ROOT = REPO_ROOT / "data" / "exports"


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


def _find_latest_zip() -> Path:
    candidates = sorted(DEFAULT_EXPORT_ROOT.glob("garmin_fit_dump_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise SystemExit("No garmin_fit_dump_*.zip found in data/exports.")
    return candidates[0]


def _read_manifest_from_zip(archive: zipfile.ZipFile) -> tuple[dict[str, Any], str]:
    manifest_names = [name for name in archive.namelist() if name.endswith("/manifest.json") or name == "manifest.json"]
    if not manifest_names:
        raise SystemExit("ZIP does not contain a manifest.json file.")
    manifest_name = manifest_names[0]
    return json.loads(archive.read(manifest_name).decode("utf-8")), manifest_name


def _read_fit_summary(fit_bytes: bytes) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "sport": None,
        "sub_sport": None,
        "time_created": None,
        "device_serial_number": None,
        "garmin_product": None,
        "session_start_time": None,
        "total_distance_m": None,
        "total_timer_time_s": None,
        "records_count": 0,
        "laps_count": 0,
        "sessions_count": 0,
        "parse_error": None,
    }
    try:
        fit = ParsedFitFile(io.BytesIO(fit_bytes))

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

        summary["records_count"] = sum(1 for _ in fit.get_messages("record"))
        summary["laps_count"] = sum(1 for _ in fit.get_messages("lap"))
        summary["sessions_count"] = sum(1 for _ in fit.get_messages("session"))
    except Exception as exc:
        summary["parse_error"] = str(exc)
    return summary


def _iso_or_none(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return None


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

    by_external_id: dict[str, list[dict[str, Any]]] = {}
    by_content_sha: dict[str, list[dict[str, Any]]] = {}
    by_file_sha: dict[str, list[dict[str, Any]]] = {}

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

    return {
        "by_external_id": by_external_id,
        "by_content_sha": by_content_sha,
        "by_file_sha": by_file_sha,
        "db_fit_files": len(fit_rows),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze a Garmin FIT dump ZIP without importing it.")
    parser.add_argument("--zip", dest="zip_path", default=None, help="Path to garmin_fit_dump_*.zip")
    args = parser.parse_args()

    zip_path = Path(args.zip_path) if args.zip_path else _find_latest_zip()
    if not zip_path.exists():
        raise SystemExit(f"ZIP not found: {zip_path}")

    db_index = _load_db_index()
    report: dict[str, Any] = {
        "generated_at": datetime.now().isoformat(),
        "zip_path": str(zip_path),
        "summary": {},
        "rides": [],
    }

    duplicate_counter: Counter[str] = Counter()

    with zipfile.ZipFile(zip_path, "r") as archive:
        manifest, manifest_name = _read_manifest_from_zip(archive)
        items = [item for item in manifest.get("items", []) if item.get("status") == "exported"]

        for item in items:
            export_file_name = str(item.get("export_file_name") or "")
            fit_entry_name = f"{Path(manifest_name).parent.as_posix()}/fits/{export_file_name}" if "/" in manifest_name else export_file_name
            if fit_entry_name not in archive.namelist():
                alt_matches = [name for name in archive.namelist() if name.endswith(f"/fits/{export_file_name}") or name.endswith(f"\\fits\\{export_file_name}") or name == export_file_name]
                if not alt_matches:
                    ride_report = {
                        "export_file_name": export_file_name,
                        "external_activity_id": item.get("external_activity_id"),
                        "status": "missing_from_zip",
                        "duplicate_flags": [],
                    }
                    report["rides"].append(ride_report)
                    duplicate_counter["missing_from_zip"] += 1
                    continue
                fit_entry_name = alt_matches[0]

            fit_bytes = archive.read(fit_entry_name)
            fit_sha256 = hashlib.sha256(fit_bytes).hexdigest()
            fit_summary = _read_fit_summary(fit_bytes)

            duplicate_flags: list[str] = []
            matches: dict[str, list[dict[str, Any]]] = {
                "external_activity_id": [],
                "content_sha256": [],
                "file_sha256": [],
            }

            external_id = str(item.get("external_activity_id") or "")
            content_sha = str(item.get("content_sha256") or "")

            if external_id and external_id in db_index["by_external_id"]:
                duplicate_flags.append("external_activity_id")
                matches["external_activity_id"] = db_index["by_external_id"][external_id]
            if content_sha and content_sha in db_index["by_content_sha"]:
                duplicate_flags.append("content_sha256")
                matches["content_sha256"] = db_index["by_content_sha"][content_sha]
            if fit_sha256 in db_index["by_file_sha"]:
                duplicate_flags.append("file_sha256")
                matches["file_sha256"] = db_index["by_file_sha"][fit_sha256]

            if duplicate_flags:
                duplicate_counter["duplicates"] += 1
            else:
                duplicate_counter["new"] += 1

            ride_report = {
                "export_file_name": export_file_name,
                "external_activity_id": item.get("external_activity_id"),
                "activity_name": item.get("activity_name"),
                "started_at": item.get("started_at"),
                "content_sha256": item.get("content_sha256"),
                "fit_sha256": fit_sha256,
                "content_size_bytes": item.get("content_size_bytes"),
                "fit_size_bytes": len(fit_bytes),
                "fit_summary": fit_summary,
                "is_duplicate": bool(duplicate_flags),
                "duplicate_flags": duplicate_flags,
                "db_matches": matches,
            }
            report["rides"].append(ride_report)

    report["summary"] = {
        "zip_path": str(zip_path),
        "db_fit_files": db_index["db_fit_files"],
        "rides_in_manifest": len(report["rides"]),
        "duplicates": duplicate_counter["duplicates"],
        "new": duplicate_counter["new"],
        "missing_from_zip": duplicate_counter["missing_from_zip"],
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
