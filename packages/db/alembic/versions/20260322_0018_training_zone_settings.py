"""training zone settings

Revision ID: 20260322_0018
Revises: 20260322_0017
Create Date: 2026-03-22 16:10:00
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260322_0018"
down_revision: Union[str, Sequence[str], None] = "20260322_0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(schema_name: str, table_name: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return table_name in insp.get_table_names(schema=schema_name)


def upgrade() -> None:
    if _table_exists("core", "user_training_zone_settings"):
        return

    op.create_table(
        "user_training_zone_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("metric_type", sa.String(length=24), nullable=False),
        sa.Column("model_key", sa.String(length=60), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["core.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "metric_type", name="uq_user_training_zone_settings_user_metric"),
        schema="core",
    )
    op.create_index(
        "ix_user_training_zone_settings_user_metric",
        "user_training_zone_settings",
        ["user_id", "metric_type"],
        schema="core",
    )


def downgrade() -> None:
    if not _table_exists("core", "user_training_zone_settings"):
        return

    op.drop_index(
        "ix_user_training_zone_settings_user_metric",
        table_name="user_training_zone_settings",
        schema="core",
    )
    op.drop_table("user_training_zone_settings", schema="core")
