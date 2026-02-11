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
- [ ] Build activity endpoints (CRUD + list/filter)
- [ ] Build food entry endpoints (CRUD + daily view)
- [ ] Build dashboard summary endpoints

## Integrations
- [ ] Integrate Garmin pull as a worker job
- [ ] Integrate Withings OAuth flow in API
- [ ] Build normalization layer for provider data

## Database
- [x] Prepare local PostgreSQL via Docker Compose
- [x] Configure Alembic migrations
- [x] Configure seed workflow
- [x] Add TrainMind-specific Postgres image (`trainmind-postgres:16`)
- [ ] Add indexes for common query patterns
- [ ] Evaluate historization/versioning for inbound raw data

## Frontend
- [x] Create initial web app scaffold in `apps/web` (React + Vite + TypeScript)
- [x] Implement modern layout with left navigation and collapsible sections
- [x] Add Start page and placeholder pages for first submenu routes
- [ ] Connect "Check new rides" UI to real Garmin backlog API
- [ ] Build food tracking views
- [ ] Build training comparison visualizations (time range/provider)

## Ops
- [ ] Add CI for tests + lint
- [ ] Decide deployment target (e.g. Render/Railway/Fly)
- [ ] Document PostgreSQL backup strategy
- [ ] Add frontend lint/test/build pipeline
