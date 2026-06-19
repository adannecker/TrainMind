from __future__ import annotations

import gzip
import io
import math
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from fitparse import FitFile as ParsedFitFile


class RideAnalysisError(ValueError):
    pass


SUPPORTED_SUFFIXES = (".fit", ".gpx", ".tcx")
SC_TO_DEG = 180 / 2**31


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def _to_int(value: Any) -> int | None:
    parsed = _to_float(value)
    if parsed is None:
        return None
    return int(round(parsed))


def _round_or_none(value: Any, digits: int = 1) -> float | None:
    parsed = _to_float(value)
    if parsed is None:
        return None
    return round(parsed, digits)


def _simple_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.lower() in {"unknown", "activity", "garmin activity"}:
        return None
    return text


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _iso_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _seconds_between(start: datetime | None, end: datetime | None) -> float | None:
    if start is None or end is None:
        return None
    try:
        return (end - start).total_seconds()
    except TypeError:
        start_ts = start.timestamp()
        end_ts = end.timestamp()
        return end_ts - start_ts


def _mean(values: list[float | int | None]) -> float | None:
    cleaned = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if not cleaned:
        return None
    return sum(cleaned) / len(cleaned)


def _max(values: list[float | int | None]) -> float | None:
    cleaned = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if not cleaned:
        return None
    return max(cleaned)


def _semicircles_to_deg(value: Any) -> float | None:
    parsed = _to_float(value)
    if parsed is None:
        return None
    return parsed * SC_TO_DEG


def _haversine_m(left: dict[str, Any], right: dict[str, Any]) -> float:
    left_lat = _to_float(left.get("lat"))
    left_lon = _to_float(left.get("lon"))
    right_lat = _to_float(right.get("lat"))
    right_lon = _to_float(right.get("lon"))
    if left_lat is None or left_lon is None or right_lat is None or right_lon is None:
        return 0.0

    radius_m = 6371000.0
    phi1 = math.radians(left_lat)
    phi2 = math.radians(right_lat)
    delta_phi = math.radians(right_lat - left_lat)
    delta_lambda = math.radians(right_lon - left_lon)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _fill_cumulative_distance(points: list[dict[str, Any]]) -> None:
    distance = 0.0
    previous: dict[str, Any] | None = None
    for point in points:
        explicit_distance = _to_float(point.get("distance_m"))
        if explicit_distance is not None:
            distance = max(distance, explicit_distance)
        elif previous is not None:
            distance += _haversine_m(previous, point)
        point["distance_m"] = distance
        previous = point


def _distance_from_points(points: list[dict[str, Any]]) -> float | None:
    distances = [_to_float(point.get("distance_m")) for point in points]
    distances = [value for value in distances if value is not None]
    if distances:
        return max(distances) - min(distances)
    if len(points) < 2:
        return None
    total = 0.0
    previous = points[0]
    for point in points[1:]:
        total += _haversine_m(previous, point)
        previous = point
    return total if total > 0 else None


def _elevation_totals(points: list[dict[str, Any]]) -> tuple[float | None, float | None]:
    ascent = 0.0
    descent = 0.0
    previous_altitude: float | None = None
    for point in points:
        altitude = _to_float(point.get("altitude_m"))
        if altitude is None:
            continue
        if previous_altitude is not None:
            delta = altitude - previous_altitude
            if delta > 0.3:
                ascent += delta
            elif delta < -0.3:
                descent += abs(delta)
        previous_altitude = altitude
    if ascent == 0 and descent == 0:
        return None, None
    return ascent, descent


def _bounds(points: list[dict[str, Any]]) -> dict[str, float | None] | None:
    latitudes = [_to_float(point.get("lat")) for point in points]
    longitudes = [_to_float(point.get("lon")) for point in points]
    latitudes = [value for value in latitudes if value is not None]
    longitudes = [value for value in longitudes if value is not None]
    if not latitudes or not longitudes:
        return None
    return {
        "min_lat": round(min(latitudes), 6),
        "max_lat": round(max(latitudes), 6),
        "min_lon": round(min(longitudes), 6),
        "max_lon": round(max(longitudes), 6),
    }


