from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select

from packages.db.models import Activity, ActivityRecord, UserAchievement, UserAchievementRecordEvent, UserTrainingMetric
from packages.db.session import SessionLocal

SECTION_META: dict[str, dict[str, Any]] = {
    "cycling": {
        "title": "Radfahren",
        "eyebrow": "Achievements",
        "intro": "Distanzen, Wochenkontingente, Rekorde, Zonen und diese besonderen Tage, über die man später noch spricht.",
    },
    "nutrition": {
        "title": "Ernährung",
        "eyebrow": "Bald mehr",
        "intro": "Hier können wir später Gewohnheiten, Fueling und saubere Routinen mit eigenen Erfolgen sichtbar machen.",
        "cards": [
            {"title": "Fueling Flow", "description": "Lange Einheiten mit guter Kohlenhydratstrategie und ohne Leistungseinbruch."},
            {"title": "Protein-Rhythmus", "description": "Mehrere Tage hintereinander das Proteinziel sinnvoll getroffen."},
            {"title": "Meal Prep Momentum", "description": "Vorbereitet statt improvisiert und dadurch entspannter durch die Woche."},
        ],
    },
    "health": {
        "title": "Gesundheit",
        "eyebrow": "Bald mehr",
        "intro": "Schlaf, Erholung, Gewichtsverlauf und nachhaltige Gesundheit passen hier sehr gut hinein.",
        "cards": [
            {"title": "Recovery First", "description": "Eine Entlastungswoche wirklich auch als Entlastungswoche gelebt."},
            {"title": "Schlafanker", "description": "Vor wichtigen Belastungen mehrere Nächte stabil und ruhig geschlafen."},
            {"title": "Trend in die richtige Richtung", "description": "Ein gesunder Verlauf über mehrere Wochen statt hektischer Ausreißer."},
        ],
    },
}

CYCLING_CATEGORIES = [
    ("records", "Rekorde", "Leistungs- und Pulsbestwerte über kurze und lange Zeitfenster."),
    ("distance", "Ausdauer", "Von den ersten 10 km bis zu epischen Heldentouren."),
    ("weekly", "Wochenkontingent", "Wie regelmäßig und umfangreich die Woche getragen wird."),
    ("zones", "Zonen", "Besondere Zeiten in Recovery, Grundlage, Schwelle und darüber."),
    ("moments", "Besondere Momente", "Seltene Tage mit Charakter, Mut und richtig guter Story."),
]


@dataclass(frozen=True)
class AchievementDefinition:
    key: str
    section_key: str
    category_key: str
    title: str
    detail: str
    icon: str
    accent: str
    hint: str
    sort_index: int
    kind: str
    threshold: float | int | None = None
    window_seconds: int | None = None


def _make_distance_definitions() -> list[AchievementDefinition]:
    entries = [
        ("distance_10", "Erste 10 km", "10K", 10, "Der Einstieg ist geschafft und Radfahren wird real.", "Die erste Hürde ist gefallen."),
        ("distance_20", "20 km Runde", "20K", 20, "Die erste kleine Ausfahrt mit echtem Rhythmus.", "Schon deutlich mehr als nur einmal kurz rollen."),
        ("distance_30", "30 km Flow", "30K", 30, "Ein Ride, bei dem man in den Tag hineinfindet.", "Locker hinaus und sauber wieder heim."),
        ("distance_50", "50 km Klassiker", "50K", 50, "Der Meilenstein, ab dem viele sich als richtige Hobbyfahrer fühlen.", "Ein Klassiker, der immer zählt."),
        ("distance_75", "75 km Formtest", "75K", 75, "Genug Zeit im Sattel, damit Ausdauer sichtbar wird.", "Der nächste schöne Distanzsprung."),
        ("distance_100", "100 km Jahrhundertag", "100", 100, "Der legendäre Hunderter mit ganz eigenem Stolz.", "Ein Badge, den fast jeder gern hätte."),
        ("distance_125", "125 km Ausdehnung", "125", 125, "Eine Tour, bei der Verpflegung und Geduld schon mitfahren.", "Hier wird der Tag langsam groß."),
        ("distance_150", "150 km Abenteuer", "150", 150, "Eine Tour, die schon nach Verpflegung, Disziplin und Geduld riecht.", "Lang, fordernd und unvergesslich."),
        ("distance_200", "200 km Heldentour", "200", 200, "Brevet-Energie und ein Tag, den man nicht vergisst.", "Hier beginnt die richtige Langstrecke."),
        ("distance_250", "250 km Ultratag", "250", 250, "Ein Ride für Planung, Energie und sehr langen Fokus.", "Eine richtige Ultra-Visitenkarte."),
    ]
    return [AchievementDefinition(key, "cycling", "distance", title, detail, icon, "endurance", hint, 100 + idx, "distance", threshold) for idx, (key, title, icon, threshold, detail, hint) in enumerate(entries)]


