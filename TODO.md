# TODO TrainMind

## Aufraeumen/Struktur
- [x] Projektstruktur auf `apps/`, `packages/`, `infra/`, `data/` umgestellt
- [x] Alte `src/trainmind`-Dateien entfernt/verschoben
- [x] Legacy-Projektdateien entfernt (`TrainMind.sln`, `TrainMind.pyproj`)
- [x] `__init__.py` in allen relevanten Python-Paketordnern gesetzt
- [x] README auf neue Struktur aktualisiert

## Datenmodell FIT (Entwurf v1)
- [x] Zieltabellen fuer FIT-Daten definiert: `fit_files`, `activities`, `activity_sessions`, `activity_laps`, `activity_records`, `fit_raw_messages`
- [x] Trennung von normalisierten Metriken und Rohdaten festgelegt
- [x] Schluessel fuer Deduplizierung festgelegt (`provider` + `external_id`)
- [x] Erste Indizes/Unique-Constraints im ORM vorgesehen
- [ ] Alembic-Revision fuer das neue Schema erzeugen
- [ ] Seed auf neues Schema erweitern (Demo-Aktivitaet + Samples)

## Backend/API
- [ ] Auth-Konzept festlegen (lokal zuerst, spaeter OAuth/JWT)
- [ ] API-Endpoints fuer Activities bauen (CRUD + List/Filter)
- [ ] API-Endpoints fuer Food Entries bauen (CRUD + Tagesansicht)
- [ ] API-Endpoints fuer Dashboard-Summary bauen

## Integrationen
- [ ] Garmin Pull als Worker-Job integrieren
- [ ] Withings OAuth Flow in API integrieren
- [ ] Normalisierungsschicht fuer Providerdaten bauen

## Datenbank
- [x] PostgreSQL lokal via Docker Compose vorbereiten
- [x] Alembic-Migrationen eingerichtet
- [x] Seed-Workflow eingerichtet
- [ ] Indizes fuer haeufige Queries ergaenzen
- [ ] Historisierung/Versionierung fuer eingehende Rohdaten pruefen

## Frontend
- [ ] Web-App Grundgeruest anlegen
- [ ] Food-Tracking Views bauen
- [ ] Trainingsvergleich (Zeitraeume/Provider) visualisieren

## Ops
- [ ] CI fuer Tests + Lint einrichten
- [ ] Deployment-Ziel festlegen (z. B. Render/Railway/Fly)
- [ ] Backup-Strategie fuer PostgreSQL dokumentieren
