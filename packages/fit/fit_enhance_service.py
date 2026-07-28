from __future__ import annotations

import io
import math
import struct
from datetime import datetime
from statistics import mean
from typing import Any

from fitparse import FitFile as ParsedFitFile

from packages.fit.fit_create_service import _finalize_fit_bytes
from packages.fit.fit_fix_service import _build_metric_summary, _infer_ftp_w, _parse_summary_messages
from packages.fit.fit_trim_service import _collect_record_rows, _duration_seconds, _position_degrees_or_none


class FitEnhanceError(ValueError):
    pass


FIT_ENHANCE_EXPORTER_VERSION = "tm-fit-enhance-v1-byte-preserving"
_FIT_EPOCH_UNIX_SECONDS = 631065600
_TIMESTAMP_FIELD = 253
_RECORD_MESSAGE = 20
_LAP_MESSAGE = 19
_SESSION_MESSAGE = 18
_ACTIVITY_MESSAGE = 34
_RECORD_DISTANCE_FIELD = 5
_RECORD_SPEED_FIELD = 6
_RECORD_POWER_FIELD = 7
_RECORD_ENHANCED_SPEED_FIELD = 73
_RECORD_ACCUMULATED_POWER_FIELD = 29


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _fit_seconds(value: datetime) -> int:
    return int(value.timestamp()) - _FIT_EPOCH_UNIX_SECONDS


def _format_records(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "offset_seconds": int(row["offset_seconds"]),
            "altitude_m": row.get("enhanced_altitude") if row.get("enhanced_altitude") is not None else row.get("altitude"),
            "power_w": row.get("power"),
            "heart_rate_bpm": row.get("heart_rate"),
            "distance_m": row.get("distance_m"),
            "speed_kmh": row.get("speed_kmh"),
            "lat": _position_degrees_or_none(row.get("position_lat")),
            "lon": _position_degrees_or_none(row.get("position_long")),
        }
        for row in rows
    ]


def inspect_fit_for_enhance(file_bytes: bytes, filename: str) -> dict[str, Any]:
    rows, start_ts = _collect_record_rows(file_bytes)
    duration = _duration_seconds(rows)
    return {
        "file_name": filename,
        "start_time": start_ts.isoformat(),
        "duration_seconds": duration,
        "record_count": len(rows),
        "records": _format_records(rows),
        "map_points": [
            {"lat": point["lat"], "lon": point["lon"], "offset_seconds": point["offset_seconds"]}
            for point in _format_records(rows)
            if point["lat"] is not None and point["lon"] is not None
        ],
    }


def normalize_enhance_segment(raw_segment: Any, duration_seconds: int) -> tuple[int, int, float]:
    if not isinstance(raw_segment, dict):
        raise FitEnhanceError("Die Segment-Anpassung muss ein Objekt sein.")
    try:
        start = int(round(float(raw_segment.get("start_second"))))
        end = int(round(float(raw_segment.get("end_second"))))
        percent = float(raw_segment.get("duration_percent"))
    except (TypeError, ValueError) as exc:
        raise FitEnhanceError("Segment oder Prozentwert ist ungültig.") from exc
    start = max(0, min(start, duration_seconds))
    end = max(0, min(end, duration_seconds))
    if end <= start:
        raise FitEnhanceError("Bitte einen Bereich mit mindestens einer Sekunde markieren.")
    if percent < 25 or percent > 400:
        raise FitEnhanceError("Die Dauer muss zwischen 25 % und 400 % liegen.")
    return start, end, percent / 100.0


def _remap_offset(offset: float, start: int, end: int, factor: float) -> float:
    if offset <= start:
        return offset
    if offset <= end:
        return start + ((offset - start) * factor)
    return offset + ((end - start) * (factor - 1.0))


def _read_uint(data: bytes | bytearray, offset: int, size: int, endian: str) -> int:
    if size == 1:
        return data[offset]
    if size == 2:
        return struct.unpack_from(f"{endian}H", data, offset)[0]
    if size == 4:
        return struct.unpack_from(f"{endian}I", data, offset)[0]
    raise FitEnhanceError("Ein FIT-Feld hat eine nicht unterstützte Größe.")


def _write_uint(data: bytearray, offset: int, size: int, endian: str, value: float | int) -> None:
    value = max(0, int(round(float(value))))
    if size == 1:
        data[offset] = min(value, 0xFF)
    elif size == 2:
        struct.pack_into(f"{endian}H", data, offset, min(value, 0xFFFF))
    elif size == 4:
        struct.pack_into(f"{endian}I", data, offset, min(value, 0xFFFFFFFF))
    else:
        raise FitEnhanceError("Ein FIT-Feld hat eine nicht unterstützte Größe.")