def _make_weekly_definitions() -> list[AchievementDefinition]:
    entries = [
        ("weekly_50", "50 km Woche", "W50", 50, "Die Trainingswoche bekommt Form und Regelmäßigkeit.", "Eine Woche mit erkennbarem Muster."),
        ("weekly_100", "100 km Woche", "W1", 100, "Ein erstes Wochenfundament steht.", "Konstanz wird sichtbar."),
        ("weekly_150", "150 km Woche", "W15", 150, "Mehrere gute Einheiten tragen gemeinsam die Woche.", "Nicht nur ein guter Tag, sondern mehrere."),
        ("weekly_200", "200 km Woche", "W2", 200, "Das Fundament für ambitioniertere Ziele.", "Ein starker nächster Wochenblock."),
        ("weekly_250", "250 km Woche", "W25", 250, "Struktur und Umfang treffen sich in einer runden Woche.", "Hier beginnt richtige Trainingssubstanz."),
        ("weekly_300", "300 km Woche", "W3", 300, "Eine echte Ausdauerwoche mit Struktur und Substanz.", "Hier beginnt Trainingscharakter."),
        ("weekly_400", "400 km Woche", "W4", 400, "Eine große Trainingswoche mit echtem Block-Gefühl.", "Das ist schon sehr ordentlich."),
        ("weekly_500", "500 km Woche", "W5", 500, "Ein großer Trainingsblock mit echtem Ultra-Gefühl.", "Für sehr ambitionierte Wochen."),
    ]
    return [AchievementDefinition(key, "cycling", "weekly", title, detail, icon, "weekly", hint, 200 + idx, "weekly_distance", threshold) for idx, (key, title, icon, threshold, detail, hint) in enumerate(entries)]


