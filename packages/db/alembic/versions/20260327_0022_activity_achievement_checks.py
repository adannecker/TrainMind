"""activity achievement checks

Revision ID: 20260327_0022
Revises: 20260326_0021
Create Date: 2026-03-27 09:30:00.000000
"""

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import GARMIN_SCHEMA


revision = "20260327_0022"
down_revision = "20260326_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("achievements_checked_at", sa.DateTime(), nullable=True), schema=GARMIN_SCHEMA)
    op.add_column("activities", sa.Column("achievements_check_version", sa.Integer(), nullable=True), schema=GARMIN_SCHEMA)
    op.add_column("activities", sa.Column("achievements_summary_json", sa.Text(), nullable=True), schema=GARMIN_SCHEMA)
    op.create_index(
        "ix_activities_user_achievement_check",
        "activities",
        ["user_id", "achievements_check_version", "started_at"],
        unique=False,
        schema=GARMIN_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_activities_user_achievement_check", table_name="activities", schema=GARMIN_SCHEMA)
    op.drop_column("activities", "achievements_summary_json", schema=GARMIN_SCHEMA)
    op.drop_column("activities", "achievements_check_version", schema=GARMIN_SCHEMA)
    op.drop_column("activities", "achievements_checked_at", schema=GARMIN_SCHEMA)
