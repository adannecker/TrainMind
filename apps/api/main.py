from __future__ import annotations

import json
import os

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from apps.api.achievement_service import get_achievement_section
from apps.api.activity_service import (
    delete_activity,
    get_available_activity_weeks,
    get_activity_detail,
    list_activities,
    get_weekly_activities,
    rebuild_historical_max_hr_from_activities,
)
from apps.api.auth_service import get_current_user_from_token, login_user, logout_user
from apps.api.credential_service import get_service_credentials_status, set_service_credentials
from apps.api.garmin_service import (
    get_imported_garmin_summary,
    get_missing_garmin_rides,
    get_missing_garmin_rides_for_period,
    import_selected_garmin_rides,
    reset_imported_garmin_data,
)
from apps.api.nutrition_service import (
    build_food_item_llm_prompt,
    create_entry,
    create_entry_from_recipe,
    create_food_item,
    create_recipe,
    get_food_item,
    delete_recipe,
    delete_entry,
    get_food_item_category_counts,
    import_food_item_from_llm,
    list_entries,
    list_food_items,
    list_recipes,
    run_sync,
    update_entry,
    update_food_item,
    update_recipe,
)
from apps.api.profile_service import add_weight_log, get_user_profile, list_weight_logs, upsert_user_profile
from apps.api.training_service import (
    create_training_metric,
    delete_training_metric,
    list_training_metrics,
    update_training_metric,
    upsert_training_zone_setting,
)
from packages.fit.fit_fix_service import FitFixError, apply_power_adjustments, inspect_fit_file, normalize_adjustments

app = FastAPI(title="TrainMind API", version="0.1.0")
bearer_scheme = HTTPBearer(auto_error=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "trainmind-api", "status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> dict:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing or invalid bearer token.")
    try:
        return get_current_user_from_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class UserProfileUpdateRequest(BaseModel):
    display_name: str | None = None
    date_of_birth: str | None = None
    gender: str | None = None
    current_weight_kg: float | None = None
    target_weight_kg: float | None = None
    start_weight_kg: float | None = None
    goal_start_date: str | None = None
    goal_end_date: str | None = None
    nav_group_order: list[str] | None = None


class WeightLogCreateRequest(BaseModel):
    recorded_at: str | None = None
    weight_kg: float
    source_type: str | None = "manual"
    source_label: str | None = None
    notes: str | None = None


