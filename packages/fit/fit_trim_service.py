from __future__ import annotations

import io
import hashlib
import math
from datetime import datetime, timedelta
from statistics import mean
from typing import Any

from fit_tool.profile.messages.activity_message import ActivityMessage
from fit_tool.profile.messages.device_info_message import DeviceInfoMessage
from fit_tool.profile.messages.event_message import EventMessage
from fit_tool.profile.messages.file_id_message import FileIdMessage
from fit_tool.profile.messages.lap_message import LapMessage
from fit_tool.profile.messages.record_message import RecordMessage
from fit_tool.profile.messages.session_message import SessionMessage
from fitparse import FitFile as ParsedFitFile

from packages.fit.fit_create_service import _fit_to_bytes, _safe_set, _set_dt_encoded
from packages.fit.fit_fix_service import (
    _build_metric_summary,
    _infer_ftp_w,
    _parse_summary_messages,
)


class FitTrimError(ValueError):
    pass


TrimRange = tuple[int, int]


def _ensure_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    raise FitTrimError("Die FIT-Datei enthaelt keine lesbaren Zeitstempel.")


def _numeric_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def _int_or_none(value: Any) -> int | None:
    parsed = _numeric_or_none(value)
    if parsed is None:
        return None
    return int(round(parsed))


def _collect_record_rows(file_bytes: bytes) -> tuple[list[dict[str, Any]], datetime]:
    fit = ParsedFitFile(io.BytesIO(file_bytes))
    rows: list[dict[str, Any]] = []
    start_ts: datetime | None = None

    for message in fit.get_messages("record"):
        timestamp = message.get_value("timestamp")
        if timestamp is None:
            continue
        timestamp_dt = _ensure_datetime(timestamp)
        if start_ts is None:
            start_ts = timestamp_dt
        offset_seconds = max(0, int(round((timestamp_dt - start_ts).total_seconds())))

        speed_value = _numeric_or_none(message.get_value("enhanced_speed"))
        if speed_value is None:
            speed_value = _numeric_or_none(message.get_value("speed"))

        rows.append(
            {
                "index": len(rows),
                "offset_seconds": offset_seconds,
                "timestamp": timestamp_dt.isoformat(),
                "timestamp_dt": timestamp_dt,
                "power": _int_or_none(message.get_value("power")),
                "speed_mps": speed_value,
                "speed_kmh": None if speed_value is None else speed_value * 3.6,
                "distance_m": _numeric_or_none(message.get_value("distance")),
                "heart_rate": _int_or_none(message.get_value("heart_rate")),
                "cadence": _int_or_none(message.get_value("cadence")),
                "position_lat": _int_or_none(message.get_value("position_lat")),
                "position_long": _int_or_none(message.get_value("position_long")),
                "altitude": _numeric_or_none(message.get_value("altitude")),
                "enhanced_altitude": _numeric_or_none(message.get_value("enhanced_altitude")),
                "temperature": _int_or_none(message.get_value("temperature")),
            }
        )

    if start_ts is None or not rows:
        raise FitTrimError("In der FIT-Datei wurden keine Record-Daten gefunden.")

    return rows, start_ts


def _duration_seconds(rows: list[dict[str, Any]]) -> int:
    return max(int(row["offset_seconds"]) for row in rows)


def _metric_value(row: dict[str, Any], metric: str) -> float | None:
    if metric == "power":
        value = row.get("power")
        return None if value is None else float(value)
    if metric == "speed":
        value = row.get("speed_kmh")
        return None if value is None else float(value)
    return None


def _sample_metric_series(
    rows: list[dict[str, Any]],
    duration_seconds: int,
    metric: str,
    bucket_target: int = 220,
) -> list[dict[str, Any]]:
    metric_rows = [row for row in rows if _metric_value(row, metric) is not None]
    if not metric_rows:
        return []

    bucket_size = max(1, math.ceil(max(duration_seconds, 1) / bucket_target))
    buckets: dict[int, list[float]] = {}

    for row in metric_rows:
        bucket_index = int(row["offset_seconds"]) // bucket_size
        value = _metric_value(row, metric)
        if value is None:
            continue
        buckets.setdefault(bucket_index, []).append(value)

    series: list[dict[str, Any]] = []
    for bucket_index in sorted(buckets):
        values = buckets[bucket_index]
        start_second = bucket_index * bucket_size
        end_second = min(duration_seconds, start_second + bucket_size - 1)
        series.append(
            {
                "start_second": start_second,
                "end_second": end_second,
                "avg_value": round(float(mean(values)), 2),
                "max_value": round(float(max(values)), 2),
                "record_count": len(values),
            }
        )

    return series


