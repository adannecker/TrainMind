"""Store training configuration and adopted plan on user profiles.

Revision ID: 20260326_0021
Revises: 20260323_0020
Create Date: 2026-03-26
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260326_0021"
down_revision: Union[str, Sequence[str], None] = "20260323_0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    if table_name not in insp.get_table_names(schema=schema_name):
        return set()
    return {column["name"] for column in insp.get_columns(table_name, schema=schema_name)}


def upgrade() -> None:
    profile_cols = _existing_columns("core", "user_profiles")
    if "training_config_json" not in profile_cols:
        op.add_column("user_profiles", sa.Column("training_config_json", sa.Text(), nullable=True), schema="core")
    if "training_plan_json" not in profile_cols:
        op.add_column("user_profiles", sa.Column("training_plan_json", sa.Text(), nullable=True), schema="core")


def downgrade() -> None:
    profile_cols = _existing_columns("core", "user_profiles")
    if "training_plan_json" in profile_cols:
        op.drop_column("user_profiles", "training_plan_json", schema="core")
    if "training_config_json" in profile_cols:
        op.drop_column("user_profiles", "training_config_json", schema="core")
