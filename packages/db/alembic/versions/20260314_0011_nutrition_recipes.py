"""Add nutrition recipes and recipe items.

Revision ID: 20260314_0011
Revises: 20260314_0010
Create Date: 2026-03-14
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260314_0011"
down_revision: Union[str, Sequence[str], None] = "20260314_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {col["name"] for col in insp.get_columns(table_name, schema=schema_name)}


def upgrade() -> None:
    op.create_table(
        "recipes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("visibility", sa.String(length=20), nullable=False, server_default="private"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["core.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="nutrition",
    )
    op.create_index("ix_recipes_user_updated", "recipes", ["user_id", "updated_at"], schema="nutrition")
    op.alter_column("recipes", "visibility", server_default=None, schema="nutrition")

    op.create_table(
        "recipe_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("recipe_id", sa.String(length=36), nullable=False),
        sa.Column("food_item_id", sa.String(length=36), nullable=False),
        sa.Column("amount_g", sa.Float(), nullable=False),
        sa.Column("sort_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["food_item_id"], ["nutrition.food_items.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["recipe_id"], ["nutrition.recipes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="nutrition",
    )
    op.create_index("ix_recipe_items_recipe_updated", "recipe_items", ["recipe_id", "updated_at"], schema="nutrition")
    op.alter_column("recipe_items", "sort_index", server_default=None, schema="nutrition")

    meal_item_cols = _existing_columns("nutrition", "meal_entry_items")
    if "source_recipe_id" not in meal_item_cols:
        op.add_column(
            "meal_entry_items",
            sa.Column("source_recipe_id", sa.String(length=36), nullable=True),
            schema="nutrition",
        )
        op.create_foreign_key(
            "fk_meal_entry_items_source_recipe_id",
            "meal_entry_items",
            "recipes",
            ["source_recipe_id"],
            ["id"],
            source_schema="nutrition",
            referent_schema="nutrition",
            ondelete="SET NULL",
        )


def downgrade() -> None:
    meal_item_cols = _existing_columns("nutrition", "meal_entry_items")
    if "source_recipe_id" in meal_item_cols:
        op.drop_constraint(
            "fk_meal_entry_items_source_recipe_id",
            "meal_entry_items",
            schema="nutrition",
            type_="foreignkey",
        )
        op.drop_column("meal_entry_items", "source_recipe_id", schema="nutrition")

    op.drop_index("ix_recipe_items_recipe_updated", table_name="recipe_items", schema="nutrition")
    op.drop_table("recipe_items", schema="nutrition")

    op.drop_index("ix_recipes_user_updated", table_name="recipes", schema="nutrition")
    op.drop_table("recipes", schema="nutrition")
