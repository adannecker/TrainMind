from __future__ import annotations

import argparse
import gzip
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

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


def _safe_fit_name(fit_file: FitFile, activity: Activity | None) -> str:
    base_name = (activity.name if activity and activity.name else fit_file.file_name or "").strip()
    stem = Path(base_name).stem if base_name else f"fit_file_{fit_file.id}"
    clean = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in stem).strip("._")
    if not clean:
        clean = f"fit_file_{fit_file.id}"
    started_at = activity.started_at if activity and activity.started_at else fit_file.imported_at
    prefix = started_at.strftime("%y%m%d_%H%M") if started_at else f"fit_{fit_file.id}"
    return f"{prefix}_{clean}.fit"


def _serialize_json(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _serialize_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize_json(item) for item in value]
    return value


def _parse_raw_json(raw_json: str | None) -> dict[str, Any] | None:
    if not raw_json:
        return None
    try:
        payload = json.loads(raw_json)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return _serialize_json(payload)


def _build_item_metadata(fit_file: FitFile, payload: FitFilePayload, activity: Activity | None, export_file_name: str) -> dict[str, Any]:
    fit_embedded_fields = {
        "started_at",
        "distance_m",
        "duration_s",
        "avg_power_w",
        "avg_hr_bpm",
        "sport",
    }
    non_fit_metadata = {
        "trainmind_annotation": "TrainMind export bundle",
        "fit_file_id": fit_file.id,
        "source_fit_file_id": activity.source_fit_file_id if activity else None,
        "activity_id": activity.id if activity else None,
        "user_id": fit_file.user_id,
        "provider": fit_file.provider,
        "external_activity_id": fit_file.external_activity_id or (activity.external_id if activity else None),
        "activity_name": activity.name if activity else None,
        "stored_file_name": fit_file.file_name,
        "stored_file_path": fit_file.file_path,
        "export_file_name": export_file_name,
        "fit_file_imported_at": fit_file.imported_at.isoformat() if fit_file.imported_at else None,
        "parser_version": fit_file.parser_version,
        "file_sha256": fit_file.file_sha256,
        "content_sha256": payload.content_sha256,
        "content_size_bytes": payload.content_size_bytes,
        "compression": payload.compression,
        "activity_raw_json": _parse_raw_json(activity.raw_json if activity else None),
        "fields_expected_in_fit_or_derivable": {
            "started_at": activity.started_at.isoformat() if activity and activity.started_at else None,
            "distance_m": activity.distance_m if activity else None,
            "duration_s": activity.duration_s if activity else None,
            "avg_power_w": activity.avg_power_w if activity else None,
            "avg_hr_bpm": activity.avg_hr_bpm if activity else None,
            "sport": activity.sport if activity else None,
        },
        "metadata_only_fields": {
            "provider": fit_file.provider,
            "external_activity_id": fit_file.external_activity_id or (activity.external_id if activity else None),
            "activity_name": activity.name if activity else None,
            "stored_file_name": fit_file.file_name,
            "stored_file_path": fit_file.file_path,
            "fit_file_imported_at": fit_file.imported_at.isoformat() if fit_file.imported_at else None,
            "parser_version": fit_file.parser_version,
            "file_sha256": fit_file.file_sha256,
            "content_sha256": payload.content_sha256,
            "content_size_bytes": payload.content_size_bytes,
            "compression": payload.compression,
            "activity_raw_json": _parse_raw_json(activity.raw_json if activity else None),
        },
        "notes": {
            "purpose": "Metadata for re-import into another TrainMind database",
            "exported_from": "TrainMind",
            "fields_expected_not_to_be_reliably_present_in_fit": sorted(non_fit_metadata_keys(non_fit_metadata={}, embedded_fields=fit_embedded_fields)),
        },
    }
    return non_fit_metadata


