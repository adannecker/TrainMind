"""Add invite tokens for user onboarding.

Revision ID: 20260323_0019
Revises: 20260323_0018
Create Date: 2026-03-23
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260323_0019"
down_revision = "20260323_0018"
branch_labels = None
depends_on = None


def _table_exists(schema: str, table: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            """
            select 1
            from information_schema.tables
            where table_schema = :schema_name and table_name = :table_name
            limit 1
            """
        ),
        {"schema_name": schema, "table_name": table},
    ).first()
    return result is not None


def upgrade() -> None:
    if not _table_exists("core", "user_invite_tokens"):
        op.create_table(
            "user_invite_tokens",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["core.users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("token_hash", name="uq_user_invite_tokens_token_hash"),
            schema="core",
        )
        op.create_index(
            "ix_user_invite_tokens_user_expires",
            "user_invite_tokens",
            ["user_id", "expires_at"],
            unique=False,
            schema="core",
        )


def downgrade() -> None:
    if _table_exists("core", "user_invite_tokens"):
        op.drop_index("ix_user_invite_tokens_user_expires", table_name="user_invite_tokens", schema="core")
        op.drop_table("user_invite_tokens", schema="core")
