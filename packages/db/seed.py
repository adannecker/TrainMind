from __future__ import annotations

from datetime import datetime

from sqlalchemy import select

from packages.db.models import User
from packages.db.session import SessionLocal


def run_seed() -> None:
    with SessionLocal() as session:
        exists = session.scalar(select(User).where(User.email == "demo@trainmind.local"))
        if exists:
            print("Seed skipped: demo user already exists")
            return

        demo = User(email="demo@trainmind.local", display_name="Demo User", created_at=datetime.utcnow())
        session.add(demo)
        session.commit()
        print("Seed complete: demo@trainmind.local created")


if __name__ == "__main__":
    run_seed()
