"""Repair missing training zone migration artifacts.

Revision ID: 20260323_0020
Revises: 20260323_0019
Create Date: 2026-03-23
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260323_0020"
down_revision: Union[str, Sequence[str], None] = "20260323_0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(schema_name: str, table_name: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return table_name in insp.get_table_names(schema=schema_name)


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    if table_name not in insp.get_table_names(schema=schema_name):
        return set()
    return {column["name"] for column in insp.get_columns(table_name, schema=schema_name)}


def _existing_indexes(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    if table_name not in insp.get_table_names(schema=schema_name):
        return set()
    return {index["name"] for index in insp.get_indexes(table_name, schema=schema_name)}


def upgrade() -> None:
    if not _table_exists("core", "user_training_zone_settings"):
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

    if "ix_user_training_zone_settings_user_metric" not in _existing_indexes("core", "user_training_zone_settings"):
        op.create_index(
            "ix_user_training_zone_settings_user_metric",
            "user_training_zone_settings",
            ["user_id", "metric_type"],
            unique=False,
            schema="core",
        )

    zone_cols = _existing_columns("core", "user_training_zone_settings")
    if "config_json" not in zone_cols:
        op.add_column("user_training_zone_settings", sa.Column("config_json", sa.Text(), nullable=True), schema="core")

    profile_cols = _existing_columns("core", "user_profiles")
    if "nav_group_order_json" not in profile_cols:
        op.add_column("user_profiles", sa.Column("nav_group_order_json", sa.Text(), nullable=True), schema="core")


def downgrade() -> None:
    profile_cols = _existing_columns("core", "user_profiles")
    if "nav_group_order_json" in profile_cols:
        op.drop_column("user_profiles", "nav_group_order_json", schema="core")

    zone_cols = _existing_columns("core", "user_training_zone_settings")
    if "config_json" in zone_cols:
        op.drop_column("user_training_zone_settings", "config_json", schema="core")

    if _table_exists("core", "user_training_zone_settings"):
        if "ix_user_training_zone_settings_user_metric" in _existing_indexes("core", "user_training_zone_settings"):
            op.drop_index(
                "ix_user_training_zone_settings_user_metric",
                table_name="user_training_zone_settings",
                schema="core",
            )
        op.drop_table("user_training_zone_settings", schema="core")
