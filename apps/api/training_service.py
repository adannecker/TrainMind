from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import requests
from sqlalchemy import select

from packages.db.models import UserTrainingMetric, UserTrainingZoneSetting
from packages.db.session import SessionLocal

ALLOWED_METRIC_TYPES = {"ftp", "max_hr"}

DEFAULT_ZONE_COLORS: dict[str, list[str]] = {
    "ftp": ["#7C7691", "#6D8FD0", "#59B78F", "#F1D96A", "#E7A458", "#D45D76", "#B86AD6"],
    "max_hr": ["#7C7691", "#6D8FD0", "#59B78F", "#F1D96A", "#E7A458"],
}

ZONE_MODEL_DEFINITIONS: dict[str, list[dict[str, Any]]] = {
    "ftp": [
        {
            "key": "coggan_classic",
            "label": "Coggan 7 Zonen",
            "description": "Der verbreitete Standard fuer FTP-basierte Leistungszonen.",
            "is_default": True,
            "zones": [
                {"label": "Z1 Active Recovery", "min": 0.0, "max": 0.55, "detail": "Locker rollen und Erholung"},
                {"label": "Z2 Endurance", "min": 0.56, "max": 0.75, "detail": "Ruhige Grundlage"},
                {"label": "Z3 Tempo", "min": 0.76, "max": 0.9, "detail": "Zuegige Ausdauer"},
                {"label": "Z4 Lactate Threshold", "min": 0.91, "max": 1.05, "detail": "Nahe an FTP"},
                {"label": "Z5 VO2max", "min": 1.06, "max": 1.2, "detail": "Kurze harte Intervalle"},
                {"label": "Z6 Anaerobic Capacity", "min": 1.21, "max": 1.5, "detail": "Sehr harte Belastungen"},
                {"label": "Z7 Sprint Open End", "min": 1.51, "max": None, "detail": "Sprint und Spitzenleistung oberhalb von Zone 6"},
            ],
        },
        {
            "key": "ftp_6_simplified",
            "label": "Vereinfacht 6 Zonen",
            "description": "Etwas kompakter fuer alltagsnahe Trainingssteuerung mit FTP.",
            "is_default": False,
            "zones": [
                {"label": "Z1 Recovery", "min": 0.0, "max": 0.55, "detail": "Sehr locker"},
                {"label": "Z2 GA1", "min": 0.56, "max": 0.75, "detail": "Grundlagenausdauer"},
                {"label": "Z3 GA2", "min": 0.76, "max": 0.9, "detail": "Tempobereich"},
                {"label": "Z4 Schwelle", "min": 0.91, "max": 1.05, "detail": "Schwellennahe Arbeit"},
                {"label": "Z5 VO2max", "min": 1.06, "max": 1.2, "detail": "Kurze fordernde Intervalle"},
                {"label": "Z6 Anaerob+", "min": 1.21, "max": 1.5, "detail": "Anaerob und sehr hohe Spitzen"},
                {"label": "Z7 Sprint Open End", "min": 1.51, "max": None, "detail": "Open End fuer Sprints oberhalb von Zone 6"},
            ],
        },
        {
            "key": "seiler_3_power",
            "label": "Seiler 3 Zonen",
            "description": "Kompaktes 3-Zonen-Modell fuer eine grobe Intensitaetslogik.",
            "is_default": False,
            "zones": [
                {"label": "Z1 Niedrig", "min": 0.0, "max": 0.84, "detail": "Locker bis moderat"},
                {"label": "Z2 Mittel", "min": 0.85, "max": 1.0, "detail": "Schwellennaeher Bereich"},
                {"label": "Z3 Hoch", "min": 1.01, "max": 1.5, "detail": "Hohe Intensitaet oberhalb der Schwelle"},
                {"label": "Z4 Sprint Open End", "min": 1.51, "max": None, "detail": "Open End fuer sehr hohe Spitzenleistungen"},
            ],
        },
    ],
    "max_hr": [
        {
            "key": "max_hr_5_classic",
            "label": "Klassisch 5 Zonen",
            "description": "Die gaengigste Einteilung fuer MaxHF-basierte Herzfrequenzzonen.",
            "is_default": True,
            "zones": [
                {"label": "Z1 Recovery", "min": 0.5, "max": 0.6, "detail": "Sehr locker"},
                {"label": "Z2 Grundlage", "min": 0.61, "max": 0.72, "detail": "Ruhige Grundlagenausdauer"},
                {"label": "Z3 Tempo", "min": 0.73, "max": 0.82, "detail": "Kontrolliert fordernd"},
                {"label": "Z4 Schwelle", "min": 0.83, "max": 0.9, "detail": "Schwellennahe Arbeit"},
                {"label": "Z5 Hoch", "min": 0.91, "max": 1.0, "detail": "Maximal und wettkampfnah"},
            ],
        },
        {
            "key": "max_hr_5_even",
            "label": "5 Zonen zu 10 Prozent",
            "description": "Ein verbreitetes einfaches Raster in gleichmaessigen 10-Prozent-Schritten.",
            "is_default": False,
            "zones": [
                {"label": "Z1 Recovery", "min": 0.5, "max": 0.6, "detail": "Sehr locker"},
                {"label": "Z2 Grundlage", "min": 0.6, "max": 0.7, "detail": "Locker aerob"},
                {"label": "Z3 Tempo", "min": 0.7, "max": 0.8, "detail": "Stetige Belastung"},
                {"label": "Z4 Hart", "min": 0.8, "max": 0.9, "detail": "Deutlich fordernd"},
                {"label": "Z5 Maximal", "min": 0.9, "max": 1.0, "detail": "Sehr hart bis maximal"},
            ],
        },
        {
            "key": "max_hr_3_simplified",
            "label": "Vereinfacht 3 Zonen",
            "description": "Grobe Low-Mid-High-Logik fuer einfachere Auswertungen.",
            "is_default": False,
            "zones": [
                {"label": "Z1 Niedrig", "min": 0.5, "max": 0.78, "detail": "Leicht bis moderat"},
                {"label": "Z2 Mittel", "min": 0.79, "max": 0.88, "detail": "Tempo bis Schwelle"},
                {"label": "Z3 Hoch", "min": 0.89, "max": 1.0, "detail": "Hart bis maximal"},
            ],
        },
    ],
}

OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_OPENAI_MODEL = "gpt-4.1-mini"


def _normalize_focus_labels(values: list[str] | None) -> list[str]:
    labels: list[str] = []
    for value in values or []:
        text = str(value or "").strip()
        if not text or text in labels:
            continue
        labels.append(text)
    return labels


def _normalize_optional_notes(value: str | None) -> str | None:
    text = str(value or "").strip()
    return text or None


def _normalize_config_section_key(value: str | None) -> str:
    key = str(value or "").strip().lower()
    if key not in {"profile", "goals", "week", "sources"}:
        raise ValueError("section_key must be one of: profile, goals, week, sources.")
    return key


def _default_config_section_title(section_key: str) -> str:
    titles = {
        "profile": "Athletenprofil",
        "goals": "Ziele und Eventkontext",
        "week": "Wochenorganisation",
        "sources": "Quellenbasiertes Setup",
    }
    return titles.get(section_key, section_key)


def build_training_config_prompt(
    section_key: str | None,
    section_title: str | None,
    selected_focus_labels: list[str] | None,
    notes: str | None = None,
) -> dict[str, Any]:
    normalized_section_key = _normalize_config_section_key(section_key)
    resolved_section_title = _normalize_optional_notes(section_title) or _default_config_section_title(normalized_section_key)
    focus_labels = _normalize_focus_labels(selected_focus_labels)
    if not focus_labels:
        raise ValueError("At least one prioritized focus item is required.")

    note_block = notes.strip() if notes and notes.strip() else "No extra notes provided."
    prioritized_lines = "\n".join(f"{index}. {label}" for index, label in enumerate(focus_labels, start=1))
    prompt = (
        f"Create a concise German training-configuration interpretation for the section '{resolved_section_title}' "
        "of an endurance training assistant.\n"
        "The ordered focus list below is already prioritized from highest to lowest importance.\n"
        "Base the interpretation primarily on those priorities and explain what they imply for training design.\n\n"
        "Prioritized focus items:\n"
        f"{prioritized_lines}\n\n"
        "Additional user notes:\n"
        f"{note_block}\n\n"
        "Return JSON only with this schema:\n"
        "{\n"
        '  "result_title": "short title",\n'
        '  "summary": "3-5 sentences in German",\n'
        '  "rationale": ["why this interpretation fits", "second reason", "third reason"],\n'
        '  "planning_implications": ["practical coaching implication", "second implication", "third implication"],\n'
        '  "follow_up_questions": ["important clarification question", "second question", "third question"],\n'
        '  "recommended_focus_order": ["reuse only items from the prioritized focus list"]\n'
        "}\n"
        "Do not use markdown fences."
    )
    return {
        "section_key": normalized_section_key,
        "section_title": resolved_section_title,
        "focus_labels": focus_labels,
        "notes": _normalize_optional_notes(notes),
        "prompt": prompt,
    }


def build_athlete_profile_prompt(selected_focus_labels: list[str] | None, notes: str | None = None) -> dict[str, Any]:
    payload = build_training_config_prompt(
        section_key="profile",
        section_title="Athletenprofil",
        selected_focus_labels=selected_focus_labels,
        notes=notes,
    )
    return {
        "focus_labels": payload["focus_labels"],
        "notes": payload["notes"],
        "prompt": payload["prompt"],
    }


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


def _normalize_string_list(value: Any, max_items: int = 6) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for raw_item in value:
        text = str(raw_item or "").strip()
        if not text or text in items:
            continue
        items.append(text)
        if len(items) >= max_items:
            break
    return items


