"""Add encrypted service credentials storage.

Revision ID: 20260314_0004
Revises: 20260314_0003
Create Date: 2026-03-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260314_0004"
down_revision: Union[str, Sequence[str], None] = "20260314_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "service_credentials",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("username_encrypted", sa.Text(), nullable=False),
        sa.Column("password_encrypted", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("provider", name="uq_service_credentials_provider"),
        schema="core",
    )


def downgrade() -> None:
    op.drop_table("service_credentials", schema="core")

