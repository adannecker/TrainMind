"""training zone setting config

Revision ID: 20260322_0020
Revises: 20260322_0019
Create Date: 2026-03-22 19:00:00
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260322_0020"
down_revision: Union[str, Sequence[str], None] = "20260322_0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {column["name"] for column in insp.get_columns(table_name, schema=schema_name)}


def upgrade() -> None:
    zone_cols = _existing_columns("core", "user_training_zone_settings")
    if "config_json" not in zone_cols:
        op.add_column("user_training_zone_settings", sa.Column("config_json", sa.Text(), nullable=True), schema="core")


def downgrade() -> None:
    zone_cols = _existing_columns("core", "user_training_zone_settings")
    if "config_json" in zone_cols:
        op.drop_column("user_training_zone_settings", "config_json", schema="core")