def _normalize_training_plan_variants(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized_variants: list[dict[str, Any]] = []
    for raw_variant in value[:3]:
        if not isinstance(raw_variant, dict):
            continue

        title = str(raw_variant.get("title") or "").strip()
        summary = str(raw_variant.get("summary") or "").strip()
        level = str(raw_variant.get("level") or "").strip()
        suitable_for = str(raw_variant.get("suitable_for") or "").strip()
        days_raw = raw_variant.get("days")
        if not title or not isinstance(days_raw, list):
            continue

        normalized_days: list[dict[str, Any]] = []
        for raw_day in days_raw[:7]:
            if not isinstance(raw_day, dict):
                continue
            day_label = str(raw_day.get("day_label") or "").strip()
            session_label = str(raw_day.get("session_label") or "").strip()
            objective = str(raw_day.get("objective") or "").strip()
            details = str(raw_day.get("details") or "").strip()
            duration_hint = str(raw_day.get("duration_hint") or "").strip()
            intensity_hint = str(raw_day.get("intensity_hint") or "").strip()
            if not day_label or not session_label:
                continue
            normalized_days.append(
                {
                    "day_label": day_label,
                    "session_label": session_label,
                    "objective": objective,
                    "details": details,
                    "duration_hint": duration_hint,
                    "intensity_hint": intensity_hint,
                }
            )

        if not normalized_days:
            continue

        normalized_variants.append(
            {
                "title": title,
                "summary": summary,
                "level": level,
                "suitable_for": suitable_for,
                "days": normalized_days,
            }
        )

    return normalized_variants


def _build_plan_context_text(sections: list[dict[str, Any]]) -> str:
    context_parts: list[str] = []
    for section in sections:
        context_parts.extend(section.get("focus_labels") or [])
        note = str(section.get("notes") or "").strip()
        if note:
            context_parts.append(note)
    return " ".join(context_parts).lower()


def _pick_endurance_label(context_text: str) -> str:
    if "sweetspot" in context_text:
        return "GA1 mit Sweetspot-Anteilen"
    if "schwelle" in context_text or "zeitfahren" in context_text:
        return "GA1 mit schwellennahem Finish"
    return "GA1"


def _pick_intensity_label(context_text: str) -> str:
    if "vo2" in context_text or "berg" in context_text:
        return "VO2max"
    if "sweetspot" in context_text:
        return "Sweetspot"
    return "Schwelle"


def _build_fallback_week_variants(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    context_text = _build_plan_context_text(sections)
    endurance_label = _pick_endurance_label(context_text)
    intensity_label = _pick_intensity_label(context_text)
    includes_strength = "kraft" in context_text
    includes_triathlon = "triathlon" in context_text or "laufen" in context_text or "schwimmen" in context_text

    strength_note = " Optional 20-30 Minuten Krafttraining nach der Einheit." if includes_strength else ""
    multisport_note = " Andere Disziplinen bewusst locker daneben legen." if includes_triathlon else ""

    return [
        {
            "title": "Kompakte 3-Tage-Woche",
            "summary": "Drei gezielte Radeinheiten mit klarer Priorisierung auf Qualität und einem langen Grundlagenreiz am Wochenende.",
            "level": "3 Tage",
            "suitable_for": "volle Arbeitswochen, wenig verfügbare Tage, trotzdem strukturierter Leistungsaufbau",
            "days": [
                {
                    "day_label": "Montag",
                    "session_label": "Ruhe / Mobilität",
                    "objective": "Erholung nach dem Wochenende und frischer Start in die Woche",
                    "details": "Kompletter Ruhetag oder 20-30 Minuten lockere Mobilität, Spaziergang und Beweglichkeit.",
                    "duration_hint": "0-30 min",
                    "intensity_hint": "Recovery",
                },
                {
                    "day_label": "Dienstag",
                    "session_label": f"Qualität {intensity_label}",
                    "objective": "Wichtigster Entwicklungsreiz der Woche",
                    "details": f"Nach 15-20 Minuten Einrollen 3x8 bis 4x8 Minuten im Bereich {intensity_label} mit 4 Minuten locker dazwischen, danach sauber ausfahren.{strength_note}",
                    "duration_hint": "60-75 min",
                    "intensity_hint": intensity_label,
                },
                {
                    "day_label": "Mittwoch",
                    "session_label": "Ruhe oder sehr locker",
                    "objective": "Belastung aufnehmen und Müdigkeit niedrig halten",
                    "details": "Ruhetag oder maximal sehr lockeres Rollen, nur wenn sich die Beine gut anfühlen.",
                    "duration_hint": "0-45 min",
                    "intensity_hint": "Recovery",
                },
                {
                    "day_label": "Donnerstag",
                    "session_label": f"Stetige Ausdauer {endurance_label}",
                    "objective": "Aerobe Basis stabilisieren und muskuläre Ausdauer pflegen",
                    "details": f"10-15 Minuten locker einfahren, dann 2x20 Minuten kontrolliert im oberen GA1- bis unteren Tempo-Bereich, dazwischen 5 Minuten locker. Rest locker auffüllen.{multisport_note}",
                    "duration_hint": "60-90 min",
                    "intensity_hint": endurance_label,
                },
                {
                    "day_label": "Freitag",
                    "session_label": "Ruhe",
                    "objective": "Frische für den langen Reiz sichern",
                    "details": "Vollständig frei oder nur leichte Alltagsbewegung.",
                    "duration_hint": "0 min",
                    "intensity_hint": "Recovery",
                },
                {
                    "day_label": "Samstag",
                    "session_label": "Lange Ausfahrt",
                    "objective": "Grundlagenausdauer und Belastungsverträglichkeit erhöhen",
                    "details": "Lange lockere Ausfahrt mit ruhigem Beginn. Im letzten Drittel 20-30 Minuten etwas zügiger, aber kontrolliert. Verpflegung aktiv üben.",
                    "duration_hint": "2.5-4 h",
                    "intensity_hint": "GA1 bis GA2",
                },
                {
                    "day_label": "Sonntag",
                    "session_label": "Locker oder frei",
                    "objective": "Wochenlast abrunden ohne zusätzliche Ermüdung",
                    "details": "45-60 Minuten sehr locker rollen oder komplett frei, je nach Müdigkeit und Alltagsbelastung.",
                    "duration_hint": "0-60 min",
                    "intensity_hint": "Recovery",
                },
            ],
        },
        {
            "title": "Balancierte 4-Tage-Woche",
            "summary": "Vier Trainingstage mit einer klaren Qualitätsachse, einer längeren Ausfahrt und einem zweiten moderaten Entwicklungsreiz.",
            "level": "4 Tage",
            "suitable_for": "regelmäßige Trainingswoche mit gutem Verhältnis aus Fortschritt und Erholung",
            "days": [
                {
                    "day_label": "Montag",
                    "session_label": "Ruhe",
                    "objective": "Erholung und Planung der Woche",
                    "details": "Ruhetag, Schlaf priorisieren und die nächsten Kerneinheiten vorbereiten.",
                    "duration_hint": "0 min",
                    "intensity_hint": "Recovery",
                },
                {
                    "day_label": "Dienstag",
                    "session_label": f"Intervalle {intensity_label}",
                    "objective": "Primärer Leistungsreiz",
                    "details": f"4x6 bis 5x6 Minuten im Bereich {intensity_label} mit sauberer Kontrolle. Ein- und Ausfahren nicht zu kurz halten.{strength_note}",
                    "duration_hint": "70-85 min",
                    "intensity_hint": intensity_label,
                },
                {
                    "day_label": "Mittwoch",
                    "session_label": "Locker",
                    "objective": "Aktive Erholung",
                    "details": "Ruhige Einheit mit hoher Trittfrequenz oder alternativ frei, wenn der Dienstag sehr tief saß.",
                    "duration_hint": "45-60 min",
                    "intensity_hint": "Recovery bis GA1",
                },
                {
                    "day_label": "Donnerstag",
                    "session_label": "Sweetspot / Tempo",
                    "objective": "Stabile Dauerleistung und ökonomische Belastung",
                    "details": "2x15 bis 3x15 Minuten zügig, aber kontrolliert. Fokus auf gleichmäßige Leistung und saubere Sitzposition.",
                    "duration_hint": "60-80 min",
                    "intensity_hint": "Sweetspot bis Schwelle",
                },
                {
                    "day_label": "Freitag",
                    "session_label": "Ruhe oder Mobility",
                    "objective": "Frische vor dem Wochenende",
                    "details": "Wenn möglich komplett frei, sonst nur lockere Beweglichkeit.",
                    "duration_hint": "0-20 min",
                    "intensity_hint": "Recovery",
                },
                {
                    "day_label": "Samstag",
                    "session_label": "Lange Ausfahrt mit Struktur",
                    "objective": "Ausdauerblock und Fueling-Praxis",
                    "details": "Lange Grundlagenfahrt. Im Mittelteil 2 bis 3 längere Blöcke leicht oberhalb Wohlfühltempo einbauen, aber nie aus dem Ruder laufen lassen.",
                    "duration_hint": "3-4.5 h",
                    "intensity_hint": "GA1 bis GA2",
                },
                {
                    "day_label": "Sonntag",
                    "session_label": "Kurze Stützeinheit",
                    "objective": "Wochenumfang abrunden ohne zu überziehen",
                    "details": f"45-75 Minuten locker bis moderat mit 4-6 kurzen Aktivierungen. Gut geeignet für Rolle, Gruppe oder Koppeleinheit.{multisport_note}",
                    "duration_hint": "45-75 min",
                    "intensity_hint": "GA1",
                },
            ],
        },
        {
            "title": "Entwicklungsorientierte 5-Tage-Woche",
            "summary": "Fünf strukturierte Trainingstage für Nutzer mit mehr Spielraum, die mehrere Reize pro Woche sauber vertragen.",
            "level": "5 Tage",
            "suitable_for": "ambitionierte Aufbauphasen mit guter Regeneration und verlässlichen Zeitfenstern",
            "days": [
                {
                    "day_label": "Montag",
                    "session_label": "Recovery",
                    "objective": "Aktive Erholung",
                    "details": "Sehr lockeres Rollen, Beine lösen und Müdigkeit beobachten.",
                    "duration_hint": "30-45 min",
                    "intensity_hint": "Recovery",
                },
                {
                    "day_label": "Dienstag",
                    "session_label": f"Hauptreiz {intensity_label}",
                    "objective": "Leistungsentwicklung gezielt anstoßen",
                    "details": f"5x5 Minuten oder 6x4 Minuten im Bereich {intensity_label}, Pausen vollständig locker. Qualität vor Umfang.{strength_note}",
                    "duration_hint": "70-85 min",
                    "intensity_hint": intensity_label,
                },
                {
                    "day_label": "Mittwoch",
                    "session_label": "Grundlage",
                    "objective": "Aerobe Stütze nach dem Hauptreiz",
                    "details": "Ruhige Einheit mit gleichmäßigem Druck auf dem Pedal. Kein verstecktes Rennen daraus machen.",
                    "duration_hint": "60-90 min",
                    "intensity_hint": "GA1",
                },
                {
                    "day_label": "Donnerstag",
                    "session_label": "Sweetspot / Kraftausdauer",
                    "objective": "Muskuläre Robustheit und dauerhafte Leistung",
                    "details": "3x10 bis 3x12 Minuten im unteren bis mittleren Sweetspot. Optional einzelne Blöcke mit leicht reduzierter Kadenz fahren.",
                    "duration_hint": "60-80 min",
                    "intensity_hint": "Sweetspot",
                },
                {
                    "day_label": "Freitag",
                    "session_label": "Locker oder frei",
                    "objective": "Belastung abfangen",
                    "details": "Kurze Recovery-Einheit oder kompletter Ruhetag je nach Müdigkeit.",
                    "duration_hint": "0-45 min",
                    "intensity_hint": "Recovery",
                },
                {
                    "day_label": "Samstag",
                    "session_label": "Langer Schlüsselblock",
                    "objective": "Ausdauer, Nahrungsstrategie und mentale Stabilität",
                    "details": "Lange Ausfahrt mit klarem Energie-Management. Im Verlauf einzelne strukturierte Abschnitte im Tempo- oder Sweetspot-Bereich einbauen.",
                    "duration_hint": "3.5-5 h",
                    "intensity_hint": "GA1 bis Sweetspot",
                },
                {
                    "day_label": "Sonntag",
                    "session_label": "Stabile Endurance-Einheit",
                    "objective": "Zusätzlicher Umfang ohne komplettes Entgleisen der Woche",
                    "details": f"Lockere bis moderate Ausdauerfahrt. Nur dann etwas zügiger, wenn Schlaf, Beine und Gesamtlast passen.{multisport_note}",
                    "duration_hint": "90-150 min",
                    "intensity_hint": "GA1 bis GA2",
                },
            ],
        },
    ]


def _fallback_weekly_structure(variants: list[dict[str, Any]]) -> list[str]:
    if not variants:
        return [
            "1 Hauptreiz pro Woche mit klarer Qualität und vollständiger Erholung davor.",
            "1 längere Grundlagenfahrt zur Entwicklung der Ausdauer und Belastungsverträglichkeit.",
            "Zwischentage bewusst locker halten, damit die Schlüsseleinheiten wirksam bleiben.",
        ]

    lines: list[str] = []
    for variant in variants[:3]:
        lines.append(f"{variant['title']}: {variant['summary']}")
    return lines[:10]


def _fallback_key_workouts(variants: list[dict[str, Any]]) -> list[str]:
    workouts: list[str] = []
    for variant in variants:
        for day in variant.get("days", []):
            session_label = str(day.get("session_label") or "").strip()
            details = str(day.get("details") or "").strip()
            intensity_hint = str(day.get("intensity_hint") or "").strip()
            if any(keyword in session_label.lower() for keyword in ("intervalle", "hauptreiz", "sweetspot", "schlüssel", "qualität")):
                workouts.append(f"{day['day_label']}: {session_label} - {details}")
            elif intensity_hint in {"Schwelle", "VO2max", "Sweetspot"}:
                workouts.append(f"{day['day_label']}: {session_label} - {details}")
            if len(workouts) >= 6:
                return workouts
    return workouts


def derive_training_config_with_llm(
    section_key: str | None,
    section_title: str | None,
    selected_focus_labels: list[str] | None,
    notes: str | None = None,
) -> dict[str, Any]:
    prompt_payload = build_training_config_prompt(
        section_key=section_key,
        section_title=section_title,
        selected_focus_labels=selected_focus_labels,
        notes=notes,
    )

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not configured.")

    model = os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_OPENAI_MODEL
    response = requests.post(
        OPENAI_CHAT_COMPLETIONS_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a structured endurance coach. Respond in German. "
                        "Return valid JSON only and do not include markdown."
                    ),
                },
                {
                    "role": "user",
                    "content": prompt_payload["prompt"],
                },
            ],
            "temperature": 0.5,
        },
        timeout=45,
    )

    if response.status_code >= 400:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        detail = (
            payload.get("error", {}).get("message")
            if isinstance(payload, dict)
            else None
        ) or response.text.strip() or "LLM request failed."
        raise RuntimeError(detail)

    body = response.json()
    content = (
        body.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    parsed = _extract_json_object(content)
    summary = str(parsed.get("summary") or "").strip()
    if not summary:
        raise ValueError("LLM response did not contain a summary.")

    recommended_focus_order = _normalize_string_list(parsed.get("recommended_focus_order"))
    valid_focus_labels = prompt_payload["focus_labels"]
    normalized_focus_order = [label for label in recommended_focus_order if label in valid_focus_labels]
    remaining_focus_labels = [label for label in valid_focus_labels if label not in normalized_focus_order]

    return {
        "section_key": prompt_payload["section_key"],
        "section_title": prompt_payload["section_title"],
        "result_title": str(parsed.get("result_title") or prompt_payload["section_title"]).strip() or prompt_payload["section_title"],
        "summary": summary,
        "rationale": _normalize_string_list(parsed.get("rationale")),
        "planning_implications": _normalize_string_list(parsed.get("planning_implications")),
        "follow_up_questions": _normalize_string_list(parsed.get("follow_up_questions")),
        "recommended_focus_order": normalized_focus_order + remaining_focus_labels,
        "prompt": prompt_payload["prompt"],
        "model": model,
    }


def derive_athlete_profile_with_llm(selected_focus_labels: list[str] | None, notes: str | None = None) -> dict[str, Any]:
    payload = derive_training_config_with_llm(
        section_key="profile",
        section_title="Athletenprofil",
        selected_focus_labels=selected_focus_labels,
        notes=notes,
    )
    return {
        **payload,
        "profile_name": payload["result_title"],
    }


def _normalize_training_plan_sections(sections: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized_sections: list[dict[str, Any]] = []
    for raw_section in sections or []:
        if not isinstance(raw_section, dict):
            continue
        section_key = _normalize_config_section_key(raw_section.get("section_key"))
        section_title = _normalize_optional_notes(raw_section.get("section_title")) or _default_config_section_title(section_key)
        focus_labels = _normalize_focus_labels(raw_section.get("focus_labels"))
        notes = _normalize_optional_notes(raw_section.get("notes"))
        normalized_sections.append(
            {
                "section_key": section_key,
                "section_title": section_title,
                "focus_labels": focus_labels,
                "notes": notes,
            }
        )
    non_empty_sections = [section for section in normalized_sections if section["focus_labels"] or section["notes"]]
    if not non_empty_sections:
        raise ValueError("At least one configured section is required.")
    return non_empty_sections


def build_training_plan_prompt(sections: list[dict[str, Any]] | None) -> dict[str, Any]:
    normalized_sections = _normalize_training_plan_sections(sections)

    section_blocks: list[str] = []
    for section in normalized_sections:
        prioritized_lines = "\n".join(
            f"- {index}. {label}"
            for index, label in enumerate(section["focus_labels"], start=1)
        ) or "- No focus items selected."
        notes_line = section["notes"] or "No additional notes."
        section_blocks.append(
            f"{section['section_title']} ({section['section_key']}):\n"
            f"{prioritized_lines}\n"
            f"Notes: {notes_line}"
        )

    prompt = (
        "Create a practical German endurance training plan draft based on the structured user configuration below.\n"
        "Use the priorities and constraints across all sections to form one coherent plan direction.\n"
        "Keep the answer realistic, explain tradeoffs briefly and stay actionable.\n"
        "The result must be substantial and specific, not generic.\n"
        "Always build complete week variants from Monday to Sunday.\n"
        "Every variant must contain exactly 7 days.\n"
        "Each day needs a concrete session label, a real training objective, a useful details text, a duration range and an intensity hint.\n"
        "Prefer concrete cycling language such as Recovery, GA1, GA2, Sweetspot, Schwelle, VO2max or Kraftausdauer where it fits.\n"
        "The weekly_structure, key_workouts, progression_notes, watchouts, why_this_plan_fits and adoption_checklist arrays must each contain at least 3 useful items.\n\n"
        "Configuration:\n"
        f"{chr(10).join(section_blocks)}\n\n"
        "Return JSON only with this schema:\n"
        "{\n"
        '  "plan_title": "short title",\n'
        '  "summary": "3-6 sentences in German",\n'
        '  "weekly_structure": ["day or block guideline", "second line", "third line"],\n'
        '  "week_variants": [\n'
        "    {\n"
        '      "title": "variant title",\n'
        '      "summary": "short variant summary",\n'
        '      "level": "for example 3 Tage, 4 Tage or 5 Tage",\n'
        '      "suitable_for": "who this variant fits best",\n'
        '      "days": [\n'
        "        {\n"
        '          "day_label": "Montag",\n'
        '          "session_label": "Ruhetag / GA1 / Intervalle",\n'
        '          "objective": "main purpose of the day",\n'
        '          "details": "structured session guidance in German",\n'
        '          "duration_hint": "for example 45-60 min",\n'
        '          "intensity_hint": "for example Recovery, GA1, Sweetspot, Schwelle"\n'
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ],\n"
        '  "key_workouts": ["key workout idea", "second key workout", "third key workout"],\n'
        '  "progression_notes": ["how to progress", "second point", "third point"],\n'
        '  "watchouts": ["important risk or limit", "second risk"],\n'
        '  "why_this_plan_fits": ["fit reason", "second fit reason", "third fit reason"],\n'
        '  "adoption_checklist": ["what to confirm before adopting", "second check", "third check"]\n'
        "}\n"
        "Create between 1 and 3 realistic week_variants. Keep them clearly different, for example by available training days or by how compact the week is.\n"
        "A good default is three variants: compact, balanced and development-oriented.\n"
        "Do not leave week_variants empty.\n"
        "Do not use markdown fences."
    )
    return {
        "sections": normalized_sections,
        "prompt": prompt,
    }


def derive_training_plan_with_llm(sections: list[dict[str, Any]] | None) -> dict[str, Any]:
    prompt_payload = build_training_plan_prompt(sections)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not configured.")

    model = os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_OPENAI_MODEL
    response = requests.post(
        OPENAI_CHAT_COMPLETIONS_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a structured endurance coach. Respond in German. "
                        "Return valid JSON only and do not include markdown."
                    ),
                },
                {
                    "role": "user",
                    "content": prompt_payload["prompt"],
                },
            ],
            "temperature": 0.45,
        },
        timeout=45,
    )

    if response.status_code >= 400:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        detail = (
            payload.get("error", {}).get("message")
            if isinstance(payload, dict)
            else None
        ) or response.text.strip() or "LLM request failed."
        raise RuntimeError(detail)

    body = response.json()
    content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
    parsed = _extract_json_object(content)

    summary = str(parsed.get("summary") or "").strip()
    if not summary:
        raise ValueError("LLM response did not contain a summary.")

    plan_title = str(parsed.get("plan_title") or "Trainingsplan-Entwurf").strip() or "Trainingsplan-Entwurf"
    week_variants = _normalize_training_plan_variants(parsed.get("week_variants"))
    if not week_variants:
        week_variants = _build_fallback_week_variants(prompt_payload["sections"])

    weekly_structure = _normalize_string_list(parsed.get("weekly_structure"), max_items=10)
    if not weekly_structure:
        weekly_structure = _fallback_weekly_structure(week_variants)

    key_workouts = _normalize_string_list(parsed.get("key_workouts"), max_items=8)
    if not key_workouts:
        key_workouts = _fallback_key_workouts(week_variants)

    progression_notes = _normalize_string_list(parsed.get("progression_notes"), max_items=8)
    if not progression_notes:
        progression_notes = [
            "Steigere zuerst die Wiederholbarkeit der Schlüsseleinheiten, bevor du Umfang und Intensität gleichzeitig erhöhst.",
            "Plane nach 2 bis 3 Belastungswochen eine leichtere Woche mit reduziertem Gesamtumfang ein.",
            "Erhöhe lange Ausfahrten und harte Intervalle nur dann, wenn Schlaf, Alltag und Erholung stabil bleiben.",
        ]

    watchouts = _normalize_string_list(parsed.get("watchouts"), max_items=8)
    if not watchouts:
        watchouts = [
            "Zu viele mittlere Tage hintereinander drücken die Qualität der wichtigen Einheiten.",
            "Lange Ausfahrten ohne saubere Verpflegung gefährden sowohl Anpassung als auch Regeneration.",
            "Bei hohem Alltagsstress sollte zuerst Intensität reduziert werden, nicht nur die Erholungstage.",
        ]

    why_this_plan_fits = _normalize_string_list(parsed.get("why_this_plan_fits"), max_items=8)
    if not why_this_plan_fits:
        why_this_plan_fits = [
            "Die Woche verbindet klare Qualitätsreize mit ausreichend leichter Struktur dazwischen.",
            "Die Varianten bilden unterschiedliche Zeitbudgets ab, ohne das Trainingsziel aus den Augen zu verlieren.",
            "Die Planung bleibt alltagstauglich und trotzdem gezielt genug für messbaren Fortschritt.",
        ]

    adoption_checklist = _normalize_string_list(parsed.get("adoption_checklist"), max_items=8)
    if not adoption_checklist:
        adoption_checklist = [
            "Prüfen, ob die vorgesehenen Trainingstage wirklich zu Arbeit, Familie und Schlaf passen.",
            "Sicherstellen, dass Intensitätsbereiche und Leistungswerte aktuell sind.",
            "Verpflegung, Indoor-Optionen und Alternativen für stressige Wochen vorab festlegen.",
        ]

    return {
        "plan_title": plan_title,
        "summary": summary,
        "weekly_structure": weekly_structure,
        "week_variants": week_variants,
        "key_workouts": key_workouts,
        "progression_notes": progression_notes,
        "watchouts": watchouts,
        "why_this_plan_fits": why_this_plan_fits,
        "adoption_checklist": adoption_checklist,
        "prompt": prompt_payload["prompt"],
        "model": model,
        "sections": prompt_payload["sections"],
    }