def _sample_series(points: list[dict[str, Any]], max_points: int = 240) -> list[dict[str, Any]]:
    if not points:
        return []
    if len(points) <= max_points:
        indexes = list(range(len(points)))
    else:
        step = (len(points) - 1) / float(max_points - 1)
        indexes = sorted({int(round(index * step)) for index in range(max_points)})

    start_time = next((point.get("time") for point in points if isinstance(point.get("time"), datetime)), None)
    series: list[dict[str, Any]] = []
    for index in indexes:
        point = points[index]
        timestamp = point.get("time") if isinstance(point.get("time"), datetime) else None
        offset_seconds = _seconds_between(start_time, timestamp) if start_time is not None else None
        series.append(
            {
                "offset_seconds": int(round(max(0, offset_seconds))) if offset_seconds is not None else None,
                "distance_m": _round_or_none(point.get("distance_m"), 1),
                "altitude_m": _round_or_none(point.get("altitude_m"), 1),
                "speed_kmh": _round_or_none((float(point["speed_mps"]) * 3.6) if point.get("speed_mps") is not None else None, 1),
                "heart_rate_bpm": _to_int(point.get("heart_rate_bpm")),
                "power_w": _to_int(point.get("power_w")),
                "cadence_rpm": _to_int(point.get("cadence_rpm")),
            }
        )
    return series


def _sample_map_points(points: list[dict[str, Any]], max_points: int = 1400) -> list[dict[str, Any]]:
    gps_points = [
        point
        for point in points
        if _to_float(point.get("lat")) is not None
        and _to_float(point.get("lon")) is not None
        and abs(float(point["lat"])) <= 90
        and abs(float(point["lon"])) <= 180
    ]
    if not gps_points:
        return []

    if len(gps_points) <= max_points:
        selected_points = gps_points
    else:
        step = (len(gps_points) - 1) / float(max_points - 1)
        indexes = sorted({int(round(index * step)) for index in range(max_points)})
        selected_points = [gps_points[index] for index in indexes]

    start_time = next((point.get("time") for point in gps_points if isinstance(point.get("time"), datetime)), None)
    map_points: list[dict[str, Any]] = []
    for point in selected_points:
        timestamp = point.get("time") if isinstance(point.get("time"), datetime) else None
        offset_seconds = _seconds_between(start_time, timestamp) if start_time is not None else None
        map_points.append(
            {
                "lat": round(float(point["lat"]), 6),
                "lon": round(float(point["lon"]), 6),
                "offset_seconds": int(round(max(0, offset_seconds))) if offset_seconds is not None else None,
                "distance_m": _round_or_none(point.get("distance_m"), 1),
                "altitude_m": _round_or_none(point.get("altitude_m"), 1),
            }
        )
    return map_points


def _first_child_text(element: ET.Element | None, *names: str) -> str | None:
    if element is None:
        return None
    wanted = {name.lower() for name in names}
    for child in list(element):
        if _local_name(child.tag).lower() in wanted and child.text and child.text.strip():
            return child.text.strip()
    return None


def _first_descendant_text(element: ET.Element | None, *names: str) -> str | None:
    if element is None:
        return None
    wanted = {name.lower() for name in names}
    for child in element.iter():
        if child is element:
            continue
        if _local_name(child.tag).lower() in wanted and child.text and child.text.strip():
            return child.text.strip()
    return None


def _iter_by_local(root: ET.Element, name: str) -> list[ET.Element]:
    target = name.lower()
    return [element for element in root.iter() if _local_name(element.tag).lower() == target]


def _xml_root(file_bytes: bytes, format_label: str) -> ET.Element:
    try:
        return ET.fromstring(file_bytes)
    except ET.ParseError as exc:
        raise RideAnalysisError(f"{format_label}-Datei konnte nicht gelesen werden: {exc}") from exc


def _detect_payload_format(filename: str, file_bytes: bytes) -> str:
    lower_name = filename.lower()
    preview = file_bytes[:512].lower()
    if lower_name.endswith(".fit") or (len(file_bytes) >= 12 and b".fit" in file_bytes[:16].lower()):
        return "fit"
    if lower_name.endswith(".gpx") or b"<gpx" in preview:
        return "gpx"
    if lower_name.endswith(".tcx") or b"trainingcenterdatabase" in preview:
        return "tcx"
    raise RideAnalysisError("Bitte eine FIT-, GPX- oder TCX-Datei auswaehlen.")