DISTANCE_DEFINITIONS = _make_distance_definitions()
WEEKLY_DEFINITIONS = _make_weekly_definitions()
ZONE_DEFINITIONS = [
    AchievementDefinition("zone1_30", "cycling", "zones", "Z1 Ruhepol 30", "30 Minuten sauber in Herzfrequenzzone 1 geblieben.", "Z30", "zone", "Recovery mit Disziplin ist auch Stärke.", 300, "zone1_duration", 30),
    AchievementDefinition("zone1_60", "cycling", "zones", "Z1 Ruhepol 60", "60 Minuten stabil in Herzfrequenzzone 1 gefahren.", "Z60", "zone", "Lange locker bleiben ist eine Qualität.", 301, "zone1_duration", 60),
    AchievementDefinition("zone1_90", "cycling", "zones", "Z1 Ruhepol 90", "90 Minuten kontrolliert locker geblieben.", "Z90", "zone", "Viele fahren zu schnell für so eine Ruhe.", 302, "zone1_duration", 90),
    AchievementDefinition("zone1_120", "cycling", "zones", "Z1 Ruhepol 120", "Zwei Stunden Z1 mit echter Geduld geschafft.", "Z12", "zone", "Das ist saubere Grundlage im leichten Bereich.", 303, "zone1_duration", 120),
    AchievementDefinition("zone1_180", "cycling", "zones", "Z1 Ruhepol 180", "Drei Stunden locker und kontrolliert geblieben.", "Z18", "zone", "Sehr ruhige Ausdauer ist gar nicht so leicht.", 304, "zone1_duration", 180),
    AchievementDefinition("zone1_240", "cycling", "zones", "Z1 Ruhepol 240", "Vier Stunden im sehr ruhigen Bereich sind eine Kunst.", "Z24", "zone", "Geduld, Gefühl und gutes Pacing.", 305, "zone1_duration", 240),
]
MOMENT_DEFINITIONS = [
    AchievementDefinition("moment_early_bird", "cycling", "moments", "Early Bird", "Vor 06:30 auf dem Rad und der Tag gehört dir früh.", "EAR", "moment", "Leere Straßen haben ihren eigenen Zauber.", 400, "moment_early_bird"),
    AchievementDefinition("moment_night_ride", "cycling", "moments", "Night Ride", "Später Start nach 20:00 und trotzdem rausgegangen.", "NGT", "moment", "Ein Abendride hat eine ganz eigene Energie.", 401, "moment_night_ride"),
    AchievementDefinition("moment_double_day", "cycling", "moments", "Double Day", "Zwei Fahrten an einem Tag sauber untergebracht.", "2X", "moment", "Morgens und abends fahren hat Charakter.", 402, "moment_double_day"),
    AchievementDefinition("moment_streak_3", "cycling", "moments", "3-Tage-Serie", "Drei Tage am Stück gefahren und Momentum aufgebaut.", "3D", "moment", "Hier beginnt Gewohnheit sichtbar zu werden.", 403, "moment_streak_days", 3),
    AchievementDefinition("moment_streak_4", "cycling", "moments", "4-Tage-Serie", "Vier Tage in Folge mit echtem Rhythmus.", "4D", "moment", "Mehrere Tage hintereinander sind eine starke Basis.", 404, "moment_streak_days", 4),
    AchievementDefinition("moment_weekend_double", "cycling", "moments", "Wochenend-Doppel", "Sowohl Samstag als auch Sonntag gefahren.", "WE2", "moment", "Ein Wochenende, das wirklich genutzt wurde.", 405, "moment_weekend_double"),
    AchievementDefinition("moment_sunrise_century", "cycling", "moments", "Sonnenaufgangs-Hunderter", "Früh gestartet und direkt einen richtig langen Tag gebaut.", "SUN", "moment", "Ein besonderer Tag mit bleibender Erinnerung.", 406, "moment_sunrise_century"),
]
RECORD_DEFINITIONS = [
    AchievementDefinition("record_max_power", "cycling", "records", "Maximalleistung", "Die höchste jemals gemessene Spitzenleistung, egal wie kurz.", "MAX", "record", "Der rohe Peak für Sprints und Antritte.", 0, "record_max_power"),
    AchievementDefinition("record_10s", "cycling", "records", "10 Sekunden Rakete", "Explosivität für Sprint, Lücke oder Ortschild.", "10s", "record", "Kurz, brutal und herrlich direkt.", 1, "record_power_window", window_seconds=10),
    AchievementDefinition("record_30s", "cycling", "records", "30 Sekunden Zündung", "Die perfekte Mitte zwischen Sprint und Härte.", "30s", "record", "Hier zeigt sich echte Punch-Power.", 2, "record_power_window", window_seconds=30),
    AchievementDefinition("record_1m", "cycling", "records", "1 Minute Feuer", "Hart genug, um jeden Ausreißversuch teuer zu machen.", "1m", "record", "Kurzfristige Härte mit hohem Preis.", 3, "record_power_window", window_seconds=60),
    AchievementDefinition("record_5m", "cycling", "records", "5 Minuten Angriff", "Ein starker Marker für harte Berge und VO2max-Nähe.", "5m", "record", "Ideal für giftige Anstiege.", 4, "record_power_window", window_seconds=300),
    AchievementDefinition("record_10m", "cycling", "records", "10 Minuten Druck", "Starker Bereich zwischen Härte und Ausdauer.", "10m", "record", "Ein echter Formindikator.", 5, "record_power_window", window_seconds=600),
    AchievementDefinition("record_20m", "cycling", "records", "20 Minuten FTP-Nähe", "Klassischer Benchmark für Leistungsentwicklung.", "20m", "record", "Direkt spannend für FTP-Themen.", 6, "record_power_window", window_seconds=1200),
    AchievementDefinition("record_30m", "cycling", "records", "30 Minuten Tempo", "Konstanz unter Spannung und sauberem Zug.", "30m", "record", "Hier trennt sich locker von stabil.", 7, "record_power_window", window_seconds=1800),
    AchievementDefinition("record_max_hr", "cycling", "records", "MaxHF Peak", "Der höchste belastbare Puls aus Rennen, Test oder harten Intervallen.", "MHF", "record", "Ein starker Marker für den oberen Herzfrequenzrahmen.", 8, "record_max_hr"),
]
CYCLING_DEFINITIONS = RECORD_DEFINITIONS + DISTANCE_DEFINITIONS + WEEKLY_DEFINITIONS + ZONE_DEFINITIONS + MOMENT_DEFINITIONS


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _format_date(value: datetime | None) -> str | None:
    return value.strftime("%d.%m.%Y") if value else None


