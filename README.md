# TrainMind

TrainMind is organized as a modular monorepo:
- `apps/api`: FastAPI service
- `apps/web`: React + Vite frontend
- `apps/worker`: worker/service placeholder
- `packages/db`: SQLAlchemy models, session, Alembic, seed
- `packages/fit`: FIT parsing/utilities
- `packages/integrations`: Garmin and Withings integrations
- `infra`: Docker and database scripts
- `data`: local data, exports, and tokens

## Prerequisites
- Python 3.11+
- Node.js 20+ (with npm)
- Docker Desktop
- PowerShell (Windows)

## Backend Setup
1. Create and initialize virtual environment:
```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

2. Create local environment file:
```powershell
Copy-Item .env.example .env
```

3. Start PostgreSQL:
```powershell
.\infra\scripts\db_up.ps1 -Build
```

4. Apply migrations:
```powershell
.\infra\scripts\db_migrate.ps1
```

5. Seed demo data:
```powershell
.\infra\scripts\db_seed.ps1
```

6. Start API:
```powershell
.\.venv\Scripts\python.exe -m uvicorn apps.api.main:app --reload
```

Health endpoint:
- `GET http://127.0.0.1:8000/health`

## Frontend Setup
```powershell
cd apps/web
npm install
npm run dev
```

Frontend URL:
- `http://127.0.0.1:5173`

## Database Helpers
Stop DB:
```powershell
.\infra\scripts\db_down.ps1
```

Full reset (drop volume, recreate, migrate, seed):
```powershell
.\infra\scripts\db_reset.ps1
```

Create a new migration after changing `packages/db/models.py`:
```powershell
.\infra\scripts\db_revision.ps1 -Message "describe change"
.\infra\scripts\db_migrate.ps1
```

## Optional: Adminer (Browser DB UI)
```powershell
docker run --name trainmind-adminer -d -p 8081:8080 --network trainmind_default adminer
```

Open:
- `http://localhost:8081`

Connection values:
- System: `PostgreSQL`
- Server: `trainmind-postgres`
- Username: `trainmind`
- Password: `trainmind`
- Database: `trainmind`

## Garmin Import Workflow
- Configure credentials in `.env`:
  - `GARMIN_EMAIL`
  - `GARMIN_PASSWORD`
- Use the frontend page `Setup > Neue Rides prüfen` to:
  - compare latest Garmin rides with already stored rides
  - select single/all rides
  - import selected rides into DB (including FIT payload)
- Import stores:
  - `activities`
  - `fit_files`
  - `fit_file_payloads`
  - `activity_laps` (when Garmin split data exists)

## Weekly Activities View
- Open `Aktivitäten > Wochenansicht`
- Features:
  - week selector with available weeks containing data
  - week and month navigation (`<`, `>`, `<<`, `>>`)
  - day cards (Mon-Sun) with activity bundles and per-day summaries
  - right-side weekly summary + performance visualizer
    - reference target for ambitious amateurs: `250 km / 10 h` per week

## Key Files
- API entrypoint: `apps/api/main.py`
- Frontend entrypoint: `apps/web/src/main.tsx`
- Activity services: `apps/api/activity_service.py`, `apps/api/garmin_service.py`
- DB models: `packages/db/models.py`
- Alembic config: `packages/db/alembic.ini`
- Docker Compose: `infra/docker/docker-compose.yml`

## Current Status (2026-02-11)
- Monorepo layout migrated from `src/trainmind` to `apps/` and `packages/`
- Project/solution legacy files removed
- Integration scripts updated to new paths
- PostgreSQL + Alembic + seed workflow running
- FIT schema v1 tables created (including raw FIT payload storage)
- Garmin compare/import flow implemented in API + frontend
- Garmin data repair/backfill for summaryDTO-based fields added
- Weekly activities board implemented with navigation, summaries, and visualizer
