"""Extend nutrition food_items with category and detailed nutrient fields.

Revision ID: 20260314_0007
Revises: 20260314_0006
Create Date: 2026-03-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260314_0007"
down_revision: Union[str, Sequence[str], None] = "20260314_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema: str, table: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name=table, schema=schema)}


def upgrade() -> None:
    existing = _existing_columns("nutrition", "food_items")
    additions: list[tuple[str, sa.types.TypeEngine]] = [
        ("category", sa.String(length=60)),
        ("fiber_per_100g", sa.Float()),
        ("sugar_per_100g", sa.Float()),
        ("starch_per_100g", sa.Float()),
        ("saturated_fat_per_100g", sa.Float()),
        ("monounsaturated_fat_per_100g", sa.Float()),
        ("polyunsaturated_fat_per_100g", sa.Float()),
        ("sodium_mg_per_100g", sa.Float()),
        ("potassium_mg_per_100g", sa.Float()),
        ("details_json", sa.Text()),
    ]
    for column_name, column_type in additions:
        if column_name in existing:
            continue
        op.add_column("food_items", sa.Column(column_name, column_type, nullable=True), schema="nutrition")


def downgrade() -> None:
    existing = _existing_columns("nutrition", "food_items")
    for column_name in [
        "details_json",
        "potassium_mg_per_100g",
        "sodium_mg_per_100g",
        "polyunsaturated_fat_per_100g",
        "monounsaturated_fat_per_100g",
        "saturated_fat_per_100g",
        "starch_per_100g",
        "sugar_per_100g",
        "fiber_per_100g",
        "category",
    ]:
        if column_name not in existing:
            continue
        op.drop_column("food_items", column_name, schema="nutrition")