def _km(value_m: float | None) -> float:
    return float(value_m or 0) / 1000.0


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _parse_summary_json(raw_json: str | None) -> dict[str, Any]:
    if not raw_json:
        return {}
    try:
        payload = json.loads(raw_json)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _extract_summary_max_hr(activity: Activity) -> float | None:
    payload = _parse_summary_json(activity.raw_json)
    value = payload.get("maxHR")
    if value is None and isinstance(payload.get("summaryDTO"), dict):
        value = payload["summaryDTO"].get("maxHR")
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _effective_max_hr(metrics: list[UserTrainingMetric], target_time: datetime | None) -> float | None:
    if target_time is None:
        return None
    candidates = [metric for metric in metrics if metric.metric_type == "max_hr" and metric.recorded_at <= target_time]
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item.recorded_at, item.id), reverse=True)
    return float(candidates[0].value)


def _records_to_series(records: list[ActivityRecord], attribute: str) -> list[tuple[int, float]]:
    points: list[tuple[int, float]] = []
    seen_seconds: set[int] = set()
    sorted_records = sorted(records, key=lambda item: (item.elapsed_s if item.elapsed_s is not None else 10**12, item.record_index))
    previous_second = -1
    for record in sorted_records:
        raw_value = getattr(record, attribute)
        if raw_value is None:
            continue
        second = int(round(record.elapsed_s)) if record.elapsed_s is not None else previous_second + 1
        if second < 0 or second in seen_seconds:
            continue
        seen_seconds.add(second)
        previous_second = second
        points.append((second, float(raw_value)))
    return points


def _expand_series(points: list[tuple[int, float]], duration_seconds: int | None) -> list[float]:
    if not points:
        return []
    expanded: list[float] = []
    max_index = max(second for second, _ in points)
    if duration_seconds is not None:
        max_index = max(max_index, int(duration_seconds))
    cursor = 0
    last_value = float(points[0][1])
    for second, value in points:
        while cursor < second:
            expanded.append(last_value)
            cursor += 1
        last_value = float(value)
        expanded.append(last_value)
        cursor = second + 1
    while cursor < max_index:
        expanded.append(last_value)
        cursor += 1
    return expanded


