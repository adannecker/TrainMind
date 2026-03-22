"""achievements tables

Revision ID: 20260322_0017
Revises: 20260322_0016
Create Date: 2026-03-22 15:20:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import CORE_SCHEMA


revision = "20260322_0017"
down_revision = "20260322_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_achievements",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("section_key", sa.String(length=40), nullable=False),
        sa.Column("category_key", sa.String(length=40), nullable=False),
        sa.Column("achievement_key", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("icon", sa.String(length=24), nullable=False),
        sa.Column("accent", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("hint", sa.Text(), nullable=True),
        sa.Column("achieved_at", sa.DateTime(), nullable=True),
        sa.Column("current_value", sa.Float(), nullable=True),
        sa.Column("current_value_label", sa.String(length=120), nullable=True),
        sa.Column("sort_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], [f"{CORE_SCHEMA}.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "achievement_key", name="uq_user_achievements_user_key"),
        schema=CORE_SCHEMA,
    )
    op.create_index(
        "ix_user_achievements_user_section_category",
        "user_achievements",
        ["user_id", "section_key", "category_key"],
        unique=False,
        schema=CORE_SCHEMA,
    )

    op.create_table(
        "user_achievement_record_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("section_key", sa.String(length=40), nullable=False),
        sa.Column("category_key", sa.String(length=40), nullable=False),
        sa.Column("achievement_key", sa.String(length=80), nullable=False),
        sa.Column("achieved_at", sa.DateTime(), nullable=False),
        sa.Column("value_numeric", sa.Float(), nullable=True),
        sa.Column("value_label", sa.String(length=120), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("activity_id", sa.Integer(), nullable=True),
        sa.Column("activity_name", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], [f"{CORE_SCHEMA}.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema=CORE_SCHEMA,
    )
    op.create_index(
        "ix_user_achievement_record_events_user_key_date",
        "user_achievement_record_events",
        ["user_id", "achievement_key", "achieved_at"],
        unique=False,
        schema=CORE_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_user_achievement_record_events_user_key_date",
        table_name="user_achievement_record_events",
        schema=CORE_SCHEMA,
    )
    op.drop_table("user_achievement_record_events", schema=CORE_SCHEMA)

    op.drop_index(
        "ix_user_achievements_user_section_category",
        table_name="user_achievements",
        schema=CORE_SCHEMA,
    )
    op.drop_table("user_achievements", schema=CORE_SCHEMA)
