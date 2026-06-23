from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime
from urllib.parse import urlencode

import requests
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from apps.api.credential_service import _decrypt, _encrypt, delete_service_credentials, get_service_credentials, set_service_credentials
from packages.db.models import ServiceCredential, UserProfile, UserWeightLog, WithingsBodyMeasurement
from packages.db.session import SessionLocal

AUTH_URL = "https://account.withings.com/oauth2_user/authorize2"
TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2"
MEASURE_URL = "https://wbsapi.withings.net/measure"
PROVIDER = "withings"
APP_PROVIDER = "withings_app"
DEFAULT_SCOPES = "user.activity,user.metrics"
STATE_MAX_AGE_SECONDS = 15 * 60
MEASURE_TYPES = {
    1: ("weight_kg", "Gewicht", "kg"),
    6: ("fat_ratio_pct", "Körperfett", "%"),
    8: ("fat_mass_kg", "Fettmasse", "kg"),
    170: ("visceral_fat_index", "Viszerales Fett", "Index"),
    76: ("muscle_mass_kg", "Muskelmasse", "kg"),
    88: ("bone_mass_kg", "Knochenmasse", "kg"),
    77: ("hydration_kg", "Wasser", "kg"),
}


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is not configured.")
    return value


def _load_app_credentials(user_id: int | None = None) -> tuple[str, str, str]:
    if user_id is not None:
        stored = get_service_credentials(APP_PROVIDER, int(user_id))
        if stored and stored[0].strip() and stored[1].strip():
            return stored[0].strip(), stored[1].strip(), "user"
    client_id = os.getenv("WITHINGS_CLIENT_ID", "").strip()
    client_secret = os.getenv("WITHINGS_CLIENT_SECRET", "").strip()
    if client_id and client_secret:
        return client_id, client_secret, "env"
    raise ValueError("WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET are not configured.")


def _client_id(user_id: int | None = None) -> str:
    return _load_app_credentials(user_id)[0]


def _client_secret(user_id: int | None = None) -> str:
    return _load_app_credentials(user_id)[1]


def save_withings_app_credentials(user_id: int, client_id: str, client_secret: str) -> dict[str, str]:
    clean_client_id = client_id.strip()
    clean_client_secret = client_secret.strip()
    if not clean_client_id or not clean_client_secret:
        raise ValueError("Withings Client ID and Client Secret are required.")
    return set_service_credentials(APP_PROVIDER, clean_client_id, clean_client_secret, int(user_id))


def delete_withings_app_credentials(user_id: int) -> dict[str, str]:
    return delete_service_credentials(APP_PROVIDER, int(user_id))


def _redirect_uri() -> str:
    return _required_env("WITHINGS_REDIRECT_URI")


def _state_secret() -> bytes:
    value = os.getenv("APP_ENCRYPTION_KEY") or os.getenv("TRAINMIND_ENCRYPTION_KEY") or os.getenv("APP_ENCRYPTION_KY")
    if not value:
        raise ValueError("APP_ENCRYPTION_KEY is required for Withings state signing.")
    return value.encode("utf-8")


def _scopes() -> str:
    raw = os.getenv("WITHINGS_SCOPES", DEFAULT_SCOPES)
    return ",".join([scope.strip() for scope in re.split(r"[,\s]+", raw) if scope.strip()]) or DEFAULT_SCOPES


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode((raw + padding).encode("ascii"))


def _sign(payload: str) -> str:
    return _b64encode(hmac.new(_state_secret(), payload.encode("utf-8"), hashlib.sha256).digest())


def _make_state(user_id: int) -> str:
    payload = _b64encode(json.dumps({"user_id": int(user_id), "iat": int(time.time())}, separators=(",", ":")).encode("utf-8"))
    return f"{payload}.{_sign(payload)}"


def _parse_state(state: str) -> int:
    try:
        payload, signature = state.split(".", 1)
    except ValueError as exc:
        raise ValueError("Invalid Withings state.") from exc
    expected = _sign(payload)
    if not hmac.compare_digest(signature, expected):
        raise ValueError("Invalid Withings state signature.")
    data = json.loads(_b64decode(payload).decode("utf-8"))
    issued_at = int(data.get("iat") or 0)
    if issued_at <= 0 or time.time() - issued_at > STATE_MAX_AGE_SECONDS:
        raise ValueError("Withings state expired. Please start the connection again.")
    user_id = int(data.get("user_id") or 0)
    if user_id <= 0:
        raise ValueError("Invalid Withings state user.")
    return user_id