def _now() -> datetime:
    return datetime.utcnow()


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _normalize_metric_type(value: str | None) -> str:
    metric_type = str(value or "").strip().lower()
    if metric_type == "maxhf":
        metric_type = "max_hr"
    if metric_type not in ALLOWED_METRIC_TYPES:
        raise ValueError("metric_type must be one of: ftp, max_hr.")
    return metric_type


def _validate_metric_value(metric_type: str, value: float | int | None) -> float:
    if value is None:
        raise ValueError("value is required.")
    parsed = float(value)
    if metric_type == "ftp" and (parsed <= 0 or parsed > 2000):
        raise ValueError("FTP must be > 0 and <= 2000.")
    if metric_type == "max_hr" and (parsed <= 0 or parsed > 260):
        raise ValueError("MaxHF must be > 0 and <= 260.")
    return round(parsed, 2)


def _serialize_metric(row: UserTrainingMetric) -> dict[str, Any]:
    return {
        "id": row.id,
        "metric_type": row.metric_type,
        "recorded_at": _serialize_datetime(row.recorded_at),
        "value": row.value,
        "source": row.source,
        "notes": row.notes,
        "created_at": _serialize_datetime(row.created_at),
        "updated_at": _serialize_datetime(row.updated_at),
    }


def get_available_zone_models(metric_type: str) -> list[dict[str, Any]]:
    normalized = _normalize_metric_type(metric_type)
    definitions = ZONE_MODEL_DEFINITIONS.get(normalized, [])
    return [
        {
            "key": definition["key"],
            "label": definition["label"],
            "description": definition["description"],
            "is_default": bool(definition.get("is_default")),
        }
        for definition in definitions
    ]


