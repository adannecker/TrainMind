"""Add user training metrics history.

Revision ID: 20260322_0016
Revises: 20260316_0015
Create Date: 2026-03-22
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260322_0016"
down_revision: Union[str, Sequence[str], None] = "20260316_0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(schema_name: str, table_name: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return table_name in insp.get_table_names(schema=schema_name)


def upgrade() -> None:
    if _table_exists("core", "user_training_metrics"):
        return

    op.create_table(
        "user_training_metrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("metric_type", sa.String(length=24), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=120), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["core.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="core",
    )
    op.create_index(
        "ix_user_training_metrics_user_metric_recorded",
        "user_training_metrics",
        ["user_id", "metric_type", "recorded_at"],
        schema="core",
    )


def downgrade() -> None:
    if not _table_exists("core", "user_training_metrics"):
        return

    op.drop_index("ix_user_training_metrics_user_metric_recorded", table_name="user_training_metrics", schema="core")
    op.drop_table("user_training_metrics", schema="core")