def _resolve_payload(file_bytes: bytes, filename: str) -> tuple[bytes, str, str]:
    safe_name = Path(filename or "uploaded").name
    if not file_bytes:
        raise RideAnalysisError("Bitte eine Datei auswaehlen.")

    if file_bytes[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
                candidates = [
                    name
                    for name in archive.namelist()
                    if not name.endswith("/") and Path(name).suffix.lower() in SUPPORTED_SUFFIXES
                ]
                if not candidates:
                    raise RideAnalysisError("ZIP enthaelt keine FIT-, GPX- oder TCX-Datei.")
                entry_name = candidates[0]
                entry_bytes = archive.read(entry_name)
                detected = _detect_payload_format(entry_name, entry_bytes)
                return entry_bytes, Path(entry_name).name, detected
        except zipfile.BadZipFile as exc:
            raise RideAnalysisError(f"ZIP konnte nicht gelesen werden: {exc}") from exc

    if file_bytes[:2] == b"\x1f\x8b":
        try:
            inflated = gzip.decompress(file_bytes)
        except OSError as exc:
            raise RideAnalysisError(f"GZIP konnte nicht gelesen werden: {exc}") from exc
        inner_name = Path(safe_name).with_suffix("").name or "uploaded"
        detected = _detect_payload_format(inner_name, inflated)
        return inflated, inner_name, detected

    detected = _detect_payload_format(safe_name, file_bytes)
    return file_bytes, safe_name, detected


def _fit_get(message: Any, *names: str) -> Any:
    if message is None:
        return None
    for name in names:
        try:
            value = message.get_value(name)
        except Exception:
            value = None
        if value is not None:
            return value
    return None


def _fit_activity_name(fit: ParsedFitFile) -> str | None:
    candidates = (
        ("session", ("name", "sport_profile_name")),
        ("workout", ("wkt_name", "name")),
        ("course", ("course_name", "name")),
        ("sport", ("name", "sub_sport", "sport")),
    )
    for message_name, field_names in candidates:
        message = next(iter(fit.get_messages(message_name)), None)
        for field_name in field_names:
            name = _clean_text(_fit_get(message, field_name))
            if name:
                return name
    return None


def _fit_laps(fit: ParsedFitFile) -> list[dict[str, Any]]:
    laps: list[dict[str, Any]] = []
    for index, message in enumerate(fit.get_messages("lap"), start=1):
        start_time = _parse_datetime(_fit_get(message, "start_time", "timestamp"))
        laps.append(
            {
                "index": index,
                "start_time": _iso_or_none(start_time),
                "duration_seconds": _round_or_none(_fit_get(message, "total_timer_time", "total_elapsed_time"), 1),
                "distance_m": _round_or_none(_fit_get(message, "total_distance"), 1),
                "avg_power_w": _to_int(_fit_get(message, "avg_power", "total_average_power")),
                "max_power_w": _to_int(_fit_get(message, "max_power")),
                "avg_hr_bpm": _to_int(_fit_get(message, "avg_heart_rate", "total_average_heart_rate")),
                "max_hr_bpm": _to_int(_fit_get(message, "max_heart_rate")),
                "avg_cadence_rpm": _to_int(_fit_get(message, "avg_cadence")),
            }
        )
    return laps


def _finalize_analysis(
    *,
    source_file_name: str,
    analyzed_file_name: str,
    detected_format: str,
    activity_name: str | None,
    sport: str | None,
    sub_sport: str | None,
    device: dict[str, Any] | None,
    points: list[dict[str, Any]],
    laps: list[dict[str, Any]],
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    overrides = overrides or {}
    times = [point["time"] for point in points if isinstance(point.get("time"), datetime)]
    start_time = _parse_datetime(overrides.get("start_time")) or (times[0] if times else None)
    end_time = _parse_datetime(overrides.get("end_time")) or (times[-1] if times else None)
    duration_seconds = _to_float(overrides.get("duration_seconds"))
    if duration_seconds is None:
        duration_seconds = _seconds_between(start_time, end_time)
    if duration_seconds is not None:
        duration_seconds = max(0.0, duration_seconds)

    distance_m = _to_float(overrides.get("distance_m"))
    if distance_m is None:
        distance_m = _distance_from_points(points)

    avg_speed_mps = _to_float(overrides.get("avg_speed_mps"))
    if avg_speed_mps is None and distance_m is not None and duration_seconds and duration_seconds > 0:
        avg_speed_mps = distance_m / duration_seconds
    if avg_speed_mps is None:
        avg_speed_mps = _mean([point.get("speed_mps") for point in points])

    max_speed_mps = _to_float(overrides.get("max_speed_mps"))
    if max_speed_mps is None:
        max_speed_mps = _max([point.get("speed_mps") for point in points])

    ascent_m = _to_float(overrides.get("ascent_m"))
    descent_m = _to_float(overrides.get("descent_m"))
    if ascent_m is None or descent_m is None:
        computed_ascent, computed_descent = _elevation_totals(points)
        ascent_m = ascent_m if ascent_m is not None else computed_ascent
        descent_m = descent_m if descent_m is not None else computed_descent

    summary = {
        "start_time": _iso_or_none(start_time),
        "end_time": _iso_or_none(end_time),
        "duration_seconds": _round_or_none(duration_seconds, 1),
        "distance_m": _round_or_none(distance_m, 1),
        "avg_speed_kmh": _round_or_none(avg_speed_mps * 3.6 if avg_speed_mps is not None else None, 1),
        "max_speed_kmh": _round_or_none(max_speed_mps * 3.6 if max_speed_mps is not None else None, 1),
        "ascent_m": _round_or_none(ascent_m, 1),
        "descent_m": _round_or_none(descent_m, 1),
        "avg_power_w": _to_int(overrides.get("avg_power_w")) or _to_int(_mean([point.get("power_w") for point in points])),
        "max_power_w": _to_int(overrides.get("max_power_w")) or _to_int(_max([point.get("power_w") for point in points])),
        "avg_hr_bpm": _to_int(overrides.get("avg_hr_bpm")) or _to_int(_mean([point.get("heart_rate_bpm") for point in points])),
        "max_hr_bpm": _to_int(overrides.get("max_hr_bpm")) or _to_int(_max([point.get("heart_rate_bpm") for point in points])),
        "avg_cadence_rpm": _to_int(overrides.get("avg_cadence_rpm")) or _to_int(_mean([point.get("cadence_rpm") for point in points])),
        "max_cadence_rpm": _to_int(overrides.get("max_cadence_rpm")) or _to_int(_max([point.get("cadence_rpm") for point in points])),
        "calories": _to_int(overrides.get("calories")),
    }

    return {
        "source_file_name": source_file_name,
        "analyzed_file_name": analyzed_file_name,
        "detected_format": detected_format,
        "activity": {
            "name": activity_name or Path(analyzed_file_name).stem,
            "sport": sport,
            "sub_sport": sub_sport,
            "device": device or {},
        },
        "summary": summary,
        "samples": {
            "records": len(points),
            "gps_points": sum(1 for point in points if point.get("lat") is not None and point.get("lon") is not None),
            "altitude_points": sum(1 for point in points if point.get("altitude_m") is not None),
            "heart_rate_points": sum(1 for point in points if point.get("heart_rate_bpm") is not None),
            "power_points": sum(1 for point in points if point.get("power_w") is not None),
            "cadence_points": sum(1 for point in points if point.get("cadence_rpm") is not None),
            "laps": len(laps),
        },
        "bounds": _bounds(points),
        "map_points": _sample_map_points(points),
        "laps": laps[:80],
        "series": _sample_series(points),
    }


def _analyze_fit(file_bytes: bytes, source_file_name: str, analyzed_file_name: str) -> dict[str, Any]:
    try:
        fit = ParsedFitFile(io.BytesIO(file_bytes))
    except Exception as exc:
        raise RideAnalysisError(f"FIT-Datei konnte nicht gelesen werden: {exc}") from exc

    file_id = next(iter(fit.get_messages("file_id")), None)
    sport_message = next(iter(fit.get_messages("sport")), None)
    session_message = next(iter(fit.get_messages("session")), None)

    points: list[dict[str, Any]] = []
    for message in fit.get_messages("record"):
        timestamp = _parse_datetime(_fit_get(message, "timestamp"))
        lat = _semicircles_to_deg(_fit_get(message, "position_lat"))
        lon = _semicircles_to_deg(_fit_get(message, "position_long"))
        speed_mps = _to_float(_fit_get(message, "enhanced_speed", "speed"))
        points.append(
            {
                "time": timestamp,
                "lat": lat,
                "lon": lon,
                "altitude_m": _to_float(_fit_get(message, "enhanced_altitude", "altitude")),
                "distance_m": _to_float(_fit_get(message, "distance")),
                "speed_mps": speed_mps,
                "heart_rate_bpm": _to_int(_fit_get(message, "heart_rate")),
                "power_w": _to_int(_fit_get(message, "power")),
                "cadence_rpm": _to_int(_fit_get(message, "cadence")),
            }
        )

    if points and not any(point.get("distance_m") is not None for point in points):
        _fill_cumulative_distance(points)

    sport = _clean_text(_fit_get(sport_message, "sport")) or _clean_text(_fit_get(session_message, "sport"))
    sub_sport = _clean_text(_fit_get(sport_message, "sub_sport")) or _clean_text(_fit_get(session_message, "sub_sport"))
    device = {
        "manufacturer": _simple_value(_fit_get(file_id, "manufacturer")),
        "product": _simple_value(_fit_get(file_id, "garmin_product", "product")),
        "serial_number": _simple_value(_fit_get(file_id, "serial_number")),
        "time_created": _simple_value(_fit_get(file_id, "time_created")),
    }
    device = {key: value for key, value in device.items() if value is not None}

    start_time = _parse_datetime(_fit_get(session_message, "start_time", "timestamp")) or _parse_datetime(_fit_get(file_id, "time_created"))
    overrides = {
        "start_time": start_time,
        "duration_seconds": _fit_get(session_message, "total_timer_time", "total_elapsed_time"),
        "distance_m": _fit_get(session_message, "total_distance"),
        "avg_speed_mps": _fit_get(session_message, "enhanced_avg_speed", "avg_speed"),
        "max_speed_mps": _fit_get(session_message, "enhanced_max_speed", "max_speed"),
        "ascent_m": _fit_get(session_message, "total_ascent"),
        "descent_m": _fit_get(session_message, "total_descent"),
        "avg_power_w": _fit_get(session_message, "avg_power", "total_average_power"),
        "max_power_w": _fit_get(session_message, "max_power"),
        "avg_hr_bpm": _fit_get(session_message, "avg_heart_rate", "total_average_heart_rate"),
        "max_hr_bpm": _fit_get(session_message, "max_heart_rate"),
        "avg_cadence_rpm": _fit_get(session_message, "avg_cadence"),
        "max_cadence_rpm": _fit_get(session_message, "max_cadence"),
        "calories": _fit_get(session_message, "total_calories", "calories"),
    }

    if not points and not any(value is not None for value in overrides.values()):
        raise RideAnalysisError("FIT-Datei enthaelt keine auswertbaren Ride-Daten.")

    return _finalize_analysis(
        source_file_name=source_file_name,
        analyzed_file_name=analyzed_file_name,
        detected_format="FIT",
        activity_name=_fit_activity_name(fit),
        sport=sport,
        sub_sport=sub_sport,
        device=device,
        points=points,
        laps=_fit_laps(fit),
        overrides=overrides,
    )


def _analyze_gpx(file_bytes: bytes, source_file_name: str, analyzed_file_name: str) -> dict[str, Any]:
    root = _xml_root(file_bytes, "GPX")
    points: list[dict[str, Any]] = []
    gpx_points = _iter_by_local(root, "trkpt")
    if not gpx_points:
        gpx_points = _iter_by_local(root, "rtept")
    for trkpt in gpx_points:
        point = {
            "time": _parse_datetime(_first_child_text(trkpt, "time")),
            "lat": _to_float(trkpt.attrib.get("lat")),
            "lon": _to_float(trkpt.attrib.get("lon")),
            "altitude_m": _to_float(_first_child_text(trkpt, "ele")),
            "distance_m": None,
            "speed_mps": _to_float(_first_descendant_text(trkpt, "speed")),
            "heart_rate_bpm": _to_int(_first_descendant_text(trkpt, "hr", "heartrate", "heart_rate")),
            "power_w": _to_int(_first_descendant_text(trkpt, "power", "watts")),
            "cadence_rpm": _to_int(_first_descendant_text(trkpt, "cad", "cadence")),
        }
        points.append(point)

    if not points:
        raise RideAnalysisError("GPX-Datei enthaelt keine Track- oder Route-Punkte.")

    _fill_cumulative_distance(points)
    activity_name = _clean_text(_first_descendant_text(root, "name"))

    return _finalize_analysis(
        source_file_name=source_file_name,
        analyzed_file_name=analyzed_file_name,
        detected_format="GPX",
        activity_name=activity_name,
        sport=None,
        sub_sport=None,
        device={},
        points=points,
        laps=[],
    )


def _tcx_trackpoint_to_point(trackpoint: ET.Element) -> dict[str, Any]:
    position = next((child for child in list(trackpoint) if _local_name(child.tag).lower() == "position"), None)
    heart_rate = next((child for child in list(trackpoint) if _local_name(child.tag).lower() == "heartratebpm"), None)
    return {
        "time": _parse_datetime(_first_child_text(trackpoint, "Time")),
        "lat": _to_float(_first_child_text(position, "LatitudeDegrees")),
        "lon": _to_float(_first_child_text(position, "LongitudeDegrees")),
        "altitude_m": _to_float(_first_child_text(trackpoint, "AltitudeMeters")),
        "distance_m": _to_float(_first_child_text(trackpoint, "DistanceMeters")),
        "speed_mps": _to_float(_first_descendant_text(trackpoint, "Speed")),
        "heart_rate_bpm": _to_int(_first_descendant_text(heart_rate, "Value")),
        "power_w": _to_int(_first_descendant_text(trackpoint, "Watts", "Power")),
        "cadence_rpm": _to_int(_first_child_text(trackpoint, "Cadence") or _first_descendant_text(trackpoint, "RunCadence")),
    }


def _analyze_tcx(file_bytes: bytes, source_file_name: str, analyzed_file_name: str) -> dict[str, Any]:
    root = _xml_root(file_bytes, "TCX")
    activity = next(iter(_iter_by_local(root, "Activity")), None)
    sport = _clean_text(activity.attrib.get("Sport") if activity is not None else None)
    activity_name = _clean_text(_first_descendant_text(activity, "Id")) if activity is not None else None

    laps: list[dict[str, Any]] = []
    total_lap_distance = 0.0
    total_lap_duration = 0.0
    total_calories = 0
    for index, lap in enumerate(_iter_by_local(root, "Lap"), start=1):
        duration = _to_float(_first_child_text(lap, "TotalTimeSeconds"))
        distance = _to_float(_first_child_text(lap, "DistanceMeters"))
        calories = _to_int(_first_child_text(lap, "Calories"))
        if distance is not None:
            total_lap_distance += distance
        if duration is not None:
            total_lap_duration += duration
        if calories is not None:
            total_calories += calories
        average_hr = next((child for child in list(lap) if _local_name(child.tag).lower() == "averageheartratebpm"), None)
        maximum_hr = next((child for child in list(lap) if _local_name(child.tag).lower() == "maximumheartratebpm"), None)
        laps.append(
            {
                "index": index,
                "start_time": _iso_or_none(_parse_datetime(lap.attrib.get("StartTime"))),
                "duration_seconds": _round_or_none(duration, 1),
                "distance_m": _round_or_none(distance, 1),
                "avg_power_w": None,
                "max_power_w": None,
                "avg_hr_bpm": _to_int(_first_descendant_text(average_hr, "Value")),
                "max_hr_bpm": _to_int(_first_descendant_text(maximum_hr, "Value")),
                "avg_cadence_rpm": None,
            }
        )

    points = [_tcx_trackpoint_to_point(trackpoint) for trackpoint in _iter_by_local(root, "Trackpoint")]
    if not points:
        raise RideAnalysisError("TCX-Datei enthaelt keine Trackpoints.")
    if not any(point.get("distance_m") is not None for point in points):
        _fill_cumulative_distance(points)

    overrides: dict[str, Any] = {}
    if total_lap_duration > 0:
        overrides["duration_seconds"] = total_lap_duration
    if total_lap_distance > 0:
        overrides["distance_m"] = total_lap_distance
    if total_calories > 0:
        overrides["calories"] = total_calories

    return _finalize_analysis(
        source_file_name=source_file_name,
        analyzed_file_name=analyzed_file_name,
        detected_format="TCX",
        activity_name=activity_name,
        sport=sport,
        sub_sport=None,
        device={},
        points=points,
        laps=laps,
        overrides=overrides,
    )


def analyze_ride_file_no_import(file_bytes: bytes, filename: str) -> dict[str, Any]:
    payload_bytes, analyzed_file_name, detected = _resolve_payload(file_bytes, filename)
    source_file_name = Path(filename or analyzed_file_name).name
    if detected == "fit":
        return _analyze_fit(payload_bytes, source_file_name, analyzed_file_name)
    if detected == "gpx":
        return _analyze_gpx(payload_bytes, source_file_name, analyzed_file_name)
    if detected == "tcx":
        return _analyze_tcx(payload_bytes, source_file_name, analyzed_file_name)
    raise RideAnalysisError("Dateiformat wird nicht unterstuetzt.")