def get_zone_model(metric_type: str, model_key: str | None = None) -> dict[str, Any]:
    normalized = _normalize_metric_type(metric_type)
    definitions = ZONE_MODEL_DEFINITIONS.get(normalized, [])
    if not definitions:
        raise ValueError(f"No zone models configured for {normalized}.")
    if model_key:
        for definition in definitions:
            if definition["key"] == model_key:
                return definition
        raise ValueError(f"Unknown zone model '{model_key}' for metric_type '{normalized}'.")
    for definition in definitions:
        if definition.get("is_default"):
            return definition
    return definitions[0]


def _default_upper_bounds(metric_type: str, model_key: str) -> list[float]:
    definition = get_zone_model(metric_type, model_key)
    return [float(zone["max"]) for zone in definition["zones"][:-1] if zone["max"] is not None]


def _default_colors(metric_type: str, zone_count: int) -> list[str]:
    palette = DEFAULT_ZONE_COLORS.get(metric_type, [])
    if len(palette) >= zone_count:
        return palette[:zone_count]
    return palette + [palette[-1] if palette else "#f2eff7"] * max(0, zone_count - len(palette))


def _parse_zone_config(raw_json: str | None) -> dict[str, Any]:
    if not raw_json:
        return {}
    try:
        payload = json.loads(raw_json)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _validate_hex_color(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) != 7 or not text.startswith("#"):
        raise ValueError("custom_colors must use #RRGGBB format.")
    try:
        int(text[1:], 16)
    except ValueError as exc:
        raise ValueError("custom_colors must use #RRGGBB format.") from exc
    return text.upper()


