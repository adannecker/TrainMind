$composeFile = "infra/docker/docker-compose.yml"
$python = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  throw "Python venv not found at .venv. Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
}

Write-Host "Stopping containers and deleting DB volume..."
docker compose -f $composeFile down -v

Write-Host "Starting fresh Postgres..."
docker compose -f $composeFile up -d

Write-Host "Applying migrations..."
$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgresql+psycopg2://trainmind:trainmind@localhost:5432/trainmind" }
& $python -m alembic -c packages/db/alembic.ini upgrade head

Write-Host "Seeding demo data..."
& $python -m packages.db.seed

Write-Host "DB reset complete."
