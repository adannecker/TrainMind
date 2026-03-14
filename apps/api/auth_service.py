from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select

from packages.db.models import User, UserSession
from packages.db.session import SessionLocal


SESSION_HOURS = 24 * 14


def _utcnow() -> datetime:
    return datetime.utcnow()


def hash_password(password: str, *, iterations: int = 200_000) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algorithm, iter_s, salt_b64, digest_b64 = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iter_s)
        salt = base64.b64decode(salt_b64.encode("utf-8"))
        expected = base64.b64decode(digest_b64.encode("utf-8"))
    except Exception:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_user(email: str, password: str, display_name: str | None = None) -> dict[str, str]:
    clean_email = email.strip().lower()
    if not clean_email:
        raise ValueError("Email is required.")
    if not password.strip():
        raise ValueError("Password is required.")
    now = _utcnow()
    with SessionLocal() as session:
        existing = session.scalar(select(User.id).where(User.email == clean_email))
        if existing is not None:
            raise ValueError("User already exists.")
        user = User(
            email=clean_email,
            display_name=(display_name.strip() if display_name else None),
            password_hash=hash_password(password),
            created_at=now,
        )
        session.add(user)
        session.commit()
    return {"status": "created", "email": clean_email}


def login_user(email: str, password: str) -> dict[str, str | int]:
    clean_email = email.strip().lower()
    with SessionLocal() as session:
        user = session.scalar(select(User).where(User.email == clean_email))
        if user is None or not verify_password(password, user.password_hash):
            raise ValueError("Invalid email or password.")

        user_id = user.id
        user_email = user.email
        raw_token = secrets.token_urlsafe(48)
        now = _utcnow()
        expires = now + timedelta(hours=SESSION_HOURS)
        session.add(
            UserSession(
                user_id=user_id,
                token_hash=_token_hash(raw_token),
                created_at=now,
                expires_at=expires,
            )
        )
        session.commit()

    return {"token": raw_token, "user_id": user_id, "email": user_email, "expires_at": expires.isoformat()}


def logout_user(token: str) -> None:
    with SessionLocal() as session:
        row = session.scalar(select(UserSession).where(UserSession.token_hash == _token_hash(token)))
        if row is not None:
            session.delete(row)
            session.commit()


def get_current_user_from_token(token: str) -> dict[str, str | int]:
    with SessionLocal() as session:
        row = session.scalar(
            select(UserSession)
            .where(UserSession.token_hash == _token_hash(token))
            .where(UserSession.expires_at > _utcnow())
        )
        if row is None:
            raise ValueError("Invalid or expired session.")
        user = session.scalar(select(User).where(User.id == row.user_id))
        if user is None:
            raise ValueError("User not found.")
        return {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name or "",
        }
