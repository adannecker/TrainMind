"""user achievement activity link

Revision ID: 20260327_0023
Revises: 20260327_0022
Create Date: 2026-03-27 01:30:00.000000
"""

from alembic import op
import sqlalchemy as sa

from packages.db.models import CORE_SCHEMA


revision = "20260327_0023"
down_revision = "20260327_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_achievements", sa.Column("activity_id", sa.Integer(), nullable=True), schema=CORE_SCHEMA)
    op.add_column("user_achievements", sa.Column("activity_name", sa.String(length=200), nullable=True), schema=CORE_SCHEMA)


def downgrade() -> None:
    op.drop_column("user_achievements", "activity_name", schema=CORE_SCHEMA)
    op.drop_column("user_achievements", "activity_id", schema=CORE_SCHEMA)
