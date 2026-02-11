$python = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  throw "Python venv not found at .venv. Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
}

& $python -m packages.db.seed
