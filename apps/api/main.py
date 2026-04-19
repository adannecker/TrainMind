from __future__ import annotations

import json
import os
import threading
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv

from apps.api.achievement_service import ACHIEVEMENT_RECHECK_PASSES, get_achievement_section
from apps.api.activity_service import (
    MAX_HR_RECHECK_PASSES,
    delete_activity,
    derive_activity_llm_analysis,
    get_available_activity_months,
    get_available_activity_weeks,
    get_activity_detail,
    get_activity_achievement_check_status,
    get_monthly_activities,
    list_activities,
    get_weekly_activities,
    rebuild_activity_achievement_checks,
    rebuild_historical_max_hr_from_activities,
)
from apps.api.admin_service import delete_user_as_admin, invite_user_as_admin, list_users
from apps.api.auth_service import get_current_user_from_token, login_user, logout_user, set_password_from_invite
from apps.api.climb_compare_service import (
    DEFAULT_CHECK_RIDES_LIMIT,
    create_climb_compare,
    delete_climb_compare,
    duplicate_climb_compare,
    export_climb_compares,
    find_rides_on_map_point,
    get_climb_compare_brief,
    import_climb_compares,
    list_climb_compares,
    rename_climb_compare,
    trigger_climb_compare_check,
    update_climb_compare,
)
from apps.api.garmin_service import (
    ingest_recent_garmin_rides,
    get_imported_garmin_summary,
    get_missing_garmin_rides,
    get_missing_garmin_rides_for_period,
    get_garmin_session_status,
    import_selected_garmin_rides,
    postprocess_imported_garmin_rides,
    reset_imported_garmin_data,
)
from apps.api.garmin_file_import_service import analyze_fit_dump_zip, analyze_saved_fit_dump_zip, import_fit_dump_zip, list_saved_fit_dump_archives
from apps.api.llm_service import get_llm_status
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
    build_athlete_profile_prompt,
    build_training_config_prompt,
    build_training_plan_prompt,
    create_training_metric,
    delete_training_metric,
    derive_athlete_profile_with_llm,
    derive_training_config_with_llm,
    derive_training_plan_with_llm,
    get_hf_development,
    list_training_metrics,
    rebuild_hf_development_cache,
    update_training_metric,
    upsert_training_zone_setting,
)
from packages.fit.fit_fix_service import FitFixError, apply_power_adjustments, inspect_fit_file, normalize_adjustments

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(dotenv_path=REPO_ROOT / ".env")

def _parse_cors_origins() -> list[str]:
    configured = os.getenv("APP_CORS_ORIGINS", "").strip()
    if configured:
        origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
        if origins:
            return origins
    return [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ]


app = FastAPI(title="TrainMind API", version="0.1.0")
bearer_scheme = HTTPBearer(auto_error=False)
_recheck_jobs_lock = threading.Lock()
_recheck_jobs: dict[int, dict[str, object]] = {}
_recheck_job_conditions: dict[int, threading.Condition] = {}
_recheck_job_queues: dict[int, deque[dict[str, object]]] = {}
_garmin_import_jobs_lock = threading.Lock()
_garmin_import_jobs: dict[int, dict[str, object]] = {}
_garmin_postprocess_jobs_lock = threading.Lock()
_garmin_postprocess_jobs: dict[int, dict[str, object]] = {}
_climb_compare_jobs_lock = threading.Lock()
_climb_compare_jobs: dict[tuple[int, int], dict[str, object]] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
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


