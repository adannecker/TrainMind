"""Add FIT schema v1 and payload storage.

Revision ID: 20260211_0002
Revises: 20260210_0001
Create Date: 2026-02-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260211_0002"
down_revision: Union[str, Sequence[str], None] = "20260210_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fit_files",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("external_activity_id", sa.String(length=128), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.String(length=500), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=True),
        sa.Column("imported_at", sa.DateTime(), nullable=False),
        sa.Column("parser_version", sa.String(length=50), nullable=True),
        sa.UniqueConstraint("provider", "external_activity_id", name="uq_fit_files_provider_external_activity_id"),
    )
    op.create_index("ix_fit_files_user_imported_at", "fit_files", ["user_id", "imported_at"])

    op.create_table(
        "fit_file_payloads",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fit_file_id", sa.Integer(), sa.ForeignKey("fit_files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("content_size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("compression", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("fit_file_id", name="uq_fit_file_payloads_fit_file_id"),
    )
    op.create_index("ix_fit_file_payloads_content_sha256", "fit_file_payloads", ["content_sha256"])

    op.add_column("activities", sa.Column("source_fit_file_id", sa.Integer(), nullable=True))
    op.add_column("activities", sa.Column("sport", sa.String(length=50), nullable=True))
    op.add_column("activities", sa.Column("distance_m", sa.Float(), nullable=True))
    op.create_foreign_key(
        "fk_activities_source_fit_file_id_fit_files",
        "activities",
        "fit_files",
        ["source_fit_file_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint("uq_activities_provider_external_id", "activities", ["provider", "external_id"])
    op.create_index("ix_activities_user_started_at", "activities", ["user_id", "started_at"])
    op.drop_column("activities", "distance_km")

    op.create_table(
        "activity_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("activity_id", sa.Integer(), sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_index", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=True),
        sa.Column("total_elapsed_time_s", sa.Float(), nullable=True),
        sa.Column("total_timer_time_s", sa.Float(), nullable=True),
        sa.Column("total_distance_m", sa.Float(), nullable=True),
        sa.Column("avg_speed_mps", sa.Float(), nullable=True),
        sa.Column("max_speed_mps", sa.Float(), nullable=True),
        sa.Column("avg_power_w", sa.Float(), nullable=True),
        sa.Column("max_power_w", sa.Float(), nullable=True),
        sa.Column("avg_hr_bpm", sa.Float(), nullable=True),
        sa.Column("max_hr_bpm", sa.Float(), nullable=True),
        sa.UniqueConstraint("activity_id", "session_index", name="uq_activity_sessions_activity_index"),
    )

    op.create_table(
        "activity_laps",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("activity_id", sa.Integer(), sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lap_index", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=True),
        sa.Column("total_elapsed_time_s", sa.Float(), nullable=True),
        sa.Column("total_timer_time_s", sa.Float(), nullable=True),
        sa.Column("total_distance_m", sa.Float(), nullable=True),
        sa.Column("avg_speed_mps", sa.Float(), nullable=True),
        sa.Column("avg_power_w", sa.Float(), nullable=True),
        sa.Column("max_power_w", sa.Float(), nullable=True),
        sa.Column("avg_hr_bpm", sa.Float(), nullable=True),
        sa.Column("max_hr_bpm", sa.Float(), nullable=True),
        sa.UniqueConstraint("activity_id", "lap_index", name="uq_activity_laps_activity_index"),
    )
    op.create_index("ix_activity_laps_activity_start_time", "activity_laps", ["activity_id", "start_time"])

    op.create_table(
        "activity_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("activity_id", sa.Integer(), sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("record_index", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=True),
        sa.Column("elapsed_s", sa.Float(), nullable=True),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("latitude_deg", sa.Float(), nullable=True),
        sa.Column("longitude_deg", sa.Float(), nullable=True),
        sa.Column("altitude_m", sa.Float(), nullable=True),
        sa.Column("speed_mps", sa.Float(), nullable=True),
        sa.Column("heart_rate_bpm", sa.Integer(), nullable=True),
        sa.Column("cadence_rpm", sa.Integer(), nullable=True),
        sa.Column("power_w", sa.Integer(), nullable=True),
        sa.Column("temperature_c", sa.Float(), nullable=True),
        sa.UniqueConstraint("activity_id", "record_index", name="uq_activity_records_activity_index"),
    )
    op.create_index("ix_activity_records_activity_timestamp", "activity_records", ["activity_id", "timestamp"])

    op.create_table(
        "fit_raw_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fit_file_id", sa.Integer(), sa.ForeignKey("fit_files.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("external_activity_id", sa.String(length=128), nullable=True),
        sa.Column("message_type", sa.String(length=64), nullable=False),
        sa.Column("message_index", sa.Integer(), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_fit_raw_messages_provider_external",
        "fit_raw_messages",
        ["provider", "external_activity_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_fit_raw_messages_provider_external", table_name="fit_raw_messages")
    op.drop_table("fit_raw_messages")

    op.drop_index("ix_activity_records_activity_timestamp", table_name="activity_records")
    op.drop_table("activity_records")

    op.drop_index("ix_activity_laps_activity_start_time", table_name="activity_laps")
    op.drop_table("activity_laps")

    op.drop_table("activity_sessions")

    op.add_column("activities", sa.Column("distance_km", sa.Float(), nullable=True))
    op.drop_index("ix_activities_user_started_at", table_name="activities")
    op.drop_constraint("uq_activities_provider_external_id", "activities", type_="unique")
    op.drop_constraint("fk_activities_source_fit_file_id_fit_files", "activities", type_="foreignkey")
    op.drop_column("activities", "distance_m")
    op.drop_column("activities", "sport")
    op.drop_column("activities", "source_fit_file_id")

    op.drop_index("ix_fit_file_payloads_content_sha256", table_name="fit_file_payloads")
    op.drop_table("fit_file_payloads")

    op.drop_index("ix_fit_files_user_imported_at", table_name="fit_files")
    op.drop_table("fit_files")
