# TODO Roadmap

Diese Datei zeigt den aktuellen Fortschritt und die naechsten Umsetzungsphasen.

## Leitplanken

- UTF-8 sauber durchziehen (Umlaute korrekt in App, Web, API, DB).
- Mehrsprachigkeit von Anfang an vorbereiten.
- Erst Web als Referenz-UI ausbauen, danach in Mobile uebernehmen.
- Datenmodell generisch und erweiterbar halten.

## Phase 0: Foundation

- [x] Login im Hub eingefuehrt.
- [x] Sichere Speicherung von Garmin-Credentials (verschluesselt in DB).
- [x] Hub auf Port `8000` als zentrale Oberflaeche etabliert.
- [ ] Encoding-Check in gesamtem App/Web-Frontend final abschliessen.
- [ ] i18n-Struktur einbauen (de als Default, en vorbereitet).
- [ ] UI-Texte in zentrale Translation-Dateien auslagern.
- [ ] Komplette Projektdokumentation auf Englisch umstellen (inkl. README, Runbook, Architektur, API, Roadmap).
- [ ] Benutzerverwaltung erweitern: API-/LLM-Keys pro Nutzer hinterlegbar (verschluesselt mit `APP_ENCRYPTION_KEY`).
- [ ] Kleinen integrierten Workflow bauen: Key erzeugen/beschreiben/eintragen/validieren in einem gefuehrten UI-Flow.

## Phase 1: Nutrition Core (Web-Referenz)

- [x] Kernentitaet fuer Zutaten/Produkte umgesetzt (`nutrition.food_items`).
- [x] Erweiterte Naehrwertfelder inkl. aufklappbarer Zusatzfelder integriert.
- [x] Zutaten-CRUD mit Suche + Forward-Typing umgesetzt.
- [x] LLM-Prompt Export/Import fuer Naehrwerte eingebaut.
- [x] Trennung Zutaten vs. Produkte (eigene Navigation und Filter).
- [x] Kategorien mit Mengenanzeige je Bereich eingebaut.
- [x] Produkt-spezifische Felder (Marke/Hersteller, Barcode) abgetrennt.
- [x] Rezeptmodell (`Recipe`, `RecipeItem`) eingefuehrt.
- [ ] Tages-/Mahlzeit-Log als eigener Flow aufbauen.
- [x] Rezepte per Klick oeffnen und bestehende Rezepte bearbeiten koennen (Name, Bestandteile, Mengen, Sichtbarkeit).
- [x] Mengenlogik erweitert: `g`, `ml`, `EL` (Essloeffel), `TL` (Teeloeffel) inkl. Gramm-Umrechnung.
- [x] Rezeptbibliothek mit Suche fuer eigene + oeffentliche Rezepte umgesetzt.
- [x] Rezepte duplizieren, loeschen und ueber Overlay-Menue bearbeiten.
- [x] Rezept-Detailansicht/Overlay mit kumulierten Makro- und Mikronaehrstoffen umgesetzt.
- [x] Rezeptfelder `Zubereitung` und `Favorit` integriert.
- [x] Starter-Basis mit 30 Sportler-Rezepten inkl. Zubereitung angelegt.
- [ ] Portionen je Produkt/Zutat hinterlegen (z. B. 1 Portion = 30g) und in Gramm umrechnen.
- [ ] Umrechnungsbasis fuer EL/TL definieren (dichte-/produktspezifisch oder konfigurierbare Default-Werte).
- [ ] Beim Erfassen via Forward-Typing den Typ anzeigen: `Rezept`, `Zutat`, `Produkt`.
- [ ] Haeufig genutzte Eintraege/Favoriten speichern und mit zuletzt genutzter Menge direkt auswaehlbar machen.
- [ ] Rezept-Import aus freien Quellen pruefen (z. B. TheMealDB / offene Datensaetze) inkl. Lizenz-Check und Mapping auf lokale Zutaten.
- [ ] In Zutaten/Produkten den Bereich `Herkunft`, `Verifizierung`, `Trust Level` visuell deutlich abheben (eigener Info-Block/Badge-Bereich).
- [ ] `Trust Level` farblich kennzeichnen (z. B. `high=gruen`, `medium=gelb`, `low=rot`) in Formular und Listenansicht.
- [ ] Gesundheitsindikator fuer Zutaten und Produkte einfuehren als gut sichtbarer Marker mit Stufen:
  `sehr positiv`, `neutral`, `eher kontraproduktiv`.
