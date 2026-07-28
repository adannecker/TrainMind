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
- `POST /garmin/reset-imported`
- `GET /garmin/credentials-status`
- `POST /garmin/credentials`

### Garmin Reset

`POST /garmin/reset-imported`

- loescht lokal importierte Garmin-Fahrten und zugehoerige FIT-Dateien
- Fahrten bleiben bei Garmin selbst unveraendert
- optional kann `delete_derived_metrics=true` mitgegeben werden, um automatisch erzeugte `MaxHF`-Werte ebenfalls zu loeschen
- gedacht fuer komplette Re-Import-Tests und Neuaufbau abgeleiteter Analysen

Beispiel-Body:

```json
{
  "delete_derived_metrics": true
}
```

## FIT Fix Endpoints

- `POST /fit-fix/inspect`
- `POST /fit-fix/apply`

### FIT Fix Flow

`POST /fit-fix/inspect`

- erwartet `multipart/form-data` mit Datei-Feld `file`
- liest die FIT-Datei ein und liefert:
  - Dateiname
  - Dauer
  - Anzahl Power-Records
  - Durchschnitts- und Max-Watt
  - aggregierte Power-Serie fuer die Web-Vorschau

`POST /fit-fix/apply`

- erwartet `multipart/form-data` mit:
  - `file`
  - `adjustments_json`
- `adjustments_json` ist eine Liste von Bereichsanpassungen mit:
  - `start_second`
  - `end_second`
  - `mode` (`percent` oder `fixed`)
  - `value`
- Antwort:
  - neue FIT-Datei als Download
  - Header mit Kurzinfos:
    - `X-TrainMind-Changed-Records`
    - `X-TrainMind-Avg-Power`
    - `X-TrainMind-Max-Power`


## FIT Enhance Endpoints

- `POST /fit-enhance/inspect`
- `POST /fit-enhance/preview`
- `POST /fit-enhance/apply`

### FIT Enhance Workflow

Der Bereich **Tools > Fit Fixer > Enhance FIT File** verändert die Zeitbasis eines markierten Ride-Segments, ohne den Ride zu zerlegen:

1. Eine FIT-Datei laden. Karte, Höhenprofil, Leistung und Herzfrequenz erscheinen auf einer gemeinsamen Zeitachse.
2. Mit normalem Ziehen einen Bereich markieren. Die orangefarbenen Ränder können anschließend einzeln verschoben werden.
3. Mit `Shift` + Ziehen in einen Zeitbereich zoomen; **Zoom zurücksetzen** stellt die Gesamtansicht wieder her.
4. Die gewünschte Segmentdauer in Prozent angeben, etwa `80` für 20 % kürzere Dauer.
5. **Vorschau aktualisieren** berechnet die resultierende Ride-/Segmentdauer und die Segmentleistung mit Geschwindigkeit, Steigung und Fahrwiderstand.
6. Erst danach ist **Enhance FIT speichern** aktiv. Der Export verwendet exakt die Werte aus dieser Vorschau.

Alle drei Endpunkte erwarten `multipart/form-data` mit `file`. Für Vorschau und Export zusätzlich:

- `segment_json`: Objekt mit `start_second`, `end_second` und `duration_percent`
- optional `system_mass_kg` (Default: `83`), `crr` (Default: `0.004`) und `cda_m2` (Default: `0.32`)

Der Export aktualisiert die bekannten Zeit-, Leistungs-, Geschwindigkeits- und Zusammenfassungsfelder und erhält übrige Standard- und Developer-Felder bytegenau. FIT-Dateien mit komprimierten Zeitstempeln werden bewusst abgelehnt, weil eine verlustfreie Zeitverzerrung dieser Datenform noch nicht implementiert ist.

## Activities-Endpoints

- `GET /activities/week`
- `GET /activities/weeks-available`

## Training-Endpoints

- `GET /training/metrics`
- `POST /training/metrics`
- `PATCH /training/metrics/{metric_id}`
- `DELETE /training/metrics/{metric_id}`

## Achievement-Endpoints

- `GET /achievements/{section_key}`

Aktuell verfuegbare `section_key`:

- `cycling`
- `nutrition`
- `health`

### Achievement-Response

Fuer `cycling` wird die Achievement-Welt live aus importierten Aktivitaeten berechnet und in der DB persistiert:

- Achievement-Status (`erreicht` / `noch offen`)
- Datum, wann ein Achievement erreicht wurde
- aktueller Rekordwert mit Datum
- Rekord-Historie als Liste von Verbesserungen mit Datum

## Nutrition-Endpoints (V1)

- `POST /nutrition/entries`
- `GET /nutrition/entries`
- `PATCH /nutrition/entries/{entry_id}`
- `DELETE /nutrition/entries/{entry_id}`
- `POST /nutrition/sync`
- `GET /nutrition/recipes`
- `POST /nutrition/recipes`
- `PATCH /nutrition/recipes/{recipe_id}`
- `DELETE /nutrition/recipes/{recipe_id}`
- `GET /nutrition/food-items/{item_id}`
- `GET /nutrition/food-items/category-counts`
- `POST /nutrition/entries/from-recipe`

### Rezept-Payload (relevant)

`GET/POST/PATCH /nutrition/recipes` liefert bzw. erwartet zusaetzlich zu Name/Sichtbarkeit jetzt auch:

- `notes`
- `preparation`
- `is_favorite`
- `items[]` mit `food_item_id`, `amount_g`, `sort_index`

Abgeleitete Rueckgabefelder:

- `total_weight_g`
- `kcal`, `protein_g`, `carbs_g`, `fat_g`
- `kcal_per_100g`, `protein_per_100g`, `carbs_per_100g`, `fat_per_100g`

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
