# Services und API

## Docker Services

Compose-Datei: `infra/docker/docker-compose.yml`

- `postgres`: Datenbank
- `db-migrate`: fuehrt `alembic upgrade head` aus
- `garmin-api`: zentrale FastAPI (`apps/api/main.py`) auf `:8010`
- `hub-web`: React/Vite Hub auf `:8000`
- `withings-api` (optional, Profil `optional`) auf `:8001`
- `nutrition-api` (optional, Profil `optional`) auf `:8002`

## Hub und API-Ports

- Hub UI: `http://127.0.0.1:8000`
- API direkt: `http://127.0.0.1:8010`
- API ueber Hub-Proxy: `http://127.0.0.1:8000/api/...`

## Auth-Endpoints

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

API-Endpunkte (ausser Health/Root/Login) erwarten Bearer-Token.

## Garmin-Endpoints

- `GET /garmin/new-rides`
- `POST /garmin/import-rides`
- `GET /garmin/credentials-status`
- `POST /garmin/credentials`

## Activities-Endpoints

- `GET /activities/week`
- `GET /activities/weeks-available`

## Nutrition-Endpoints (V1)

- `POST /nutrition/entries`
- `GET /nutrition/entries`
- `PATCH /nutrition/entries/{entry_id}`
- `DELETE /nutrition/entries/{entry_id}`
- `POST /nutrition/sync`
- `GET /nutrition/recipes`
- `POST /nutrition/recipes`
- `PATCH /nutrition/recipes/{recipe_id}`
- `POST /nutrition/entries/from-recipe`

## Health

- `GET /health` -> `{"status":"healthy"}`
- `GET /` -> `{"service":"trainmind-api","status":"ok"}`

## Lokale Hilfsbefehle

Stack starten:

```powershell
docker compose -f infra/docker/docker-compose.yml up -d --build
```

Service-Status:

```powershell
docker compose -f infra/docker/docker-compose.yml ps
```

Optionale Services mitstarten:

```powershell
docker compose -f infra/docker/docker-compose.yml --profile optional up -d --build
```
