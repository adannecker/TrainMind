# Backup und Restore

Diese Anleitung beschreibt, wie du die lokale TrainMind-Datenbank auf einen anderen Rechner uebertraegst.

## Ziel

Mit dem Full-Dump kannst du:

- alle PostgreSQL-Daten aus deiner aktuellen TrainMind-Instanz sichern
- die Daten auf einem zweiten Rechner wieder einspielen
- danach mit demselben Datenstand weiterarbeiten

## Was im Dump enthalten ist

Der Full-Dump enthaelt die komplette PostgreSQL-Datenbank, also zum Beispiel:

- User und Profile
- Aktivitäten, Records, Runden, Sessions
- Trainingsdaten, HF-Analyse-Cache, LLM-Analyse-Cache
- Achievements, Nutrition-Daten, Climb Compare, Einstellungen

## Was nicht im Dump enthalten ist

Der Dump enthaelt nicht automatisch:

- `.env`
- Docker-Volumes ausserhalb der Datenbank
- lokale Dateien ausserhalb von PostgreSQL

Besonders wichtig:

- `APP_ENCRYPTION_KEY` aus `.env` muss auf dem Zielrechner identisch sein
- Garmin-Token liegen im Docker-Volume `trainmind_garmin_tokens` und nicht in PostgreSQL

Ohne denselben `APP_ENCRYPTION_KEY` koennen bestehende verschluesselte Eintraege spaeter nicht mehr gelesen werden.

## Verfuegbare Skripte

- Export: [`infra/scripts/export_db_full.ps1`](/c:/Users/achim/Develop/TrainMind/infra/scripts/export_db_full.ps1)
- Import: [`infra/scripts/import_db_full.ps1`](/c:/Users/achim/Develop/TrainMind/infra/scripts/import_db_full.ps1)

## 1. Full-Dump erzeugen

Im Repo-Stamm ausfuehren:

```powershell
.\infra\scripts\export_db_full.ps1
```

Standard-Ziel:

```text
data/backups/trainmind_full_YYYY-MM-DD_HH-mm-ss.dump
```

Optional mit eigenem Zielpfad:

```powershell
.\infra\scripts\export_db_full.ps1 -OutputPath .\data\backups\mein_dump.dump
```

## 2. Welche Dateien du auf den anderen Rechner kopieren musst

Pflicht:

- die erzeugte `.dump`-Datei
- deine `.env`

Optional:

- Garmin-Token-Volume, wenn du Garmin nicht neu verbinden willst

## 3. Repo auf dem Zielrechner vorbereiten

Auf dem Zielrechner:

1. aktuelles Repo holen
2. `.env` bereitstellen
3. Stack mindestens mit `postgres` und `db-migrate` starten

Beispiel:

```powershell
docker compose -f infra/docker/docker-compose.yml up -d postgres db-migrate
```

Oder direkt den ganzen Stack:

```powershell
docker compose -f infra/docker/docker-compose.yml up -d --build
```

## 4. Dump einspielen

Wenn die Dump-Datei zum Beispiel unter `data/backups/trainmind_full_2026-04-07_01-03-34.dump` liegt:

```powershell
.\infra\scripts\import_db_full.ps1 -InputPath .\data\backups\trainmind_full_2026-04-07_01-03-34.dump
```

Das Skript:

- kopiert den Dump in den laufenden Postgres-Container
- fuehrt `pg_restore` mit `--clean --if-exists` aus
- ueberschreibt damit den bestehenden Datenbankinhalt sauber

## 5. Services danach neu starten

Nach dem Restore:

```powershell
docker compose -f infra/docker/docker-compose.yml restart garmin-api hub-web
```

Bei Bedarf kannst du auch den ganzen Stack neu starten:

```powershell
docker compose -f infra/docker/docker-compose.yml up -d
```

## 6. Garmin-Token optional uebernehmen

Wenn du Garmin auf dem Zielrechner nicht neu verbinden willst, musst du zusaetzlich das Docker-Volume `trainmind_garmin_tokens` uebernehmen.

Das ist optional. Ohne diesen Schritt kannst du Garmin spaeter einfach neu verbinden.

## 7. Schnell-Check nach dem Restore

Pruefen:

- Hub auf `http://127.0.0.1:8000`
- API Health auf `http://127.0.0.1:8010/health`

Schnelltest:

```powershell
Invoke-RestMethod http://127.0.0.1:8010/health
```

Erwartet:

```json
{"status":"healthy"}
```

## Typischer Transfer fuer einen zweiten Rechner

Kurzfassung:

1. auf Quellrechner Dump erzeugen
2. `.dump` und `.env` auf Zielrechner kopieren
3. Repo auf Zielrechner ziehen
4. Docker-Stack starten
5. Dump importieren
6. API/Web neu starten

## Hinweise fuer Git

Die Full-Dumps gehoeren nicht ins Repo.

Warum:

- persoenliche Daten landen sonst in der Git-History
- Dumps werden schnell gross
- sie sind Betriebsdaten, keine Quelltexte

Der Standardpfad `data/backups/` ist bereits ueber `.gitignore` abgedeckt.