def _best_average(series: list[float], window_seconds: int) -> float | None:
    if window_seconds <= 0 or len(series) < window_seconds:
        return None
    window_sum = sum(series[:window_seconds])
    best = window_sum / window_seconds
    for idx in range(window_seconds, len(series)):
        window_sum += series[idx] - series[idx - window_seconds]
        best = max(best, window_sum / window_seconds)
    return best


def _longest_zone1_seconds(records: list[ActivityRecord], max_hr_value: float | None) -> int:
    if max_hr_value is None or max_hr_value <= 0:
        return 0
    lower = max_hr_value * 0.50
    upper = max_hr_value * 0.60
    streak = 0
    best = 0
    for value in _expand_series(_records_to_series(records, "heart_rate_bpm"), None):
        if lower <= value <= upper:
            streak += 1
            best = max(best, streak)
        else:
            streak = 0
    return best


def _record_info(key: str) -> dict[str, str] | None:
    mapping = {
        "record_max_power": ("Höchste Watt-Spitze", "Beliebiges Peak-Fenster", "Zeigt deine maximale Explosivität und den stärksten Einzelmoment auf dem Rad."),
        "record_10s": ("Bestwert über 10 Sekunden", "10 Sekunden Durchschnittsleistung", "Typischer Sprintwert für Antritte, Attacken und kurze Vollgas-Momente."),
        "record_30s": ("Bestwert über 30 Sekunden", "30 Sekunden Durchschnittsleistung", "Sehr aussagekräftig für Punch, giftige Rampen und längere Sprintfinishes."),
        "record_1m": ("Bestwert über 1 Minute", "1 Minute Durchschnittsleistung", "Hilft bei der Einordnung von Attacken, kurzen Bergen und sehr harten Intervallen."),
        "record_5m": ("Bestwert über 5 Minuten", "5 Minuten Durchschnittsleistung", "Wichtiger Marker für VO2max-nahe Belastungen und steile Anstiege."),
        "record_10m": ("Bestwert über 10 Minuten", "10 Minuten Durchschnittsleistung", "Spannend für harte Tempoblöcke, längere Anstiege und Rennhärte."),
        "record_20m": ("Bestwert über 20 Minuten", "20 Minuten Durchschnittsleistung", "Sehr relevant für FTP-Einschätzung und längere Schwellenarbeit."),
        "record_30m": ("Bestwert über 30 Minuten", "30 Minuten Durchschnittsleistung", "Zeigt, wie stabil du Leistung über längere Zeit wirklich halten kannst."),
        "record_max_hr": ("Höchste Herzfrequenz", "Einzelpeak in einer Aktivität", "Hilft, den oberen Rahmen für Herzfrequenzzonen und Spitzenbelastungen zu verstehen."),
    }
    if key not in mapping:
        return None
    metric, window, meaning = mapping[key]
    return {"metric": metric, "window": window, "meaning": meaning}


def _locked(definition: AchievementDefinition) -> dict[str, Any]:
    return {"definition": definition, "status": "locked", "achieved_at": None, "current_value": None, "current_value_label": None, "events": []}


def _serialize_achievement(row: UserAchievement, record_events: list[UserAchievementRecordEvent]) -> dict[str, Any]:
    return {
        "key": row.achievement_key,
        "title": row.title,
        "detail": row.detail,
        "icon": row.icon,
        "status": row.status,
        "hint": row.hint,
        "accent": row.accent,
        "achieved_at": _serialize_datetime(row.achieved_at),
        "achieved_at_label": _format_date(row.achieved_at),
        "current_value": row.current_value,
        "current_value_label": row.current_value_label,
        "record_info": _record_info(row.achievement_key),
        "record_history": [
            {
                "achieved_at": _serialize_datetime(event.achieved_at),
                "achieved_at_label": _format_date(event.achieved_at),
                "value_numeric": event.value_numeric,
                "value_label": event.value_label,
                "summary": event.summary,
                "activity_name": event.activity_name,
            }
            for event in sorted(record_events, key=lambda item: (item.achieved_at, item.id))
        ],
    }