def get_admin_user(current_user: dict = Depends(get_current_user)) -> dict:
    if not bool(current_user.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required.")
    return current_user


def _job_timestamp() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _get_recheck_job_condition(user_id: int) -> threading.Condition:
    with _recheck_jobs_lock:
        condition = _recheck_job_conditions.get(user_id)
        if condition is None:
            condition = threading.Condition()
            _recheck_job_conditions[user_id] = condition
        return condition


def _get_recheck_job_queue(user_id: int) -> deque[dict[str, object]]:
    with _recheck_jobs_lock:
        queue = _recheck_job_queues.get(user_id)
        if queue is None:
            queue = deque()
            _recheck_job_queues[user_id] = queue
        return queue


def _compute_recheck_progress(job: dict[str, object]) -> int:
    status = str(job.get("status") or "")
    if status == "completed":
        return 100
    pass_current = int(job.get("pass_current") or job.get("phase_current") or 0)
    pass_total = int(job.get("pass_total") or job.get("phase_total") or 0)
    pass_progress = 0.0 if pass_total <= 0 else min(max(pass_current / pass_total, 0.0), 1.0)
    pass_index = int(job.get("pass_index") or 0)
    pass_count = int(job.get("pass_count") or 0)
    if pass_count <= 0:
        return 0
    completed_passes = max(0, pass_index - 1)
    overall = ((completed_passes + pass_progress) / pass_count) * 100.0
    if status == "running" and overall >= 100.0:
        return 99
    return max(0, min(100, int(round(overall))))


def _snapshot_recheck_job(user_id: int) -> dict[str, object]:
    with _recheck_jobs_lock:
        job = dict(_recheck_jobs.get(user_id) or {})
    if not job:
        return {
            "status": "idle",
            "progress_percent": 0,
            "phase": None,
            "phase_label": None,
            "phase_current": 0,
            "phase_total": 0,
            "pass_index": 0,
            "pass_count": 0,
            "pass_label": None,
            "pass_current": 0,
            "pass_total": 0,
            "version": 0,
            "result": None,
            "error": None,
        }
    job["progress_percent"] = _compute_recheck_progress(job)
    return job


def _store_recheck_job(user_id: int, updates: dict[str, object]) -> dict[str, object]:
    condition = _get_recheck_job_condition(user_id)
    queue = _get_recheck_job_queue(user_id)
    with _recheck_jobs_lock:
        current = dict(_recheck_jobs.get(user_id) or {})
        current.update(updates)
        current["version"] = int(current.get("version") or 0) + 1
        current["progress_percent"] = _compute_recheck_progress(current)
        _recheck_jobs[user_id] = current
        snapshot = dict(current)
        queue.append(snapshot)
    with condition:
        condition.notify_all()
    return snapshot


def _snapshot_garmin_import_job(user_id: int) -> dict[str, object]:
    with _garmin_import_jobs_lock:
        job = dict(_garmin_import_jobs.get(user_id) or {})
    if not job:
        return {
            "status": "idle",
            "progress_percent": 0,
            "phase": None,
            "phase_label": None,
            "phase_current": 0,
            "phase_total": 0,
            "pass_index": 0,
            "pass_count": 0,
            "pass_label": None,
            "pass_current": 0,
            "pass_total": 0,
            "version": 0,
            "result": None,
            "error": None,
            "activity_ids": [],
            "current_activity_name": None,
        }
    job["progress_percent"] = _compute_recheck_progress(job)
    return job


def _store_garmin_import_job(user_id: int, updates: dict[str, object]) -> dict[str, object]:
    with _garmin_import_jobs_lock:
        current = dict(_garmin_import_jobs.get(user_id) or {})
        current.update(updates)
        current["version"] = int(current.get("version") or 0) + 1
        current["progress_percent"] = _compute_recheck_progress(current)
        _garmin_import_jobs[user_id] = current
        return dict(current)


def _run_garmin_import_job(user_id: int, activity_ids: list[str], run_postprocessing: bool) -> None:
    try:
        result = import_selected_garmin_rides(
            user_id=user_id,
            activity_ids=activity_ids,
            run_postprocessing=run_postprocessing,
            progress_callback=lambda current, total, activity_label, step_status: _store_garmin_import_job(
                user_id,
                {
                    "status": "running",
                    "phase": "import",
                    "phase_label": "Rides einlesen",
                    "phase_current": int(current),
                    "phase_total": int(total),
                    "pass_index": 1,
                    "pass_count": 1,
                    "pass_label": f"Einlesen ({step_status})",
                    "pass_current": int(current),
                    "pass_total": int(total),
                    "current_activity_name": activity_label,
                    "updated_at": _job_timestamp(),
                },
            ),
        )
        snapshot = _snapshot_garmin_import_job(user_id)
        _store_garmin_import_job(
            user_id,
            {
                "status": "completed",
                "phase_current": int(snapshot.get("phase_total") or 0),
                "pass_index": 1,
                "pass_count": 1,
                "pass_current": int(snapshot.get("pass_total") or 0),
                "pass_total": int(snapshot.get("pass_total") or 0),
                "current_activity_name": None,
                "updated_at": _job_timestamp(),
                "finished_at": _job_timestamp(),
                "result": result,
                "message": "Garmin-Import erfolgreich abgeschlossen.",
                "error": None,
            },
        )
    except Exception as exc:
        _store_garmin_import_job(
            user_id,
            {
                "status": "error",
                "updated_at": _job_timestamp(),
                "finished_at": _job_timestamp(),
                "error": str(exc),
            },
        )


def _snapshot_garmin_postprocess_job(user_id: int) -> dict[str, object]:
    with _garmin_postprocess_jobs_lock:
        job = dict(_garmin_postprocess_jobs.get(user_id) or {})
    if not job:
        return {
            "status": "idle",
            "progress_percent": 0,
            "phase": None,
            "phase_label": None,
            "phase_current": 0,
            "phase_total": 0,
            "pass_index": 0,
            "pass_count": 0,
            "pass_label": None,
            "pass_current": 0,
            "pass_total": 0,
            "version": 0,
            "result": None,
            "error": None,
            "activity_ids": [],
        }
    job["progress_percent"] = _compute_recheck_progress(job)
    return job


def _store_garmin_postprocess_job(user_id: int, updates: dict[str, object]) -> dict[str, object]:
    with _garmin_postprocess_jobs_lock:
        current = dict(_garmin_postprocess_jobs.get(user_id) or {})
        current.update(updates)
        current["version"] = int(current.get("version") or 0) + 1
        current["progress_percent"] = _compute_recheck_progress(current)
        _garmin_postprocess_jobs[user_id] = current
        return dict(current)


def _run_garmin_postprocess_job(user_id: int, activity_ids: list[str]) -> None:
    try:
        result = postprocess_imported_garmin_rides(
            user_id=user_id,
            activity_ids=activity_ids,
            progress_callback=lambda pass_label, pass_index, pass_count, current, total, phase, phase_label: _store_garmin_postprocess_job(
                user_id,
                {
                    "status": "running",
                    "phase": phase,
                    "phase_label": phase_label,
                    "phase_current": int(current),
                    "phase_total": int(total),
                    "pass_index": int(pass_index),
                    "pass_count": int(pass_count),
                    "pass_label": pass_label,
                    "pass_current": int(current),
                    "pass_total": int(total),
                    "updated_at": _job_timestamp(),
                },
            ),
        )
        snapshot = _snapshot_garmin_postprocess_job(user_id)
        _store_garmin_postprocess_job(
            user_id,
            {
                "status": "completed",
                "phase_current": int(snapshot.get("phase_total") or 0),
                "pass_index": int(snapshot.get("pass_count") or 0),
                "pass_count": int(snapshot.get("pass_count") or 0),
                "pass_current": int(snapshot.get("pass_total") or 0),
                "pass_total": int(snapshot.get("pass_total") or 0),
                "updated_at": _job_timestamp(),
                "finished_at": _job_timestamp(),
                "result": result,
                "message": "Garmin-Nachbereitung erfolgreich abgeschlossen.",
                "error": None,
            },
        )
    except Exception as exc:
        _store_garmin_postprocess_job(
            user_id,
            {
                "status": "error",
                "updated_at": _job_timestamp(),
                "finished_at": _job_timestamp(),
                "error": str(exc),
            },
        )


def _climb_compare_job_key(user_id: int, compare_id: int) -> tuple[int, int]:
    return (int(user_id), int(compare_id))


def _compute_climb_compare_progress(job: dict[str, object]) -> int:
    if str(job.get("status") or "") == "completed":
        return 100
    checked_current = int(job.get("checked_current") or 0)
    checked_total = int(job.get("checked_total") or 0)
    if checked_total <= 0:
        return 0
    progress = (checked_current / checked_total) * 100.0
    return max(0, min(100, int(round(progress))))


def _snapshot_climb_compare_job(user_id: int, compare_id: int) -> dict[str, object]:
    with _climb_compare_jobs_lock:
        job = dict(_climb_compare_jobs.get(_climb_compare_job_key(user_id, compare_id)) or {})
    if not job:
        return {
            "status": "idle",
            "compare_id": compare_id,
            "compare_name": None,
            "checked_current": 0,
            "checked_total": 0,
            "current_activity_name": None,
            "progress_percent": 0,
            "version": 0,
            "result": None,
            "error": None,
        }
    job["progress_percent"] = _compute_climb_compare_progress(job)
    return job


def _store_climb_compare_job(user_id: int, compare_id: int, updates: dict[str, object]) -> dict[str, object]:
    job_key = _climb_compare_job_key(user_id, compare_id)
    with _climb_compare_jobs_lock:
        current = dict(_climb_compare_jobs.get(job_key) or {})
        current.update(updates)
        current["version"] = int(current.get("version") or 0) + 1
        current["progress_percent"] = _compute_climb_compare_progress(current)
        _climb_compare_jobs[job_key] = current
        return dict(current)


def _run_climb_compare_job(user_id: int, compare_id: int, scope: str) -> None:
    try:
        result = trigger_climb_compare_check(
            user_id=user_id,
            compare_id=compare_id,
            limit=DEFAULT_CHECK_RIDES_LIMIT,
            full_refresh=scope == "all",
            progress_callback=lambda current, total, activity_name: _store_climb_compare_job(
                user_id,
                compare_id,
                {
                    "status": "running",
                    "checked_current": current,
                    "checked_total": total,
                    "current_activity_name": activity_name,
                    "updated_at": _job_timestamp(),
                },
            ),
        )
        _store_climb_compare_job(
            user_id,
            compare_id,
            {
                "status": "completed",
                "checked_current": int(result.get("checked_total") or 0),
                "checked_total": int(result.get("checked_total") or 0),
                "current_activity_name": None,
                "updated_at": _job_timestamp(),
                "finished_at": _job_timestamp(),
                "scope": scope,
                "result": result,
                "error": None,
                "message": result.get("message"),
            },
        )
    except Exception as exc:
        _store_climb_compare_job(
            user_id,
            compare_id,
            {
                "status": "error",
                "updated_at": _job_timestamp(),
                "finished_at": _job_timestamp(),
                "error": str(exc),
                "current_activity_name": None,
            },
        )


def _run_recheck_job(user_id: int, rebuild_max_hr: bool, rebuild_achievements: bool) -> None:
    try:
        result: dict[str, object] = {"status": "ok"}
        total_activities = int(get_activity_achievement_check_status(user_id=user_id).get("total_activities") or 0)
        total_passes = (MAX_HR_RECHECK_PASSES if rebuild_max_hr else 0) + (ACHIEVEMENT_RECHECK_PASSES if rebuild_achievements else 0) + 1
        pass_offset = 0

        def _progress_update(global_pass_index: int, pass_label: str, current: int, total: int, phase: str, phase_label: str) -> None:
            _store_recheck_job(
                user_id,
                {
                    "status": "running",
                    "phase": phase,
                    "phase_label": phase_label,
                    "phase_current": current,
                    "phase_total": total,
                    "pass_index": global_pass_index,
                    "pass_count": total_passes,
                    "pass_label": pass_label,
                    "pass_current": current,
                    "pass_total": total,
                    "updated_at": _job_timestamp(),
                },
            )

        if rebuild_max_hr:
            _progress_update(pass_offset + 1, "Auslesen", 0, 5, "max_hr", "MaxHF-Verlauf")
            result["max_hr"] = rebuild_historical_max_hr_from_activities(
                user_id=user_id,
                progress_callback=lambda pass_label, pass_index, pass_count, current, total: _progress_update(
                    pass_offset + pass_index,
                    pass_label,
                    current,
                    total,
                    "max_hr",
                    "MaxHF-Verlauf",
                ),
            )
            pass_offset += MAX_HR_RECHECK_PASSES

        if rebuild_achievements:
            _progress_update(pass_offset + 1, "Distanz und Wochen", 0, total_activities, "achievements", "Achievement-Checks")
            result["achievements"] = rebuild_activity_achievement_checks(
                user_id=user_id,
                progress_callback=lambda pass_label, pass_index, pass_count, current, total: _progress_update(
                    pass_offset + pass_index,
                    pass_label,
                    current,
                    total,
                    "achievements",
                    "Achievement-Checks",
                ),
            )
            pass_offset += ACHIEVEMENT_RECHECK_PASSES

        _progress_update(pass_offset + 1, "Analyse-Cache", 0, total_activities, "hf_analysis", "HF-Analyse")
        result["hf_analysis"] = rebuild_hf_development_cache(user_id=user_id)
        pass_offset += 1

        _store_recheck_job(
            user_id,
            {
                "status": "completed",
                "phase_current": int(_snapshot_recheck_job(user_id).get("phase_total") or 0),
                "pass_index": total_passes,
                "pass_count": total_passes,
                "pass_current": int(_snapshot_recheck_job(user_id).get("pass_total") or 0),
                "pass_total": int(_snapshot_recheck_job(user_id).get("pass_total") or 0),
                "updated_at": _job_timestamp(),
                "finished_at": _job_timestamp(),
                "result": result,
                "message": "Historischer Recheck erfolgreich abgeschlossen.",
            },
        )
    except Exception as exc:
        _store_recheck_job(
            user_id,
            {
                "status": "error",
                "updated_at": _job_timestamp(),
                "finished_at": _job_timestamp(),
                "error": str(exc),
            },
        )


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
    weekly_target_hours: float | None = None
    weekly_target_stress: float | None = None
    nav_group_order: list[str] | None = None
    training_config: dict | None = None
    training_plan: dict | None = None


class GeoPointRequest(BaseModel):
    latitude_deg: float
    longitude_deg: float


class ClimbCompareCreateRequest(BaseModel):
    name: str | None = None
    notes: str | None = None
    search_tolerance_m: float | None = Field(default=50.0, ge=15.0, le=500.0)
    start_point: GeoPointRequest
    via_point: GeoPointRequest
    end_point: GeoPointRequest


class ClimbCompareRenameRequest(BaseModel):
    name: str


class ClimbCompareFindRidesRequest(BaseModel):
    point: GeoPointRequest
    tolerance_m: float = Field(default=50.0, ge=15.0, le=500.0)
    limit: int = Field(default=300, ge=1, le=1000)


class WeightLogCreateRequest(BaseModel):
    recorded_at: str | None = None
    weight_kg: float
    source_type: str | None = "manual"
    source_label: str | None = None
    notes: str | None = None


class AdminUserCreateRequest(BaseModel):
    email: str
    is_admin: bool = False


class SetPasswordFromInviteRequest(BaseModel):
    token: str
    password: str


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


@app.get("/admin/users")
def admin_users_list(_admin_user: dict = Depends(get_admin_user)) -> dict:
    return list_users()


@app.post("/admin/users")
def admin_users_create(payload: AdminUserCreateRequest, _admin_user: dict = Depends(get_admin_user)) -> dict:
    try:
        app_base_url = os.getenv("APP_BASE_URL", "https://trainmind.de")
        return invite_user_as_admin(
            email=payload.email,
            app_base_url=app_base_url,
            is_admin=payload.is_admin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected admin error: {exc}") from exc


@app.delete("/admin/users/{user_id}")
def admin_users_delete(user_id: int, admin_user: dict = Depends(get_admin_user)) -> dict:
    try:
        return delete_user_as_admin(user_id=user_id, actor_user_id=int(admin_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected admin error: {exc}") from exc


@app.post("/auth/set-password")
def auth_set_password(payload: SetPasswordFromInviteRequest) -> dict:
    try:
        return set_password_from_invite(payload.token, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected auth error: {exc}") from exc


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
    return get_llm_status(
        user_id=int(current_user["id"]),
        include_org_costs=bool(current_user.get("is_admin")),
    )


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
    run_postprocessing: bool = True


class GarminImportPostprocessRequest(BaseModel):
    activity_ids: list[str]


class GarminRecentIngestRequest(BaseModel):
    days_back: int = Field(default=3, ge=0, le=30)
    batch_size: int = Field(default=20, ge=1, le=100)
    sleep_seconds: float = Field(default=1.0, ge=0, le=5)


class GarminResetRequest(BaseModel):
    delete_derived_metrics: bool = False


class GarminImportSavedFileRequest(BaseModel):
    file_name: str


class ActivityHistoricalRecheckRequest(BaseModel):
    rebuild_max_hr: bool = True
    rebuild_achievements: bool = True


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


class AthleteProfileDeriveRequest(BaseModel):
    focus_labels: list[str] = Field(default_factory=list)
    notes: str | None = None


class TrainingConfigSectionDeriveRequest(BaseModel):
    section_key: str
    section_title: str | None = None
    focus_labels: list[str] = Field(default_factory=list)
    notes: str | None = None


class TrainingPlanSectionRequest(BaseModel):
    section_key: str
    section_title: str | None = None
    focus_labels: list[str] = Field(default_factory=list)
    notes: str | None = None


class TrainingPlanDeriveRequest(BaseModel):
    sections: list[TrainingPlanSectionRequest] = Field(default_factory=list)


for request_model in (
    AuthLoginRequest,
    GarminImportRequest,
    GarminResetRequest,
    GarminImportSavedFileRequest,
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
    AthleteProfileDeriveRequest,
    TrainingConfigSectionDeriveRequest,
    TrainingPlanSectionRequest,
    TrainingPlanDeriveRequest,
):
    request_model.model_rebuild()


@app.get("/garmin/credentials-status")
def garmin_credentials_status(current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    has_env_credentials = bool((os.getenv("GARMIN_EMAIL") or "").strip() and (os.getenv("GARMIN_PASSWORD") or "").strip())
    return {
        "provider": "garmin",
        "has_encrypted_credentials": False,
        "has_env_credentials": has_env_credentials,
        "active_source": "env" if has_env_credentials else "none",
    }


@app.get("/garmin/session-status")
def garmin_session_status(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_garmin_session_status(user_id=int(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin session error: {exc}") from exc


@app.get("/training/metrics")
def training_metrics_get(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return list_training_metrics(user_id=int(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.get("/training/analysis/hf-development")
def training_hf_development_get(
    window_key: str | None = Query(default=None),
    bucket_start_w: int | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return get_hf_development(user_id=int(current_user["id"]), window_key=window_key, bucket_start_w=bucket_start_w)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training analysis error: {exc}") from exc


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


@app.post("/training/config-section/llm-prompt")
def training_config_section_llm_prompt(payload: TrainingConfigSectionDeriveRequest, current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    try:
        return build_training_config_prompt(
            section_key=payload.section_key,
            section_title=payload.section_title,
            selected_focus_labels=payload.focus_labels,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.post("/training/config-section/derive")
def training_config_section_derive(payload: TrainingConfigSectionDeriveRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return derive_training_config_with_llm(
            user_id=int(current_user["id"]),
            section_key=payload.section_key,
            section_title=payload.section_title,
            selected_focus_labels=payload.focus_labels,
            notes=payload.notes,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 503 if "OPENAI_API_KEY" in detail else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.post("/training/plan-draft/llm-prompt")
def training_plan_draft_llm_prompt(payload: TrainingPlanDeriveRequest, current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    try:
        return build_training_plan_prompt(sections=[section.model_dump() for section in payload.sections])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.post("/training/plan-draft/derive")
def training_plan_draft_derive(payload: TrainingPlanDeriveRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return derive_training_plan_with_llm(
            user_id=int(current_user["id"]),
            sections=[section.model_dump() for section in payload.sections],
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 503 if "OPENAI_API_KEY" in detail else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.post("/training/athlete-profile/llm-prompt")
def training_athlete_profile_llm_prompt(payload: AthleteProfileDeriveRequest, current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    try:
        return build_athlete_profile_prompt(selected_focus_labels=payload.focus_labels, notes=payload.notes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.post("/training/athlete-profile/derive")
def training_athlete_profile_derive(payload: AthleteProfileDeriveRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return derive_athlete_profile_with_llm(
            user_id=int(current_user["id"]),
            selected_focus_labels=payload.focus_labels,
            notes=payload.notes,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 503 if "OPENAI_API_KEY" in detail else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}") from exc


@app.post("/garmin/credentials")
def garmin_credentials_save(current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    raise HTTPException(
        status_code=410,
        detail="Garmin-Credentials werden aktuell nicht im Service gespeichert. Bitte GARMIN_EMAIL und GARMIN_PASSWORD in .env verwenden.",
    )


@app.post("/garmin/import-rides")
def garmin_import_rides(payload: GarminImportRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return import_selected_garmin_rides(
            user_id=int(current_user["id"]),
            activity_ids=payload.activity_ids,
            run_postprocessing=payload.run_postprocessing,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin error: {exc}") from exc


@app.post("/garmin/import-rides/start")
def garmin_import_rides_start(payload: GarminImportRequest, current_user: dict = Depends(get_current_user)) -> dict:
    user_id = int(current_user["id"])
    current_job = _snapshot_garmin_import_job(user_id)
    if current_job.get("status") == "running":
        return current_job

    cleaned_ids = [str(item).strip() for item in payload.activity_ids if str(item).strip()]
    deduped_ids = list(dict.fromkeys(cleaned_ids))
    _store_garmin_import_job(
        user_id,
        {
            "status": "running",
            "phase": "queued",
            "phase_label": "Vorbereitung",
            "phase_current": 0,
            "phase_total": max(1, len(deduped_ids)),
            "pass_index": 0,
            "pass_count": 1,
            "pass_label": "Wartet auf Start",
            "pass_current": 0,
            "pass_total": max(1, len(deduped_ids)),
            "activity_ids": deduped_ids,
            "current_activity_name": None,
            "started_at": _job_timestamp(),
            "updated_at": _job_timestamp(),
            "finished_at": None,
            "result": None,
            "error": None,
            "message": None,
        },
    )
    worker = threading.Thread(
        target=_run_garmin_import_job,
        kwargs={
            "user_id": user_id,
            "activity_ids": deduped_ids,
            "run_postprocessing": payload.run_postprocessing,
        },
        daemon=True,
    )
    worker.start()
    return _snapshot_garmin_import_job(user_id)


@app.get("/garmin/import-rides/status")
def garmin_import_rides_status(current_user: dict = Depends(get_current_user)) -> dict:
    return _snapshot_garmin_import_job(int(current_user["id"]))


@app.post("/garmin/import-rides/postprocess")
def garmin_import_rides_postprocess(payload: GarminImportPostprocessRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return postprocess_imported_garmin_rides(
            user_id=int(current_user["id"]),
            activity_ids=payload.activity_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin postprocessing error: {exc}") from exc


@app.post("/garmin/import-rides/postprocess/start")
def garmin_import_rides_postprocess_start(payload: GarminImportPostprocessRequest, current_user: dict = Depends(get_current_user)) -> dict:
    user_id = int(current_user["id"])
    current_job = _snapshot_garmin_postprocess_job(user_id)
    if current_job.get("status") == "running":
        return current_job

    cleaned_ids = [str(item).strip() for item in payload.activity_ids if str(item).strip()]
    deduped_ids = list(dict.fromkeys(cleaned_ids))
    _store_garmin_postprocess_job(
        user_id,
        {
            "status": "running",
            "phase": "queued",
            "phase_label": "Vorbereitung",
            "phase_current": 0,
            "phase_total": max(1, len(deduped_ids)),
            "pass_index": 0,
            "pass_count": 1 + ACHIEVEMENT_RECHECK_PASSES,
            "pass_label": "Wartet auf Start",
            "pass_current": 0,
            "pass_total": max(1, len(deduped_ids)),
            "activity_ids": deduped_ids,
            "started_at": _job_timestamp(),
            "updated_at": _job_timestamp(),
            "finished_at": None,
            "result": None,
            "error": None,
            "message": None,
        },
    )
    worker = threading.Thread(
        target=_run_garmin_postprocess_job,
        kwargs={"user_id": user_id, "activity_ids": deduped_ids},
        daemon=True,
    )
    worker.start()
    return _snapshot_garmin_postprocess_job(user_id)


@app.get("/garmin/import-rides/postprocess/status")
def garmin_import_rides_postprocess_status(current_user: dict = Depends(get_current_user)) -> dict:
    return _snapshot_garmin_postprocess_job(int(current_user["id"]))


@app.post("/garmin/ingest-recent")
def garmin_ingest_recent(payload: GarminRecentIngestRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return ingest_recent_garmin_rides(
            user_id=int(current_user["id"]),
            days_back=payload.days_back,
            batch_size=payload.batch_size,
            sleep_seconds=payload.sleep_seconds,
        )
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
        if payload.rebuild_achievements:
            result["achievements"] = rebuild_activity_achievement_checks(user_id=int(current_user["id"]))
        result["hf_analysis"] = rebuild_hf_development_cache(user_id=int(current_user["id"]))
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity recheck error: {exc}") from exc


@app.post("/activities/recheck-history/start")
def activities_recheck_history_start(
    payload: ActivityHistoricalRecheckRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = int(current_user["id"])
    current_job = _snapshot_recheck_job(user_id)
    if current_job.get("status") == "running":
        return current_job

    job_id = str(uuid.uuid4())
    with _recheck_jobs_lock:
        _recheck_job_queues[user_id] = deque()
    _store_recheck_job(
        user_id,
        {
            "job_id": job_id,
            "status": "running",
            "phase": "queued",
            "phase_label": "Vorbereitung",
            "phase_current": 0,
            "phase_total": 0,
            "rebuild_max_hr": payload.rebuild_max_hr,
            "rebuild_achievements": payload.rebuild_achievements,
            "started_at": _job_timestamp(),
            "updated_at": _job_timestamp(),
            "finished_at": None,
            "result": None,
            "error": None,
            "message": None,
        },
    )
    worker = threading.Thread(
        target=_run_recheck_job,
        kwargs={
            "user_id": user_id,
            "rebuild_max_hr": payload.rebuild_max_hr,
            "rebuild_achievements": payload.rebuild_achievements,
        },
        daemon=True,
    )
    worker.start()
    return _snapshot_recheck_job(user_id)


@app.get("/activities/recheck-history/status")
def activities_recheck_history_status(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return {"status": "ok", "achievements": get_activity_achievement_check_status(user_id=int(current_user["id"]))}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity recheck status error: {exc}") from exc


@app.get("/activities/recheck-history/job-status")
def activities_recheck_history_job_status(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return _snapshot_recheck_job(int(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity recheck job status error: {exc}") from exc


@app.get("/activities/recheck-history/job-stream")
def activities_recheck_history_job_stream(current_user: dict = Depends(get_current_user)) -> StreamingResponse:
    user_id = int(current_user["id"])

    def generate():
        condition = _get_recheck_job_condition(user_id)
        queue = _get_recheck_job_queue(user_id)
        initial_snapshot = _snapshot_recheck_job(user_id)
        yield json.dumps(initial_snapshot) + "\n"

        while True:
            snapshot: dict[str, object] | None = None
            with condition:
                condition.wait_for(lambda: len(queue) > 0, timeout=15.0)
                if queue:
                    snapshot = queue.popleft()
            if snapshot is None:
                continue
            yield json.dumps(snapshot) + "\n"
            if str(snapshot.get("status") or "") in {"completed", "error", "idle"}:
                break

    return StreamingResponse(generate(), media_type="application/x-ndjson")


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


@app.post("/garmin/import-files/analyze")
async def garmin_import_files_analyze(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise ValueError("Bitte eine ZIP-Datei auswählen.")
        return analyze_fit_dump_zip(file_bytes=file_bytes, filename=file.filename or "garmin_fit_dump.zip")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin import-file error: {exc}") from exc


@app.get("/garmin/import-files/available")
def garmin_import_files_available(current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    try:
        return list_saved_fit_dump_archives()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin import-file error: {exc}") from exc


@app.post("/garmin/import-files/analyze-saved")
def garmin_import_files_analyze_saved(payload: GarminImportSavedFileRequest, current_user: dict = Depends(get_current_user)) -> dict:
    _ = current_user
    try:
        return analyze_saved_fit_dump_zip(file_name=payload.file_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin import-file error: {exc}") from exc


@app.post("/garmin/import-files/import")
async def garmin_import_files_import(
    file: UploadFile = File(...),
    selections_json: str = Form(...),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise ValueError("Bitte eine ZIP-Datei auswählen.")
        selections = json.loads(selections_json)
        if not isinstance(selections, list):
            raise ValueError("Die ausgewählten Fahrten müssen als Liste übergeben werden.")
        return import_fit_dump_zip(
            file_bytes=file_bytes,
            filename=file.filename or "garmin_fit_dump.zip",
            user_id=int(current_user["id"]),
            selections=selections,
        )
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Ungültiges JSON für die Auswahl: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin import-file error: {exc}") from exc


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
            "X-TrainMind-Normalized-Power": str(summary["normalized_power"]),
            "X-TrainMind-Estimated-Calories": str(summary["estimated_calories"]),
            "X-TrainMind-Total-Work-KJ": str(summary["total_work_kj"]),
            "X-TrainMind-Intensity-Factor": str(summary["intensity_factor"] or ""),
            "X-TrainMind-Training-Stress-Score": str(summary["training_stress_score"] or ""),
            "X-TrainMind-Updated-Fields": ",".join(summary["updated_fields"]),
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


@app.get("/activities/month")
def activities_month(
    reference_date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return get_monthly_activities(user_id=int(current_user["id"]), reference_date=reference_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity error: {exc}") from exc


@app.get("/activities/months-available")
def activities_months_available(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return get_available_activity_months(user_id=int(current_user["id"]))
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


@app.get("/activities/climb-compare")
def activities_climb_compare_list(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return list_climb_compares(user_id=int(current_user["id"]))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.post("/activities/climb-compare")
def activities_climb_compare_create(payload: ClimbCompareCreateRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return create_climb_compare(user_id=int(current_user["id"]), payload=payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.get("/activities/climb-compare/export")
def activities_climb_compare_export(current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return export_climb_compares(user_id=int(current_user["id"]))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.post("/activities/climb-compare/import")
def activities_climb_compare_import(payload: dict, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return import_climb_compares(user_id=int(current_user["id"]), payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.put("/activities/climb-compare/{compare_id}")
def activities_climb_compare_update(compare_id: int, payload: ClimbCompareCreateRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return update_climb_compare(user_id=int(current_user["id"]), compare_id=compare_id, payload=payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.post("/activities/climb-compare/{compare_id}/rename")
def activities_climb_compare_rename(compare_id: int, payload: ClimbCompareRenameRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return rename_climb_compare(user_id=int(current_user["id"]), compare_id=compare_id, name=payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.post("/activities/climb-compare/{compare_id}/copy")
def activities_climb_compare_copy(compare_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return duplicate_climb_compare(user_id=int(current_user["id"]), compare_id=compare_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.post("/activities/climb-compare/{compare_id}/check-rides")
def activities_climb_compare_check(
    compare_id: int,
    scope: str = Query(default="new", pattern=r"^(new|all)$"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        user_id = int(current_user["id"])
        current_job = _snapshot_climb_compare_job(user_id, compare_id)
        if str(current_job.get("status") or "") == "running":
            return current_job

        compare = get_climb_compare_brief(user_id=user_id, compare_id=compare_id)
        _store_climb_compare_job(
            user_id,
            compare_id,
            {
                "status": "running",
                "compare_id": compare_id,
                "compare_name": compare.get("name"),
                "checked_current": 0,
                "checked_total": 0,
                "current_activity_name": None,
                "started_at": _job_timestamp(),
                "updated_at": _job_timestamp(),
                "finished_at": None,
                "scope": scope,
                "result": None,
                "error": None,
                "message": (
                    "Climb Compare wird komplett neu geprüft."
                    if scope == "all"
                    else f"Die letzten {DEFAULT_CHECK_RIDES_LIMIT} neuen Rides werden jetzt geprüft."
                    if DEFAULT_CHECK_RIDES_LIMIT > 0
                    else "Neue Rides werden jetzt geprüft."
                ),
            },
        )
        worker = threading.Thread(
            target=_run_climb_compare_job,
            kwargs={
                "user_id": user_id,
                "compare_id": compare_id,
                "scope": scope,
            },
            daemon=True,
        )
        worker.start()
        return _snapshot_climb_compare_job(user_id, compare_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.get("/activities/climb-compare/{compare_id}/check-rides/status")
def activities_climb_compare_check_status(compare_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return _snapshot_climb_compare_job(int(current_user["id"]), compare_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.post("/activities/climb-compare/find-rides-on-map")
def activities_climb_compare_find_rides_on_map(payload: ClimbCompareFindRidesRequest, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return find_rides_on_map_point(
            user_id=int(current_user["id"]),
            payload=payload.model_dump(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


@app.delete("/activities/climb-compare/{compare_id}")
def activities_climb_compare_delete(compare_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return delete_climb_compare(user_id=int(current_user["id"]), compare_id=compare_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected climb compare error: {exc}") from exc


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


@app.post("/activities/{activity_id}/llm-analysis")
def activity_llm_analysis(
    activity_id: int,
    force_refresh: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
) -> dict:
    try:
        return derive_activity_llm_analysis(
            user_id=int(current_user["id"]),
            activity_id=activity_id,
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 503 if "OPENAI_API_KEY" in detail else 404 if detail == "Activity not found." else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity LLM error: {exc}") from exc


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
