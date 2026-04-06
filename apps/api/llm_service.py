from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from typing import Any

import requests
from sqlalchemy import func, select

from packages.db.models import LlmUsageEvent
from packages.db.session import SessionLocal

OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_ORG_COSTS_URL = "https://api.openai.com/v1/organization/costs"
DEFAULT_OPENAI_MODEL = "gpt-4.1-mini"


def _utcnow() -> datetime:
    return datetime.utcnow()


def _extract_usage_metrics(body: dict[str, Any] | None) -> dict[str, int | None]:
    usage = body.get("usage") if isinstance(body, dict) else None
    if not isinstance(usage, dict):
        return {
            "input_tokens": None,
            "output_tokens": None,
            "total_tokens": None,
        }
    return {
        "input_tokens": _safe_int(usage.get("prompt_tokens") or usage.get("input_tokens")),
        "output_tokens": _safe_int(usage.get("completion_tokens") or usage.get("output_tokens")),
        "total_tokens": _safe_int(usage.get("total_tokens")),
    }


def _safe_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def log_llm_usage_event(
    *,
    user_id: int,
    provider: str = "openai",
    feature_key: str,
    model: str | None,
    status: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    total_tokens: int | None = None,
    latency_ms: int | None = None,
    error_message: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    with SessionLocal() as session:
        session.add(
            LlmUsageEvent(
                user_id=user_id,
                provider=provider,
                feature_key=feature_key,
                model=model,
                status=status,
                request_count=1,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                latency_ms=latency_ms,
                error_message=(error_message or "").strip()[:1000] or None,
                metadata_json=json.dumps(metadata, ensure_ascii=False) if metadata else None,
            )
        )
        session.commit()


def openai_chat_completion(
    *,
    user_id: int,
    feature_key: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.5,
    timeout: int = 45,
) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not configured.")

    model = os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_OPENAI_MODEL
    started_at = _utcnow()
    try:
        response = requests.post(
            OPENAI_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": temperature,
            },
            timeout=timeout,
        )
    except requests.RequestException as exc:
        latency_ms = max(0, int((_utcnow() - started_at).total_seconds() * 1000))
        log_llm_usage_event(
            user_id=user_id,
            feature_key=feature_key,
            model=model,
            status="error",
            latency_ms=latency_ms,
            error_message=str(exc),
            metadata={"http_status": None},
        )
        raise RuntimeError(f"OpenAI request failed: {exc}") from exc
    latency_ms = max(0, int((_utcnow() - started_at).total_seconds() * 1000))

    try:
        body = response.json()
    except ValueError:
        body = {}

    usage = _extract_usage_metrics(body if isinstance(body, dict) else {})
    metadata = {
        "http_status": response.status_code,
    }

    if response.status_code >= 400:
        detail = (
            body.get("error", {}).get("message")
            if isinstance(body, dict)
            else None
        ) or response.text.strip() or "LLM request failed."
        log_llm_usage_event(
            user_id=user_id,
            feature_key=feature_key,
            model=model,
            status="error",
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            total_tokens=usage["total_tokens"],
            latency_ms=latency_ms,
            error_message=detail,
            metadata=metadata,
        )
        raise RuntimeError(detail)

    log_llm_usage_event(
        user_id=user_id,
        feature_key=feature_key,
        model=model,
        status="success",
        input_tokens=usage["input_tokens"],
        output_tokens=usage["output_tokens"],
        total_tokens=usage["total_tokens"],
        latency_ms=latency_ms,
        metadata=metadata,
    )
    return body if isinstance(body, dict) else {}