def non_fit_metadata_keys(*, non_fit_metadata: dict[str, Any], embedded_fields: set[str]) -> list[str]:
    keys: list[str] = []
    base_keys = {
        "trainmind_annotation",
        "fit_file_id",
        "source_fit_file_id",
        "activity_id",
        "user_id",
        "provider",
        "external_activity_id",
        "activity_name",
        "stored_file_name",
        "stored_file_path",
        "export_file_name",
        "fit_file_imported_at",
        "parser_version",
        "file_sha256",
        "content_sha256",
        "content_size_bytes",
        "compression",
        "activity_raw_json",
    }
    for key in sorted(base_keys):
        if key not in embedded_fields:
            keys.append(key)
    return keys


def main() -> int:
    parser = argparse.ArgumentParser(description="Export a small TrainMind FIT bundle with manifest metadata.")
    parser.add_argument("--limit", type=int, default=10, help="Number of already imported rides to export.")
    args = parser.parse_args()

    limit = max(1, min(int(args.limit), 100))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    export_dir = EXPORT_ROOT / f"trainmind_fit_bundle_{timestamp}"
    fits_dir = export_dir / "fits"
    manifest_path = export_dir / "manifest.json"
    zip_path = EXPORT_ROOT / f"trainmind_fit_bundle_{timestamp}.zip"

    fits_dir.mkdir(parents=True, exist_ok=True)

    items: list[dict[str, Any]] = []
    used_names: set[str] = set()
    written = 0
    skipped = 0

    with SessionLocal() as session:
        rows = session.execute(
            select(FitFile, FitFilePayload, Activity)
            .join(FitFilePayload, FitFilePayload.fit_file_id == FitFile.id)
            .outerjoin(Activity, Activity.source_fit_file_id == FitFile.id)
            .where(FitFile.provider == "garmin")
            .order_by(Activity.started_at.desc().nullslast(), FitFile.imported_at.desc(), FitFile.id.desc())
            .limit(limit)
        ).all()

        for fit_file, payload, activity in rows:
            fit_bytes = _unwrap_fit_payload(payload.content)
            if not fit_bytes:
                skipped += 1
                items.append(
                    {
                        "fit_file_id": fit_file.id,
                        "activity_id": activity.id if activity else None,
                        "external_activity_id": fit_file.external_activity_id,
                        "status": "skipped",
                        "reason": "payload could not be unwrapped as FIT",
                    }
                )
                continue

            target_name = _safe_fit_name(fit_file, activity)
            if target_name in used_names:
                target_name = f"{Path(target_name).stem}_{fit_file.id}.fit"
            used_names.add(target_name)

            target_path = fits_dir / target_name
            target_path.write_bytes(fit_bytes)
            written += 1

            item_metadata = _build_item_metadata(fit_file, payload, activity, target_name)
            items.append(
                {
                    "status": "exported",
                    "export_file_name": target_name,
                    "metadata": item_metadata,
                }
            )

    manifest = {
        "format": "trainmind_fit_bundle",
        "format_version": 1,
        "annotation": "Export von TrainMind",
        "generated_at": datetime.now().isoformat(),
        "export_dir": str(export_dir.relative_to(REPO_ROOT)),
        "zip_file": str(zip_path.relative_to(REPO_ROOT)),
        "exported_fit_files": written,
        "skipped_payloads": skipped,
        "notes": [
            "Dieses Bundle wurde von TrainMind exportiert.",
            "Die FIT-Dateien liegen unverändert im Unterordner fits/.",
            "Die manifest.json enthält Zusatzinformationen, die nicht zuverlässig im FIT enthalten sind oder für einen sauberen Re-Import hilfreich sind.",
        ],
        "items": items,
    }

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(manifest_path, arcname=f"{export_dir.name}/manifest.json")
        for fit_path in sorted(fits_dir.glob("*.fit")):
            archive.write(fit_path, arcname=f"{export_dir.name}/fits/{fit_path.name}")

    print(f"Export directory: {export_dir}")
    print(f"ZIP file: {zip_path}")
    print(f"Exported FIT files: {written}")
    print(f"Skipped payloads: {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