def _validate_zone_config(metric_type: str, model_key: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    definition = get_zone_model(metric_type, model_key)
    zones = definition["zones"]
    default_upper_bounds = _default_upper_bounds(metric_type, model_key)
    default_colors = _default_colors(metric_type, len(zones))
    incoming = payload or {}

    custom_upper_bounds = incoming.get("custom_upper_bounds")
    if custom_upper_bounds is None:
        normalized_upper_bounds = default_upper_bounds
    else:
        if not isinstance(custom_upper_bounds, list) or len(custom_upper_bounds) != len(default_upper_bounds):
            raise ValueError("custom_upper_bounds has an invalid length.")
        normalized_upper_bounds = [round(float(value), 4) for value in custom_upper_bounds]
        for index, value in enumerate(normalized_upper_bounds):
            min_allowed = float(zones[index]["min"])
            max_allowed = float(zones[index + 1]["max"]) if zones[index + 1]["max"] is not None else max(value, 2.0)
            if value <= min_allowed:
                raise ValueError("custom_upper_bounds must stay above the lower edge of the zone.")
            if index < len(normalized_upper_bounds) - 1 and value >= normalized_upper_bounds[index + 1]:
                raise ValueError("custom_upper_bounds must be strictly increasing.")
            if zones[index]["max"] is not None and index == len(normalized_upper_bounds) - 1 and metric_type == "ftp":
                max_allowed = 3.0
            if value > max_allowed:
                raise ValueError("custom_upper_bounds exceeds the allowed range.")

    custom_colors = incoming.get("custom_colors")
    if custom_colors is None:
        normalized_colors = default_colors
    else:
        if not isinstance(custom_colors, list) or len(custom_colors) != len(zones):
            raise ValueError("custom_colors has an invalid length.")
        normalized_colors = [_validate_hex_color(color) for color in custom_colors]

    return {
        "custom_upper_bounds": normalized_upper_bounds,
        "custom_colors": normalized_colors,
        "is_default": normalized_upper_bounds == default_upper_bounds and normalized_colors == default_colors,
    }


def _serialize_zone_setting(metric_type: str, model_key: str | None = None, raw_config_json: str | None = None) -> dict[str, Any]:
    definition = get_zone_model(metric_type, model_key)
    config = _validate_zone_config(metric_type, definition["key"], _parse_zone_config(raw_config_json))
    return {
        "metric_type": metric_type,
        "model_key": definition["key"],
        "label": definition["label"],
        "description": definition["description"],
        "is_default": bool(definition.get("is_default")),
        "custom_upper_bounds": config["custom_upper_bounds"],
        "custom_colors": config["custom_colors"],
        "has_customizations": not config["is_default"],
    }


def get_user_zone_model_settings(user_id: int) -> dict[str, dict[str, Any]]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(UserTrainingZoneSetting)
            .where(UserTrainingZoneSetting.user_id == user_id)
            .order_by(UserTrainingZoneSetting.metric_type.asc(), UserTrainingZoneSetting.id.asc())
        ).all()

    settings: dict[str, dict[str, Any]] = {}
    for metric_type in ALLOWED_METRIC_TYPES:
        matching = next((row for row in rows if row.metric_type == metric_type), None)
        settings[metric_type] = _serialize_zone_setting(
            metric_type,
            matching.model_key if matching else None,
            matching.config_json if matching else None,
        )
    return settings


