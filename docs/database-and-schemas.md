# Datenbank und Schemata

## Ziel

Eine gemeinsame PostgreSQL-Instanz mit klaren Schema-Grenzen:

- `core`: gemeinsame Basisdaten (User, Sessions, Credentials)
- `garmin`: Aktivitaeten und FIT-Daten
- `nutrition`: Ernaehrungsdaten und Sync-Events

So bleibt das System erweiterbar, auch wenn spaeter mehrere APIs getrennt deployt werden.

## Wichtige Tabellen

### core

- `core.users`
- `core.user_sessions`
- `core.service_credentials`

### garmin

- `garmin.activities`
- `garmin.fit_files`
- `garmin.fit_file_payloads`
- `garmin.activity_sessions`
- `garmin.activity_laps`
- `garmin.activity_records`
- `garmin.fit_raw_messages`

### nutrition

- `nutrition.food_entries` (legacy/basic)
- `nutrition.food_items`
- `nutrition.meal_entries`
- `nutrition.meal_entry_items`
- `nutrition.sync_events`

## Migrationshistorie (Alembic)

Pfad: `packages/db/alembic/versions`

- `20260210_0001_initial`
- `20260211_0002_fit_schema_v1`
- `20260314_0003_service_schemas`
- `20260314_0004_service_credentials`
- `20260314_0005_auth_and_user_scoped_credentials`
- `20260314_0006_nutrition_v1_sync`

## Security-Aspekte

- Passwoerter als Hash in `core.users.password_hash`.
- Session-Token als Hash in `core.user_sessions.token_hash`.
- Provider-Zugangsdaten verschluesselt in `core.service_credentials`.
- Schluesselverwaltung ueber `.env`:
  - `APP_ENCRYPTION_KEY`

Wichtig: Der Schluessel muss stabil bleiben. Ein Wechsel ohne Re-Encryption macht bestehende Credentials unlesbar.
