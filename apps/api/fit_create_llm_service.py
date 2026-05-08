from __future__ import annotations

import json
import os
import re
from typing import Any

from apps.api.llm_service import DEFAULT_OPENAI_MODEL, openai_chat_completion


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("Empty LLM response.")
    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("LLM response did not contain JSON.")
    payload = json.loads(text[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("LLM response JSON must be an object.")
    return payload


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_text(value: Any, *, max_length: int = 220) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:max_length]


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _pick(raw: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in raw:
            return raw.get(key)
    return None


def _normalize_date(value: Any, fallback: Any = None) -> str | None:
    text = str(value or fallback or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return None


def _normalize_time(value: Any, fallback: Any = None) -> str | None:
    text = str(value or fallback or "").strip()
    if re.fullmatch(r"\d{2}:\d{2}", text):
        hour, minute = (int(part) for part in text.split(":"))
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return text
    return None


def _normalize_string_list(value: Any, max_items: int = 6) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for raw_item in value:
        text = str(raw_item or "").strip()
        if not text or text in items:
            continue
        items.append(text[:260])
        if len(items) >= max_items:
            break
    return items


def _heat_index_celsius(temp_c: float, humidity_pct: float) -> float:
    if temp_c < 26.7 or humidity_pct < 40:
        return temp_c
    temp_f = temp_c * 1.8 + 32
    rh = _clamp(humidity_pct, 0, 100)
    heat_index_f = (
        -42.379
        + 2.04901523 * temp_f
        + 10.14333127 * rh
        - 0.22475541 * temp_f * rh
        - 0.00683783 * temp_f * temp_f
        - 0.05481717 * rh * rh
        + 0.00122874 * temp_f * temp_f * rh
        + 0.00085282 * temp_f * rh * rh
        - 0.00000199 * temp_f * temp_f * rh * rh
    )
    return (heat_index_f - 32) / 1.8


def _heat_compensation_multiplier(temp_c: float | None, humidity_pct: float | None) -> float | None:
    if temp_c is None or humidity_pct is None:
        return None
    heat_index_c = _heat_index_celsius(temp_c, humidity_pct)
    heat_stress = max(0.0, heat_index_c - 26)
    humidity_stress = max(0.0, humidity_pct - 60)
    dry_heat_stress = max(0.0, temp_c - 30)
    penalty_pct = min(18.0, heat_stress * 0.45 + humidity_stress * 0.03 + dry_heat_stress * 0.3)
    if penalty_pct <= 0:
        return 1.0
    multiplier = 1 / (1 - penalty_pct / 100)
    return round(_clamp(multiplier, 1.0, 1.22), 3)


def _normalize_triplet(
    *,
    raw: dict[str, Any],
    avg_keys: tuple[str, ...],
    min_keys: tuple[str, ...],
    max_keys: tuple[str, ...],
    default_avg: float,
    minimum: float,
    maximum: float,
    low_spread: float,
    high_spread: float,
) -> tuple[float, float, float]:
    avg = _safe_float(_pick(raw, *avg_keys))
    min_value = _safe_float(_pick(raw, *min_keys))
    max_value = _safe_float(_pick(raw, *max_keys))

    if avg is None:
        known = [value for value in (min_value, max_value) if value is not None]
        avg = sum(known) / len(known) if known else default_avg

    avg = _clamp(avg, minimum, maximum)
    if min_value is None:
        min_value = avg * (1 - low_spread)
    if max_value is None:
        max_value = avg * (1 + high_spread)

    min_value = _clamp(min_value, minimum, maximum)
    max_value = _clamp(max_value, minimum, maximum)
    if min_value > max_value:
        min_value, max_value = max_value, min_value
    if avg < min_value:
        avg = min_value
    if avg > max_value:
        avg = max_value
    return (round(avg, 1), round(min_value, 1), round(max_value, 1))


def _normalize_interval(raw: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    duration_minutes = _safe_float(_pick(raw, "duration_minutes", "duration_min", "minutes", "dauer_minuten"))
    if duration_minutes is None:
        duration_seconds = _safe_float(_pick(raw, "duration_seconds", "seconds", "dauer_sekunden"))
        duration_minutes = (duration_seconds / 60) if duration_seconds else None
    if duration_minutes is None:
        duration_minutes = 10
    duration_minutes = round(_clamp(duration_minutes, 0.5, 480), 2)

    avg_power, min_power, max_power = _normalize_triplet(
        raw=raw,
        avg_keys=("avg_power_w", "average_power_w", "power_avg_w", "watt_avg", "watt"),
        min_keys=("min_power_w", "power_min_w", "watt_min"),
        max_keys=("max_power_w", "power_max_w", "watt_max"),
        default_avg=150,
        minimum=0,
        maximum=2500,
        low_spread=0.2,
        high_spread=0.18,
    )
    avg_hr, min_hr, max_hr = _normalize_triplet(
        raw=raw,
        avg_keys=("avg_hr_bpm", "average_hr_bpm", "hr_avg_bpm", "hf_avg", "puls_avg"),
        min_keys=("min_hr_bpm", "hr_min_bpm", "hf_min", "puls_min"),
        max_keys=("max_hr_bpm", "hr_max_bpm", "hf_max", "puls_max"),
        default_avg=128,
        minimum=0,
        maximum=260,
        low_spread=0.12,
        high_spread=0.1,
    )
    avg_cadence, min_cadence, max_cadence = _normalize_triplet(
        raw=raw,
        avg_keys=("avg_cadence_rpm", "average_cadence_rpm", "cadence_avg_rpm", "cadence_avg"),
        min_keys=("min_cadence_rpm", "cadence_min_rpm", "cadence_min"),
        max_keys=("max_cadence_rpm", "cadence_max_rpm", "cadence_max"),
        default_avg=88,
        minimum=0,
        maximum=250,
        low_spread=0.1,
        high_spread=0.1,
    )

    start_hr = _safe_float(_pick(raw, "start_hr_bpm", "hr_start_bpm", "start_hf", "hf_start"))
    end_hr = _safe_float(_pick(raw, "end_hr_bpm", "hr_end_bpm", "end_hf", "hf_end"))
    if start_hr is None:
        start_hr = min_hr
    if end_hr is None:
        end_hr = max(min_hr, min(max_hr, avg_hr + (max_hr - avg_hr) * 0.5))

    return {
        "name": _safe_text(_pick(raw, "name", "label", "title"), max_length=80) or f"Intervall {index + 1}",
        "duration_minutes": duration_minutes,
        "avg_power_w": avg_power,
        "max_power_w": max_power,
        "min_power_w": min_power,
        "avg_hr_bpm": avg_hr,
        "max_hr_bpm": max_hr,
        "min_hr_bpm": min_hr,
        "start_hr_bpm": round(_clamp(start_hr, min_hr, max_hr), 1),
        "end_hr_bpm": round(_clamp(end_hr, min_hr, max_hr), 1),
        "avg_cadence_rpm": avg_cadence,
        "min_cadence_rpm": min_cadence,
        "max_cadence_rpm": max_cadence,
    }


def _fallback_interval(payload: dict[str, Any]) -> dict[str, Any]:
    return _normalize_interval(
        {
            "name": payload.get("name") or "Training",
            "duration_minutes": payload.get("total_duration_minutes") or payload.get("duration_minutes") or 45,
            "avg_power_w": payload.get("avg_power_w") or 150,
            "avg_hr_bpm": payload.get("avg_hr_bpm") or 128,
            "avg_cadence_rpm": payload.get("avg_cadence_rpm") or 88,
        },
        0,
    ) or {
        "name": "Training",
        "duration_minutes": 45,
        "avg_power_w": 150,
        "max_power_w": 177,
        "min_power_w": 120,
        "avg_hr_bpm": 128,
        "max_hr_bpm": 141,
        "min_hr_bpm": 112.6,
        "start_hr_bpm": 112.6,
        "end_hr_bpm": 134.5,
        "avg_cadence_rpm": 88,
        "min_cadence_rpm": 79.2,
        "max_cadence_rpm": 96.8,
    }


def build_fit_create_description_prompt(description: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    text = str(description or "").strip()
    if len(text) < 8:
        raise ValueError("Bitte die Aktivitaet etwas genauer beschreiben.")

    context_payload = {
        "date": _normalize_date((context or {}).get("date")),
        "time": _normalize_time((context or {}).get("time")),
        "temperature_c": _safe_float((context or {}).get("temperature_c")),
        "humidity_pct": _safe_float((context or {}).get("humidity_pct")),
        "system_mass_kg": _safe_float((context or {}).get("system_mass_kg")),
    }
    prompt = (
        "Wandle die folgende natuerliche Beschreibung eines Indoor-Bike-Trainings in strukturierte Daten fuer einen FIT-Datei-Generator um.\n"
        "Aktuell werden nur Trainingsart 'indoor' und Geraet 'technogym_indoor_trainer' unterstuetzt.\n"
        "Nutze explizit genannte Werte zuerst. Fehlende min/max/start/end-Werte plausibel und natuerlich schaetzen.\n"
        "Wenn nur eine Gesamtdauer genannt wird, erstelle sinnvolle Intervalle wie Warmup, Hauptteil und Cooldown.\n"
        "Wenn der Nutzer Serien wie '4x5 min' beschreibt, lege die Wiederholungen als einzelne Intervalle plus sinnvolle Erholungen an.\n"
        "Wenn Temperatur und Luftfeuchtigkeit erkennbar sind, gib sie numerisch zurueck. Ein Watt-Multiplikator ist optional und soll nur Hitzebelastung kompensieren.\n"
        "Halte Werte realistisch: Watt 0-2500, Herzfrequenz 0-260 bpm, Cadence 0-250 rpm, Dauer je Intervall 0.5-480 Minuten.\n\n"
        "Aktueller Formular-Kontext als Fallback:\n"
        f"{json.dumps(context_payload, ensure_ascii=False)}\n\n"
        "Beschreibung:\n"
        f"{text}\n\n"
        "Antworte ausschliesslich mit validem JSON in exakt diesem Schema:\n"
        "{\n"
        '  "summary": "kurze deutsche Zusammenfassung",\n'
        '  "date": "YYYY-MM-DD oder null",\n'
        '  "time": "HH:MM oder null",\n'
        '  "temperature_c": 20.0,\n'
        '  "humidity_pct": 45.0,\n'
        '  "system_mass_kg": 85.0,\n'
        '  "power_multiplier": 1.0,\n'
        '  "intervals": [\n'
        "    {\n"
        '      "name": "Warmup",\n'
        '      "duration_minutes": 10,\n'
        '      "avg_power_w": 120,\n'
        '      "max_power_w": 150,\n'
        '      "min_power_w": 90,\n'
        '      "avg_hr_bpm": 110,\n'
        '      "max_hr_bpm": 125,\n'
        '      "min_hr_bpm": 90,\n'
        '      "start_hr_bpm": 90,\n'
        '      "end_hr_bpm": 122,\n'
        '      "avg_cadence_rpm": 86,\n'
        '      "min_cadence_rpm": 78,\n'
        '      "max_cadence_rpm": 94\n'
        "    }\n"
        "  ],\n"
        '  "assumptions": ["knappe Annahme"]\n'
        "}\n"
        "Keine Markdown-Fences, kein erklaerender Text ausserhalb des JSON."
    )
    return {"prompt": prompt, "context": context_payload}


def derive_fit_create_from_description(*, user_id: int, description: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    prompt_payload = build_fit_create_description_prompt(description, context)
    system_prompt = (
        "You are a precise endurance-training data extractor. Return JSON only. "
        "Do not include markdown, explanations outside JSON, or unsupported fields."
    )
    body = openai_chat_completion(
        user_id=user_id,
        feature_key="fit_create:describe",
        system_prompt=system_prompt,
        user_prompt=str(prompt_payload["prompt"]),
        temperature=0.25,
        timeout=45,
    )
    choice = (body.get("choices") or [{}])[0]
    message = choice.get("message") if isinstance(choice, dict) else None
    content = message.get("content") if isinstance(message, dict) else ""
    payload = _extract_json_object(str(content or ""))

    raw_intervals = payload.get("intervals")
    intervals = [
        normalized
        for index, raw_interval in enumerate(raw_intervals[:40] if isinstance(raw_intervals, list) else [])
        if (normalized := _normalize_interval(raw_interval, index)) is not None
    ]
    if not intervals:
        intervals = [_fallback_interval(payload)]

    temp_c = _safe_float(payload.get("temperature_c"))
    humidity_pct = _safe_float(payload.get("humidity_pct"))
    mass_kg = _safe_float(payload.get("system_mass_kg"))
    if temp_c is not None:
        temp_c = round(_clamp(temp_c, -40, 60), 1)
    if humidity_pct is not None:
        humidity_pct = round(_clamp(humidity_pct, 0, 100), 1)
    if mass_kg is not None:
        mass_kg = round(_clamp(mass_kg, 40, 180), 1)

    model_multiplier = _safe_float(payload.get("power_multiplier"))
    heat_multiplier = _heat_compensation_multiplier(temp_c, humidity_pct)
    if model_multiplier is not None:
        power_multiplier = round(_clamp(model_multiplier, 1.0, 1.3), 3)
    else:
        power_multiplier = heat_multiplier

    model = os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_OPENAI_MODEL
    return {
        "summary": _safe_text(payload.get("summary"), max_length=420) or "Aktivitaet aus Beschreibung strukturiert.",
        "date": _normalize_date(payload.get("date"), (context or {}).get("date")),
        "time": _normalize_time(payload.get("time"), (context or {}).get("time")),
        "temperature_c": temp_c,
        "humidity_pct": humidity_pct,
        "system_mass_kg": mass_kg,
        "power_multiplier": power_multiplier,
        "intervals": intervals,
        "assumptions": _normalize_string_list(payload.get("assumptions")),
        "model": model,
    }
