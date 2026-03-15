"""Add user profile/weight logs and food health indicator.

Revision ID: 20260315_0013
Revises: 20260315_0012
Create Date: 2026-03-15
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260315_0013"
down_revision: Union[str, Sequence[str], None] = "20260315_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {col["name"] for col in insp.get_columns(table_name, schema=schema_name)}


def _table_exists(schema_name: str, table_name: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return table_name in insp.get_table_names(schema=schema_name)


def upgrade() -> None:
    if not _table_exists("core", "user_profiles"):
        op.create_table(
            "user_profiles",
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("current_weight_kg", sa.Float(), nullable=True),
            sa.Column("target_weight_kg", sa.Float(), nullable=True),
            sa.Column("start_weight_kg", sa.Float(), nullable=True),
            sa.Column("goal_start_date", sa.DateTime(), nullable=True),
            sa.Column("goal_end_date", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["core.users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("user_id"),
            schema="core",
        )

    if not _table_exists("core", "user_weight_logs"):
        op.create_table(
            "user_weight_logs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("recorded_at", sa.DateTime(), nullable=False),
            sa.Column("weight_kg", sa.Float(), nullable=False),
            sa.Column("source_type", sa.String(length=40), nullable=False, server_default="manual"),
            sa.Column("source_label", sa.String(length=120), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["core.users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            schema="core",
        )
        op.create_index(
            "ix_user_weight_logs_user_recorded",
            "user_weight_logs",
            ["user_id", "recorded_at"],
            schema="core",
        )
        op.alter_column("user_weight_logs", "source_type", server_default=None, schema="core")

    food_cols = _existing_columns("nutrition", "food_items")
    if "health_indicator" not in food_cols:
        op.add_column(
            "food_items",
            sa.Column("health_indicator", sa.String(length=24), nullable=False, server_default="neutral"),
            schema="nutrition",
        )
        op.alter_column("food_items", "health_indicator", server_default=None, schema="nutrition")


def downgrade() -> None:
    food_cols = _existing_columns("nutrition", "food_items")
    if "health_indicator" in food_cols:
        op.drop_column("food_items", "health_indicator", schema="nutrition")

    if _table_exists("core", "user_weight_logs"):
        op.drop_index("ix_user_weight_logs_user_recorded", table_name="user_weight_logs", schema="core")
        op.drop_table("user_weight_logs", schema="core")

    if _table_exists("core", "user_profiles"):
        op.drop_table("user_profiles", schema="core")
