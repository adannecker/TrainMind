from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from apps.api.activity_service import get_available_activity_weeks, get_weekly_activities
from apps.api.garmin_service import get_missing_garmin_rides, import_selected_garmin_rides

app = FastAPI(title="TrainMind API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
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


@app.get("/garmin/new-rides")
def garmin_new_rides(limit: int = Query(default=50, ge=1, le=200)) -> dict:
    try:
        return get_missing_garmin_rides(limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin error: {exc}") from exc


class GarminImportRequest(BaseModel):
    activity_ids: list[str]


@app.post("/garmin/import-rides")
def garmin_import_rides(payload: GarminImportRequest) -> dict:
    try:
        return import_selected_garmin_rides(payload.activity_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected Garmin error: {exc}") from exc


@app.get("/activities/week")
def activities_week(reference_date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict:
    try:
        return get_weekly_activities(reference_date=reference_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity error: {exc}") from exc


@app.get("/activities/weeks-available")
def activities_weeks_available() -> dict:
    try:
        return get_available_activity_weeks()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected activity error: {exc}") from exc