def _definition_endian(architecture: int) -> str:
    return ">" if architecture == 1 else "<"


def _fit_header_bounds(file_bytes: bytes) -> tuple[int, int]:
    if not file_bytes or file_bytes[0] not in {12, 14}:
        raise FitEnhanceError("Die FIT-Datei hat einen unerwarteten Header.")
    header_size = int(file_bytes[0])
    if len(file_bytes) < header_size + 2:
        raise FitEnhanceError("Die FIT-Datei ist unvollständig.")
    data_end = header_size + struct.unpack_from("<I", file_bytes, 4)[0]
    if data_end + 2 > len(file_bytes):
        raise FitEnhanceError("Die FIT-Datei ist unvollständig.")
    return header_size, data_end


def _physical_power(
    original_power: int,
    distance_delta_m: float,
    altitude_delta_m: float,
    original_dt: float,
    new_dt: float,
    mass_kg: float,
    crr: float,
    cda_m2: float,
) -> int:
    if original_power <= 0 or original_dt <= 0 or new_dt <= 0:
        return max(0, original_power)
    if distance_delta_m <= 0:
        # Some FIT files do not record distance every second.  Keep the physics
        # direction meaningful by using the required speed ratio as fallback.
        multiplier = max(0.2, min(5.0, (original_dt / new_dt) ** 2.5))
        return max(0, min(2500, int(round(original_power * multiplier))))
    old_speed = distance_delta_m / original_dt
    new_speed = distance_delta_m / new_dt
    grade = max(-0.15, min(0.20, altitude_delta_m / distance_delta_m))
    gravity = 9.80665
    air_density = 1.225
    rolling = mass_kg * gravity * max(0.0, crr + grade)
    old_model = rolling * old_speed + 0.5 * air_density * cda_m2 * old_speed**3
    new_model = rolling * new_speed + 0.5 * air_density * cda_m2 * new_speed**3
    if old_model <= 8:
        multiplier = max(0.3, min(4.0, new_speed / max(old_speed, 0.1)))
    else:
        multiplier = max(0.2, min(5.0, new_model / old_model))
    return max(0, min(2500, int(round(original_power * multiplier))))


def _enhanced_rows(
    rows: list[dict[str, Any]], start: int, end: int, factor: float, mass_kg: float, crr: float, cda_m2: float
) -> list[dict[str, Any]]:
    enhanced: list[dict[str, Any]] = []
    accumulated_delta = 0
    previous = rows[0]
    for index, row in enumerate(rows):
        next_row = dict(row)
        old_offset = float(row["offset_seconds"])
        next_row["new_offset_seconds"] = int(round(_remap_offset(old_offset, start, end, factor)))
        if index == 0:
            next_row["power"] = row.get("power")
        else:
            old_dt = max(1.0, float(row["offset_seconds"]) - float(previous["offset_seconds"]))
            in_segment = start < old_offset <= end
            # FIT timestamps have one-second resolution.  The actual duration
            # for the physical calculation must nevertheless retain the factor;
            # otherwise a 1 Hz file would round every shortened interval back
            # to one second and never receive a power adjustment.
            new_dt = old_dt * factor if in_segment else old_dt
            next_row["effective_dt_seconds"] = new_dt
            power = row.get("power")
            if in_segment and power is not None:
                distance = (_number(row.get("distance_m")) or 0.0) - (_number(previous.get("distance_m")) or 0.0)
                altitude = (_number(row.get("enhanced_altitude")) or _number(row.get("altitude")) or 0.0) - (
                    _number(previous.get("enhanced_altitude")) or _number(previous.get("altitude")) or 0.0
                )
                next_row["power"] = _physical_power(int(power), distance, altitude, old_dt, new_dt, mass_kg, crr, cda_m2)
            else:
                next_row["power"] = power
        original_accumulated = row.get("accumulated_power")
        if original_accumulated is not None:
            original_power = row.get("power") or 0
            next_power = next_row.get("power") or 0
            old_dt = float(next_row.get("effective_dt_seconds") or 1.0)
            original_dt = old_dt / factor if start < old_offset <= end else old_dt
            accumulated_delta += int(round((float(next_power) * old_dt) - (float(original_power) * original_dt)))
            next_row["accumulated_power"] = max(0, int(original_accumulated) + accumulated_delta)
        enhanced.append(next_row)
        previous = row
    return enhanced


