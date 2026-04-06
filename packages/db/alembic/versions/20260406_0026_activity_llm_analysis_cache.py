"""activity llm analysis cache

Revision ID: 20260406_0026
Revises: 20260406_0025
Create Date: 2026-04-06 12:40:00.000000
"""

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import CORE_SCHEMA, GARMIN_SCHEMA


revision = "20260406_0026"
down_revision = "20260406_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_llm_analysis_cache",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("activity_id", sa.Integer(), nullable=False),
        sa.Column("activity_name", sa.String(length=200), nullable=True),
        sa.Column("analysis_version", sa.Integer(), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=True),
        sa.Column("generated_at", sa.DateTime(), nullable=True),
        sa.Column("context_snapshot_json", sa.Text(), nullable=True),
        sa.Column("analysis_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], [f"{CORE_SCHEMA}.users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["activity_id"], [f"{GARMIN_SCHEMA}.activities.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("activity_id", name="uq_activity_llm_analysis_cache_activity"),
        schema=GARMIN_SCHEMA,
    )
    op.create_index(
        "ix_activity_llm_analysis_cache_user_activity",
        "activity_llm_analysis_cache",
        ["user_id", "activity_id"],
        schema=GARMIN_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_activity_llm_analysis_cache_user_activity", table_name="activity_llm_analysis_cache", schema=GARMIN_SCHEMA)
    op.drop_table("activity_llm_analysis_cache", schema=GARMIN_SCHEMA)