def _metric_summary(rows: list[dict[str, Any]], duration_seconds: int, metric: str) -> dict[str, Any] | None:
    values = [_metric_value(row, metric) for row in rows]
    present_values = [float(value) for value in values if value is not None]
    if not present_values:
        return None

    label = "Power" if metric == "power" else "Geschwindigkeit"
    unit = "W" if metric == "power" else "km/h"
    return {
        "key": metric,
        "label": label,
        "unit": unit,
        "record_count": len(present_values),
        "avg_value": round(float(mean(present_values)), 2),
        "max_value": round(float(max(present_values)), 2),
        "series": _sample_metric_series(rows, duration_seconds, metric),
    }


def inspect_fit_for_trim(file_bytes: bytes, filename: str) -> dict[str, Any]:
    rows, start_ts = _collect_record_rows(file_bytes)
    duration = _duration_seconds(rows)
    metrics = {
        metric: summary
        for metric in ("speed", "power")
        if (summary := _metric_summary(rows, duration, metric)) is not None
    }
    if not metrics:
        raise FitTrimError("Die FIT-Datei enthält weder Geschwindigkeit noch Power für die Timeline.")

    distance_values = [float(row["distance_m"]) for row in rows if row.get("distance_m") is not None]
    total_distance_m = 0.0
    if distance_values:
        total_distance_m = max(0.0, distance_values[-1] - distance_values[0])

    return {
        "file_name": filename,
        "duration_seconds": duration,
        "record_count": len(rows),
        "start_time": start_ts.isoformat(),
        "end_time": (start_ts + timedelta(seconds=duration)).isoformat(),
        "total_distance_m": round(total_distance_m, 1),
        "available_metrics": list(metrics.keys()),
        "metrics": metrics,
        "records": [
            {
                "offset_seconds": int(row["offset_seconds"]),
                "timestamp": row["timestamp"],
                "power": row["power"],
                "speed_kmh": None if row["speed_kmh"] is None else round(float(row["speed_kmh"]), 2),
                "distance_m": None if row["distance_m"] is None else round(float(row["distance_m"]), 2),
            }
            for row in rows
        ],
    }


def normalize_delete_segments(raw_segments: Any, duration_seconds: int) -> list[TrimRange]:
    if not isinstance(raw_segments, list):
        raise FitTrimError("Die zu löschenden Segmente müssen als Liste übergeben werden.")

    ranges: list[TrimRange] = []
    for item in raw_segments:
        if not isinstance(item, dict):
            raise FitTrimError("Jedes Segment muss ein Objekt sein.")
        try:
            start_second = int(round(float(item.get("start_second", 0))))
            end_second = int(round(float(item.get("end_second", 0))))
        except (TypeError, ValueError) as exc:
            raise FitTrimError("Ein Segment enthält ungültige Zahlenwerte.") from exc

        start = max(0, min(start_second, duration_seconds))
        end = max(0, min(end_second, duration_seconds))
        if end < start:
            start, end = end, start
        if end <= start:
            continue
        ranges.append((start, end))

    if not ranges:
        raise FitTrimError("Bitte mindestens ein Segment zum Loeschen markieren.")

    ranges.sort(key=lambda value: value[0])
    merged: list[TrimRange] = []
    for start, end in ranges:
        if not merged or start > merged[-1][1] + 1:
            merged.append((start, end))
            continue
        previous_start, previous_end = merged[-1]
        merged[-1] = (previous_start, max(previous_end, end))

    return merged


