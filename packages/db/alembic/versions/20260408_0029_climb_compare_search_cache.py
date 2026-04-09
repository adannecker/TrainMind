"""climb compare search cache

Revision ID: 20260408_0029
Revises: 20260406_0028
Create Date: 2026-04-08 18:05:00.000000
"""

from alembic import op
import sqlalchemy as sa

from packages.db.schemas import GARMIN_SCHEMA


revision = "20260408_0029"
down_revision = "20260406_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activity_climb_compares", sa.Column("search_matches_json", sa.Text(), nullable=True), schema=GARMIN_SCHEMA)
    op.add_column("activity_climb_compares", sa.Column("last_search_started_at", sa.DateTime(), nullable=True), schema=GARMIN_SCHEMA)
    op.add_column("activity_climb_compares", sa.Column("last_search_completed_at", sa.DateTime(), nullable=True), schema=GARMIN_SCHEMA)
    op.add_column("activity_climb_compares", sa.Column("last_search_activity_created_at", sa.DateTime(), nullable=True), schema=GARMIN_SCHEMA)
    op.add_column("activity_climb_compares", sa.Column("last_search_checked_total", sa.Integer(), nullable=True), schema=GARMIN_SCHEMA)
    op.add_column("activity_climb_compares", sa.Column("last_search_matched_total", sa.Integer(), nullable=True), schema=GARMIN_SCHEMA)
    op.add_column("activity_climb_compares", sa.Column("last_search_algorithm_version", sa.Integer(), nullable=True), schema=GARMIN_SCHEMA)


def downgrade() -> None:
    op.drop_column("activity_climb_compares", "last_search_algorithm_version", schema=GARMIN_SCHEMA)
    op.drop_column("activity_climb_compares", "last_search_matched_total", schema=GARMIN_SCHEMA)
    op.drop_column("activity_climb_compares", "last_search_checked_total", schema=GARMIN_SCHEMA)
    op.drop_column("activity_climb_compares", "last_search_activity_created_at", schema=GARMIN_SCHEMA)
    op.drop_column("activity_climb_compares", "last_search_completed_at", schema=GARMIN_SCHEMA)
    op.drop_column("activity_climb_compares", "last_search_started_at", schema=GARMIN_SCHEMA)
    op.drop_column("activity_climb_compares", "search_matches_json", schema=GARMIN_SCHEMA)
