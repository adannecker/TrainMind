from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from packages.db.base import Base
from packages.db.schemas import CORE_SCHEMA, GARMIN_SCHEMA, NUTRITION_SCHEMA


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": CORE_SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    service_credentials: Mapped[list["ServiceCredential"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    nutrition_food_items: Mapped[list["NutritionFoodItem"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    nutrition_food_item_overrides: Mapped[list["NutritionFoodItemOverride"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    nutrition_meal_entries: Mapped[list["NutritionMealEntry"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    nutrition_sync_events: Mapped[list["NutritionSyncEvent"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    nutrition_recipes: Mapped[list["NutritionRecipe"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    food_entries: Mapped[list["FoodEntry"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    activities: Mapped[list["Activity"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    fit_files: Mapped[list["FitFile"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    profile: Mapped["UserProfile | None"] = relationship(
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    weight_logs: Mapped[list["UserWeightLog"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    training_metrics: Mapped[list["UserTrainingMetric"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    training_zone_settings: Mapped[list["UserTrainingZoneSetting"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    achievements: Mapped[list["UserAchievement"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    achievement_record_events: Mapped[list["UserAchievementRecordEvent"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    invite_tokens: Mapped[list["UserInviteToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    llm_usage_events: Mapped[list["LlmUsageEvent"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class ServiceCredential(Base):
    __tablename__ = "service_credentials"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_service_credentials_user_provider"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    username_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    password_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="service_credentials")


class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


class UserInviteToken(Base):
    __tablename__ = "user_invite_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_user_invite_tokens_token_hash"),
        Index("ix_user_invite_tokens_user_expires", "user_id", "expires_at"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="invite_tokens")


class UserProfile(Base):
    __tablename__ = "user_profiles"
    __table_args__ = {"schema": CORE_SCHEMA}

    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), primary_key=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    current_weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    goal_start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    goal_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    weekly_target_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    weekly_target_stress: Mapped[float | None] = mapped_column(Float, nullable=True)
    nav_group_order_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    training_config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    training_plan_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="profile")


class UserWeightLog(Base):
    __tablename__ = "user_weight_logs"
    __table_args__ = (
        Index("ix_user_weight_logs_user_recorded", "user_id", "recorded_at"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), default="manual", nullable=False)
    source_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="weight_logs")


class UserTrainingMetric(Base):
    __tablename__ = "user_training_metrics"
    __table_args__ = (
        Index("ix_user_training_metrics_user_metric_recorded", "user_id", "metric_type", "recorded_at"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    metric_type: Mapped[str] = mapped_column(String(24), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(120), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="training_metrics")


class UserTrainingZoneSetting(Base):
    __tablename__ = "user_training_zone_settings"
    __table_args__ = (
        UniqueConstraint("user_id", "metric_type", name="uq_user_training_zone_settings_user_metric"),
        Index("ix_user_training_zone_settings_user_metric", "user_id", "metric_type"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    metric_type: Mapped[str] = mapped_column(String(24), nullable=False)
    model_key: Mapped[str] = mapped_column(String(60), nullable=False)
    config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="training_zone_settings")


class UserAchievement(Base):
    __tablename__ = "user_achievements"
    __table_args__ = (
        UniqueConstraint("user_id", "achievement_key", name="uq_user_achievements_user_key"),
        Index("ix_user_achievements_user_section_category", "user_id", "section_key", "category_key"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    section_key: Mapped[str] = mapped_column(String(40), nullable=False)
    category_key: Mapped[str] = mapped_column(String(40), nullable=False)
    achievement_key: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    icon: Mapped[str] = mapped_column(String(24), nullable=False)
    accent: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    achieved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    activity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    activity_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    current_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_value_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sort_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="achievements")


class UserAchievementRecordEvent(Base):
    __tablename__ = "user_achievement_record_events"
    __table_args__ = (
        Index("ix_user_achievement_record_events_user_key_date", "user_id", "achievement_key", "achieved_at"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    section_key: Mapped[str] = mapped_column(String(40), nullable=False)
    category_key: Mapped[str] = mapped_column(String(40), nullable=False)
    achievement_key: Mapped[str] = mapped_column(String(80), nullable=False)
    achieved_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    value_numeric: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    activity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    activity_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="achievement_record_events")


class LlmUsageEvent(Base):
    __tablename__ = "llm_usage_events"
    __table_args__ = (
        Index("ix_llm_usage_events_user_created", "user_id", "created_at"),
        Index("ix_llm_usage_events_user_feature_created", "user_id", "feature_key", "created_at"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    feature_key: Mapped[str] = mapped_column(String(80), nullable=False)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    request_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="llm_usage_events")


class FitFile(Base):
    __tablename__ = "fit_files"
    __table_args__ = (
        UniqueConstraint("provider", "external_activity_id", name="uq_fit_files_provider_external_activity_id"),
        Index("ix_fit_files_user_imported_at", "user_id", "imported_at"),
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    external_activity_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    parser_version: Mapped[str | None] = mapped_column(String(50), nullable=True)

    user: Mapped[User] = relationship(back_populates="fit_files")
    activities: Mapped[list["Activity"]] = relationship(back_populates="fit_file")
    payload: Mapped["FitFilePayload | None"] = relationship(
        back_populates="fit_file",
        uselist=False,
        cascade="all, delete-orphan",
    )


class FitFilePayload(Base):
    __tablename__ = "fit_file_payloads"
    __table_args__ = (
        UniqueConstraint("fit_file_id", name="uq_fit_file_payloads_fit_file_id"),
        Index("ix_fit_file_payloads_content_sha256", "content_sha256"),
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fit_file_id: Mapped[int] = mapped_column(
        ForeignKey(f"{GARMIN_SCHEMA}.fit_files.id", ondelete="CASCADE"),
        nullable=False,
    )
    content: Mapped[bytes] = mapped_column(nullable=False)
    content_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    compression: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    fit_file: Mapped[FitFile] = relationship(back_populates="payload")


class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_activities_provider_external_id"),
        Index("ix_activities_user_started_at", "user_id", "started_at"),
        Index("ix_activities_user_achievement_check", "user_id", "achievements_check_version", "started_at"),
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    source_fit_file_id: Mapped[int | None] = mapped_column(
        ForeignKey(f"{GARMIN_SCHEMA}.fit_files.id", ondelete="SET NULL"),
        nullable=True,
    )
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
    achievements_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    achievements_check_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    achievements_summary_json: Mapped[str | None] = mapped_column(Text, nullable=True)
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
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey(f"{GARMIN_SCHEMA}.activities.id", ondelete="CASCADE"), nullable=False)
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
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey(f"{GARMIN_SCHEMA}.activities.id", ondelete="CASCADE"), nullable=False)
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
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey(f"{GARMIN_SCHEMA}.activities.id", ondelete="CASCADE"), nullable=False)
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


class ActivityHfAnalysis(Base):
    __tablename__ = "activity_hf_analysis"
    __table_args__ = (
        UniqueConstraint("activity_id", "window_key", "bucket_start_w", name="uq_activity_hf_analysis_activity_window_bucket"),
        Index("ix_activity_hf_analysis_user_window_bucket_date", "user_id", "window_key", "bucket_start_w", "activity_date"),
        Index("ix_activity_hf_analysis_activity_window", "activity_id", "window_key"),
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    activity_id: Mapped[int] = mapped_column(ForeignKey(f"{GARMIN_SCHEMA}.activities.id", ondelete="CASCADE"), nullable=False)
    activity_date: Mapped[date] = mapped_column(Date, nullable=False)
    window_key: Mapped[str] = mapped_column(String(12), nullable=False)
    window_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    bucket_start_w: Mapped[int] = mapped_column(Integer, nullable=False)
    bucket_end_w: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_hr_bpm: Mapped[float] = mapped_column(Float, nullable=False)
    avg_power_w: Mapped[float] = mapped_column(Float, nullable=False)
    activity_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ActivityLlmAnalysisCache(Base):
    __tablename__ = "activity_llm_analysis_cache"
    __table_args__ = (
        UniqueConstraint("activity_id", name="uq_activity_llm_analysis_cache_activity"),
        Index("ix_activity_llm_analysis_cache_user_activity", "user_id", "activity_id"),
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    activity_id: Mapped[int] = mapped_column(ForeignKey(f"{GARMIN_SCHEMA}.activities.id", ondelete="CASCADE"), nullable=False)
    activity_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    analysis_version: Mapped[int] = mapped_column(Integer, nullable=False)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    context_snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    analysis_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ActivityClimbCompare(Base):
    __tablename__ = "activity_climb_compares"
    __table_args__ = (
        Index("ix_activity_climb_compares_user_created", "user_id", "created_at"),
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    search_tolerance_m: Mapped[float] = mapped_column(Float, default=50.0, nullable=False)
    start_latitude_deg: Mapped[float] = mapped_column(Float, nullable=False)
    start_longitude_deg: Mapped[float] = mapped_column(Float, nullable=False)
    via_latitude_deg: Mapped[float] = mapped_column(Float, nullable=False)
    via_longitude_deg: Mapped[float] = mapped_column(Float, nullable=False)
    end_latitude_deg: Mapped[float] = mapped_column(Float, nullable=False)
    end_longitude_deg: Mapped[float] = mapped_column(Float, nullable=False)
    representative_activity_id: Mapped[int | None] = mapped_column(
        ForeignKey(f"{GARMIN_SCHEMA}.activities.id", ondelete="SET NULL"),
        nullable=True,
    )
    representative_activity_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    representative_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    representative_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    representative_ascent_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    representative_descent_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    route_points_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_points_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    search_matches_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_search_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_search_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_search_activity_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_search_checked_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_search_matched_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_search_algorithm_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class FitRawMessage(Base):
    __tablename__ = "fit_raw_messages"
    __table_args__ = (
        Index("ix_fit_raw_messages_provider_external", "provider", "external_activity_id"),
        {"schema": GARMIN_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fit_file_id: Mapped[int | None] = mapped_column(
        ForeignKey(f"{GARMIN_SCHEMA}.fit_files.id", ondelete="SET NULL"),
        nullable=True,
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    external_activity_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    message_type: Mapped[str] = mapped_column(String(64), nullable=False)
    message_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class FoodEntry(Base):
    __tablename__ = "food_entries"
    __table_args__ = {"schema": NUTRITION_SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    eaten_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    meal_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    calories_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="food_entries")


class NutritionFoodItem(Base):
    __tablename__ = "food_items"
    __table_args__ = (
        Index("ix_food_items_user_updated", "user_id", "updated_at"),
        Index("ix_food_items_user_barcode", "user_id", "barcode"),
        {"schema": NUTRITION_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(180), nullable=True)
    name_de: Mapped[str | None] = mapped_column(String(180), nullable=True)
    item_kind: Mapped[str] = mapped_column(String(20), default="base_ingredient", nullable=False)
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(160), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    origin_type: Mapped[str] = mapped_column(String(32), default="user_self", nullable=False)
    trust_level: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)
    verification_status: Mapped[str] = mapped_column(String(24), default="unverified", nullable=False)
    usda_status: Mapped[str] = mapped_column(String(20), default="unknown", nullable=False)
    health_indicator: Mapped[str] = mapped_column(String(24), default="neutral", nullable=False)
    source_label: Mapped[str | None] = mapped_column(String(180), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    kcal_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugar_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    starch_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    saturated_fat_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    monounsaturated_fat_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    polyunsaturated_fat_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_mg_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    potassium_mg_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User | None] = relationship(back_populates="nutrition_food_items")
    meal_items: Mapped[list["NutritionMealEntryItem"]] = relationship(back_populates="food_item")
    overrides: Mapped[list["NutritionFoodItemOverride"]] = relationship(
        back_populates="food_item",
        cascade="all, delete-orphan",
    )
    sources: Mapped[list["NutritionFoodItemSource"]] = relationship(
        back_populates="food_item",
        cascade="all, delete-orphan",
    )


class NutritionFoodItemOverride(Base):
    __tablename__ = "food_item_overrides"
    __table_args__ = (
        Index("ix_food_item_overrides_user_item_updated", "user_id", "food_item_id", "updated_at"),
        {"schema": NUTRITION_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    food_item_id: Mapped[str] = mapped_column(
        ForeignKey(f"{NUTRITION_SCHEMA}.food_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_kind: Mapped[str | None] = mapped_column(String(20), nullable=True)
    name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    name_en: Mapped[str | None] = mapped_column(String(180), nullable=True)
    name_de: Mapped[str | None] = mapped_column(String(180), nullable=True)
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(160), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kcal_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugar_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    starch_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    saturated_fat_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    monounsaturated_fat_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    polyunsaturated_fat_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_mg_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    potassium_mg_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="nutrition_food_item_overrides")
    food_item: Mapped["NutritionFoodItem"] = relationship(back_populates="overrides")


class NutritionFoodItemSource(Base):
    __tablename__ = "food_item_sources"
    __table_args__ = (
        Index("ix_food_item_sources_food_item_id", "food_item_id"),
        {"schema": NUTRITION_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    food_item_id: Mapped[str] = mapped_column(
        ForeignKey(f"{NUTRITION_SCHEMA}.food_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    citation_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_primary: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    food_item: Mapped["NutritionFoodItem"] = relationship(back_populates="sources")


class NutritionMealEntry(Base):
    __tablename__ = "meal_entries"
    __table_args__ = (
        Index("ix_meal_entries_user_consumed", "user_id", "consumed_at"),
        Index("ix_meal_entries_user_updated", "user_id", "updated_at"),
        {"schema": NUTRITION_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    consumed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    meal_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(30), default="manual", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="nutrition_meal_entries")
    items: Mapped[list["NutritionMealEntryItem"]] = relationship(
        back_populates="meal_entry",
        cascade="all, delete-orphan",
    )


class NutritionMealEntryItem(Base):
    __tablename__ = "meal_entry_items"
    __table_args__ = (
        Index("ix_meal_entry_items_entry_updated", "meal_entry_id", "updated_at"),
        {"schema": NUTRITION_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    meal_entry_id: Mapped[str] = mapped_column(
        ForeignKey(f"{NUTRITION_SCHEMA}.meal_entries.id", ondelete="CASCADE"),
        nullable=False,
    )
    food_item_id: Mapped[str | None] = mapped_column(
        ForeignKey(f"{NUTRITION_SCHEMA}.food_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_recipe_id: Mapped[str | None] = mapped_column(
        ForeignKey(f"{NUTRITION_SCHEMA}.recipes.id", ondelete="SET NULL"),
        nullable=True,
    )
    custom_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    amount_g: Mapped[float] = mapped_column(Float, nullable=False)
    kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    meal_entry: Mapped[NutritionMealEntry] = relationship(back_populates="items")
    food_item: Mapped["NutritionFoodItem | None"] = relationship(back_populates="meal_items")
    source_recipe: Mapped["NutritionRecipe | None"] = relationship(back_populates="meal_items")


class NutritionRecipe(Base):
    __tablename__ = "recipes"
    __table_args__ = (
        Index("ix_recipes_user_updated", "user_id", "updated_at"),
        {"schema": NUTRITION_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    preparation: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[str] = mapped_column(String(20), default="private", nullable=False)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="nutrition_recipes")
    items: Mapped[list["NutritionRecipeItem"]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
    )
    meal_items: Mapped[list["NutritionMealEntryItem"]] = relationship(back_populates="source_recipe")


class NutritionRecipeItem(Base):
    __tablename__ = "recipe_items"
    __table_args__ = (
        Index("ix_recipe_items_recipe_updated", "recipe_id", "updated_at"),
        {"schema": NUTRITION_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    recipe_id: Mapped[str] = mapped_column(
        ForeignKey(f"{NUTRITION_SCHEMA}.recipes.id", ondelete="CASCADE"),
        nullable=False,
    )
    food_item_id: Mapped[str] = mapped_column(
        ForeignKey(f"{NUTRITION_SCHEMA}.food_items.id", ondelete="RESTRICT"),
        nullable=False,
    )
    amount_g: Mapped[float] = mapped_column(Float, nullable=False)
    sort_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    recipe: Mapped["NutritionRecipe"] = relationship(back_populates="items")
    food_item: Mapped["NutritionFoodItem"] = relationship()


class NutritionSyncEvent(Base):
    __tablename__ = "sync_events"
    __table_args__ = (
        Index("ix_sync_events_user_updated", "user_id", "updated_at"),
        {"schema": NUTRITION_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    op: Mapped[str] = mapped_column(String(20), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="nutrition_sync_events")
