"""Add i18n name fields for nutrition food items.

Revision ID: 20260314_0010
Revises: 20260314_0009
Create Date: 2026-03-14
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260314_0010"
down_revision: Union[str, Sequence[str], None] = "20260314_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {col["name"] for col in insp.get_columns(table_name, schema=schema_name)}


def upgrade() -> None:
    food_cols = _existing_columns("nutrition", "food_items")
    if "name_en" not in food_cols:
        op.add_column("food_items", sa.Column("name_en", sa.String(length=180), nullable=True), schema="nutrition")
    if "name_de" not in food_cols:
        op.add_column("food_items", sa.Column("name_de", sa.String(length=180), nullable=True), schema="nutrition")

    override_cols = _existing_columns("nutrition", "food_item_overrides")
    if "name_en" not in override_cols:
        op.add_column("food_item_overrides", sa.Column("name_en", sa.String(length=180), nullable=True), schema="nutrition")
    if "name_de" not in override_cols:
        op.add_column("food_item_overrides", sa.Column("name_de", sa.String(length=180), nullable=True), schema="nutrition")

    op.execute(
        sa.text(
            """
            UPDATE nutrition.food_items
            SET name_en = name
            WHERE name_en IS NULL OR trim(name_en) = ''
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE nutrition.food_items
            SET name_de = name
            WHERE name_de IS NULL OR trim(name_de) = ''
            """
        )
    )


def downgrade() -> None:
    override_cols = _existing_columns("nutrition", "food_item_overrides")
    if "name_de" in override_cols:
        op.drop_column("food_item_overrides", "name_de", schema="nutrition")
    if "name_en" in override_cols:
        op.drop_column("food_item_overrides", "name_en", schema="nutrition")

    food_cols = _existing_columns("nutrition", "food_items")
    if "name_de" in food_cols:
        op.drop_column("food_items", "name_de", schema="nutrition")
    if "name_en" in food_cols:
        op.drop_column("food_items", "name_en", schema="nutrition")