def _build_trim_summary(trimmed_rows: list[dict[str, Any]], ftp_w: float | None) -> dict[str, Any]:
    duration = max(int(trimmed_rows[-1]["new_offset_seconds"]), 0)
    metric_rows = [
        {
            **row,
            "offset_seconds": int(row["new_offset_seconds"]),
            "distance_m": row.get("new_distance_m"),
        }
        for row in trimmed_rows
    ]

    power_metric_summary: dict[str, Any]
    if any(row.get("power") is not None for row in metric_rows):
        power_metric_summary = _build_metric_summary(metric_rows, ftp_w=ftp_w)
    else:
        power_metric_summary = {
            "avg_power": None,
            "max_power": None,
            "normalized_power": None,
            "total_work_kj": 0,
            "estimated_calories": 0,
            "intensity_factor": None,
            "training_stress_score": None,
            "power_record_count": 0,
        }

    speed_values = [float(row["speed_mps"]) for row in trimmed_rows if row.get("speed_mps") is not None]
    hr_values = [int(row["heart_rate"]) for row in trimmed_rows if row.get("heart_rate") is not None]
    cadence_values = [int(row["cadence"]) for row in trimmed_rows if row.get("cadence") is not None]
    distance_values = [float(row["new_distance_m"]) for row in trimmed_rows if row.get("new_distance_m") is not None]
    total_distance_m = distance_values[-1] if distance_values else 0.0

    return {
        "duration_seconds": duration,
        "record_count": len(trimmed_rows),
        "total_distance_m": round(total_distance_m, 2),
        "avg_speed_mps": float(mean(speed_values)) if speed_values else (total_distance_m / duration if duration > 0 else 0.0),
        "max_speed_mps": float(max(speed_values)) if speed_values else 0.0,
        "avg_power": power_metric_summary["avg_power"],
        "max_power": power_metric_summary["max_power"],
        "normalized_power": power_metric_summary["normalized_power"],
        "total_work_kj": power_metric_summary["total_work_kj"],
        "estimated_calories": power_metric_summary["estimated_calories"],
        "intensity_factor": power_metric_summary["intensity_factor"],
        "training_stress_score": power_metric_summary["training_stress_score"],
        "avg_heart_rate": int(round(mean(hr_values))) if hr_values else None,
        "max_heart_rate": int(max(hr_values)) if hr_values else None,
        "avg_cadence": int(round(mean(cadence_values))) if cadence_values else None,
        "max_cadence": int(max(cadence_values)) if cadence_values else None,
    }


def _is_tail_trim(ranges: list[TrimRange], original_duration: int) -> bool:
    return len(ranges) == 1 and ranges[0][0] > 0 and ranges[0][1] >= original_duration - 1


def _rows_after_tail_trim(rows: list[dict[str, Any]], cutoff_second: int) -> list[dict[str, Any]]:
    retained = [row for row in rows if int(row["offset_seconds"]) <= cutoff_second]
    if len(retained) < 2:
        raise FitTrimError("Nach dem Kürzen müssen mindestens zwei Record-Punkte übrig bleiben.")

    result: list[dict[str, Any]] = []
    for row in retained:
        next_row = dict(row)
        next_row["new_offset_seconds"] = int(row["offset_seconds"])
        next_row["new_distance_m"] = row.get("distance_m")
        result.append(next_row)
    return result


