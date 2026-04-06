"""add weekly target fields to user profile

Revision ID: 20260406_0027
Revises: 20260406_0026
Create Date: 2026-04-06 19:20:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import CORE_SCHEMA


revision = "20260406_0027"
down_revision = "20260406_0026"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("user_profiles", sa.Column("weekly_target_hours", sa.Float(), nullable=True), schema=CORE_SCHEMA)
    op.add_column("user_profiles", sa.Column("weekly_target_stress", sa.Float(), nullable=True), schema=CORE_SCHEMA)


def downgrade() -> None:
    op.drop_column("user_profiles", "weekly_target_stress", schema=CORE_SCHEMA)
    op.drop_column("user_profiles", "weekly_target_hours", schema=CORE_SCHEMA)