def build_withings_login_url(user_id: int) -> dict[str, str]:
    params = {
        "response_type": "code",
        "client_id": _client_id(user_id),
        "redirect_uri": _redirect_uri(),
        "scope": _scopes(),
        "state": _make_state(user_id),
    }
    return {
        "status": "ok",
        "authorize_url": f"{AUTH_URL}?{urlencode(params)}",
        "redirect_uri": _redirect_uri(),
        "scopes": params["scope"],
    }


def _store_tokens(user_id: int, token_body: dict) -> dict[str, object]:
    now = datetime.utcnow()
    userid = str(token_body.get("userid") or "withings")
    expires_in = int(token_body.get("expires_in") or 0)
    tokens = {
        "access_token": token_body["access_token"],
        "refresh_token": token_body["refresh_token"],
        "expires_at": time.time() + expires_in,
        "expires_in": expires_in,
        "scope": token_body.get("scope", _scopes()),
        "userid": token_body.get("userid"),
        "received_at": time.time(),
    }
    with SessionLocal() as session:
        existing = session.scalar(
            select(ServiceCredential).where(
                ServiceCredential.user_id == int(user_id),
                ServiceCredential.provider == PROVIDER,
            )
        )
        if existing is None:
            session.add(
                ServiceCredential(
                    user_id=int(user_id),
                    provider=PROVIDER,
                    username_encrypted=_encrypt(userid),
                    password_encrypted=_encrypt(json.dumps(tokens, separators=(",", ":"))),
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            existing.username_encrypted = _encrypt(userid)
            existing.password_encrypted = _encrypt(json.dumps(tokens, separators=(",", ":")))
            existing.updated_at = now
        session.commit()
    return {"status": "connected", "userid": token_body.get("userid"), "scope": tokens["scope"]}



def _load_tokens(user_id: int) -> tuple[ServiceCredential, dict[str, object]]:
    with SessionLocal() as session:
        record = session.scalar(
            select(ServiceCredential).where(
                ServiceCredential.user_id == int(user_id),
                ServiceCredential.provider == PROVIDER,
            )
        )
        if record is None:
            raise ValueError("Withings is not connected.")
        tokens = json.loads(_decrypt(record.password_encrypted))
        session.expunge(record)
        return record, tokens


def _save_tokens(user_id: int, tokens: dict[str, object]) -> None:
    now = datetime.utcnow()
    userid = str(tokens.get("userid") or "withings")
    with SessionLocal() as session:
        record = session.scalar(
            select(ServiceCredential).where(
                ServiceCredential.user_id == int(user_id),
                ServiceCredential.provider == PROVIDER,
            )
        )
        if record is None:
            raise ValueError("Withings is not connected.")
        record.username_encrypted = _encrypt(userid)
        record.password_encrypted = _encrypt(json.dumps(tokens, separators=(",", ":")))
        record.updated_at = now
        session.commit()


def _access_token(user_id: int) -> dict[str, object]:
    _record, tokens = _load_tokens(user_id)
    expires_at = float(tokens.get("expires_at") or 0)
    if expires_at > time.time() + 90 and tokens.get("access_token"):
        return tokens
    refresh_token = str(tokens.get("refresh_token") or "")
    if not refresh_token:
        raise ValueError("Withings refresh token is missing.")
    response = requests.post(
        TOKEN_URL,
        data={
            "action": "requesttoken",
            "grant_type": "refresh_token",
            "client_id": _client_id(user_id),
            "client_secret": _client_secret(),
            "refresh_token": refresh_token,
        },
        timeout=30,
    )
    payload = response.json()
    body = payload.get("body") or {}
    if "access_token" not in body or "refresh_token" not in body:
        raise RuntimeError(f"Withings token refresh failed: {payload}")
    expires_in = int(body.get("expires_in") or 0)
    next_tokens = {
        **tokens,
        "access_token": body["access_token"],
        "refresh_token": body["refresh_token"],
        "expires_at": time.time() + expires_in,
        "expires_in": expires_in,
        "scope": body.get("scope", tokens.get("scope") or _scopes()),
        "userid": body.get("userid", tokens.get("userid")),
        "received_at": time.time(),
    }
    _save_tokens(user_id, next_tokens)
    return next_tokens


def _measure_value(measure: dict[str, object]) -> float:
    return float(measure["value"]) * (10 ** int(measure.get("unit") or 0))


def _normalize_measure_groups(groups: list[dict[str, object]]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for group in groups:
        measured_at = datetime.fromtimestamp(int(group.get("date") or 0)).isoformat()
        values: dict[str, float] = {}
        raw_types: list[int] = []
        for measure in group.get("measures") or []:
            measure_type = int(measure.get("type") or 0)
            config = MEASURE_TYPES.get(measure_type)
            if not config:
                continue
            key, _label, _unit = config
            values[key] = round(_measure_value(measure), 3)
            raw_types.append(measure_type)
        if values:
            rows.append(
                {
                    "measured_at": measured_at,
                    "withings_grpid": group.get("grpid"),
                    "attrib": group.get("attrib"),
                    "category": group.get("category"),
                    "raw_types": sorted(raw_types),
                    **values,
                }
            )
    rows.sort(key=lambda row: str(row["measured_at"]), reverse=True)
    return rows


def _withings_metrics_payload() -> list[dict[str, object]]:
    return [
        {"key": key, "label": label, "unit": unit, "withings_type": measure_type}
        for measure_type, (key, label, unit) in MEASURE_TYPES.items()
    ]


def _serialize_withings_measurement(row: WithingsBodyMeasurement) -> dict[str, object]:
    payload: dict[str, object] = {
        "measured_at": row.measured_at.isoformat(),
        "withings_grpid": row.withings_grpid,
        "attrib": row.attrib,
        "category": row.category,
    }
    for key, _label, _unit in MEASURE_TYPES.values():
        value = getattr(row, key, None)
        if value is not None:
            payload[key] = value
    try:
        payload["raw_types"] = json.loads(row.raw_types_json or "[]")
    except json.JSONDecodeError:
        payload["raw_types"] = []
    return payload


def _read_stored_withings_body_measures(user_id: int, *, limit: int = 1000, userid: object | None = None) -> dict[str, object]:
    max_rows = max(1, min(int(limit), 5000))
    with SessionLocal() as session:
        rows = session.scalars(
            select(WithingsBodyMeasurement)
            .where(WithingsBodyMeasurement.user_id == int(user_id))
            .order_by(WithingsBodyMeasurement.measured_at.desc())
            .limit(max_rows)
        ).all()
    measurements = [_serialize_withings_measurement(row) for row in rows]
    return {
        "status": "ok",
        "connected": True,
        "userid": userid,
        "source": "database",
        "metrics": _withings_metrics_payload(),
        "count": len(measurements),
        "measurements": measurements,
        "weight_import": {"created": 0, "updated_profile": False},
    }


def _int_or_none(value: object) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _float_or_none(value: object) -> float | None:
    try:
        if value is None:
            return None
        parsed = float(value)
        return parsed if parsed == parsed else None
    except (TypeError, ValueError):
        return None


def _store_withings_body_measurements(user_id: int, rows: list[dict[str, object]]) -> dict[str, int]:
    now = datetime.utcnow()
    values: list[dict[str, object]] = []
    seen: set[datetime] = set()
    for row in rows:
        measured_at = datetime.fromisoformat(str(row["measured_at"]))
        if measured_at in seen:
            continue
        seen.add(measured_at)
        item: dict[str, object] = {
            "user_id": int(user_id),
            "measured_at": measured_at,
            "withings_grpid": str(row.get("withings_grpid")) if row.get("withings_grpid") is not None else None,
            "attrib": _int_or_none(row.get("attrib")),
            "category": _int_or_none(row.get("category")),
            "raw_types_json": json.dumps(row.get("raw_types") or [], separators=(",", ":")),
            "synced_at": now,
            "created_at": now,
            "updated_at": now,
        }
        for key, _label, _unit in MEASURE_TYPES.values():
            item[key] = _float_or_none(row.get(key))
        values.append(item)
    if not values:
        return {"created": 0, "updated": 0}

    with SessionLocal() as session:
        existing_count = len(
            session.scalars(
                select(WithingsBodyMeasurement.measured_at).where(
                    WithingsBodyMeasurement.user_id == int(user_id),
                    WithingsBodyMeasurement.measured_at.in_([item["measured_at"] for item in values]),
                )
            ).all()
        )
        stmt = pg_insert(WithingsBodyMeasurement).values(values)
        update_columns = {
            "withings_grpid": stmt.excluded.withings_grpid,
            "attrib": stmt.excluded.attrib,
            "category": stmt.excluded.category,
            "raw_types_json": stmt.excluded.raw_types_json,
            "weight_kg": stmt.excluded.weight_kg,
            "fat_ratio_pct": stmt.excluded.fat_ratio_pct,
            "fat_mass_kg": stmt.excluded.fat_mass_kg,
            "visceral_fat_index": stmt.excluded.visceral_fat_index,
            "muscle_mass_kg": stmt.excluded.muscle_mass_kg,
            "bone_mass_kg": stmt.excluded.bone_mass_kg,
            "hydration_kg": stmt.excluded.hydration_kg,
            "synced_at": stmt.excluded.synced_at,
            "updated_at": stmt.excluded.updated_at,
        }
        session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_withings_body_measurements_user_measured",
                set_=update_columns,
            )
        )
        session.commit()
    return {"created": max(0, len(values) - existing_count), "updated": existing_count}


def fetch_withings_body_measures(user_id: int, *, limit: int = 1000, sync_weight: bool = False) -> dict[str, object]:
    if not sync_weight:
        userid: object | None = None
        try:
            _record, tokens = _load_tokens(user_id)
            userid = tokens.get("userid")
        except ValueError:
            raise
        return _read_stored_withings_body_measures(user_id, limit=limit, userid=userid)

    tokens = _access_token(user_id)
    access_token = str(tokens.get("access_token") or "")
    all_groups: list[dict[str, object]] = []
    offset = 0
    page_limit = 100
    max_rows = max(1, min(int(limit), 5000))
    for _page in range(50):
        response = requests.get(
            MEASURE_URL,
            params={
                "action": "getmeas",
                "meastype": ",".join(str(item) for item in MEASURE_TYPES),
                "category": 1,
                "limit": page_limit,
                "offset": offset,
            },
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30,
        )
        payload = response.json()
        if int(payload.get("status") or 0) != 0:
            raise RuntimeError(f"Withings measure request failed: {payload}")
        body = payload.get("body") or {}
        groups = body.get("measuregrps") or []
        all_groups.extend(groups)
        if len(all_groups) >= max_rows or len(groups) < page_limit:
            break
        offset += page_limit
    rows = _normalize_measure_groups(all_groups[:max_rows])
    stored = _store_withings_body_measurements(user_id, rows)
    imported = _import_weight_logs(user_id, rows)
    result = _read_stored_withings_body_measures(user_id, limit=limit, userid=tokens.get("userid"))
    result["source"] = "withings_sync"
    result["sync_import"] = stored
    result["weight_import"] = imported
    return result


def _import_weight_logs(user_id: int, rows: list[dict[str, object]]) -> dict[str, object]:
    created = 0
    latest_weight: tuple[datetime, float] | None = None
    with SessionLocal() as session:
        now = datetime.utcnow()
        for row in rows:
            weight = row.get("weight_kg")
            if weight is None:
                continue
            recorded_at = datetime.fromisoformat(str(row["measured_at"]))
            existing = session.scalar(
                select(UserWeightLog).where(
                    UserWeightLog.user_id == int(user_id),
                    UserWeightLog.source_type == "withings",
                    UserWeightLog.recorded_at == recorded_at,
                )
            )
            if existing is None:
                session.add(
                    UserWeightLog(
                        user_id=int(user_id),
                        recorded_at=recorded_at,
                        weight_kg=float(weight),
                        source_type="withings",
                        source_label="Withings",
                        notes=f"Withings grpid {row.get('withings_grpid')}" if row.get("withings_grpid") else None,
                        created_at=now,
                    )
                )
                created += 1
            if latest_weight is None or recorded_at > latest_weight[0]:
                latest_weight = (recorded_at, float(weight))
        if latest_weight is not None:
            profile = session.scalar(select(UserProfile).where(UserProfile.user_id == int(user_id)))
            if profile is None:
                profile = UserProfile(
                    user_id=int(user_id),
                    current_weight_kg=latest_weight[1],
                    start_weight_kg=latest_weight[1],
                    created_at=now,
                    updated_at=now,
                )
                session.add(profile)
            else:
                profile.current_weight_kg = latest_weight[1]
                if profile.start_weight_kg is None:
                    profile.start_weight_kg = latest_weight[1]
                profile.updated_at = now
        session.commit()
    return {"created": created, "updated_profile": latest_weight is not None}


def handle_withings_callback(*, code: str | None, state: str | None, error: str | None = None) -> dict[str, object]:
    if error:
        raise ValueError(f"Withings authorization failed: {error}")
    if not code:
        raise ValueError("Missing Withings authorization code.")
    if not state:
        raise ValueError("Missing Withings state.")
    user_id = _parse_state(state)
    response = requests.post(
        TOKEN_URL,
        data={
            "action": "requesttoken",
            "grant_type": "authorization_code",
            "client_id": _client_id(user_id),
            "client_secret": _client_secret(),
            "code": code,
            "redirect_uri": _redirect_uri(),
        },
        timeout=30,
    )
    payload = response.json()
    body = payload.get("body") or {}
    if "access_token" not in body or "refresh_token" not in body:
        raise RuntimeError(f"Withings token exchange failed: {payload}")
    return _store_tokens(user_id, body)


def get_withings_status(user_id: int) -> dict[str, object]:
    env_configured = bool(os.getenv("WITHINGS_CLIENT_ID") and os.getenv("WITHINGS_CLIENT_SECRET"))
    user_app_credentials = get_service_credentials(APP_PROVIDER, int(user_id))
    has_user_app_credentials = bool(user_app_credentials and user_app_credentials[0].strip() and user_app_credentials[1].strip())
    redirect_configured = bool(os.getenv("WITHINGS_REDIRECT_URI"))
    configured = bool((has_user_app_credentials or env_configured) and redirect_configured)
    credential_source = "user" if has_user_app_credentials else ("env" if env_configured else "none")
    client_id_hint = None
    if has_user_app_credentials and user_app_credentials:
        client_id_hint = f"...{user_app_credentials[0][-6:]}" if len(user_app_credentials[0]) >= 6 else user_app_credentials[0]
    elif env_configured:
        env_client_id = os.getenv("WITHINGS_CLIENT_ID", "").strip()
        client_id_hint = f"...{env_client_id[-6:]}" if len(env_client_id) >= 6 else env_client_id
    with SessionLocal() as session:
        record = session.scalar(
            select(ServiceCredential).where(
                ServiceCredential.user_id == int(user_id),
                ServiceCredential.provider == PROVIDER,
            )
        )
        if record is None:
            return {
                "provider": PROVIDER,
                "configured": configured,
                "connected": False,
                "redirect_uri": os.getenv("WITHINGS_REDIRECT_URI") or None,
                "redirect_configured": redirect_configured,
                "credential_source": credential_source,
                "has_user_app_credentials": has_user_app_credentials,
                "has_env_app_credentials": env_configured,
                "client_id_hint": client_id_hint,
                "scopes": _scopes(),
                "userid": None,
                "scope": None,
                "expires_at": None,
            }
        userid = _decrypt(record.username_encrypted)
        tokens = json.loads(_decrypt(record.password_encrypted))
        expires_at = tokens.get("expires_at")
        return {
            "provider": PROVIDER,
            "configured": configured,
            "connected": True,
            "redirect_uri": os.getenv("WITHINGS_REDIRECT_URI") or None,
            "redirect_configured": redirect_configured,
            "credential_source": credential_source,
            "has_user_app_credentials": has_user_app_credentials,
            "has_env_app_credentials": env_configured,
            "client_id_hint": client_id_hint,
            "scopes": _scopes(),
            "userid": userid,
            "scope": tokens.get("scope"),
            "expires_at": datetime.fromtimestamp(float(expires_at)).isoformat() if expires_at else None,
        }
