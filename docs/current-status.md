# TrainMind Status (Stand: 2026-03-17)

Diese Datei dokumentiert den aktuellen Projektstand und die naechsten konkreten Schritte.

## 1) Was aktuell funktioniert

- Docker-Stack mit Hub und API laeuft lokal stabil auf:
  - Hub: `http://127.0.0.1:8000`
  - API: `http://127.0.0.1:8010`
- Login/Logout mit lokalem Account ist aktiv.
- Garmin-Credentials werden verschluesselt in der DB gespeichert.
- Garmin-Import und Aktivitaetsseiten sind nutzbar.
- Ernaehrung (Web) ist als Arbeitsbereich aktiv.
- Zutaten und Produkte sind getrennte Bereiche:
  - eigener Menuepunkt fuer Produkte
  - Filter, Suche und Kategorien je Bereich getrennt
  - Produkte mit Marke/Hersteller + Barcode
- Naehrwerteingabe mit erweiterten Inhaltsstoffen ist vorhanden.
- LLM-Prompt Export/Import fuer Naehrwertdaten ist vorhanden.
- UI zeigt Kategorien mit Anzahl je Kategorie.
- Forward-Typing/Suchvorschlaege in der Eingabe sind aktiv.
- `name_de` und `name_en` sind im Datenmodell vorhanden und im UI/API angebunden.
- Erste grosse Seed-Basis wurde geladen (aktuell ~800 Eintraege).
- App-Verschluesselung per `APP_ENCRYPTION_KEY` ist vorhanden und fuer sensible Keys/Token nutzbar.
- Rezeptbereich im Web ist deutlich ausgebaut:
  - Rezeptbibliothek rechts mit Suche fuer eigene + oeffentliche Rezepte
  - Rezepte erstellen, bearbeiten, duplizieren, loeschen
  - Favoriten markieren und filtern
  - Zubereitung je Rezept pflegen
  - Einheiten `g`, `ml`, `EL`, `TL` mit lokaler Gramm-Umrechnung
  - Rezept-Overlay mit kumulierten Makro-/Mikronaehrstoffen und Datenabdeckung
- Es gibt aktuell 30 lokale Starter-Rezepte fuer gesundes Sportleressen inkl. Zubereitungstexten.
- `Fix FIT file` ist als neuer Setup-Bereich im Web verfuegbar:
  - FIT-Datei Upload
  - Power-Analyse und Chart-Vorschau
  - Bereichsauswahl direkt im Chart oder per Dual-Slider
  - Watt-Anpassung pro Bereich als `prozentual` oder `fix`
  - Export der angepassten FIT-Datei

## 2) Datenmodell und Migrationen (Nutrition)

Aktuelle relevante Migrationen:

- `20260314_0008_nutrition_global_catalog_and_provenance.py`
- `20260314_0009_food_item_kind_split.py`
- `20260314_0010_food_item_names_i18n.py`
- `20260314_0011_nutrition_recipes.py`
- `20260315_0014_profile_birth_and_gender.py`
- `20260316_0015_recipe_preparation_and_favorites.py`

Wichtige Felder in `nutrition.food_items`:

- `item_kind` (`base_ingredient` / `product`)
- `name_de`
- `name_en`
- Herkunft/Trust/Verifizierung-Felder (fuer Datenqualitaet)

Wichtige Felder in `nutrition.recipes`:

- `name`
- `notes`
- `preparation`
- `visibility`
- `is_favorite`

## 3) Datenqualitaet-Stand (USDA / Uebersetzungen)

- USDA-Verify-Script vorhanden: `infra/scripts/usda_verify_ingredients.py`
- Rate-Tracking vorhanden: `docs/usda-rate-tracker.json`
- Mehrere USDA-Reports wurden erzeugt: `docs/usda-verify-report-*.csv`
- Vollstaendige Namensueberarbeitung mit OpenAI wurde bereits ausgefuehrt:
  - Script: `infra/scripts/translate_food_names_openai.py`
  - Beispiel-Ausgabe: `docs/name-translation-sample-20260314_224339.json`

Aktueller Engpass:

- USDA-API lief zeitweise in ein Stundenlimit/HTTP-Fehler.
- Deshalb sind nicht alle Datensaetze final gegen USDA bestaetigt.

## 4) Offene Punkte (fachlich priorisiert)

1. USDA-Verifizierung erneut starten (nach Limit-Reset).
2. Matching verbessern bei nicht exakt gleichen Namen:
   - Synonyme
   - Normalisierung (Singular/Plural, roh/gekocht)
   - fallback auf Kandidatenliste mit Score
3. Trust/Verifizierungsstatus final setzen:
   - Treffer mit Quelle: `trust_level=high`, `verification_status=verified`
   - unsichere Treffer: `medium`, mit Review-Hinweis
4. Produkte separat befuellen:
   - echte Produktdatensaetze (Marke + Barcode)
   - Zutaten bleiben Basisdaten
5. Portionen/Dichtewerte fuer Rezepte weiter verfeinern.
6. Freie Rezeptquellen fuer moeglichen Import pruefen (inkl. Lizenz-Check).
7. i18n-Grundgeruest im Web vorbereiten (de/en Ressourcen statt harter Texte).
8. UTF-8-Review in UI/Docs final abschliessen.
9. `Fix FIT file` weiter ausbauen:
   - weitere Metriken neben Power
   - feinere Editierlogik fuer Reduktion/Steigerung
   - optionaler Mehrfach-Export (z. B. TCX)

## 5) Naechster geplanter Arbeitsablauf

1. USDA-Lauf mit begrenztem Batch (z. B. 100) starten.
2. Ergebnisquote pruefen (`matched/weak/no_match`).
3. Wenn stabil, in groesseren Batches fortsetzen.
4. Danach selektive manuelle Qualitaetssicherung fuer kritische Lebensmittel.

## 6) Wichtige Skripte

- Stack starten: `infra/scripts/stack_up.ps1`
- DB Migration: `infra/scripts/db_migrate.ps1`
- Seed Basisdaten: `infra/scripts/seed_global_ingredients.py`
- USDA Verify: `infra/scripts/usda_verify_ingredients.py`
- Name-Uebersetzung: `infra/scripts/translate_food_names_openai.py`

## 7) FIT Fix Technischer Stand

- API-Endpunkte vorhanden:
  - `POST /fit-fix/inspect`
  - `POST /fit-fix/apply`
- Backend-Logik:
  - `packages/fit/fit_fix_service.py`
- Web-UI:
  - `Setup > Fix FIT file`
  - Datei-Upload, Analyse, Bereichsauswahl, Power-Anpassung, Download
- Aktuelle erste Ausbaustufe konzentriert sich bewusst auf Power-Korrekturen in bestehenden Power-Records.
