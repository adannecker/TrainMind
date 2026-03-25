from __future__ import annotations

from sqlalchemy import select

from apps.api.auth_service import create_invite_token, create_invited_user
from apps.api.mail_service import send_invite_email
from packages.db.models import User
from packages.db.session import SessionLocal


def list_users() -> dict[str, list[dict[str, object]]]:
    with SessionLocal() as session:
        users = session.scalars(select(User).order_by(User.created_at.asc(), User.id.asc())).all()
        return {
            "users": [
                {
                    "id": user.id,
                    "email": user.email,
                    "display_name": user.display_name or "",
                    "is_admin": bool(user.is_admin),
                    "has_password": bool(user.password_hash),
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                }
                for user in users
            ]
        }


def create_user_as_admin(email: str, password: str, display_name: str | None = None, *, is_admin: bool = False) -> dict[str, object]:
    result = create_user(email=email, password=password, display_name=display_name, is_admin=is_admin)
    with SessionLocal() as session:
        user = session.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None:
            raise ValueError("User creation failed.")
        return {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name or "",
            "is_admin": bool(user.is_admin),
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "status": result["status"],
        }


def delete_user_as_admin(user_id: int, *, actor_user_id: int) -> dict[str, object]:
    if user_id == actor_user_id:
        raise ValueError("Admin account cannot delete itself.")
    with SessionLocal() as session:
        user = session.scalar(select(User).where(User.id == user_id))
        if user is None:
            raise ValueError("User not found.")
        payload = {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name or "",
            "is_admin": bool(user.is_admin),
        }
        session.delete(user)
        session.commit()
        return {"status": "deleted", "user": payload}


def invite_user_as_admin(email: str, *, app_base_url: str, is_admin: bool = False) -> dict[str, object]:
    user = create_invited_user(email=email, is_admin=is_admin)
    raw_token = create_invite_token(user.id)
    invite_url = f"{app_base_url.rstrip('/')}/set-password?token={raw_token}"
    try:
        email_delivery = send_invite_email(user.email, invite_url)
    except Exception as exc:
        email_delivery = {
            "attempted": True,
            "sent": False,
            "detail": str(exc),
        }
    return {
        "status": "invited",
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name or "",
            "is_admin": bool(user.is_admin),
            "has_password": False,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "invite_url": invite_url,
        "email_delivery": email_delivery,
    }
