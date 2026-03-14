from __future__ import annotations

import os
from datetime import datetime

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select

from packages.db.models import ServiceCredential
from packages.db.session import SessionLocal


_ENCRYPTION_ENV_KEYS = ("APP_ENCRYPTION_KEY", "TRAINMIND_ENCRYPTION_KEY")


def _get_encryption_key() -> str:
    for env_key in _ENCRYPTION_ENV_KEYS:
        value = os.getenv(env_key)
        if value:
            return value
    raise ValueError(
        "Missing encryption key. Set APP_ENCRYPTION_KEY (or TRAINMIND_ENCRYPTION_KEY) in environment/.env."
    )


def _get_fernet() -> Fernet:
    key = _get_encryption_key().encode("utf-8")
    try:
        return Fernet(key)
    except Exception as exc:
        raise ValueError(
            "Invalid APP_ENCRYPTION_KEY format. It must be a valid Fernet key."
        ) from exc


def _encrypt(value: str) -> str:
    token = _get_fernet().encrypt(value.encode("utf-8"))
    return token.decode("utf-8")


def _decrypt(value: str) -> str:
    try:
        raw = _get_fernet().decrypt(value.encode("utf-8"))
        return raw.decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Stored credential could not be decrypted (invalid key or corrupted data).") from exc


def set_service_credentials(provider: str, username: str, password: str, user_id: int) -> dict[str, str]:
    cleaned_provider = provider.strip().lower()
    cleaned_username = username.strip()
    cleaned_password = password.strip()
    if not cleaned_provider:
        raise ValueError("Provider is required.")
    if not cleaned_username:
        raise ValueError("Username is required.")
    if not cleaned_password:
        raise ValueError("Password is required.")

    now = datetime.utcnow()
    encrypted_username = _encrypt(cleaned_username)
    encrypted_password = _encrypt(cleaned_password)

    with SessionLocal() as session:
        existing = session.scalar(
            select(ServiceCredential).where(
                ServiceCredential.provider == cleaned_provider,
                ServiceCredential.user_id == user_id,
            )
        )
        if existing is None:
            session.add(
                ServiceCredential(
                    user_id=user_id,
                    provider=cleaned_provider,
                    username_encrypted=encrypted_username,
                    password_encrypted=encrypted_password,
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            existing.username_encrypted = encrypted_username
            existing.password_encrypted = encrypted_password
            existing.updated_at = now
        session.commit()

    return {"provider": cleaned_provider, "status": "saved"}


def get_service_credentials(provider: str, user_id: int) -> tuple[str, str] | None:
    cleaned_provider = provider.strip().lower()
    if not cleaned_provider:
        return None

    with SessionLocal() as session:
        record = session.scalar(
            select(ServiceCredential).where(
                ServiceCredential.provider == cleaned_provider,
                ServiceCredential.user_id == user_id,
            )
        )
        if record is None:
            return None
        return (_decrypt(record.username_encrypted), _decrypt(record.password_encrypted))


def get_service_credentials_status(provider: str, user_id: int) -> dict[str, str | bool]:
    cleaned_provider = provider.strip().lower()
    if not cleaned_provider:
        raise ValueError("Provider is required.")

    with SessionLocal() as session:
        record = session.scalar(
            select(ServiceCredential.id).where(
                ServiceCredential.provider == cleaned_provider,
                ServiceCredential.user_id == user_id,
            )
        )
        has_db_credentials = record is not None

    has_env_credentials = bool(os.getenv(f"{cleaned_provider.upper()}_EMAIL") and os.getenv(f"{cleaned_provider.upper()}_PASSWORD"))

    return {
        "provider": cleaned_provider,
        "has_encrypted_credentials": has_db_credentials,
        "has_env_credentials": has_env_credentials,
        "active_source": "db" if has_db_credentials else ("env" if has_env_credentials else "none"),
    }