def _parse_cost_total(body: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(body, dict):
        return None
    buckets = body.get("data")
    if not isinstance(buckets, list):
        return None

    total_value = 0.0
    currency = None
    for bucket in buckets:
        if not isinstance(bucket, dict):
            continue
        results = bucket.get("results")
        if isinstance(results, list):
            for result in results:
                if not isinstance(result, dict):
                    continue
                amount = result.get("amount")
                if not isinstance(amount, dict):
                    continue
                value = _safe_float(amount.get("value"))
                if value is None:
                    continue
                total_value += value
                currency = currency or amount.get("currency")
        else:
            amount = bucket.get("amount")
            if isinstance(amount, dict):
                value = _safe_float(amount.get("value"))
                if value is not None:
                    total_value += value
                    currency = currency or amount.get("currency")

    return {
        "value": round(total_value, 4),
        "currency": currency or "usd",
    }


def fetch_openai_cost_summary(days: int) -> dict[str, Any]:
    admin_key = os.getenv("OPENAI_ADMIN_KEY", "").strip()
    if not admin_key:
        return {
            "available": False,
            "value": None,
            "currency": None,
            "message": "OPENAI_ADMIN_KEY ist nicht gesetzt.",
        }

    start_time = int((_utcnow() - timedelta(days=max(1, days))).timestamp())
    try:
        response = requests.get(
            OPENAI_ORG_COSTS_URL,
            headers={"Authorization": f"Bearer {admin_key}"},
            params={
                "start_time": start_time,
                "bucket_width": "1d",
                "limit": min(max(days, 1), 31),
            },
            timeout=20,
        )
    except requests.RequestException as exc:
        return {
            "available": False,
            "value": None,
            "currency": None,
            "message": f"OpenAI costs request failed: {exc}",
        }

    try:
        body = response.json()
    except ValueError:
        body = {}

    if response.status_code >= 400:
        detail = (
            body.get("error", {}).get("message")
            if isinstance(body, dict)
            else None
        ) or response.text.strip() or "OpenAI costs endpoint failed."
        return {
            "available": False,
            "value": None,
            "currency": None,
            "message": detail,
        }

    total = _parse_cost_total(body if isinstance(body, dict) else {})
    if not total:
        return {
            "available": False,
            "value": None,
            "currency": None,
            "message": "Keine Kosteninformationen von OpenAI erhalten.",
        }
    return {
        "available": True,
        "value": total["value"],
        "currency": total["currency"],
        "message": None,
    }


def get_llm_status(user_id: int, *, include_org_costs: bool) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_OPENAI_MODEL
    now = _utcnow()
    since_7d = now - timedelta(days=7)
    since_30d = now - timedelta(days=30)

    with SessionLocal() as session:
        totals_30d = session.execute(
            select(
                func.count(LlmUsageEvent.id),
                func.coalesce(func.sum(LlmUsageEvent.input_tokens), 0),
                func.coalesce(func.sum(LlmUsageEvent.output_tokens), 0),
                func.coalesce(func.sum(LlmUsageEvent.total_tokens), 0),
                func.coalesce(func.sum(LlmUsageEvent.request_count), 0),
                func.max(LlmUsageEvent.created_at),
            ).where(
                LlmUsageEvent.user_id == user_id,
                LlmUsageEvent.created_at >= since_30d,
            )
        ).one()
        success_30d = session.scalar(
            select(func.count(LlmUsageEvent.id)).where(
                LlmUsageEvent.user_id == user_id,
                LlmUsageEvent.created_at >= since_30d,
                LlmUsageEvent.status == "success",
            )
        ) or 0
        error_30d = session.scalar(
            select(func.count(LlmUsageEvent.id)).where(
                LlmUsageEvent.user_id == user_id,
                LlmUsageEvent.created_at >= since_30d,
                LlmUsageEvent.status == "error",
            )
        ) or 0
        requests_7d = session.scalar(
            select(func.coalesce(func.sum(LlmUsageEvent.request_count), 0)).where(
                LlmUsageEvent.user_id == user_id,
                LlmUsageEvent.created_at >= since_7d,
            )
        ) or 0
        recent_rows = session.scalars(
            select(LlmUsageEvent)
            .where(LlmUsageEvent.user_id == user_id)
            .order_by(LlmUsageEvent.created_at.desc())
            .limit(12)
        ).all()

    org_costs = {
        "today": {"available": False, "value": None, "currency": None, "message": "Nur fuer Admins sichtbar."},
        "last_7_days": {"available": False, "value": None, "currency": None, "message": "Nur fuer Admins sichtbar."},
        "last_30_days": {"available": False, "value": None, "currency": None, "message": "Nur fuer Admins sichtbar."},
    }
    if include_org_costs:
        org_costs = {
            "today": fetch_openai_cost_summary(1),
            "last_7_days": fetch_openai_cost_summary(7),
            "last_30_days": fetch_openai_cost_summary(30),
        }

    return {
        "provider": "openai",
        "configured": bool(api_key),
        "key_hint": f"...{api_key[-6:]}" if len(api_key) >= 6 else None,
        "model": model,
        "admin_key_configured": bool(os.getenv("OPENAI_ADMIN_KEY", "").strip()),
        "balance_available": False,
        "balance_value": None,
        "balance_currency": None,
        "balance_note": (
            "OpenAI stellt offiziell Usage- und Costs-Daten bereit, aber kein direktes verbleibendes Prepaid-Guthaben per dokumentierter API."
        ),
        "org_costs": org_costs,
        "local_usage": {
            "last_7_days_requests": int(requests_7d),
            "last_30_days_requests": int(totals_30d[4] or 0),
            "last_30_days_success": int(success_30d),
            "last_30_days_errors": int(error_30d),
            "last_30_days_input_tokens": int(totals_30d[1] or 0),
            "last_30_days_output_tokens": int(totals_30d[2] or 0),
            "last_30_days_total_tokens": int(totals_30d[3] or 0),
            "last_used_at": totals_30d[5].isoformat() if totals_30d[5] else None,
        },
        "recent_events": [
            {
                "id": row.id,
                "feature_key": row.feature_key,
                "model": row.model,
                "status": row.status,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "total_tokens": row.total_tokens,
                "latency_ms": row.latency_ms,
                "created_at": row.created_at.isoformat(),
                "error_message": row.error_message,
            }
            for row in recent_rows
        ],
    }
