from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _smtp_settings() -> dict[str, object]:
    use_ssl = _env_flag("SMTP_USE_SSL", False)
    return {
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "465" if use_ssl else "587")),
        "username": os.getenv("SMTP_USER", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from_email": os.getenv("SMTP_FROM_EMAIL", "").strip(),
        "from_name": os.getenv("SMTP_FROM_NAME", "TrainMind").strip() or "TrainMind",
        "reply_to": os.getenv("SMTP_REPLY_TO", "").strip(),
        "use_ssl": use_ssl,
        "use_starttls": _env_flag("SMTP_USE_STARTTLS", not use_ssl),
        "timeout_seconds": int(os.getenv("SMTP_TIMEOUT_SECONDS", "15")),
    }


def smtp_is_configured() -> bool:
    settings = _smtp_settings()
    return bool(settings["host"] and settings["from_email"])


def build_invite_email_message(recipient_email: str, invite_url: str) -> EmailMessage:
    settings = _smtp_settings()
    from_email = str(settings["from_email"])
    from_name = str(settings["from_name"])
    reply_to = str(settings["reply_to"] or from_email)

    message = EmailMessage()
    message["Subject"] = "Deine Einladung zu TrainMind"
    message["From"] = formataddr((from_name, from_email))
    message["To"] = recipient_email
    message["Reply-To"] = reply_to
    message.set_content(
        "\n".join(
            [
                "Hallo,",
                "",
                "du wurdest zu TrainMind eingeladen.",
                "Bitte verwende den folgenden Link, um dein Passwort zu setzen und deinen Zugang zu aktivieren:",
                "",
                invite_url,
                "",
                "Dieser Link ist 7 Tage gueltig.",
                "Bitte antworte nicht auf diese E-Mail.",
            ]
        )
    )
    return message


def send_invite_email(recipient_email: str, invite_url: str) -> dict[str, object]:
    settings = _smtp_settings()
    if not smtp_is_configured():
        return {
            "attempted": False,
            "sent": False,
            "detail": "SMTP is not configured. Share the invite link manually.",
        }

    host = str(settings["host"])
    port = int(settings["port"])
    username = str(settings["username"])
    password = str(settings["password"])
    use_ssl = bool(settings["use_ssl"])
    use_starttls = bool(settings["use_starttls"])
    timeout_seconds = int(settings["timeout_seconds"])
    message = build_invite_email_message(recipient_email, invite_url)

    if username and not password:
        raise ValueError("SMTP password is missing.")

    smtp_client: smtplib.SMTP | smtplib.SMTP_SSL
    if use_ssl:
        smtp_client = smtplib.SMTP_SSL(host, port, timeout=timeout_seconds, context=ssl.create_default_context())
    else:
        smtp_client = smtplib.SMTP(host, port, timeout=timeout_seconds)

    with smtp_client as server:
        if not use_ssl and use_starttls:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        if username:
            server.login(username, password)
        server.send_message(message)

    return {
        "attempted": True,
        "sent": True,
        "detail": f"Invitation email sent to {recipient_email}.",
    }
