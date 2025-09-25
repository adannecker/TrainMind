# src/trainmind/garmin_pull_last3.py
# -*- coding: utf-8 -*-
"""
Pull the last 3 new Garmin activities and store both JSON and FIT files.

- Uses unofficial 'garminconnect' lib (username/password login).
- Skips activities already present locally (by activityId or filename).
- Filenames: YYMMDD_HHMM_<sanitized-activity-name>.json/.fit
- JSON includes 'activityId' for later DB import.
- Stores a tiny index manifest at data/exports/_index.json to speed up duplicate checks.

Env:
  GARMIN_EMAIL, GARMIN_PASSWORD  (or provide a .env file in repo root)

Install:
  pip install garminconnect python-dotenv
"""

from __future__ import annotations
import os
import re
import json
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List

# Third-party
try:
    from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectConnectionError
except ImportError as e:
    raise SystemExit(
        "Missing dependency. Please run: pip install garminconnect\n"
        f"Original error: {e}"
    )

try:
    from dotenv import load_dotenv
except ImportError:
    # dotenv is optional; environment variables can be set by other means
    def load_dotenv(*args, **kwargs):
        return False


# -------------------- Configuration --------------------
REPO_ROOT = Path(__file__).resolve().parents[2]  # .../TrainMind
EXPORT_DIR = REPO_ROOT / "data" / "exports"
MANIFEST_PATH = EXPORT_DIR / "_index.json"
MAX_TO_FETCH = 3  # user requirement


# -------------------- Helpers --------------------
def sanitize_filename(s: str, maxlen: int = 60) -> str:
    """Make a safe filename segment from an activity name."""
    if not s:
        s = "activity"
    s = s.strip()
    # Replace spaces & slashes, drop other unsafe chars
    s = re.sub(r"[^\w\-. ]+", "", s, flags=re.UNICODE)
    s = s.replace(" ", "_")
    s = s.strip("._")
    if not s:
        s = "activity"
    return s[:maxlen]

def ensure_dirs() -> None:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

def load_manifest() -> Dict[str, Any]:
    if MANIFEST_PATH.exists():
        try:
            return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except Exception:
            # Corrupt manifest — start clean
            return {"downloaded_ids": []}
    return {"downloaded_ids": []}

def save_manifest(manifest: Dict[str, Any]) -> None:
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

def already_downloaded(activity_id: int, base_name: str, manifest: Dict[str, Any]) -> bool:
    """Check by id and by files on disk."""
    if str(activity_id) in set(map(str, manifest.get("downloaded_ids", []))):
        return True
    json_path = EXPORT_DIR / f"{base_name}.json"
    fit_path = EXPORT_DIR / f"{base_name}.fit"
    return json_path.exists() and fit_path.exists()

def ts_to_local_str(start_time_local: str | None, start_time_gmt: str | None) -> str:
    """
    Garmin returns startTimeLocal like '2025-09-24 18:35:12'.
    Fallback to GMT when needed.
    Output: 'YYMMDD_HHMM'
    """
    raw = start_time_local or start_time_gmt
    if not raw:
        # fallback to now
        return datetime.now().strftime("%y%m%d_%H%M")
    # Normalize possible formats
    raw = raw.replace("T", " ").replace("Z", "").replace(".0", "")
    try:
        dt = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            dt = datetime.fromisoformat(raw)
        except Exception:
            return datetime.now().strftime("%y%m%d_%H%M")
    return dt.strftime("%y%m%d_%H%M")


# -------------------- Core logic --------------------
def login_garmin() -> Garmin:
    load_dotenv(dotenv_path=REPO_ROOT / ".env")
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        raise SystemExit(
            "Please set GARMIN_EMAIL and GARMIN_PASSWORD (env or .env in repo root)."
        )
    g = Garmin(email, password)
    try:
        g.login()
    except GarminConnectAuthenticationError as e:
        raise SystemExit(f"Garmin auth failed: {e}")
    except GarminConnectConnectionError as e:
        # transient network: retry briefly
        time.sleep(2)
        g.login()
    return g

def fetch_last_activities(client: Garmin, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Pulls the latest 'limit' activities metadata. We'll then pick the first 3 new ones.
    """
    # get_activities(start, limit) returns a list dicts (latest first)
    return client.get_activities(0, limit)

def download_fit(client: Garmin, activity_id: int, dest_path: Path) -> None:
    """
    Download the ORIGINAL/FIT file for an activity.
    """
    # Some versions expose 'download_activity' with format enum:
    try:
        content = client.download_activity(activity_id, dl_fmt=client.ActivityDownloadFormat.ORIGINAL)
        dest_path.write_bytes(content)
        return
    except AttributeError:
        # Fallback for older api: download_activity_original returns bytes
        pass

    # Alternative known methods in the library:
    try:
        content = client.download_activity_original(activity_id)
        dest_path.write_bytes(content)
        return
    except Exception as e:
        raise

def save_activity_json(activity: Dict[str, Any], dest_path: Path) -> None:
    dest_path.write_text(json.dumps(activity, ensure_ascii=False, indent=2), encoding="utf-8")

def main():
    ensure_dirs()
    manifest = load_manifest()
    client = login_garmin()

    # Get a bunch, we will filter to "new" and cap at 3 actually saved
    all_recent = fetch_last_activities(client, limit=15)

    saved = 0
    downloaded_ids = set(map(str, manifest.get("downloaded_ids", [])))

    for a in all_recent:
        # Different keys depend on GC version; make it robust:
        activity_id = a.get("activityId") or a.get("activityIdLong") or a.get("summaryId") or a.get("activityIdStr")
        if activity_id is None:
            # try yet another known field name
            activity_id = a.get("id")
        if activity_id is None:
            # if still none, skip (we need ID for FIT download)
            continue
        activity_id = int(str(activity_id))

        # Build base filename
        start_local = a.get("startTimeLocal") or a.get("startTimeLocalGMT") or a.get("activityStartTimeLocal")
        start_gmt = a.get("startTimeGMT") or a.get("startTimeUtc")
        ts_part = ts_to_local_str(start_local, start_gmt)
        name = a.get("activityName") or a.get("activityType", {}).get("typeKey") or "activity"
        base = f"{ts_part}_{sanitize_filename(name)}"

        if already_downloaded(activity_id, base, manifest):
            # Also mark in manifest if the files exist but id not recorded
            downloaded_ids.add(str(activity_id))
            continue

        # Enrich JSON with explicit activityId (if not present)
        if "activityId" not in a:
            a["activityId"] = activity_id

        # Save JSON
        json_path = EXPORT_DIR / f"{base}.json"
        save_activity_json(a, json_path)

        # Save FIT
        fit_path = EXPORT_DIR / f"{base}.fit"
        try:
            download_fit(client, activity_id, fit_path)
        except Exception as e:
            # If FIT fails, remove JSON to keep consistency
            try:
                json_path.unlink(missing_ok=True)
            except Exception:
                pass
            raise SystemExit(f"Failed to download FIT for {activity_id}: {e}")

        downloaded_ids.add(str(activity_id))
        saved += 1
        if saved >= MAX_TO_FETCH:
            break

    # Update manifest
    manifest["downloaded_ids"] = sorted(downloaded_ids, key=int)
    save_manifest(manifest)

    print(f"Done. Saved {saved} new activities to {EXPORT_DIR}")

if __name__ == "__main__":
    main()
