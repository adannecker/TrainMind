"""Split tables into service-oriented schemas.

Revision ID: 20260314_0003
Revises: 20260211_0002
Create Date: 2026-03-14
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260314_0003"
down_revision: Union[str, Sequence[str], None] = "20260211_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")
    op.execute("CREATE SCHEMA IF NOT EXISTS garmin")
    op.execute("CREATE SCHEMA IF NOT EXISTS nutrition")

    op.execute("ALTER TABLE IF EXISTS users SET SCHEMA core")

    op.execute("ALTER TABLE IF EXISTS fit_files SET SCHEMA garmin")
    op.execute("ALTER TABLE IF EXISTS fit_file_payloads SET SCHEMA garmin")
    op.execute("ALTER TABLE IF EXISTS activities SET SCHEMA garmin")
    op.execute("ALTER TABLE IF EXISTS activity_sessions SET SCHEMA garmin")
    op.execute("ALTER TABLE IF EXISTS activity_laps SET SCHEMA garmin")
    op.execute("ALTER TABLE IF EXISTS activity_records SET SCHEMA garmin")
    op.execute("ALTER TABLE IF EXISTS fit_raw_messages SET SCHEMA garmin")

    op.execute("ALTER TABLE IF EXISTS food_entries SET SCHEMA nutrition")


def downgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS nutrition.food_entries SET SCHEMA public")

    op.execute("ALTER TABLE IF EXISTS garmin.fit_raw_messages SET SCHEMA public")
    op.execute("ALTER TABLE IF EXISTS garmin.activity_records SET SCHEMA public")
    op.execute("ALTER TABLE IF EXISTS garmin.activity_laps SET SCHEMA public")
    op.execute("ALTER TABLE IF EXISTS garmin.activity_sessions SET SCHEMA public")
    op.execute("ALTER TABLE IF EXISTS garmin.activities SET SCHEMA public")
    op.execute("ALTER TABLE IF EXISTS garmin.fit_file_payloads SET SCHEMA public")
    op.execute("ALTER TABLE IF EXISTS garmin.fit_files SET SCHEMA public")

    op.execute("ALTER TABLE IF EXISTS core.users SET SCHEMA public")

    op.execute("DROP SCHEMA IF EXISTS nutrition")
    op.execute("DROP SCHEMA IF EXISTS garmin")
    op.execute("DROP SCHEMA IF EXISTS core")

