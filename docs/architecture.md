# Architektur

## Ueberblick

Aktuell laeuft TrainMind als Docker-Stack mit Hub-Frontend und zentraler API:

- `hub-web` (`apps/web`) auf Port `8000`
- `garmin-api` (`apps/api.main`) auf Port `8010`
- `postgres` auf Port `5432`
- `db-migrate` als einmaliger Migrations-Job beim Start
- optional: `withings-api` (`8001`) und `nutrition-api` (`8002`) ueber Docker-Profil `optional`

## Architekturprinzipien

- Hub-zentriert:
  - Das Web-Frontend dient als zentrale Einstiegsebene.
  - Fachlogik liegt im API-Service.
- Service-ready:
  - Es gibt bereits getrennte Container und klare Modulgrenzen.
  - Neue Integrationen koennen als eigener Service ergaenzt werden.
- Daten sauber getrennt:
  - Gemeinsame DB, aber getrennte Schemata je Domane (`core`, `garmin`, `nutrition`).

## Request Flow

1. Browser oder Mobile App ruft Hub/API auf.
2. Hub proxyt API-Requests intern an `garmin-api:8010`.
3. API authentifiziert via Bearer Token (Session in DB).
4. API liest/schreibt in PostgreSQL (schema-basiert).

## Security-Grundlagen

- Lokaler Login mit gehashtem Passwort (`core.users.password_hash`).
- Session-Token gehasht in `core.user_sessions`.
- Provider-Credentials (z. B. Garmin) verschluesselt in `core.service_credentials`.
- Verschluesselungsschluessel aus `.env`: `APP_ENCRYPTION_KEY`.

## Aktueller Ausbaustatus

- Garmin Import und Aktivitaetsansichten sind aktiv.
- Nutrition V1 (Entries + Sync-Endpunkte) ist aktiv.
- Withings als Service-Placeholder vorbereitet.