@app.post("/auth/login")
def auth_login(payload: AuthLoginRequest) -> dict:
    try:
        return login_user(payload.email, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected auth error: {exc}") from exc


@app.post("/auth/logout")
def auth_logout(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> dict[str, str]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        return {"status": "ok"}
    try:
        logout_user(credentials.credentials)
    except Exception:
        pass
    return {"status": "ok"}


@app.get("/auth/me")
def auth_me(current_user: dict = Depends(get_current_user)) -> dict:
    return current_user


@app.get("/profile")
def profile_get(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_user_profile(user_id=int(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected profile error: {exc}") from exc


@app.patch("/profile")
def profile_update(payload: UserProfileUpdateRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return upsert_user_profile(user_id=int(current_user["id"]), payload=payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected profile error: {exc}") from exc


@app.get("/llm/status")
def llm_status(current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    return {
        "provider": "openai",
        "configured": bool(api_key),
        "key_hint": f"...{api_key[-6:]}" if len(api_key) >= 6 else None,
    }


@app.get("/profile/weight-logs")
def profile_weight_logs(
    limit: int = Query(default=100, ge=1, le=500),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return list_weight_logs(user_id=int(current_user["id"]), limit=limit, from_iso=from_, to_iso=to)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected profile error: {exc}") from exc


@app.post("/profile/weight-logs")
def profile_add_weight_log(payload: WeightLogCreateRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return add_weight_log(user_id=int(current_user["id"]), payload=payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected profile error: {exc}") from exc


@app.get("/garmin/new-rides")
def garmin_new_rides(limit: int = Query(default=50, ge=1, le=200), current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_missing_garmin_rides(user_id=int(current_user["id"]), limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin error: {exc}") from exc


@app.get("/garmin/month-rides")
def garmin_month_rides(
    start_year: int = Query(..., ge=2000, le=2100),
    start_month: int = Query(..., ge=1, le=12),
    end_year: int = Query(..., ge=2000, le=2100),
    end_month: int = Query(..., ge=1, le=12),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return get_missing_garmin_rides_for_period(
            user_id=int(current_user["id"]),
            start_year=start_year,
            start_month=start_month,
            end_year=end_year,
            end_month=end_month,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin error: {exc}") from exc


@app.get("/garmin/imported-summary")
def garmin_imported_summary(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_imported_garmin_summary(user_id=int(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin error: {exc}") from exc


class GarminImportRequest(BaseModel):
    activity_ids: list[str]


class GarminCredentialsRequest(BaseModel):
    email: str
    password: str


class GarminResetRequest(BaseModel):
    delete_derived_metrics: bool = False


class ActivityHistoricalRecheckRequest(BaseModel):
    rebuild_max_hr: bool = True


class NutritionEntryItemRequest(BaseModel):
    id: str | None = None
    food_item_id: str | None = None
    source_recipe_id: str | None = None
    custom_name: str | None = None
    amount_g: float
    kcal: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None


class NutritionEntryCreateRequest(BaseModel):
    id: str | None = None
    consumed_at: str
    meal_type: str | None = None
    notes: str | None = None
    source: str | None = "manual"
    items: list[NutritionEntryItemRequest] = Field(default_factory=list)


class NutritionEntryUpdateRequest(BaseModel):
    consumed_at: str | None = None
    meal_type: str | None = None
    notes: str | None = None
    source: str | None = None
    items: list[NutritionEntryItemRequest] | None = None


class NutritionSyncChangeRequest(BaseModel):
    entity_type: str
    entity_id: str | None = None
    op: str
    payload: dict = Field(default_factory=dict)


class NutritionSyncRequest(BaseModel):
    last_sync_at: str | None = None
    changes: list[NutritionSyncChangeRequest] = Field(default_factory=list)


class NutritionFoodItemCreateRequest(BaseModel):
    id: str | None = None
    name: str
    name_en: str | None = None
    name_de: str | None = None
    scope: str | None = "user"
    item_kind: str | None = "base_ingredient"
    category: str | None = None
    brand: str | None = None
    barcode: str | None = None
    origin_type: str | None = None
    trust_level: str | None = None
    verification_status: str | None = None
    usda_status: str | None = None
    health_indicator: str | None = None
    source_type: str | None = None
    source_label: str | None = None
    source_url: str | None = None
    source_citation: str | None = None
    kcal_per_100g: float | None = None
    protein_per_100g: float | None = None
    carbs_per_100g: float | None = None
    fat_per_100g: float | None = None
    fiber_per_100g: float | None = None
    sugar_per_100g: float | None = None
    starch_per_100g: float | None = None
    saturated_fat_per_100g: float | None = None
    monounsaturated_fat_per_100g: float | None = None
    polyunsaturated_fat_per_100g: float | None = None
    sodium_mg_per_100g: float | None = None
    potassium_mg_per_100g: float | None = None
    details: dict = Field(default_factory=dict)


class NutritionFoodItemUpdateRequest(BaseModel):
    name: str | None = None
    name_en: str | None = None
    name_de: str | None = None
    item_kind: str | None = None
    category: str | None = None
    brand: str | None = None
    barcode: str | None = None
    origin_type: str | None = None
    trust_level: str | None = None
    verification_status: str | None = None
    usda_status: str | None = None
    health_indicator: str | None = None
    source_label: str | None = None
    source_url: str | None = None
    kcal_per_100g: float | None = None
    protein_per_100g: float | None = None
    carbs_per_100g: float | None = None
    fat_per_100g: float | None = None
    fiber_per_100g: float | None = None
    sugar_per_100g: float | None = None
    starch_per_100g: float | None = None
    saturated_fat_per_100g: float | None = None
    monounsaturated_fat_per_100g: float | None = None
    polyunsaturated_fat_per_100g: float | None = None
    sodium_mg_per_100g: float | None = None
    potassium_mg_per_100g: float | None = None
    details: dict | None = None


class NutritionFoodItemPromptRequest(BaseModel):
    name: str
    brand: str | None = None
    category: str | None = None


class NutritionFoodItemImportRequest(BaseModel):
    raw_text: str


class NutritionRecipeItemRequest(BaseModel):
    id: str | None = None
    food_item_id: str
    amount_g: float
    sort_index: int | None = None


class NutritionRecipeCreateRequest(BaseModel):
    id: str | None = None
    name: str
    notes: str | None = None
    preparation: str | None = None
    visibility: str | None = "private"
    is_favorite: bool | None = False
    items: list[NutritionRecipeItemRequest] = Field(default_factory=list)


class NutritionRecipeUpdateRequest(BaseModel):
    name: str | None = None
    notes: str | None = None
    preparation: str | None = None
    visibility: str | None = None
    is_favorite: bool | None = None
    items: list[NutritionRecipeItemRequest] | None = None


class NutritionEntryFromRecipeRequest(BaseModel):
    recipe_id: str
    amount_g: float
    consumed_at: str
    meal_type: str | None = None
    notes: str | None = None


class TrainingMetricCreateRequest(BaseModel):
    metric_type: str
    recorded_at: str | None = None
    value: float
    source: str
    notes: str | None = None


class TrainingMetricUpdateRequest(BaseModel):
    metric_type: str | None = None
    recorded_at: str | None = None
    value: float | None = None
    source: str | None = None
    notes: str | None = None


class TrainingZoneSettingUpdateRequest(BaseModel):
    metric_type: str
    model_key: str
    config: dict | None = None


for request_model in (
    AuthLoginRequest,
    GarminImportRequest,
    GarminCredentialsRequest,
    GarminResetRequest,
    ActivityHistoricalRecheckRequest,
    NutritionEntryItemRequest,
    NutritionEntryCreateRequest,
    NutritionEntryUpdateRequest,
    NutritionSyncChangeRequest,
    NutritionSyncRequest,
    NutritionFoodItemCreateRequest,
    NutritionFoodItemUpdateRequest,
    NutritionFoodItemPromptRequest,
    NutritionFoodItemImportRequest,
    NutritionRecipeItemRequest,
    NutritionRecipeCreateRequest,
    NutritionRecipeUpdateRequest,
    NutritionEntryFromRecipeRequest,
    UserProfileUpdateRequest,
    WeightLogCreateRequest,
    TrainingMetricCreateRequest,
    TrainingMetricUpdateRequest,
    TrainingZoneSettingUpdateRequest,
):
    request_model.model_rebuild()


@app.get("/garmin/credentials-status")
def garmin_credentials_status(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_service_credentials_status("garmin", user_id=int(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected credential error: {exc}") from exc


@app.get("/training/metrics")
def training_metrics_get(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return list_training_metrics(user_id=int(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.post("/training/metrics")
def training_metric_create(payload: TrainingMetricCreateRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return create_training_metric(user_id=int(current_user["id"]), payload=payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.patch("/training/metrics/{metric_id}")
def training_metric_patch(
    metric_id: int,
    payload: TrainingMetricUpdateRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return update_training_metric(user_id=int(current_user["id"]), metric_id=metric_id, payload=payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.delete("/training/metrics/{metric_id}")
def training_metric_delete(metric_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return delete_training_metric(user_id=int(current_user["id"]), metric_id=metric_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.put("/training/zone-settings")
def training_zone_setting_put(payload: TrainingZoneSettingUpdateRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return upsert_training_zone_setting(user_id=int(current_user["id"]), payload=payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.post("/garmin/credentials")
def garmin_credentials_save(payload: GarminCredentialsRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return set_service_credentials("garmin", payload.email, payload.password, user_id=int(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected credential error: {exc}") from exc


@app.post("/garmin/import-rides")
def garmin_import_rides(payload: GarminImportRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return import_selected_garmin_rides(user_id=int(current_user["id"]), activity_ids=payload.activity_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin error: {exc}") from exc


@app.post("/garmin/reset-imported")
def garmin_reset_imported(payload: GarminResetRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return reset_imported_garmin_data(
            user_id=int(current_user["id"]),
            delete_derived_metrics=payload.delete_derived_metrics,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin error: {exc}") from exc


@app.post("/activities/recheck-history")
def activities_recheck_history(
    payload: ActivityHistoricalRecheckRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        result: dict[str, object] = {"status": "ok"}
        if payload.rebuild_max_hr:
            result["max_hr"] = rebuild_historical_max_hr_from_activities(user_id=int(current_user["id"]))
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity recheck error: {exc}") from exc


@app.get("/achievements/{section_key}")
def achievements_section(section_key: str, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_achievement_section(user_id=int(current_user["id"]), section_key=section_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected achievement error: {exc}") from exc


@app.post("/fit-fix/inspect")
async def fit_fix_inspect(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise FitFixError("Bitte eine FIT-Datei auswählen.")
        return inspect_fit_file(file_bytes=file_bytes, filename=file.filename or "uploaded.fit")
    except FitFixError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected FIT error: {exc}") from exc


@app.post("/fit-fix/apply")
async def fit_fix_apply(
    file: UploadFile = File(...),
    adjustments_json: str = Form(...),
    current_user: dict = Depends(get_current_user),
) -> Response:
    _ = current_user
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise FitFixError("Bitte eine FIT-Datei auswählen.")
        raw_adjustments = json.loads(adjustments_json)
        adjustments = normalize_adjustments(raw_adjustments)
        output_bytes, summary = apply_power_adjustments(file_bytes=file_bytes, adjustments=adjustments)

        source_name = (file.filename or "uploaded.fit").strip() or "uploaded.fit"
        if source_name.lower().endswith(".fit"):
            download_name = f"{source_name[:-4]}_power_fixed.fit"
        else:
            download_name = f"{source_name}_power_fixed.fit"

        headers = {
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "X-TrainMind-Changed-Records": str(summary["changed_records"]),
            "X-TrainMind-Avg-Power": str(summary["avg_power"]),
            "X-TrainMind-Max-Power": str(summary["max_power"]),
        }
        return Response(content=output_bytes, media_type="application/octet-stream", headers=headers)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid adjustments JSON: {exc}") from exc
    except FitFixError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected FIT error: {exc}") from exc


@app.get("/activities/week")
def activities_week(
    reference_date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return get_weekly_activities(user_id=int(current_user["id"]), reference_date=reference_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity error: {exc}") from exc


@app.get("/activities/weeks-available")
def activities_weeks_available(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_available_activity_weeks(user_id=int(current_user["id"]))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity error: {exc}") from exc


@app.get("/activities")
def activities_list(
    q: str | None = Query(default=None),
    provider: str | None = Query(default=None),
    sport: str | None = Query(default=None),
    date_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    avg_power_min: float | None = Query(default=None),
    avg_power_max: float | None = Query(default=None),
    avg_hr_min: float | None = Query(default=None),
    avg_hr_max: float | None = Query(default=None),
    avg_speed_min: float | None = Query(default=None),
    avg_speed_max: float | None = Query(default=None),
    distance_min_km: float | None = Query(default=None),
    distance_max_km: float | None = Query(default=None),
    duration_min_min: float | None = Query(default=None),
    duration_max_min: float | None = Query(default=None),
    sort_by: str = Query(default="started_at"),
    sort_dir: str = Query(default="desc", pattern=r"^(asc|desc)$"),
    limit: int = Query(default=250, ge=1, le=1000),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return list_activities(
            user_id=int(current_user["id"]),
            query=q,
            provider=provider,
            sport=sport,
            date_from=date_from,
            date_to=date_to,
            avg_power_min=avg_power_min,
            avg_power_max=avg_power_max,
            avg_hr_min=avg_hr_min,
            avg_hr_max=avg_hr_max,
            avg_speed_min=avg_speed_min,
            avg_speed_max=avg_speed_max,
            distance_min_km=distance_min_km,
            distance_max_km=distance_max_km,
            duration_min_min=duration_min_min,
            duration_max_min=duration_max_min,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity error: {exc}") from exc


@app.delete("/activities/{activity_id}")
def activity_delete(activity_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return delete_activity(user_id=int(current_user["id"]), activity_id=activity_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity error: {exc}") from exc


@app.get("/activities/{activity_id}")
def activity_detail(activity_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_activity_detail(user_id=int(current_user["id"]), activity_id=activity_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity error: {exc}") from exc


@app.post("/nutrition/entries")
def nutrition_create_entry(payload: NutritionEntryCreateRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return create_entry(user_id=int(current_user["id"]), payload=payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.get("/nutrition/entries")
def nutrition_list_entries(
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return list_entries(user_id=int(current_user["id"]), from_iso=from_, to_iso=to)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.patch("/nutrition/entries/{entry_id}")
def nutrition_update_entry(
    entry_id: str,
    payload: NutritionEntryUpdateRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return update_entry(user_id=int(current_user["id"]), entry_id=entry_id, payload=payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.delete("/nutrition/entries/{entry_id}")
def nutrition_delete_entry(entry_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return delete_entry(user_id=int(current_user["id"]), entry_id=entry_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.post("/nutrition/sync")
def nutrition_sync(payload: NutritionSyncRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return run_sync(
            user_id=int(current_user["id"]),
            last_sync_at=payload.last_sync_at,
            changes=[c.model_dump() for c in payload.changes],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.get("/nutrition/food-items")
def nutrition_list_food_items(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    item_kind: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return list_food_items(user_id=int(current_user["id"]), query=q, category=category, item_kind=item_kind, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.get("/nutrition/food-items/category-counts")
def nutrition_food_item_category_counts(
    q: str | None = Query(default=None),
    item_kind: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return get_food_item_category_counts(user_id=int(current_user["id"]), query=q, item_kind=item_kind)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.post("/nutrition/food-items")
def nutrition_create_food_item(payload: NutritionFoodItemCreateRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return create_food_item(user_id=int(current_user["id"]), payload=payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.patch("/nutrition/food-items/{item_id}")
def nutrition_update_food_item(
    item_id: str,
    payload: NutritionFoodItemUpdateRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return update_food_item(user_id=int(current_user["id"]), item_id=item_id, payload=payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.post("/nutrition/food-items/llm-prompt")
def nutrition_food_item_llm_prompt(payload: NutritionFoodItemPromptRequest, current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    try:
        return build_food_item_llm_prompt(name=payload.name, brand=payload.brand, category=payload.category)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.post("/nutrition/food-items/import-llm")
def nutrition_food_item_import_llm(payload: NutritionFoodItemImportRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return import_food_item_from_llm(user_id=int(current_user["id"]), raw_text=payload.raw_text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.get("/nutrition/recipes")
def nutrition_list_recipes(
    q: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return list_recipes(user_id=int(current_user["id"]), query=q)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.post("/nutrition/recipes")
def nutrition_create_recipe(payload: NutritionRecipeCreateRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return create_recipe(user_id=int(current_user["id"]), payload=payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.patch("/nutrition/recipes/{recipe_id}")
def nutrition_update_recipe(
    recipe_id: str,
    payload: NutritionRecipeUpdateRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return update_recipe(user_id=int(current_user["id"]), recipe_id=recipe_id, payload=payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.delete("/nutrition/recipes/{recipe_id}")
def nutrition_delete_recipe(recipe_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return delete_recipe(user_id=int(current_user["id"]), recipe_id=recipe_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.get("/nutrition/food-items/{item_id}")
def nutrition_get_food_item(item_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_food_item(user_id=int(current_user["id"]), item_id=item_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc


@app.post("/nutrition/entries/from-recipe")
def nutrition_create_entry_from_recipe(payload: NutritionEntryFromRecipeRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return create_entry_from_recipe(user_id=int(current_user["id"]), payload=payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected nutrition error: {exc}") from exc