def _build_recreated_tail_fit(
    file_bytes: bytes,
    trimmed_rows: list[dict[str, Any]],
    summary: dict[str, Any],
    start_ts: datetime,
    end_ts: datetime,
    ranges: list[TrimRange],
) -> bytes:
    seed_input = repr(
        {
            "source": file_bytes[:4096].hex(),
            "start_time": start_ts.isoformat(),
            "end_time": end_ts.isoformat(),
            "ranges": ranges,
            "records": len(trimmed_rows),
        }
    )
    seed = int(hashlib.sha256(seed_input.encode("utf-8")).hexdigest()[:16], 16)
    serial_number = seed % 0xFFFFFFFF or 1
    messages: list[Any] = []

    file_id = FileIdMessage()
    _safe_set(file_id, "type", 4)
    _safe_set(file_id, "manufacturer", 255)
    _safe_set(file_id, "product", 0)
    _safe_set(file_id, "serial_number", serial_number)
    _set_dt_encoded(file_id, "time_created", start_ts)
    messages.append(file_id)

    device_info = DeviceInfoMessage()
    _set_dt_encoded(device_info, "timestamp", start_ts)
    _safe_set(device_info, "device_index", 0)
    _safe_set(device_info, "manufacturer", 255)
    _safe_set(device_info, "product", 0)
    _safe_set(device_info, "serial_number", serial_number)
    _safe_set(device_info, "software_version", 1.0)
    _safe_set(device_info, "product_name", "TrainMind FIT Trimmer")
    messages.append(device_info)

    start_event = EventMessage()
    _set_dt_encoded(start_event, "timestamp", start_ts)
    _safe_set(start_event, "event", 0)
    _safe_set(start_event, "event_type", 0)
    _safe_set(start_event, "event_group", 0)
    messages.append(start_event)

    for row in trimmed_rows:
        record = RecordMessage()
        _set_dt_encoded(record, "timestamp", row["timestamp_dt"])
        _safe_set(record, "power", row.get("power"))
        _safe_set(record, "heart_rate", row.get("heart_rate"))
        _safe_set(record, "cadence", row.get("cadence"))
        if row.get("speed_mps") is not None:
            _safe_set(record, "speed", float(row["speed_mps"]))
            _safe_set(record, "enhanced_speed", float(row["speed_mps"]))
        if row.get("distance_m") is not None:
            _safe_set(record, "distance", float(row["distance_m"]))
        _safe_set(record, "position_lat", row.get("position_lat"))
        _safe_set(record, "position_long", row.get("position_long"))
        if row.get("altitude") is not None:
            _safe_set(record, "altitude", float(row["altitude"]))
        if row.get("enhanced_altitude") is not None:
            _safe_set(record, "enhanced_altitude", float(row["enhanced_altitude"]))
        _safe_set(record, "temperature", row.get("temperature"))
        messages.append(record)

    lap = LapMessage()
    _set_dt_encoded(lap, "timestamp", end_ts)
    _set_dt_encoded(lap, "start_time", start_ts)
    _safe_set(lap, "message_index", 0)
    _safe_set(lap, "total_elapsed_time", float(summary["duration_seconds"]))
    _safe_set(lap, "total_timer_time", float(summary["duration_seconds"]))
    _safe_set(lap, "total_distance", float(summary["total_distance_m"]))
    _safe_set(lap, "avg_speed", float(summary["avg_speed_mps"]))
    _safe_set(lap, "enhanced_avg_speed", float(summary["avg_speed_mps"]))
    _safe_set(lap, "max_speed", float(summary["max_speed_mps"]))
    _safe_set(lap, "enhanced_max_speed", float(summary["max_speed_mps"]))
    _safe_set(lap, "avg_power", summary["avg_power"])
    _safe_set(lap, "max_power", summary["max_power"])
    _safe_set(lap, "total_work", int(round(float(summary["total_work_kj"]) * 1000.0)))
    _safe_set(lap, "total_calories", summary["estimated_calories"])
    _safe_set(lap, "avg_heart_rate", summary["avg_heart_rate"])
    _safe_set(lap, "max_heart_rate", summary["max_heart_rate"])
    _safe_set(lap, "avg_cadence", summary["avg_cadence"])
    _safe_set(lap, "max_cadence", summary["max_cadence"])
    messages.append(lap)

    stop_event = EventMessage()
    _set_dt_encoded(stop_event, "timestamp", end_ts)
    _safe_set(stop_event, "event", 0)
    _safe_set(stop_event, "event_type", 9)
    _safe_set(stop_event, "event_group", 0)
    messages.append(stop_event)

    session = SessionMessage()
    _set_dt_encoded(session, "timestamp", end_ts)
    _set_dt_encoded(session, "start_time", start_ts)
    _safe_set(session, "total_elapsed_time", float(summary["duration_seconds"]))
    _safe_set(session, "total_timer_time", float(summary["duration_seconds"]))
    _safe_set(session, "total_distance", float(summary["total_distance_m"]))
    _safe_set(session, "avg_speed", float(summary["avg_speed_mps"]))
    _safe_set(session, "enhanced_avg_speed", float(summary["avg_speed_mps"]))
    _safe_set(session, "max_speed", float(summary["max_speed_mps"]))
    _safe_set(session, "enhanced_max_speed", float(summary["max_speed_mps"]))
    _safe_set(session, "avg_power", summary["avg_power"])
    _safe_set(session, "max_power", summary["max_power"])
    _safe_set(session, "total_work", int(round(float(summary["total_work_kj"]) * 1000.0)))
    _safe_set(session, "total_calories", summary["estimated_calories"])
    _safe_set(session, "avg_heart_rate", summary["avg_heart_rate"])
    _safe_set(session, "max_heart_rate", summary["max_heart_rate"])
    _safe_set(session, "avg_cadence", summary["avg_cadence"])
    _safe_set(session, "max_cadence", summary["max_cadence"])
    try:
        from fit_tool.profile.profile_type import Sport, SubSport

        _safe_set(session, "sport", getattr(Sport, "CYCLING", getattr(Sport, "cycling", 2)))
        _safe_set(session, "sub_sport", getattr(SubSport, "INDOOR_CYCLING", getattr(SubSport, "indoor_cycling", 6)))
    except Exception:
        _safe_set(session, "sport", 2)
        _safe_set(session, "sub_sport", 6)
    messages.append(session)

    activity = ActivityMessage()
    _set_dt_encoded(activity, "timestamp", end_ts)
    _safe_set(activity, "total_timer_time", float(summary["duration_seconds"]))
    _safe_set(activity, "num_sessions", 1)
    _safe_set(activity, "type", 0)
    messages.append(activity)

    return _fit_to_bytes(messages)


