from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from packages.db.config import get_database_url


def build_engine(echo: bool = False):
    return create_engine(get_database_url(), echo=echo, future=True)


engine = build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
