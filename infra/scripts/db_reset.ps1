$composeFile = "infra/docker/docker-compose.yml"

Write-Host "Stopping containers and deleting DB volume..."
docker compose -f $composeFile down -v

Write-Host "Starting fresh Postgres..."
docker compose -f $composeFile up -d

Write-Host "Applying migrations..."
$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgresql+psycopg2://trainmind:trainmind@localhost:5432/trainmind" }
alembic -c packages/db/alembic.ini upgrade head

Write-Host "Seeding demo data..."
python -m packages.db.seed

Write-Host "DB reset complete."
