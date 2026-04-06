# TrainMind

TrainMind ist als modularer Monorepo aufgebaut und aktuell als Hub + API lauffähig.

## Aktueller Produktstand

- Garmin-Import mit Vergleich, Auswahl-Import, Fortschritts-Overlay und komplettem Reset für Re-Import-Tests
- Training-Bereich mit historischen Grunddaten für `FTP` und `MaxHF`
- Achievement-Bereich mit datenbasierten Rad-Achievements und persistenter Rekord-Historie
- Wochenansicht für Aktivitäten als erste Analysefläche

## Quick Start

Vollständiger Stack (Hub, API, DB):

```powershell
docker compose -f infra/docker/docker-compose.yml up -d --build
```

Danach:

- Hub UI: `http://127.0.0.1:8000`
- API (direkt): `http://127.0.0.1:8010`
- API Health: `http://127.0.0.1:8010/health`

Stoppen:

```powershell
docker compose -f infra/docker/docker-compose.yml down
```

## Projektstruktur

- `apps/web`: Hub Frontend (React + Vite), läuft auf `:8000`
- `apps/api`: zentrale API (Garmin + Auth + Nutrition-Endpunkte), laeuft auf `:8010`
- `apps/mobile`: Expo/React-Native Prototyp fuer Login + Nutrition
- `apps/worker`: optionale Service-Entrypoints (Withings/Nutrition Placeholder)
- `packages/db`: SQLAlchemy Modelle + Alembic Migrationen
- `packages/integrations`: Provider-Integrationen (Garmin/Withings)
- `infra/docker`: Docker/Compose Setup
- `infra/scripts`: PowerShell-Helfer (DB, Stack, Account-Erstellung)

## Wichtige Hinweise

- `APP_ENCRYPTION_KEY` muss in `.env` gesetzt sein, damit Provider-Credentials verschlüsselt gespeichert werden.
- API-Endpunkte sind login-geschützt (Bearer Token, Session in DB).
- Garmin-Credentials werden pro User in `core.service_credentials` verschlüsselt abgelegt.
- Importierte Garmin-Fahrten können im Hub komplett gelöscht und anschließend erneut importiert werden.
- Für sichtbare deutsche UI-Texte bitte normale Umlaute und `ß` verwenden; ASCII-Schreibweisen wie `ae`, `oe`, `ue` nur bei technischem Grund.
- Im Hub unter `Setup > Fix FIT file` gibt es jetzt einen ersten FIT-Korrekturflow:
  - FIT-Datei hochladen
  - Power-Verlauf analysieren
  - Zeitbereich im Chart markieren oder per Slider eingrenzen
  - Watt-Anpassung pro Bereich als `prozentual` oder `fix`
  - neue FIT-Datei direkt herunterladen

Account manuell anlegen:

```powershell
.\infra\scripts\create_account.ps1 -Email "you@example.com" -Password "your-password" -DisplayName "Your Name"
```

## Detaillierte Doku

- [Doku Index](docs/README.md)
- [Roadmap / TODO](docs/todo-roadmap.md)
- [Architektur](docs/architecture.md)
- [Services und API](docs/services-and-api.md)
- [Datenbank und Schemata](docs/database-and-schemas.md)
- [Integrationen](docs/integrations.md)
- [Mobile App](docs/mobile-app.md)
- [Runbook und Betrieb](docs/runbook.md)

## Analyse-Leitlinie

- Aktivitätsanalysen müssen immer zeitbezogen mit dem zum Aktivitätszeitpunkt gültigen `FTP` und dem bis dahin höchsten gültigen `MaxHF`-Wert rechnen.
- Diese Referenzwerte beeinflussen insbesondere Zonenlogik, Intervall-Erkennung und Stress-/Load-Bewertungen.
