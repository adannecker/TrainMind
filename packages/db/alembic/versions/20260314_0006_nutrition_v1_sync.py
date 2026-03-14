"""Add nutrition v1 tables for offline sync.

Revision ID: 20260314_0006
Revises: 20260314_0005
Create Date: 2026-03-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260314_0006"
down_revision: Union[str, Sequence[str], None] = "20260314_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "food_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("core.users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("brand", sa.String(length=160), nullable=True),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("kcal_per_100g", sa.Float(), nullable=True),
        sa.Column("protein_per_100g", sa.Float(), nullable=True),
        sa.Column("carbs_per_100g", sa.Float(), nullable=True),
        sa.Column("fat_per_100g", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        schema="nutrition",
    )
    op.create_index("ix_food_items_user_updated", "food_items", ["user_id", "updated_at"], schema="nutrition")
    op.create_index("ix_food_items_user_barcode", "food_items", ["user_id", "barcode"], schema="nutrition")

    op.create_table(
        "meal_entries",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("core.users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=False),
        sa.Column("meal_type", sa.String(length=30), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        schema="nutrition",
    )
    op.create_index("ix_meal_entries_user_consumed", "meal_entries", ["user_id", "consumed_at"], schema="nutrition")
    op.create_index("ix_meal_entries_user_updated", "meal_entries", ["user_id", "updated_at"], schema="nutrition")

    op.create_table(
        "meal_entry_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("meal_entry_id", sa.String(length=36), sa.ForeignKey("nutrition.meal_entries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("food_item_id", sa.String(length=36), sa.ForeignKey("nutrition.food_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("custom_name", sa.String(length=160), nullable=True),
        sa.Column("amount_g", sa.Float(), nullable=False),
        sa.Column("kcal", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbs_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        schema="nutrition",
    )
    op.create_index("ix_meal_entry_items_entry_updated", "meal_entry_items", ["meal_entry_id", "updated_at"], schema="nutrition")

    op.create_table(
        "sync_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("core.users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_type", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("op", sa.String(length=20), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        schema="nutrition",
    )
    op.create_index("ix_sync_events_user_updated", "sync_events", ["user_id", "updated_at"], schema="nutrition")


def downgrade() -> None:
    op.drop_index("ix_sync_events_user_updated", table_name="sync_events", schema="nutrition")
    op.drop_table("sync_events", schema="nutrition")

    op.drop_index("ix_meal_entry_items_entry_updated", table_name="meal_entry_items", schema="nutrition")
    op.drop_table("meal_entry_items", schema="nutrition")

    op.drop_index("ix_meal_entries_user_updated", table_name="meal_entries", schema="nutrition")
    op.drop_index("ix_meal_entries_user_consumed", table_name="meal_entries", schema="nutrition")
    op.drop_table("meal_entries", schema="nutrition")

    op.drop_index("ix_food_items_user_barcode", table_name="food_items", schema="nutrition")
    op.drop_index("ix_food_items_user_updated", table_name="food_items", schema="nutrition")
    op.drop_table("food_items", schema="nutrition")

