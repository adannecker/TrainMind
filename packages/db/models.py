from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from packages.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    food_entries: Mapped[list["FoodEntry"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    activities: Mapped[list["Activity"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    fit_files: Mapped[list["FitFile"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class FitFile(Base):
    __tablename__ = "fit_files"
    __table_args__ = (
        UniqueConstraint("provider", "external_activity_id", name="uq_fit_files_provider_external_activity_id"),
        Index("ix_fit_files_user_imported_at", "user_id", "imported_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    external_activity_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    parser_version: Mapped[str | None] = mapped_column(String(50), nullable=True)

    user: Mapped[User] = relationship(back_populates="fit_files")
    activities: Mapped[list["Activity"]] = relationship(back_populates="fit_file")


class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_activities_provider_external_id"),
        Index("ix_activities_user_started_at", "user_id", "started_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source_fit_file_id: Mapped[int | None] = mapped_column(ForeignKey("fit_files.id", ondelete="SET NULL"), nullable=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sport: Mapped[str | None] = mapped_column(String(50), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_power_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_hr_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="activities")
    fit_file: Mapped[FitFile | None] = relationship(back_populates="activities")
    sessions: Mapped[list["ActivitySession"]] = relationship(back_populates="activity", cascade="all, delete-orphan")
    laps: Mapped[list["ActivityLap"]] = relationship(back_populates="activity", cascade="all, delete-orphan")
    records: Mapped[list["ActivityRecord"]] = relationship(back_populates="activity", cascade="all, delete-orphan")


class ActivitySession(Base):
    __tablename__ = "activity_sessions"
    __table_args__ = (
        UniqueConstraint("activity_id", "session_index", name="uq_activity_sessions_activity_index"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    session_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    start_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_elapsed_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_timer_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_power_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_power_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_hr_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_hr_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)

    activity: Mapped[Activity] = relationship(back_populates="sessions")


class ActivityLap(Base):
    __tablename__ = "activity_laps"
    __table_args__ = (
        UniqueConstraint("activity_id", "lap_index", name="uq_activity_laps_activity_index"),
        Index("ix_activity_laps_activity_start_time", "activity_id", "start_time"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    lap_index: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_elapsed_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_timer_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_power_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_power_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_hr_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_hr_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)

    activity: Mapped[Activity] = relationship(back_populates="laps")


class ActivityRecord(Base):
    __tablename__ = "activity_records"
    __table_args__ = (
        UniqueConstraint("activity_id", "record_index", name="uq_activity_records_activity_index"),
        Index("ix_activity_records_activity_timestamp", "activity_id", "timestamp"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    record_index: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    elapsed_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    latitude_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    altitude_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    heart_rate_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cadence_rpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    power_w: Mapped[int | None] = mapped_column(Integer, nullable=True)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)

    activity: Mapped[Activity] = relationship(back_populates="records")


class FitRawMessage(Base):
    __tablename__ = "fit_raw_messages"
    __table_args__ = (
        Index("ix_fit_raw_messages_provider_external", "provider", "external_activity_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fit_file_id: Mapped[int | None] = mapped_column(ForeignKey("fit_files.id", ondelete="SET NULL"), nullable=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    external_activity_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    message_type: Mapped[str] = mapped_column(String(64), nullable=False)
    message_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class FoodEntry(Base):
    __tablename__ = "food_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    eaten_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    meal_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    calories_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="food_entries")
