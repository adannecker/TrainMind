# -*- coding: utf-8 -*-
from pathlib import Path
from hashlib import sha256
import os

from garminconnect import Garmin


REPO_ROOT = Path(__file__).resolve().parents[3]
TOKENSTORE_ROOT = REPO_ROOT / "data" / "garmin_tokens" / "standalone"


def _load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_env_file(REPO_ROOT / ".env")

username = os.getenv("GARMIN_EMAIL")
password = os.getenv("GARMIN_PASSWORD")

if not username or not password:
    raise SystemExit("GARMIN_EMAIL und GARMIN_PASSWORD muessen in .env gesetzt sein.")


def _ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass


def _tokenstore_path(email: str) -> Path:
    email_hash = sha256(email.strip().lower().encode("utf-8")).hexdigest()[:16]
    return TOKENSTORE_ROOT / email_hash


def _persist_session(client: Garmin, path: Path) -> None:
    garth_client = getattr(client, "garth", None)
    dump = getattr(garth_client, "dump", None)
    if dump is None:
        return

    _ensure_private_dir(path)
    dump(str(path))
    for json_file in path.glob("*.json"):
        try:
            os.chmod(json_file, 0o600)
        except OSError:
            pass


store = _tokenstore_path(username)
if store.exists() and any(store.glob("*.json")):
    try:
        client = Garmin()
        client.login(str(store))
    except Exception:
        client = Garmin(username, password)
        client.login()
        _persist_session(client, store)
else:
    _ensure_private_dir(store)
    client = Garmin(username, password)
    client.login()
    _persist_session(client, store)

activities = client.get_activities(0, 5)  # letzte 5 Aktivitäten
for a in activities:
    print(a["activityName"], a["distance"], a["duration"])
