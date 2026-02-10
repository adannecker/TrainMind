from __future__ import annotations

import os


DEFAULT_DATABASE_URL = "postgresql+psycopg2://trainmind:trainmind@localhost:5432/trainmind"


def get_database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