def list_training_metrics(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(UserTrainingMetric)
            .where(UserTrainingMetric.user_id == user_id)
            .order_by(UserTrainingMetric.metric_type.asc(), UserTrainingMetric.recorded_at.desc(), UserTrainingMetric.id.desc())
        ).all()
        grouped: dict[str, Any] = {
            "ftp": [],
            "max_hr": [],
            "zone_settings": get_user_zone_model_settings(user_id),
            "available_zone_models": {
                "ftp": get_available_zone_models("ftp"),
                "max_hr": get_available_zone_models("max_hr"),
            },
        }
        for row in rows:
            grouped.setdefault(row.metric_type, []).append(_serialize_metric(row))
        return grouped


def get_current_metric_peak(user_id: int, metric_type: str) -> float | None:
    normalized = _normalize_metric_type(metric_type)
    with SessionLocal() as session:
        rows = session.scalars(
            select(UserTrainingMetric.value)
            .where(UserTrainingMetric.user_id == user_id, UserTrainingMetric.metric_type == normalized)
            .order_by(UserTrainingMetric.value.desc(), UserTrainingMetric.recorded_at.desc(), UserTrainingMetric.id.desc())
        ).all()
        return float(rows[0]) if rows else None


def create_training_metric(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    metric_type = _normalize_metric_type(payload.get("metric_type"))
    value = _validate_metric_value(metric_type, payload.get("value"))
    recorded_at = _parse_datetime(str(payload.get("recorded_at") or "")) or _now()
    source = str(payload.get("source") or "").strip()
    if not source:
        raise ValueError("source is required.")
    notes = str(payload.get("notes") or "").strip() or None

    with SessionLocal() as session:
        now = _now()
        row = UserTrainingMetric(
            user_id=user_id,
            metric_type=metric_type,
            recorded_at=recorded_at,
            value=value,
            source=source,
            notes=notes,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.flush()
        payload_out = _serialize_metric(row)
        session.commit()
        return payload_out


def create_imported_max_hr_metric_if_new_peak(
    user_id: int,
    value: float | int | None,
    recorded_at: datetime | None,
    source: str,
    notes: str | None = None,
) -> dict[str, Any] | None:
    parsed_value = _validate_metric_value("max_hr", value)
    current_peak = get_current_metric_peak(user_id=user_id, metric_type="max_hr")
    if current_peak is not None and parsed_value <= current_peak:
        return None
    return create_training_metric(
        user_id=user_id,
        payload={
            "metric_type": "max_hr",
            "recorded_at": _serialize_datetime(recorded_at),
            "value": parsed_value,
            "source": source,
            "notes": notes,
        },
    )


def update_training_metric(user_id: int, metric_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    with SessionLocal() as session:
        row = session.scalar(
            select(UserTrainingMetric).where(UserTrainingMetric.id == metric_id, UserTrainingMetric.user_id == user_id)
        )
        if row is None:
            raise ValueError("Training metric not found.")

        metric_type = row.metric_type
        if "metric_type" in payload and payload.get("metric_type") is not None:
            metric_type = _normalize_metric_type(payload.get("metric_type"))
            row.metric_type = metric_type
        if "value" in payload:
            row.value = _validate_metric_value(metric_type, payload.get("value"))
        if "recorded_at" in payload:
            row.recorded_at = _parse_datetime(str(payload.get("recorded_at") or "")) or _now()
        if "source" in payload:
            source = str(payload.get("source") or "").strip()
            if not source:
                raise ValueError("source is required.")
            row.source = source
        if "notes" in payload:
            row.notes = str(payload.get("notes") or "").strip() or None

        row.updated_at = _now()
        session.flush()
        payload_out = _serialize_metric(row)
        session.commit()
        return payload_out


def upsert_training_zone_setting(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    metric_type = _normalize_metric_type(payload.get("metric_type"))
    model_key = str(payload.get("model_key") or "").strip()
    definition = get_zone_model(metric_type, model_key)
    config = _validate_zone_config(metric_type, definition["key"], payload.get("config"))
    config_json = None if config["is_default"] else json.dumps(
        {
            "custom_upper_bounds": config["custom_upper_bounds"],
            "custom_colors": config["custom_colors"],
        }
    )

    with SessionLocal() as session:
        row = session.scalar(
            select(UserTrainingZoneSetting).where(
                UserTrainingZoneSetting.user_id == user_id,
                UserTrainingZoneSetting.metric_type == metric_type,
            )
        )
        now = _now()
        if row is None:
            row = UserTrainingZoneSetting(
                user_id=user_id,
                metric_type=metric_type,
                model_key=definition["key"],
                config_json=config_json,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
        else:
            row.model_key = definition["key"]
            row.config_json = config_json
            row.updated_at = now
        session.flush()
        session.commit()
    return _serialize_zone_setting(metric_type, definition["key"], config_json)


def delete_training_metric(user_id: int, metric_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        row = session.scalar(
            select(UserTrainingMetric).where(UserTrainingMetric.id == metric_id, UserTrainingMetric.user_id == user_id)
        )
        if row is None:
            raise ValueError("Training metric not found.")
        payload_out = _serialize_metric(row)
        session.delete(row)
        session.commit()
        return {"status": "deleted", "metric": payload_out}
