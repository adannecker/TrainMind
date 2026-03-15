"""Add USDA verification status field for nutrition food items.

Revision ID: 20260315_0012
Revises: 20260314_0011
Create Date: 2026-03-15
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260315_0012"
down_revision: Union[str, Sequence[str], None] = "20260314_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {col["name"] for col in insp.get_columns(table_name, schema=schema_name)}


def upgrade() -> None:
    food_cols = _existing_columns("nutrition", "food_items")
    if "usda_status" not in food_cols:
        op.add_column(
            "food_items",
            sa.Column("usda_status", sa.String(length=20), nullable=False, server_default="unknown"),
            schema="nutrition",
        )

    # Backfill existing high-confidence USDA linked rows.
    op.execute(
        sa.text(
            """
            UPDATE nutrition.food_items
            SET usda_status = 'valid'
            WHERE lower(coalesce(source_label, '')) = 'usda fooddata central'
              AND lower(coalesce(trust_level, '')) = 'high'
              AND lower(coalesce(verification_status, '')) IN ('source_linked', 'verified')
            """
        )
    )

    op.alter_column("food_items", "usda_status", server_default=None, schema="nutrition")


def downgrade() -> None:
    food_cols = _existing_columns("nutrition", "food_items")
    if "usda_status" in food_cols:
        op.drop_column("food_items", "usda_status", schema="nutrition")