def _trim_fit_tail_only(
    file_bytes: bytes,
    parsed_rows: list[dict[str, Any]],
    start_ts: datetime,
    original_duration: int,
    ranges: list[TrimRange],
    summary_messages: list[dict[str, Any]],
) -> tuple[bytes, dict[str, Any]]:
    cutoff_second = int(ranges[0][0])
    trimmed_rows = _rows_after_tail_trim(parsed_rows, cutoff_second)
    ftp_w = _infer_ftp_w(summary_messages, original_duration)
    summary = _build_trim_summary(trimmed_rows, ftp_w)
    end_ts = start_ts + timedelta(seconds=int(summary["duration_seconds"]))
    output_bytes = _build_recreated_tail_fit(
        file_bytes=file_bytes,
        trimmed_rows=trimmed_rows,
        summary=summary,
        start_ts=start_ts,
        end_ts=end_ts,
        ranges=ranges,
    )
    return (
        output_bytes,
        {
            **summary,
            "original_duration_seconds": original_duration,
            "removed_record_count": len(parsed_rows) - len(trimmed_rows),
            "kept_record_count": len(trimmed_rows),
            "delete_segments": [{"start_second": start, "end_second": end} for start, end in ranges],
            "updated_fields": [],
            "start_time": start_ts.isoformat(),
            "end_time": end_ts.isoformat(),
            "trim_mode": "recreated_tail",
            "ftp_inferred_w": round(ftp_w, 1) if ftp_w is not None else None,
        },
    )


def trim_fit_file(file_bytes: bytes, delete_segments: list[TrimRange]) -> tuple[bytes, dict[str, Any]]:
    parsed_rows, start_ts = _collect_record_rows(file_bytes)
    summary_messages = _parse_summary_messages(file_bytes)
    original_duration = _duration_seconds(parsed_rows)
    ranges = normalize_delete_segments(
        [{"start_second": start, "end_second": end} for start, end in delete_segments],
        original_duration,
    )
    if not _is_tail_trim(ranges, original_duration):
        raise FitTrimError("Der Garmin-sichere Export unterstützt aktuell nur das Kürzen am Ende: bitte genau das letzte Segment markieren.")
    return _trim_fit_tail_only(
        file_bytes=file_bytes,
        parsed_rows=parsed_rows,
        start_ts=start_ts,
        original_duration=original_duration,
        ranges=ranges,
        summary_messages=summary_messages,
    )
