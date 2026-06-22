"""activity lap normalized power

Revision ID: 20260622_0031
Revises: 20260619_0030
Create Date: 2026-06-22 22:40:00.000000
"""

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import GARMIN_SCHEMA


revision = "20260622_0031"
down_revision = "20260619_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activity_laps", sa.Column("normalized_power_w", sa.Float(), nullable=True), schema=GARMIN_SCHEMA)


def downgrade() -> None:
    op.drop_column("activity_laps", "normalized_power_w", schema=GARMIN_SCHEMA)
