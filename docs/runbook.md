# Runbook und Betrieb

## 1. Stack starten

```powershell
docker compose -f infra/docker/docker-compose.yml up -d --build
```

Status pruefen:

```powershell
docker compose -f infra/docker/docker-compose.yml ps
```

## 2. Erreichbarkeit pruefen

- Hub: `http://127.0.0.1:8000`
- API Health: `http://127.0.0.1:8010/health`

Schnelltest:

```powershell
Invoke-RestMethod http://127.0.0.1:8010/health
```

## 3. User anlegen

```powershell
.\infra\scripts\create_account.ps1 -Email "you@example.com" -Password "your-password" -DisplayName "Your Name"
```

## 4. Migrationen

Automatisch ueber `db-migrate` beim Stack-Start.

Manuell:

```powershell
.\infra\scripts\db_migrate.ps1
```

## 5. Logs

Gesamte Logs:

```powershell
docker compose -f infra/docker/docker-compose.yml logs -f
```

Nur API:

```powershell
docker compose -f infra/docker/docker-compose.yml logs -f garmin-api
```

## 6. Optionale Services starten

```powershell
docker compose -f infra/docker/docker-compose.yml --profile optional up -d --build
```

## 7. Haeufige Fehlerbilder

### `ERR_CONNECTION_REFUSED` auf `127.0.0.1:8000`

- `hub-web` laeuft nicht oder Port belegt.
- `docker compose ... ps` pruefen.

### Frontend bekommt keine API-Antwort

- Proxy-Target in Compose muss intern auf `http://garmin-api:8010` zeigen.
- Direkttest API: `http://127.0.0.1:8010/health`.

### Login funktioniert nicht

- User existiert nicht oder Passwort falsch.
- Auth-Endpunkt testen:

```powershell
$body = @{ email = "you@example.com"; password = "your-password" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/auth/login" -Method Post -ContentType "application/json" -Body $body
```

### Garmin-Credentials koennen nicht gelesen werden

- `APP_ENCRYPTION_KEY` fehlt oder wurde geaendert.
- Nur mit identischem Key koennen bestehende verschluesselte Daten entschluesselt werden.

## 8. Backup-Hinweis

Fuer produktiven Betrieb:

- DB-Backups regelmaessig einrichten.
- `.env` sicher verwalten.
- `APP_ENCRYPTION_KEY` getrennt und sicher sichern.

## 8.1 Verschluesselung fuer API-/Provider-Keys

- `APP_ENCRYPTION_KEY` ist der zentrale App-Verschluesselungsschluessel.
- Damit werden sensible Zugangsdaten (z. B. Garmin-Credentials, spaeter LLM/API-Token) verschluesselt in der DB gespeichert.
- Ohne denselben Schluessel koennen bestehende verschluesselte Eintraege nicht mehr gelesen werden.
- Der Schluessel gehoert nicht ins Repo und muss pro Umgebung sicher verwaltet werden.

## 9. USDA-Verifizierung (Ernaehrungsdaten)

Script:

```powershell
python .\infra\scripts\usda_verify_ingredients.py --apply --max-calls-per-hour 1000
```

Hinweise:

- Rate-Tracking liegt in `docs/usda-rate-tracker.json`.
- Reports werden in `docs/usda-verify-report-*.csv` gespeichert.
- Bei API-Limit/HTTP-Fehlern den Lauf nach dem naechsten Stundenfenster erneut starten.

## 10. Produkt-/Zutatenkatalog dumpen und einspielen

Eincheckbaren Katalog-Dump erzeugen:

```powershell
.\infra\scripts\export_nutrition_catalog.ps1
```

Zieldatei:

- `infra/seed/nutrition_catalog.sql`

Katalog aus Dump wiederherstellen (inkl. vorherigem Reset der Katalogtabellen):

```powershell
.\infra\scripts\import_nutrition_catalog.ps1
```

Hinweis:

- Das ist fuer den globalen Nutrition-Katalog (`nutrition.food_items`, `nutrition.food_item_sources`).
- Damit hat jeder Checkout sofort denselben Startbestand, ohne neu zu seeden.
- Diese Dateien sind bewusst versioniert und sollen im Git-Commit enthalten sein:
  - `infra/seed/nutrition_catalog.sql`
  - `infra/scripts/export_nutrition_catalog.ps1`
  - `infra/scripts/import_nutrition_catalog.ps1`
