"""profile nav group order

Revision ID: 20260322_0019
Revises: 20260322_0018
Create Date: 2026-03-22 17:05:00
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260322_0019"
down_revision: Union[str, Sequence[str], None] = "20260322_0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {column["name"] for column in insp.get_columns(table_name, schema=schema_name)}


def upgrade() -> None:
    profile_cols = _existing_columns("core", "user_profiles")
    if "nav_group_order_json" not in profile_cols:
        op.add_column("user_profiles", sa.Column("nav_group_order_json", sa.Text(), nullable=True), schema="core")


def downgrade() -> None:
    profile_cols = _existing_columns("core", "user_profiles")
    if "nav_group_order_json" in profile_cols:
        op.drop_column("user_profiles", "nav_group_order_json", schema="core")