def _compute_cycling_payload(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        activities = session.scalars(
            select(Activity).where(Activity.user_id == user_id, Activity.started_at.is_not(None)).order_by(Activity.started_at.asc(), Activity.id.asc())
        ).all()
        metrics = session.scalars(
            select(UserTrainingMetric).where(UserTrainingMetric.user_id == user_id).order_by(UserTrainingMetric.recorded_at.asc(), UserTrainingMetric.id.asc())
        ).all()
        records = session.scalars(
            select(ActivityRecord).join(Activity, Activity.id == ActivityRecord.activity_id).where(Activity.user_id == user_id).order_by(ActivityRecord.activity_id.asc(), ActivityRecord.record_index.asc())
        ).all()

        records_by_activity: dict[int, list[ActivityRecord]] = defaultdict(list)
        for record in records:
            records_by_activity[record.activity_id].append(record)

        results = {definition.key: _locked(definition) for definition in CYCLING_DEFINITIONS}

        max_ride_km = 0.0
        for activity in activities:
            ride_km = _km(activity.distance_m)
            max_ride_km = max(max_ride_km, ride_km)
            for definition in DISTANCE_DEFINITIONS:
                result = results[definition.key]
                result["current_value"] = max_ride_km
                result["current_value_label"] = f"Bestwert {round(max_ride_km, 1)} km"
                if ride_km >= float(definition.threshold or 0) and result["achieved_at"] is None:
                    result["status"] = "earned"
                    result["achieved_at"] = activity.started_at

        week_totals: dict[date, float] = defaultdict(float)
        for activity in activities:
            if activity.started_at is None:
                continue
            week_key = _week_start(activity.started_at.date())
            week_totals[week_key] += _km(activity.distance_m)
            current_week_km = week_totals[week_key]
            for definition in WEEKLY_DEFINITIONS:
                result = results[definition.key]
                result["current_value"] = max(float(result["current_value"] or 0), current_week_km)
                result["current_value_label"] = f"Beste Woche {round(float(result['current_value']), 1)} km"
                if current_week_km >= float(definition.threshold or 0) and result["achieved_at"] is None:
                    result["status"] = "earned"
                    result["achieved_at"] = activity.started_at

        longest_zone1_minutes = 0.0
        for activity in activities:
            zone1_seconds = _longest_zone1_seconds(records_by_activity.get(activity.id, []), _effective_max_hr(metrics, activity.started_at))
            longest_zone1_minutes = max(longest_zone1_minutes, zone1_seconds / 60.0)
            for definition in ZONE_DEFINITIONS:
                result = results[definition.key]
                result["current_value"] = longest_zone1_minutes
                result["current_value_label"] = f"Längster Block {int(round(longest_zone1_minutes))} min"
                if longest_zone1_minutes >= float(definition.threshold or 0) and result["achieved_at"] is None:
                    result["status"] = "earned"
                    result["achieved_at"] = activity.started_at

        day_counts: dict[date, int] = defaultdict(int)
        for activity in activities:
            if activity.started_at is not None:
                day_counts[activity.started_at.date()] += 1

        active_days = sorted(day_counts)
        longest_streak = 0
        streak = 0
        previous_day: date | None = None
        weekend_saturdays: set[date] = set()
        for day in active_days:
            streak = streak + 1 if previous_day is not None and day == previous_day + timedelta(days=1) else 1
            longest_streak = max(longest_streak, streak)
            previous_day = day
        for activity in activities:
            if activity.started_at is None:
                continue
            ride_day = activity.started_at.date()
            start_minutes = activity.started_at.hour * 60 + activity.started_at.minute
            if start_minutes < 390 and results["moment_early_bird"]["achieved_at"] is None:
                results["moment_early_bird"]["status"] = "earned"
                results["moment_early_bird"]["achieved_at"] = activity.started_at
            if start_minutes >= 20 * 60 and results["moment_night_ride"]["achieved_at"] is None:
                results["moment_night_ride"]["status"] = "earned"
                results["moment_night_ride"]["achieved_at"] = activity.started_at
            if day_counts[ride_day] >= 2 and results["moment_double_day"]["achieved_at"] is None:
                results["moment_double_day"]["status"] = "earned"
                results["moment_double_day"]["achieved_at"] = activity.started_at
            if ride_day.weekday() == 5:
                weekend_saturdays.add(ride_day)
            if ride_day.weekday() == 6 and ride_day - timedelta(days=1) in weekend_saturdays and results["moment_weekend_double"]["achieved_at"] is None:
                results["moment_weekend_double"]["status"] = "earned"
                results["moment_weekend_double"]["achieved_at"] = activity.started_at
            if start_minutes < 420 and _km(activity.distance_m) >= 100 and results["moment_sunrise_century"]["achieved_at"] is None:
                results["moment_sunrise_century"]["status"] = "earned"
                results["moment_sunrise_century"]["achieved_at"] = activity.started_at

        for definition in MOMENT_DEFINITIONS:
            result = results[definition.key]
            if definition.kind != "moment_streak_days":
                continue
            result["current_value"] = float(longest_streak)
            result["current_value_label"] = f"Längste Serie {longest_streak} Tage"
            if longest_streak < int(definition.threshold or 0):
                continue
            result["status"] = "earned"
            if result["achieved_at"] is not None:
                continue
            streak = 0
            previous_day = None
            for day in active_days:
                streak = streak + 1 if previous_day is not None and day == previous_day + timedelta(days=1) else 1
                if streak >= int(definition.threshold or 0):
                    first_activity = next((activity for activity in activities if activity.started_at and activity.started_at.date() == day), None)
                    result["achieved_at"] = first_activity.started_at if first_activity else datetime.combine(day, datetime.min.time())
                    break
                previous_day = day

        record_values: dict[str, float] = {}
        for activity in activities:
            activity_records = records_by_activity.get(activity.id, [])
            power_series = _expand_series(_records_to_series(activity_records, "power_w"), activity.duration_s)
            hr_series = _expand_series(_records_to_series(activity_records, "heart_rate_bpm"), activity.duration_s)
            max_power = max(power_series) if power_series else None
            max_hr = _extract_summary_max_hr(activity)
            if max_hr is None and hr_series:
                max_hr = max(hr_series)
            for definition in RECORD_DEFINITIONS:
                candidate_value: float | None = None
                value_label: str | None = None
                summary: str | None = None
                if definition.kind == "record_max_power" and max_power is not None:
                    candidate_value = float(max_power)
                    value_label = f"{round(candidate_value)} W"
                    summary = f"Neue Spitzenleistung in {activity.name or 'Aktivität'}"
                elif definition.kind == "record_max_hr" and max_hr is not None:
                    candidate_value = float(max_hr)
                    value_label = f"{round(candidate_value)} bpm"
                    summary = f"Neuer MaxHF-Wert in {activity.name or 'Aktivität'}"
                elif definition.kind == "record_power_window" and definition.window_seconds is not None:
                    avg_value = _best_average(power_series, definition.window_seconds)
                    if avg_value is not None:
                        candidate_value = float(avg_value)
                        value_label = f"{round(candidate_value)} W"
                        summary = f"Neuer Bestwert über {int(definition.window_seconds)} s in {activity.name or 'Aktivität'}"
                if candidate_value is None:
                    continue
                if record_values.get(definition.key) is not None and candidate_value <= float(record_values[definition.key]):
                    continue
                record_values[definition.key] = candidate_value
                result = results[definition.key]
                result["status"] = "earned"
                result["achieved_at"] = activity.started_at
                result["current_value"] = candidate_value
                result["current_value_label"] = value_label
                result["events"].append({
                    "achieved_at": activity.started_at,
                    "value_numeric": candidate_value,
                    "value_label": value_label,
                    "summary": summary,
                    "activity_id": activity.id,
                    "activity_name": activity.name or "Aktivität",
                })

        session.execute(delete(UserAchievementRecordEvent).where(UserAchievementRecordEvent.user_id == user_id))
        session.execute(delete(UserAchievement).where(UserAchievement.user_id == user_id))
        now = datetime.utcnow()
        for definition in CYCLING_DEFINITIONS:
            result = results[definition.key]
            session.add(UserAchievement(
                user_id=user_id,
                section_key=definition.section_key,
                category_key=definition.category_key,
                achievement_key=definition.key,
                title=definition.title,
                detail=definition.detail,
                icon=definition.icon,
                accent=definition.accent,
                status=result["status"],
                hint=definition.hint,
                achieved_at=result["achieved_at"],
                current_value=float(result["current_value"]) if result["current_value"] is not None else None,
                current_value_label=result["current_value_label"],
                sort_index=definition.sort_index,
                created_at=now,
                updated_at=now,
            ))
        session.flush()
        for definition in RECORD_DEFINITIONS:
            for event in results[definition.key]["events"]:
                session.add(UserAchievementRecordEvent(
                    user_id=user_id,
                    section_key="cycling",
                    category_key="records",
                    achievement_key=definition.key,
                    achieved_at=event["achieved_at"],
                    value_numeric=event["value_numeric"],
                    value_label=event["value_label"],
                    summary=event["summary"],
                    activity_id=event["activity_id"],
                    activity_name=event["activity_name"],
                    created_at=now,
                ))
        session.commit()

        rows = session.scalars(select(UserAchievement).where(UserAchievement.user_id == user_id, UserAchievement.section_key == "cycling").order_by(UserAchievement.sort_index.asc(), UserAchievement.id.asc())).all()
        event_rows = session.scalars(select(UserAchievementRecordEvent).where(UserAchievementRecordEvent.user_id == user_id, UserAchievementRecordEvent.section_key == "cycling").order_by(UserAchievementRecordEvent.achievement_key.asc(), UserAchievementRecordEvent.achieved_at.asc())).all()
        events_by_key: dict[str, list[UserAchievementRecordEvent]] = defaultdict(list)
        for row in event_rows:
            events_by_key[row.achievement_key].append(row)

        categories: list[dict[str, Any]] = []
        for category_id, label, description in CYCLING_CATEGORIES:
            items = [row for row in rows if row.category_key == category_id]
            categories.append({
                "id": category_id,
                "label": label,
                "description": description,
                "items": [_serialize_achievement(item, events_by_key.get(item.achievement_key, [])) for item in items],
            })

        return {
            "section_key": "cycling",
            "title": SECTION_META["cycling"]["title"],
            "eyebrow": SECTION_META["cycling"]["eyebrow"],
            "intro": SECTION_META["cycling"]["intro"],
            "categories": categories,
        }


def get_achievement_section(user_id: int, section_key: str) -> dict[str, Any]:
    normalized = str(section_key or "").strip().lower()
    if normalized not in SECTION_META:
        raise ValueError("Unknown achievement section.")
    if normalized != "cycling":
        payload = SECTION_META[normalized]
        return {"section_key": normalized, "title": payload["title"], "eyebrow": payload["eyebrow"], "intro": payload["intro"], "cards": payload.get("cards", [])}
    return _compute_cycling_payload(user_id=user_id)


def reset_achievement_data(user_id: int) -> None:
    with SessionLocal() as session:
        session.execute(delete(UserAchievementRecordEvent).where(UserAchievementRecordEvent.user_id == user_id))
        session.execute(delete(UserAchievement).where(UserAchievement.user_id == user_id))
        session.commit()
