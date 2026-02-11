from __future__ import annotations

from datetime import datetime
from hashlib import sha256

from sqlalchemy import select

from packages.db.models import Activity, FitFile, FitFilePayload, User
from packages.db.session import SessionLocal


def run_seed() -> None:
    with SessionLocal() as session:
        demo = session.scalar(select(User).where(User.email == "demo@trainmind.local"))
        if not demo:
            demo = User(email="demo@trainmind.local", display_name="Demo User", created_at=datetime.utcnow())
            session.add(demo)
            session.flush()

        demo_external_id = "demo-fit-activity-1"
        fit_file = session.scalar(
            select(FitFile).where(
                FitFile.provider == "demo",
                FitFile.external_activity_id == demo_external_id,
            )
        )
        if not fit_file:
            payload = b"DEMO_FIT_BINARY_PLACEHOLDER"
            payload_sha = sha256(payload).hexdigest()
            fit_file = FitFile(
                user_id=demo.id,
                provider="demo",
                external_activity_id=demo_external_id,
                file_name="demo_activity.fit",
                file_path="data/demo_activity.fit",
                file_sha256=payload_sha,
                imported_at=datetime.utcnow(),
                parser_version="seed-v1",
            )
            session.add(fit_file)
            session.flush()

            session.add(
                FitFilePayload(
                    fit_file_id=fit_file.id,
                    content=payload,
                    content_size_bytes=len(payload),
                    content_sha256=payload_sha,
                    compression="none",
                    created_at=datetime.utcnow(),
                )
            )

            session.add(
                Activity(
                    user_id=demo.id,
                    source_fit_file_id=fit_file.id,
                    provider="demo",
                    external_id=demo_external_id,
                    name="Demo Ride",
                    sport="cycling",
                    started_at=datetime.utcnow(),
                    duration_s=1800,
                    distance_m=12000.0,
                    avg_power_w=180.0,
                    avg_hr_bpm=145.0,
                    raw_json='{"source":"seed"}',
                    created_at=datetime.utcnow(),
                )
            )

        session.commit()
        print("Seed complete: demo user, FIT file payload, and demo activity ensured")


if __name__ == "__main__":
    run_seed()
