"""add llm usage events

Revision ID: 20260406_0025
Revises: 20260405_0024
Create Date: 2026-04-06 10:15:00.000000
"""

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import CORE_SCHEMA


revision = "20260406_0025"
down_revision = "20260405_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_usage_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("feature_key", sa.String(length=80), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], [f"{CORE_SCHEMA}.users.id"], ondelete="CASCADE"),
        schema=CORE_SCHEMA,
    )
    op.create_index(
        "ix_llm_usage_events_user_created",
        "llm_usage_events",
        ["user_id", "created_at"],
        schema=CORE_SCHEMA,
    )
    op.create_index(
        "ix_llm_usage_events_user_feature_created",
        "llm_usage_events",
        ["user_id", "feature_key", "created_at"],
        schema=CORE_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_llm_usage_events_user_feature_created", table_name="llm_usage_events", schema=CORE_SCHEMA)
    op.drop_index("ix_llm_usage_events_user_created", table_name="llm_usage_events", schema=CORE_SCHEMA)
    op.drop_table("llm_usage_events", schema=CORE_SCHEMA)
