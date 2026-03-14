"""Split nutrition items into base ingredients vs products.

Revision ID: 20260314_0009
Revises: 20260314_0008
Create Date: 2026-03-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260314_0009"
down_revision: Union[str, Sequence[str], None] = "20260314_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema: str, table: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name=table, schema=schema)}


def _existing_indexes(schema: str, table: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {idx["name"] for idx in inspector.get_indexes(table_name=table, schema=schema)}


def upgrade() -> None:
    food_cols = _existing_columns("nutrition", "food_items")
    if "item_kind" not in food_cols:
        op.add_column(
            "food_items",
            sa.Column("item_kind", sa.String(length=20), nullable=False, server_default=sa.text("'base_ingredient'")),
            schema="nutrition",
        )
        op.alter_column("food_items", "item_kind", server_default=None, schema="nutrition")

    override_cols = _existing_columns("nutrition", "food_item_overrides")
    if "item_kind" not in override_cols:
        op.add_column(
            "food_item_overrides",
            sa.Column("item_kind", sa.String(length=20), nullable=True),
            schema="nutrition",
        )

    indexes = _existing_indexes("nutrition", "food_items")
    if "ix_food_items_kind_category" not in indexes:
        op.create_index("ix_food_items_kind_category", "food_items", ["item_kind", "category"], schema="nutrition")

    # Heuristic migration for existing rows:
    # packaged/composite categories or barcode -> product, else base ingredient.
    op.execute(
        sa.text(
            """
            UPDATE nutrition.food_items
            SET item_kind = 'product'
            WHERE barcode IS NOT NULL
               OR category IN ('Fertiggerichte', 'Süßwaren', 'Snacks', 'Getränke', 'Backwaren')
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE nutrition.food_items
            SET item_kind = 'base_ingredient'
            WHERE item_kind IS NULL OR trim(item_kind) = ''
            """
        )
    )


def downgrade() -> None:
    indexes = _existing_indexes("nutrition", "food_items")
    if "ix_food_items_kind_category" in indexes:
        op.drop_index("ix_food_items_kind_category", table_name="food_items", schema="nutrition")

    override_cols = _existing_columns("nutrition", "food_item_overrides")
    if "item_kind" in override_cols:
        op.drop_column("food_item_overrides", "item_kind", schema="nutrition")

    food_cols = _existing_columns("nutrition", "food_items")
    if "item_kind" in food_cols:
        op.drop_column("food_items", "item_kind", schema="nutrition")
