from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
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
    visibility: Mapped[str] = mapped_column(String(20), default="private", nullable=False)
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
