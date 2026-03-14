"""Add auth tables and scope service credentials to users.

Revision ID: 20260314_0005
Revises: 20260314_0004
Create Date: 2026-03-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260314_0005"
down_revision: Union[str, Sequence[str], None] = "20260314_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True), schema="core")

    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("core.users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
        schema="core",
    )

    op.add_column("service_credentials", sa.Column("user_id", sa.Integer(), nullable=True), schema="core")
    op.create_foreign_key(
        "fk_service_credentials_user_id_users",
        "service_credentials",
        "users",
        ["user_id"],
        ["id"],
        source_schema="core",
        referent_schema="core",
        ondelete="CASCADE",
    )

    op.execute(
        """
        UPDATE core.service_credentials
        SET user_id = (
            SELECT id FROM core.users ORDER BY id ASC LIMIT 1
        )
        WHERE user_id IS NULL
        """
    )

    op.alter_column("service_credentials", "user_id", schema="core", nullable=False)
    op.drop_constraint("uq_service_credentials_provider", "service_credentials", schema="core", type_="unique")
    op.create_unique_constraint(
        "uq_service_credentials_user_provider",
        "service_credentials",
        ["user_id", "provider"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_constraint("uq_service_credentials_user_provider", "service_credentials", schema="core", type_="unique")
    op.create_unique_constraint("uq_service_credentials_provider", "service_credentials", ["provider"], schema="core")
    op.drop_constraint("fk_service_credentials_user_id_users", "service_credentials", schema="core", type_="foreignkey")
    op.drop_column("service_credentials", "user_id", schema="core")

    op.drop_table("user_sessions", schema="core")
    op.drop_column("users", "password_hash", schema="core")

