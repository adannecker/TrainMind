# TrainMind Dokumentation

Diese Dokumentation beschreibt den aktuellen Stand des Projekts.

## Inhalte

- [Architektur](./architecture.md)
- [Services und API](./services-and-api.md)
- [Datenbank und Schemata](./database-and-schemas.md)
- [Backup und Restore](./backup-and-restore.md)
- [Integrationen](./integrations.md)
- [Mobile App](./mobile-app.md)
- [Runbook und Betrieb](./runbook.md)
- [Current Status](./current-status.md)
- [Branding und Prompts](./branding-prompts.md)
- [TODO Roadmap](./todo-roadmap.md)

## Zielbild

TrainMind ist als Hub aufgebaut:

- Ein zentraler Hub (Web UI) fuer Bedienung und Uebersicht
- Mehrere fachliche Services (Garmin, Nutrition, spaeter Withings, weitere)
- Gemeinsame PostgreSQL Datenbank mit getrennten Schemata je Domane

Dadurch kann jeder Bereich spaeter als eigener Microservice ausgebaut werden, ohne dass Datenstrukturen unkontrolliert vermischt werden.

## Hinweis zum Katalog-Dump

Der globale Nutrition-Katalog-Dump liegt in `infra/seed/nutrition_catalog.sql` und ist als versionierter Bestandteil fuer Commits vorgesehen (inkl. Export/Import-Skripten unter `infra/scripts`).
