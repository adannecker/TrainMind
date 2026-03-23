# TrainMind TODO

## Cleanup / Structure
- [x] Migrate project layout to `apps/`, `packages/`, `infra/`, `data/`
- [x] Remove/move old `src/trainmind` files
- [x] Remove legacy project files (`TrainMind.sln`, `TrainMind.pyproj`)
- [x] Ensure `__init__.py` in relevant Python package folders
- [x] Update README to match new structure and workflows

## FIT Data Model (v1)
- [x] Define target FIT tables: `fit_files`, `fit_file_payloads`, `activities`, `activity_sessions`, `activity_laps`, `activity_records`, `fit_raw_messages`
- [x] Separate normalized metrics and raw provider payloads
- [x] Define dedup keys (`provider` + `external_id`)
- [x] Add first indexes and unique constraints in ORM
- [x] Generate Alembic revision for FIT schema v1
- [x] Extend seed workflow for demo FIT payload/activity
- [ ] Store parsed raw FIT messages in `fit_raw_messages` during import

## Backend / API
- [ ] Define auth concept (local first, then OAuth/JWT)
- [x] Build activity read endpoints for weekly view and Garmin compare/import
- [ ] Build food entry endpoints (CRUD + daily view)
- [ ] Build dashboard summary endpoints

## Integrations
- [x] Integrate Garmin pull/import flow via API endpoints and frontend selection UI
- [ ] Review Garmin-derived activity detail content again and identify missing fields/visuals from stored FIT payloads
- [ ] Integrate Withings OAuth flow in API
- [ ] Build normalization layer for provider data

## Database
- [x] Prepare local PostgreSQL via Docker Compose
- [x] Configure Alembic migrations
- [x] Configure seed workflow
- [x] Add TrainMind-specific Postgres image (`trainmind-postgres:16`)
- [ ] Add indexes for common query patterns
- [ ] Evaluate historization/versioning for inbound raw data
- [x] Repair/backfill Garmin activity metrics from stored raw payloads (`summaryDTO`)
- [x] Populate `activity_laps` from Garmin split summaries when available

## Frontend
- [x] Create initial web app scaffold in `apps/web` (React + Vite + TypeScript)
- [x] Implement modern layout with left navigation and collapsible sections
- [x] Add Start page and placeholder pages for first submenu routes
- [x] Connect "Check new rides" UI to real Garmin backlog API
- [x] Add import progress overlay with live counter and circular progress
- [x] Build weekly activities board (Mon-first bundles + per-day summary)
- [x] Add weekly navigation controls and "weeks with data" selector
- [x] Add weekly performance visualizer (distance/time target progress)
- [ ] Build food tracking views
- [ ] Build training comparison visualizations (time range/provider)
- [x] Add achievement navigation and first live achievement experience
- [x] Persist achievement state and record history in DB
- [x] Add Garmin reset flow for complete re-import testing
- [ ] Expand cycling achievements with more computed milestones and special cases
- [ ] Add visual progress indicators for achievement completion
- [ ] Add many more record types and derived record analytics
- [ ] Add hover/overlay drilldowns for non-record achievements as needed
- [ ] Add activity analytics engine to derive more achievements automatically
- [ ] Fix sorting in activities list for missing numeric values (`-` currently still behaves incorrectly for e.g. avg power / avg HR)
- [ ] Add map integration on activity detail pages
- [ ] Add zoom-out overview with overlay/minimap for activity charts

## Training Product
- [x] Add training navigation with basics, configuration and plans
- [x] Persist FTP and MaxHF history
- [ ] Build activity analytics consistently against time-valid FTP and MaxHF
- [~] Support configurable zone models (Coggan, simplified, Seiler, MaxHF; LTHR and Karvonen pending)
- [ ] Build horizontal zone editor with compact sliders and manual overrides
- [ ] Build full training self-assessment with goals, availability and athlete type
- [ ] Persist training configuration profiles and goal sets
- [ ] Generate suggested plans from training configuration
- [ ] Offer multiple plan variants per focus area (for example many VO2max session styles)
- [ ] Make suggested plans editable before saving
- [ ] Export workouts/plans for Rouvy and Zwift
- [ ] Add source-backed plan libraries and interval collections

## Ops
- [ ] Add CI for tests + lint
- [ ] Decide deployment target (e.g. Render/Railway/Fly)
- [ ] Document PostgreSQL backup strategy
- [ ] Add frontend lint/test/build pipeline
