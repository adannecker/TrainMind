# TrainMind

TrainMind ist jetzt in eine modulare Monorepo-Struktur aufgeteilt:
- `apps/api`: FastAPI-Service
- `apps/web`: Platzhalter fuer Frontend
- `apps/worker`: Platzhalter fuer Worker-Jobs
- `packages/db`: SQLAlchemy-Modelle, Session, Alembic, Seed
- `packages/fit`: FIT-Utilities
- `packages/integrations`: Garmin- und Withings-Integrationen
- `infra`: Docker- und Datenbank-Skripte
- `data`: lokale Daten, Exporte und Tokens

## Voraussetzungen
- Python 3.11+
- Docker Desktop
- PowerShell (Windows)

## Setup
1. Virtuelle Umgebung erstellen und aktivieren
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Abhaengigkeiten installieren
```powershell
pip install -r requirements.txt
```

3. `.env` anlegen
```powershell
Copy-Item .env.example .env
```

## PostgreSQL lokal
DB starten:
```powershell
.\infra\scripts\db_up.ps1
```

Migrationen anwenden:
```powershell
.\infra\scripts\db_migrate.ps1
```

Seed-Daten schreiben:
```powershell
.\infra\scripts\db_seed.ps1
```

Komplett-Reset (DB neu aufsetzen, migrieren, seeden):
```powershell
.\infra\scripts\db_reset.ps1
```

DB stoppen:
```powershell
.\infra\scripts\db_down.ps1
```

## Neue Migration
Nach Aenderungen in `packages/db/models.py`:
```powershell
.\infra\scripts\db_revision.ps1 -Message "describe change"
.\infra\scripts\db_migrate.ps1
```

## API starten
```powershell
uvicorn apps.api.main:app --reload
```

Healthcheck:
- `GET http://127.0.0.1:8000/health`

## Wichtige Pfade
- API: `apps/api/main.py`
- DB-Modelle: `packages/db/models.py`
- Alembic: `packages/db/alembic.ini`
- Docker Compose: `infra/docker/docker-compose.yml`

## Status (Stand: 11.02.2026)
- Projektstruktur von `src/trainmind` nach `apps/` und `packages/` umgestellt
- Alte Solution-/Project-Dateien entfernt (`TrainMind.sln`, `TrainMind.pyproj`)
- Integrationsskripte auf neue Pfade angepasst
- Datenbank-Grundsetup mit Docker + Alembic + Seed vorhanden
