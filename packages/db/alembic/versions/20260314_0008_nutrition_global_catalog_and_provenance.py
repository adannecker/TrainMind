"""Nutrition global catalog, user overrides, and provenance metadata.

Revision ID: 20260314_0008
Revises: 20260314_0007
Create Date: 2026-03-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260314_0008"
down_revision: Union[str, Sequence[str], None] = "20260314_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema: str, table: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name=table, schema=schema)}


def _existing_tables(schema: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return set(inspector.get_table_names(schema=schema))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    op.alter_column(
        "food_items",
        "user_id",
        existing_type=sa.Integer(),
        nullable=True,
        schema="nutrition",
    )

    existing_food_item_cols = _existing_columns("nutrition", "food_items")
    for name, col_type, nullable, server_default in [
        ("origin_type", sa.String(length=32), False, "user_self"),
        ("trust_level", sa.String(length=20), False, "medium"),
        ("verification_status", sa.String(length=24), False, "unverified"),
        ("source_label", sa.String(length=180), True, None),
        ("source_url", sa.String(length=500), True, None),
    ]:
        if name in existing_food_item_cols:
            continue
        column = sa.Column(name, col_type, nullable=nullable)
        if server_default is not None:
            column.server_default = sa.text(f"'{server_default}'")
        op.add_column("food_items", column, schema="nutrition")
    # Remove defaults after backfill to keep app-level defaults authoritative.
    for col_name in ["origin_type", "trust_level", "verification_status"]:
        if col_name in _existing_columns("nutrition", "food_items"):
            op.alter_column("food_items", col_name, server_default=None, schema="nutrition")

    existing_tables = _existing_tables("nutrition")
    if "food_item_overrides" not in existing_tables:
        op.create_table(
            "food_item_overrides",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("core.users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("food_item_id", sa.String(length=36), sa.ForeignKey("nutrition.food_items.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=True),
            sa.Column("category", sa.String(length=60), nullable=True),
            sa.Column("brand", sa.String(length=160), nullable=True),
            sa.Column("barcode", sa.String(length=64), nullable=True),
            sa.Column("kcal_per_100g", sa.Float(), nullable=True),
            sa.Column("protein_per_100g", sa.Float(), nullable=True),
            sa.Column("carbs_per_100g", sa.Float(), nullable=True),
            sa.Column("fat_per_100g", sa.Float(), nullable=True),
            sa.Column("fiber_per_100g", sa.Float(), nullable=True),
            sa.Column("sugar_per_100g", sa.Float(), nullable=True),
            sa.Column("starch_per_100g", sa.Float(), nullable=True),
            sa.Column("saturated_fat_per_100g", sa.Float(), nullable=True),
            sa.Column("monounsaturated_fat_per_100g", sa.Float(), nullable=True),
            sa.Column("polyunsaturated_fat_per_100g", sa.Float(), nullable=True),
            sa.Column("sodium_mg_per_100g", sa.Float(), nullable=True),
            sa.Column("potassium_mg_per_100g", sa.Float(), nullable=True),
            sa.Column("details_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            schema="nutrition",
        )
        op.create_index(
            "ix_food_item_overrides_user_item_updated",
            "food_item_overrides",
            ["user_id", "food_item_id", "updated_at"],
            schema="nutrition",
        )

    if "food_item_sources" not in existing_tables:
        op.create_table(
            "food_item_sources",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("food_item_id", sa.String(length=36), sa.ForeignKey("nutrition.food_items.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source_type", sa.String(length=40), nullable=False),
            sa.Column("source_name", sa.String(length=180), nullable=True),
            sa.Column("source_url", sa.String(length=500), nullable=True),
            sa.Column("citation_text", sa.Text(), nullable=True),
            sa.Column("is_primary", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            schema="nutrition",
        )
        op.create_index("ix_food_item_sources_food_item_id", "food_item_sources", ["food_item_id"], schema="nutrition")
        op.alter_column("food_item_sources", "is_primary", server_default=None, schema="nutrition")

    # Ensure existing records get a consistent provenance baseline.
    if "origin_type" in _existing_columns("nutrition", "food_items"):
        op.execute(
            sa.text(
                """
                UPDATE nutrition.food_items
                SET origin_type = 'user_self'
                WHERE origin_type IS NULL OR trim(origin_type) = ''
                """
            )
        )
    if "trust_level" in _existing_columns("nutrition", "food_items"):
        op.execute(
            sa.text(
                """
                UPDATE nutrition.food_items
                SET trust_level = 'medium'
                WHERE trust_level IS NULL OR trim(trust_level) = ''
                """
            )
        )
    if "verification_status" in _existing_columns("nutrition", "food_items"):
        op.execute(
            sa.text(
                """
                UPDATE nutrition.food_items
                SET verification_status = 'unverified'
                WHERE verification_status IS NULL OR trim(verification_status) = ''
                """
            )
        )


def downgrade() -> None:
    tables = _existing_tables("nutrition")
    if "food_item_sources" in tables:
        indexes = {idx["name"] for idx in sa.inspect(op.get_bind()).get_indexes("food_item_sources", schema="nutrition")}
        if "ix_food_item_sources_food_item_id" in indexes:
            op.drop_index("ix_food_item_sources_food_item_id", table_name="food_item_sources", schema="nutrition")
        op.drop_table("food_item_sources", schema="nutrition")

    if "food_item_overrides" in tables:
        indexes = {idx["name"] for idx in sa.inspect(op.get_bind()).get_indexes("food_item_overrides", schema="nutrition")}
        if "ix_food_item_overrides_user_item_updated" in indexes:
            op.drop_index("ix_food_item_overrides_user_item_updated", table_name="food_item_overrides", schema="nutrition")
        op.drop_table("food_item_overrides", schema="nutrition")

    existing_food_item_cols = _existing_columns("nutrition", "food_items")
    for col_name in ["source_url", "source_label", "verification_status", "trust_level", "origin_type"]:
        if col_name in existing_food_item_cols:
            op.drop_column("food_items", col_name, schema="nutrition")

    op.alter_column(
        "food_items",
        "user_id",
        existing_type=sa.Integer(),
        nullable=False,
        schema="nutrition",
    )
