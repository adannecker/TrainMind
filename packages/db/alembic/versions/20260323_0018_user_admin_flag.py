"""Add admin flag to users.

Revision ID: 20260323_0018
Revises: 20260322_0020
Create Date: 2026-03-23
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260323_0018"
down_revision = "20260322_0020"
branch_labels = None
depends_on = None


def _existing_columns(schema: str, table: str) -> set[str]:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            select column_name
            from information_schema.columns
            where table_schema = :schema_name and table_name = :table_name
            """
        ),
        {"schema_name": schema, "table_name": table},
    )
    return {row[0] for row in rows}


def upgrade() -> None:
    if "is_admin" not in _existing_columns("core", "users"):
        op.add_column(
            "users",
            sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
            schema="core",
        )
        op.execute("UPDATE core.users SET is_admin = FALSE WHERE is_admin IS NULL")
        op.alter_column("users", "is_admin", server_default=None, schema="core")


def downgrade() -> None:
    if "is_admin" in _existing_columns("core", "users"):
        op.drop_column("users", "is_admin", schema="core")
