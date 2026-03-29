from __future__ import annotations

import gzip
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path

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


def _safe_fit_name(fit_file: FitFile) -> str:
    original = (fit_file.file_name or "").strip()
    stem = Path(original).stem if original else f"fit_file_{fit_file.id}"
    clean = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in stem).strip("._")
    if not clean:
        clean = f"fit_file_{fit_file.id}"
    return f"{clean}.fit"


def main() -> int:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    export_dir = EXPORT_ROOT / f"garmin_fit_dump_{timestamp}"
    fits_dir = export_dir / "fits"
    manifest_path = export_dir / "manifest.json"
    zip_path = EXPORT_ROOT / f"garmin_fit_dump_{timestamp}.zip"

    fits_dir.mkdir(parents=True, exist_ok=True)

    manifest: list[dict[str, object]] = []
    used_names: set[str] = set()
    written = 0
    skipped = 0

    with SessionLocal() as session:
        rows = session.execute(
            select(FitFile, FitFilePayload, Activity)
            .join(FitFilePayload, FitFilePayload.fit_file_id == FitFile.id)
            .outerjoin(Activity, Activity.source_fit_file_id == FitFile.id)
            .where(FitFile.provider == "garmin")
            .order_by(FitFile.imported_at.asc(), FitFile.id.asc())
        ).all()

        for fit_file, payload, activity in rows:
            fit_bytes = _unwrap_fit_payload(payload.content)
            if not fit_bytes:
                skipped += 1
                manifest.append(
                    {
                        "fit_file_id": fit_file.id,
                        "activity_id": activity.id if activity else None,
                        "external_activity_id": fit_file.external_activity_id,
                        "file_name": fit_file.file_name,
                        "status": "skipped",
                        "reason": "payload could not be unwrapped as FIT",
                    }
                )
                continue

            target_name = _safe_fit_name(fit_file)
            if target_name in used_names:
                target_name = f"{Path(target_name).stem}_{fit_file.id}.fit"
            used_names.add(target_name)

            target_path = fits_dir / target_name
            target_path.write_bytes(fit_bytes)
            written += 1

            manifest.append(
                {
                    "fit_file_id": fit_file.id,
                    "activity_id": activity.id if activity else None,
                    "user_id": fit_file.user_id,
                    "external_activity_id": fit_file.external_activity_id,
                    "activity_name": activity.name if activity else None,
                    "started_at": activity.started_at.isoformat() if activity and activity.started_at else None,
                    "stored_file_name": fit_file.file_name,
                    "export_file_name": target_name,
                    "file_sha256": fit_file.file_sha256,
                    "content_sha256": payload.content_sha256,
                    "content_size_bytes": payload.content_size_bytes,
                    "compression": payload.compression,
                    "status": "exported",
                }
            )

    manifest_path.write_text(
        json.dumps(
            {
                "generated_at": datetime.now().isoformat(),
                "export_dir": str(export_dir.relative_to(REPO_ROOT)),
                "zip_file": str(zip_path.relative_to(REPO_ROOT)),
                "exported_fit_files": written,
                "skipped_payloads": skipped,
                "items": manifest,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

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
