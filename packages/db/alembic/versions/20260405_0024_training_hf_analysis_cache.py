"""training hf analysis cache

Revision ID: 20260405_0024
Revises: 20260327_0023
Create Date: 2026-04-05 18:30:00.000000
"""

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import CORE_SCHEMA, GARMIN_SCHEMA


revision = "20260405_0024"
down_revision = "20260327_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_hf_analysis",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("activity_id", sa.Integer(), nullable=False),
        sa.Column("activity_date", sa.Date(), nullable=False),
        sa.Column("window_key", sa.String(length=12), nullable=False),
        sa.Column("window_seconds", sa.Integer(), nullable=False),
        sa.Column("bucket_start_w", sa.Integer(), nullable=False),
        sa.Column("bucket_end_w", sa.Integer(), nullable=False),
        sa.Column("avg_hr_bpm", sa.Float(), nullable=False),
        sa.Column("avg_power_w", sa.Float(), nullable=False),
        sa.Column("activity_name", sa.String(length=200), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], [f"{CORE_SCHEMA}.users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["activity_id"], [f"{GARMIN_SCHEMA}.activities.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("activity_id", "window_key", "bucket_start_w", name="uq_activity_hf_analysis_activity_window_bucket"),
        schema=GARMIN_SCHEMA,
    )
    op.create_index(
        "ix_activity_hf_analysis_user_window_bucket_date",
        "activity_hf_analysis",
        ["user_id", "window_key", "bucket_start_w", "activity_date"],
        schema=GARMIN_SCHEMA,
    )
    op.create_index(
        "ix_activity_hf_analysis_activity_window",
        "activity_hf_analysis",
        ["activity_id", "window_key"],
        schema=GARMIN_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_activity_hf_analysis_activity_window", table_name="activity_hf_analysis", schema=GARMIN_SCHEMA)
    op.drop_index("ix_activity_hf_analysis_user_window_bucket_date", table_name="activity_hf_analysis", schema=GARMIN_SCHEMA)
    op.drop_table("activity_hf_analysis", schema=GARMIN_SCHEMA)
