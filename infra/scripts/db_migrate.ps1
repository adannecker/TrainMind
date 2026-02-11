$python = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  throw "Python venv not found at .venv. Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
}

$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgresql+psycopg2://trainmind:trainmind@localhost:5432/trainmind" }
& $python -m alembic -c packages/db/alembic.ini upgrade head
