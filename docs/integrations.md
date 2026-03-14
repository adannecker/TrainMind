# Integrationen

## Garmin (aktiv)

Status: produktiv nutzbar im aktuellen Setup.

Umfang:

- Neue Garmin-Rides pruefen
- Ausgewaehlte Rides importieren
- User-spezifische Credential-Verwaltung
- Verschluesselte Speicherung von Garmin-Login in DB

Technische Punkte:

- Credentials werden zuerst aus DB gelesen (user-scoped).
- Fallback auf ENV kann bestehen, sollte langfristig reduziert werden.

## Nutrition (aktiv, V1)

Status: aktiv in zentraler API.

Umfang:

- Manuelle Erfassung von Eintraegen
- Loeschen/Aktualisieren
- Basis-Sync-Endpunkt fuer spaetere Offline-Sync-Strategie

Hinweis:

- Aktuell nutzt die Web-App diese Endpunkte direkt ueber den Hub-Proxy.
- Ein separater `nutrition-api` Container ist als optionaler Placeholder vorhanden.

## Withings (vorbereitet)

Status: vorbereitet als optionaler Service (`withings-api`), noch kein produktiver End-to-End-Flow im Hub.

Naechste sinnvolle Schritte:

1. OAuth-Flow sauber integrieren.
2. Datenmodell fuer Gewicht/Koerperwerte finalisieren.
3. Sync-Job und Konfliktstrategie definieren.
4. UI-Seiten im Hub ergaenzen.

## Integrationsrichtlinien (Empfehlung)

- Jeder externe Provider als eigenes Integrationsmodul in `packages/integrations`.
- Gemeinsame Fehlerbehandlung (Retry, Rate Limits, Partial Failures).
- Klare Trennung:
  - Transport/Provider Client
  - Mapping auf Domainmodell
  - Persistenz
- Auditierbare Sync-Events (mindestens fuer write-pfade).
