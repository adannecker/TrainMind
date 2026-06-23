"""Persist health measurements.

Revision ID: 20260623_0033
Revises: 20260623_0032
Create Date: 2026-06-23
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260623_0033"
down_revision = "20260623_0032"
branch_labels = None
depends_on = None


def _has_table(table_name: str, schema: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names(schema=schema)


def upgrade() -> None:
    if not _has_table("withings_body_measurements", "core"):
        op.create_table(
            "withings_body_measurements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("measured_at", sa.DateTime(), nullable=False),
            sa.Column("withings_grpid", sa.String(length=80), nullable=True),
            sa.Column("attrib", sa.Integer(), nullable=True),
            sa.Column("category", sa.Integer(), nullable=True),
            sa.Column("raw_types_json", sa.Text(), nullable=True),
            sa.Column("weight_kg", sa.Float(), nullable=True),
            sa.Column("fat_ratio_pct", sa.Float(), nullable=True),
            sa.Column("fat_mass_kg", sa.Float(), nullable=True),
            sa.Column("visceral_fat_index", sa.Float(), nullable=True),
            sa.Column("muscle_mass_kg", sa.Float(), nullable=True),
            sa.Column("bone_mass_kg", sa.Float(), nullable=True),
            sa.Column("hydration_kg", sa.Float(), nullable=True),
            sa.Column("synced_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["core.users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("user_id", "measured_at", name="uq_withings_body_measurements_user_measured"),
            schema="core",
        )
        op.create_index("ix_withings_body_measurements_user_measured", "withings_body_measurements", ["user_id", "measured_at"], schema="core")

    if not _has_table("daily_health", "garmin"):
        op.create_table(
            "daily_health",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("steps", sa.Integer(), nullable=True),
            sa.Column("sleep_hours", sa.Float(), nullable=True),
            sa.Column("stress_avg", sa.Float(), nullable=True),
            sa.Column("stress_max", sa.Float(), nullable=True),
            sa.Column("body_battery_avg", sa.Float(), nullable=True),
            sa.Column("synced_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["core.users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("user_id", "date", name="uq_garmin_daily_health_user_date"),
            schema="garmin",
        )
        op.create_index("ix_garmin_daily_health_user_date", "daily_health", ["user_id", "date"], schema="garmin")


def downgrade() -> None:
    if _has_table("daily_health", "garmin"):
        op.drop_index("ix_garmin_daily_health_user_date", table_name="daily_health", schema="garmin")
        op.drop_table("daily_health", schema="garmin")
    if _has_table("withings_body_measurements", "core"):
        op.drop_index("ix_withings_body_measurements_user_measured", table_name="withings_body_measurements", schema="core")
        op.drop_table("withings_body_measurements", schema="core")