- [ ] Health-Score-Regeln definieren (z. B. Zucker, Salz, Ballaststoffe, Protein, Verarbeitungsgrad) und transparent im UI erklaeren.
- [ ] Indikator auf Produkt- und Rezept-Ebene anzeigen (inkl. kurzer Begruendung in einer Zeile).

## Phase 2: Datenqualitaet und Quellen

- [x] `name_de`/`name_en` im DB-Modell integriert.
- [x] Skripte fuer Namenspflege und USDA-Checks erstellt.
- [x] Erste grosse Datenbasis geladen (~800 Eintraege).
- [ ] USDA-Verifizierung vollstaendig durchlaufen lassen.
- [ ] Matching fuer nicht exakte Namen verbessern (Synonyme/Normalisierung).
- [ ] Trust-/Verifizierungsstatus regelbasiert final setzen.
- [ ] Produkte mit echten Marken/Barcode-Datensaetzen ausbauen.
- [ ] Datenmodell fuer Mikronaehrstoffe erweitern (Vitamine/Mineralstoffe) inkl. `data_available`/`source` pro Naehrwert.
- [ ] Barcode-Flow technisch aufteilen: `barcode_lookup` (Produktdatenbank) + `usda_fallback` (Zutaten/fehlende Felder).
- [ ] Quellenprioritaet im Modell hinterlegen (z. B. `manufacturer` > `barcode_db` > `usda_fallback` > `manual`) und pro Feld versionieren.

## Phase 3: User Profil + Energiebilanz

- [ ] Nutzerprofil erweitern: Gewicht, Zielgewicht, Zieldatum, Alter.
- [ ] Persoenliche Einstellungen ergaenzen: `aktuelles Gewicht`, `Zielgewicht`, optional `Startgewicht`.
- [ ] Zeitraum fuer Zielsetzung erfassen (z. B. 4/8/12 Wochen oder freies Zieldatum) und in allen Auswertungen beruecksichtigen.
- [ ] Historie vorbereiten, damit Gewicht spaeter automatisch ueber externe Services synchronisiert werden kann.
- [ ] Grundumsatz/Tagesverbrauch berechnen (konfigurierbare Formel).
- [ ] Verbrauch durch Sport integrieren (Garmin + spaeter weitere Quellen).
- [ ] Manuelle Sport-Kalorien als Fallback erlauben.
- [ ] Tagesuebersicht: Intake vs. Verbrauch.
- [ ] Plus/Defizit-Indikator.
- [ ] Zielbalken fuer essentielle Kennzahlen (z. B. Eiweiss, Ballaststoffe).
- [ ] Wochenansicht (kompakt).
- [ ] Monatsansicht (kompakt, trendfaehig).
- [ ] Trend-Indikator nach Zeitraum einbauen (Richtung, Tempo, Zielerreichung).

## Phase 4: Mobile Synchronisierung

- [x] Android-Emulator Setup dokumentiert und lokal lauffaehig.
- [x] Mobile Login + Nutrition-Basisflow vorhanden.
- [ ] Token sicher lokal speichern (Secure Storage).
- [ ] Offline-Datenhaltung und Sync-Strategie umsetzen.
- [ ] Web-Referenzoberflaechen schrittweise in Mobile uebertragen.

## Priorisierte naechste 7 Schritte

- [ ] 1. Portionen je Zutat/Produkt sauber definieren und in Gramm umrechnen.
- [ ] 2. Dichte-/Umrechnungsmodell fuer `EL`, `TL`, `ml` weiter verfeinern.
- [ ] 3. Forward-Typing in Erfassung um Typ-Badge erweitern (`Rezept`/`Zutat`/`Produkt`).
- [ ] 4. Favoriten mit zuletzt erfasster Menge in der Erfassung anbieten.
- [ ] 5. USDA-Lauf nach Stundenlimit erneut starten (Batch-basiert).
- [ ] 6. Ergebnisquoten auswerten und Matching-Regeln nachschaerfen.
- [ ] 7. Trust-Level und Verifizierung bei sicheren Treffern automatisch setzen.
