"""Add height to user profiles.

Revision ID: 20260623_0032
Revises: 20260622_0031
Create Date: 2026-06-23
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260623_0032"
down_revision = "20260622_0031"
branch_labels = None
depends_on = None


def _columns(table_name: str, schema: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name, schema=schema)}


def upgrade() -> None:
    cols = _columns("user_profiles", "core")
    if "height_cm" not in cols:
        op.add_column("user_profiles", sa.Column("height_cm", sa.Float(), nullable=True), schema="core")


def downgrade() -> None:
    cols = _columns("user_profiles", "core")
    if "height_cm" in cols:
        op.drop_column("user_profiles", "height_cm", schema="core")
