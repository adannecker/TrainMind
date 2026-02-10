# packages/integrations/withings/withings_test_flask.py
# Minimal Withings + Flask test for TrainMind

import os
import json
import time
import datetime
import secrets
import re
from pathlib import Path
from urllib.parse import urlencode

import requests
from flask import Flask, request, redirect, jsonify
from dotenv import load_dotenv

# ---------------------------
# Env & paths
# ---------------------------
load_dotenv()

CLIENT_ID = os.getenv("WITHINGS_CLIENT_ID")
CLIENT_SECRET = os.getenv("WITHINGS_CLIENT_SECRET")
REDIRECT_URI = os.getenv("WITHINGS_REDIRECT_URI")
SCOPES_RAW = os.getenv("WITHINGS_SCOPES", "user.activity,user.metrics")
# Leerzeichen oder mehrere Kommas sauber in Kommas umwandeln:
SCOPES = ",".join([s.strip() for s in re.split(r"[,\s]+", SCOPES_RAW) if s.strip()])

# Project root = TrainMind (new package layout)
BASE_DIR = Path(__file__).resolve().parents[4]
EXPORTS_DIR = BASE_DIR / "data" / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

TOKENS_FILE = BASE_DIR / "data" / "withings_tokens.json"

AUTH_URL = "https://account.withings.com/oauth2_user/authorize2"
TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2"
MEASURE_URL = "https://wbsapi.withings.net/measure"

# Helpful console output
print("WITHINGS_CLIENT_ID:", (CLIENT_ID or "MISSING"))
print("WITHINGS_REDIRECT_URI:", (REDIRECT_URI or "MISSING"))
print("Exports dir:", EXPORTS_DIR)
print("Tokens file:", TOKENS_FILE)

# ---------------------------
# Token utils
# ---------------------------
def load_tokens() -> dict:
    if TOKENS_FILE.exists():
        return json.loads(TOKENS_FILE.read_text())
    return {}

def save_tokens(t: dict) -> None:
    TOKENS_FILE.write_text(json.dumps(t, indent=2))

def tokens_expired(t: dict) -> bool:
    return not t or time.time() >= t.get("expires_at", 0)

def refresh_tokens(t: dict) -> dict:
    """Refresh tokens using Withings refreshtoken action."""
    data = {
        "action": "refreshtoken",
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": t["refresh_token"],
    }
    r = requests.post(TOKEN_URL, data=data, timeout=30)
    resp = r.json()
    body = resp.get("body", {})
    if "access_token" not in body:
        raise RuntimeError(f"Token refresh failed: {resp}")
    t["access_token"] = body["access_token"]
    t["refresh_token"] = body.get("refresh_token", t["refresh_token"])
    t["expires_at"] = time.time() + body.get("expires_in", 0)
    t["scope"] = body.get("scope", t.get("scope", SCOPES))
    save_tokens(t)
    return t

def get_valid_tokens() -> dict:
    t = load_tokens()
    if tokens_expired(t):
        if not t:
            raise RuntimeError("No tokens stored yet. Run /login first.")
        t = refresh_tokens(t)
    return t

# ---------------------------
# Flask app & routes
# ---------------------------
app = Flask(__name__)
STATE = secrets.token_urlsafe(24)  # simple demo state

@app.get("/")
def root():
    return (
        "Withings test is running. "
        "Endpoints: /login, /callback, /measures, /export"
    )

@app.get("/login")
def login():
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": STATE,
    }
    return redirect(f"{AUTH_URL}?{urlencode(params)}")

@app.route("/callback", methods=["GET", "HEAD"])
def callback():
    # Withings "Test" button often sends HEAD ? always OK
    if request.method == "HEAD":
        return ("", 200)

    # Manual browser check without code
    if "code" not in request.args:
        return ("Callback alive (no code).", 200)

    # For real flow, check state if provided
    st = request.args.get("state")
    if st is not None and st != STATE:
        return ("State mismatch", 400)

    code = request.args.get("code")
    data = {
        "action": "requesttoken",
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "redirect_uri": REDIRECT_URI,
    }
    r = requests.post(TOKEN_URL, data=data, timeout=30)
    payload = r.json()
    body = payload.get("body", {})

    if "access_token" not in body:
        # Return full payload for debugging if something is off
        return (json.dumps(payload), 400, {"Content-Type": "application/json"})

    tokens = {
        "access_token": body["access_token"],
        "refresh_token": body["refresh_token"],
        "expires_at": time.time() + body.get("expires_in", 0),
        "scope": body.get("scope", SCOPES),
        "userid": body.get("userid"),
        "received_at": time.time(),
    }
    save_tokens(tokens)
    return jsonify({"ok": True, "scope": tokens["scope"], "userid": tokens.get("userid")})

@app.get("/measures")
def measures():
    try:
        t = get_valid_tokens()
    except Exception as e:
        return (str(e), 400)

    headers = {"Authorization": f"Bearer {t['access_token']}"}
    resp = requests.post(MEASURE_URL, data={"action": "getmeas"}, headers=headers, timeout=30)
    return (resp.text, resp.status_code, {"Content-Type": "application/json"})

@app.get("/export")
def export():
    try:
        t = get_valid_tokens()
    except Exception as e:
        return (str(e), 400)

    headers = {"Authorization": f"Bearer {t['access_token']}"}
    resp = requests.post(MEASURE_URL, data={"action": "getmeas"}, headers=headers, timeout=30)
    payload = resp.text

    ts = datetime.datetime.now().strftime("%y%m%d_%H%M")
    fname = EXPORTS_DIR / f"{ts}_withings_measure.json"
    fname.write_text(payload)
    return jsonify({"saved": str(fname), "bytes": len(payload)})

if __name__ == "__main__":
    # debug=False avoids auto-reload glitches with tunnels
    app.run(host="0.0.0.0", port=8000, debug=False)

