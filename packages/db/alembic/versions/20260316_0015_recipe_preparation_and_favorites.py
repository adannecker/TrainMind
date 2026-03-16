"""Add recipe preparation text and favorite flag.

Revision ID: 20260316_0015
Revises: 20260315_0014
Create Date: 2026-03-16
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260316_0015"
down_revision: Union[str, Sequence[str], None] = "20260315_0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {col["name"] for col in insp.get_columns(table_name, schema=schema_name)}


def upgrade() -> None:
    cols = _existing_columns("nutrition", "recipes")
    if "preparation" not in cols:
      op.add_column("recipes", sa.Column("preparation", sa.Text(), nullable=True), schema="nutrition")
    if "is_favorite" not in cols:
      op.add_column(
          "recipes",
          sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.text("false")),
          schema="nutrition",
      )
      op.alter_column("recipes", "is_favorite", server_default=None, schema="nutrition")


def downgrade() -> None:
    cols = _existing_columns("nutrition", "recipes")
    if "is_favorite" in cols:
        op.drop_column("recipes", "is_favorite", schema="nutrition")
    if "preparation" in cols:
        op.drop_column("recipes", "preparation", schema="nutrition")
