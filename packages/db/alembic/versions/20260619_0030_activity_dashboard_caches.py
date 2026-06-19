"""activity dashboard caches

Revision ID: 20260619_0030
Revises: 20260408_0029
Create Date: 2026-06-19 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import CORE_SCHEMA, GARMIN_SCHEMA


revision = "20260619_0030"
down_revision = "20260408_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_dashboard_caches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("view_type", sa.String(length=16), nullable=False),
        sa.Column("period_start_date", sa.Date(), nullable=False),
        sa.Column("period_end_date", sa.Date(), nullable=False),
        sa.Column("view_version", sa.Integer(), nullable=False),
        sa.Column("activity_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("activity_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], [f"{CORE_SCHEMA}.users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "view_type", "period_start_date", name="uq_activity_dashboard_caches_user_view_period"),
        schema=GARMIN_SCHEMA,
    )
    op.create_index(
        "ix_activity_dashboard_caches_user_view_period",
        "activity_dashboard_caches",
        ["user_id", "view_type", "period_start_date"],
        schema=GARMIN_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_activity_dashboard_caches_user_view_period", table_name="activity_dashboard_caches", schema=GARMIN_SCHEMA)
    op.drop_table("activity_dashboard_caches", schema=GARMIN_SCHEMA)