def _patch_fit_bytes(
    file_bytes: bytes, rows: list[dict[str, Any]], enhanced_rows: list[dict[str, Any]], start: int, end: int, factor: float, metric_summary: dict[str, Any], ftp_w: float | None
) -> tuple[bytes, list[str]]:
    data = bytearray(file_bytes)
    offset, data_end = _fit_header_bounds(file_bytes)
    definitions: dict[int, dict[str, Any]] = {}
    row_index = 0
    first_fit_seconds = _fit_seconds(rows[0]["timestamp_dt"])
    new_end_offset = int(enhanced_rows[-1]["new_offset_seconds"])
    summary_values = {
        "avg_power": metric_summary.get("avg_power"), "max_power": metric_summary.get("max_power"),
        "normalized_power": metric_summary.get("normalized_power"), "total_work": int(round(float(metric_summary.get("total_work_kj") or 0) * 1000)),
        "calories": metric_summary.get("estimated_calories"), "intensity_factor": metric_summary.get("intensity_factor"),
        "training_stress_score": metric_summary.get("training_stress_score"),
    }
    summary_fields = {
        _LAP_MESSAGE: {7: ("total_elapsed", 1), 8: ("total_timer", 1), 9: ("total_distance", 100), 13: ("avg_speed", 1000), 14: ("max_speed", 1000), 19: ("avg_power", 1), 20: ("max_power", 1), 33: ("normalized_power", 1), 41: ("total_work", 1), 11: ("calories", 1)},
        _SESSION_MESSAGE: {7: ("total_elapsed", 1), 8: ("total_timer", 1), 9: ("total_distance", 100), 14: ("avg_speed", 1000), 15: ("max_speed", 1000), 20: ("avg_power", 1), 21: ("max_power", 1), 34: ("normalized_power", 1), 48: ("total_work", 1), 11: ("calories", 1), 35: ("training_stress_score", 10), 36: ("intensity_factor", 1000)},
        _ACTIVITY_MESSAGE: {0: ("total_timer", 1)},
    }
    updated: set[str] = set()

    while offset < data_end:
        header = data[offset]
        offset += 1
        if header & 0x80:
            local_type = (header >> 5) & 0x03
            definition = definitions.get(local_type)
            if definition is None:
                raise FitEnhanceError("Die FIT-Datei enthält komprimierte Daten ohne Definition.")
            raise FitEnhanceError("Diese FIT-Datei nutzt komprimierte Zeitstempel und kann noch nicht verlustfrei zeitverzerrt werden.")
        local_type = header & 0x0F
        is_definition = bool(header & 0x40)
        has_developer_fields = bool(header & 0x20)
        if is_definition:
            if offset + 5 > data_end:
                raise FitEnhanceError("Die FIT-Definition ist unvollständig.")
            offset += 1
            endian = _definition_endian(data[offset]); offset += 1
            global_message = struct.unpack_from(f"{endian}H", data, offset)[0]; offset += 2
            count = data[offset]; offset += 1
            fields: list[dict[str, int]] = []
            data_size = 0
            for _ in range(count):
                number, size, base_type = data[offset], data[offset + 1], data[offset + 2]
                fields.append({"number": number, "size": size, "base_type": base_type, "offset": data_size})
                data_size += size; offset += 3
            if has_developer_fields:
                developer_count = data[offset]; offset += 1
                for _ in range(developer_count):
                    data_size += data[offset + 1]; offset += 3
            definitions[local_type] = {"global_message": global_message, "fields": fields, "endian": endian, "data_size": data_size}
            continue
        definition = definitions.get(local_type)
        if definition is None:
            raise FitEnhanceError("Die FIT-Datei enthält Daten ohne passende Definition.")
        message_start = offset
        message_end = message_start + int(definition["data_size"])
        if message_end > data_end:
            raise FitEnhanceError("Eine FIT-Message ist unvollständig.")
        global_message = int(definition["global_message"])
        endian = str(definition["endian"])
        fields = definition["fields"]
        if global_message == _RECORD_MESSAGE:
            if row_index >= len(rows):
                raise FitEnhanceError("Die FIT-Record-Daten konnten nicht konsistent gelesen werden.")
            original, next_row = rows[row_index], enhanced_rows[row_index]
            for field in fields:
                number, size, field_offset = field["number"], field["size"], field["offset"]
                target = message_start + field_offset
                if number == _TIMESTAMP_FIELD:
                    _write_uint(data, target, size, endian, first_fit_seconds + int(next_row["new_offset_seconds"])); updated.add("record:timestamp")
                elif number == _RECORD_POWER_FIELD and next_row.get("power") is not None:
                    _write_uint(data, target, size, endian, int(next_row["power"])); updated.add("record:power")
                elif number == _RECORD_ACCUMULATED_POWER_FIELD and next_row.get("accumulated_power") is not None:
                    _write_uint(data, target, size, endian, int(next_row["accumulated_power"])); updated.add("record:accumulated_power")
                elif number in {_RECORD_SPEED_FIELD, _RECORD_ENHANCED_SPEED_FIELD} and row_index > 0:
                    old_distance = _number(original.get("distance_m")); previous_distance = _number(rows[row_index - 1].get("distance_m"))
                    effective_dt = float(next_row.get("effective_dt_seconds") or 1.0)
                    if old_distance is not None and previous_distance is not None and effective_dt > 0:
                        _write_uint(data, target, size, endian, ((old_distance - previous_distance) / effective_dt) * 1000); updated.add("record:speed")
            row_index += 1
        else:
            for field in fields:
                number, size, field_offset = field["number"], field["size"], field["offset"]
                target = message_start + field_offset
                is_datetime = (field["base_type"] & 0x1F) == 6
                if size == 4 and (number == _TIMESTAMP_FIELD or is_datetime):
                    current = _read_uint(data, target, size, endian)
                    if current < 0xFFFFFF00:
                        remapped = first_fit_seconds + int(round(_remap_offset(current - first_fit_seconds, start, end, factor)))
                        _write_uint(data, target, size, endian, remapped); updated.add("message:timestamp")
                if global_message in summary_fields:
                    spec = summary_fields[global_message].get(number)
                    if spec is None:
                        continue
                    key, scale = spec
                    if key in {"total_elapsed", "total_timer"}:
                        value = new_end_offset
                    elif key == "total_distance":
                        value = float(rows[-1].get("distance_m") or 0)
                    elif key in {"avg_speed", "max_speed"}:
                        speeds = []
                        for idx in range(1, len(enhanced_rows)):
                            dist = (_number(rows[idx].get("distance_m")) or 0) - (_number(rows[idx - 1].get("distance_m")) or 0)
                            dt = int(enhanced_rows[idx]["new_offset_seconds"]) - int(enhanced_rows[idx - 1]["new_offset_seconds"])
                            if dt > 0: speeds.append(dist / dt)
                        value = (mean(speeds) if key == "avg_speed" and speeds else max(speeds) if speeds else 0)
                    else:
                        value = summary_values.get(key)
                    if value is not None and not (key in {"intensity_factor", "training_stress_score"} and ftp_w is None):
                        _write_uint(data, target, size, endian, float(value) * scale); updated.add(f"summary:{key}")
        offset = message_end
    if row_index != len(rows):
        raise FitEnhanceError("Die FIT-Record-Daten konnten nicht konsistent gelesen werden.")
    return _finalize_fit_bytes(bytes(data[:data_end])), sorted(updated)


