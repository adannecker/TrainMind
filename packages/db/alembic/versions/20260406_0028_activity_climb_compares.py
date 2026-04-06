"""activity climb compares

Revision ID: 20260406_0028
Revises: 20260406_0027
Create Date: 2026-04-06 22:20:00.000000
"""

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import CORE_SCHEMA, GARMIN_SCHEMA


revision = "20260406_0028"
down_revision = "20260406_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_climb_compares",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("location_label", sa.String(length=160), nullable=True),
        sa.Column("search_tolerance_m", sa.Float(), nullable=False),
        sa.Column("start_latitude_deg", sa.Float(), nullable=False),
        sa.Column("start_longitude_deg", sa.Float(), nullable=False),
        sa.Column("via_latitude_deg", sa.Float(), nullable=False),
        sa.Column("via_longitude_deg", sa.Float(), nullable=False),
        sa.Column("end_latitude_deg", sa.Float(), nullable=False),
        sa.Column("end_longitude_deg", sa.Float(), nullable=False),
        sa.Column("representative_activity_id", sa.Integer(), nullable=True),
        sa.Column("representative_activity_name", sa.String(length=200), nullable=True),
        sa.Column("representative_started_at", sa.DateTime(), nullable=True),
        sa.Column("representative_distance_m", sa.Float(), nullable=True),
        sa.Column("representative_ascent_m", sa.Float(), nullable=True),
        sa.Column("representative_descent_m", sa.Float(), nullable=True),
        sa.Column("route_points_json", sa.Text(), nullable=True),
        sa.Column("profile_points_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], [f"{CORE_SCHEMA}.users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["representative_activity_id"], [f"{GARMIN_SCHEMA}.activities.id"], ondelete="SET NULL"),
        schema=GARMIN_SCHEMA,
    )
    op.create_index(
        "ix_activity_climb_compares_user_created",
        "activity_climb_compares",
        ["user_id", "created_at"],
        schema=GARMIN_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_activity_climb_compares_user_created", table_name="activity_climb_compares", schema=GARMIN_SCHEMA)
    op.drop_table("activity_climb_compares", schema=GARMIN_SCHEMA)
