$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgresql+psycopg2://trainmind:trainmind@localhost:5432/trainmind" }
alembic -c packages/db/alembic.ini upgrade head