def enhance_fit_file(file_bytes: bytes, segment: tuple[int, int, float], mass_kg: float = 83.0, crr: float = 0.004, cda_m2: float = 0.32) -> tuple[bytes, dict[str, Any]]:
    rows, start_ts = _collect_record_rows(file_bytes)
    start, end, factor = segment
    mass_kg = max(40.0, min(float(mass_kg), 180.0))
    crr = max(0.001, min(float(crr), 0.02))
    cda_m2 = max(0.15, min(float(cda_m2), 0.8))
    enhanced_rows = _enhanced_rows(rows, start, end, factor, mass_kg, crr, cda_m2)
    original_duration = _duration_seconds(rows)
    summary_messages = _parse_summary_messages(file_bytes)
    ftp_w = _infer_ftp_w(summary_messages, original_duration)
    metric_rows = [{**row, "offset_seconds": int(row["new_offset_seconds"])} for row in enhanced_rows]
    metrics = _build_metric_summary(metric_rows, ftp_w=ftp_w) if any(row.get("power") is not None for row in metric_rows) else {}
    output_bytes, updated_fields = _patch_fit_bytes(file_bytes, rows, enhanced_rows, start, end, factor, metrics, ftp_w)
    selected_original = [row for row in rows if start <= int(row["offset_seconds"]) <= end and row.get("power") is not None]
    selected_enhanced = [row for row in enhanced_rows if start <= int(row["offset_seconds"]) <= end and row.get("power") is not None]
    segment_duration = end - start
    return output_bytes, {
        "original_duration_seconds": original_duration,
        "duration_seconds": int(enhanced_rows[-1]["new_offset_seconds"]),
        "segment_original_duration_seconds": segment_duration,
        "segment_duration_seconds": int(round(segment_duration * factor)),
        "segment_avg_power_before": round(mean([float(row["power"]) for row in selected_original]), 1) if selected_original else None,
        "segment_avg_power_after": round(mean([float(row["power"]) for row in selected_enhanced]), 1) if selected_enhanced else None,
        "avg_power": metrics.get("avg_power"),
        "updated_fields": updated_fields,
        "exporter_version": FIT_ENHANCE_EXPORTER_VERSION,
        "start_time": start_ts.isoformat(),
    }
