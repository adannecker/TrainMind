"""Add birth date and gender to user profiles.

Revision ID: 20260315_0014
Revises: 20260315_0013
Create Date: 2026-03-15
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260315_0014"
down_revision: Union[str, Sequence[str], None] = "20260315_0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(schema_name: str, table_name: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {col["name"] for col in insp.get_columns(table_name, schema=schema_name)}


def upgrade() -> None:
    profile_cols = _existing_columns("core", "user_profiles")
    if "date_of_birth" not in profile_cols:
        op.add_column("user_profiles", sa.Column("date_of_birth", sa.Date(), nullable=True), schema="core")
    if "gender" not in profile_cols:
        op.add_column("user_profiles", sa.Column("gender", sa.String(length=20), nullable=True), schema="core")


def downgrade() -> None:
    profile_cols = _existing_columns("core", "user_profiles")
    if "gender" in profile_cols:
        op.drop_column("user_profiles", "gender", schema="core")
    if "date_of_birth" in profile_cols:
        op.drop_column("user_profiles", "date_of_birth", schema="core")
