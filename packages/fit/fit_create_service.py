from __future__ import annotations

import hashlib
import math
import os
import random
import struct
import tempfile
from datetime import datetime, timezone
from statistics import mean
from typing import Any

from fit_tool.fit_file import FitFile as FitWriter, FitFileHeader
from fit_tool.record import Record, RecordHeader
from fit_tool.definition_message import DefinitionMessage
from fit_tool.profile.messages.activity_message import ActivityMessage
from fit_tool.profile.messages.device_info_message import DeviceInfoMessage
from fit_tool.profile.messages.event_message import EventMessage
from fit_tool.profile.messages.file_id_message import FileIdMessage
from fit_tool.profile.messages.lap_message import LapMessage
from fit_tool.profile.messages.record_message import RecordMessage
from fit_tool.profile.messages.session_message import SessionMessage


class FitCreateError(ValueError):
    pass


FIT_EPOCH = datetime(1989, 12, 31, tzinfo=timezone.utc)
FIELD_NUMBERS = {"timestamp": 253, "start_time": 2, "time_created": 4}
SEMICIRCLES_PER_DEGREE = 2**31 / 180.0
FIT_CRC_TABLE = (
    0x0000,
    0xCC01,
    0xD801,
    0x1400,
    0xF001,
    0x3C00,
    0x2800,
    0xE401,
    0xA001,
    0x6C00,
    0x7800,
    0xB401,
    0x5000,
    0x9C01,
    0x8801,
    0x4400,
)


def _safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(parsed):
        return default
    return parsed


def _safe_int(value: Any, default: int = 0) -> int:
    return int(round(_safe_float(value, float(default))))


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        raw = value.strip()
        if raw.endswith("Z"):
            raw = f"{raw[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError as exc:
            raise FitCreateError("start_time must be an ISO datetime.") from exc
    else:
        raise FitCreateError("start_time is required.")

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _to_fit_seconds(ts: datetime) -> int:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return int((ts.astimezone(timezone.utc) - FIT_EPOCH).total_seconds())


def _set_dt_encoded(message: Any, field_name: str, value: datetime) -> None:
    raw = _to_fit_seconds(value)
    field = None
    if hasattr(message, "get_field_by_name"):
        try:
            field = message.get_field_by_name(field_name)
        except Exception:
            field = None
    if field is None and hasattr(message, "get_field"):
        field_num = FIELD_NUMBERS.get(field_name)
        if field_num is not None:
            try:
                field = message.get_field(field_num)
            except Exception:
                field = None

    if field is not None and hasattr(field, "set_encoded_value"):
        base_type = getattr(field, "base_type", None)
        scale = getattr(base_type, "scale", 1) or 1
        offset = getattr(base_type, "offset", 0) or 0
        encoded = int(round((raw + offset) * scale))
        field.set_encoded_value(0, max(0, min(encoded, 0xFFFFFFFF)))
        return

    _safe_set(message, field_name, raw)


def _safe_set(message: Any, field_name: str, value: Any) -> bool:
    if value is None:
        return False
    try:
        setattr(message, field_name, value)
        return True
    except Exception:
        return False


def _deg_to_semicircles(value: float) -> int:
    return int(round(value * SEMICIRCLES_PER_DEGREE))


def _update_fit_crc(crc: int, byte_value: int) -> int:
    tmp = FIT_CRC_TABLE[crc & 0xF]
    crc = (crc >> 4) & 0x0FFF
    crc = crc ^ tmp ^ FIT_CRC_TABLE[byte_value & 0xF]
    tmp = FIT_CRC_TABLE[crc & 0xF]
    crc = (crc >> 4) & 0x0FFF
    crc = crc ^ tmp ^ FIT_CRC_TABLE[(byte_value >> 4) & 0xF]
    return crc & 0xFFFF


def _compute_fit_crc(data: bytes) -> int:
    crc = 0
    for byte_value in data:
        crc = _update_fit_crc(crc, byte_value)
    return crc


def _finalize_fit_bytes(raw_bytes: bytes) -> bytes:
    if len(raw_bytes) < 14:
        raise FitCreateError("Generated FIT payload is too short.")
    header_size = int(raw_bytes[0])
    if header_size not in {12, 14} or len(raw_bytes) < header_size:
        raise FitCreateError("Generated FIT payload has an invalid header.")

    has_existing_crc = False
    if len(raw_bytes) >= header_size + 4:
        existing_crc = struct.unpack("<H", raw_bytes[-2:])[0]
        body_candidate = bytearray(raw_bytes[:-2])
        corrected_candidate = bytearray(body_candidate)
        corrected_candidate[4:8] = struct.pack("<I", len(corrected_candidate) - header_size)
        has_existing_crc = (
            _compute_fit_crc(bytes(body_candidate)) == existing_crc
            or _compute_fit_crc(bytes(corrected_candidate)) == existing_crc
        )

    body = bytearray(raw_bytes[:-2] if has_existing_crc else raw_bytes)

    data_size = len(body) - header_size
    if data_size <= 0:
        raise FitCreateError("Generated FIT payload contains no data records.")
    body[4:8] = struct.pack("<I", data_size)

    if header_size == 14:
        header_crc = _compute_fit_crc(bytes(body[:12]))
        body[12:14] = struct.pack("<H", header_crc)

    file_crc = _compute_fit_crc(bytes(body))
    return bytes(body) + struct.pack("<H", file_crc)


def _definition_signature(definition: DefinitionMessage) -> tuple[Any, ...]:
    field_signature = tuple(
        (field_definition.field_id, field_definition.size, int(getattr(field_definition.base_type, "value", field_definition.base_type)))
        for field_definition in definition.field_definitions
    )
    developer_signature = tuple(
        (
            developer_definition.field_number,
            developer_definition.size,
            developer_definition.developer_data_index,
        )
        for developer_definition in (definition.developer_field_definitions or [])
    )
    return (definition.global_id, field_signature, developer_signature)


def _wrap_fit_messages(messages: list[Any]) -> list[Record]:
    records: list[Record] = []
    definitions_by_signature: dict[tuple[Any, ...], DefinitionMessage] = {}
    local_ids_by_signature: dict[tuple[Any, ...], int] = {}
    next_local_id = 0

    for message in messages:
        definition = DefinitionMessage.from_data_message(message)
        signature = _definition_signature(definition)
        local_id = local_ids_by_signature.get(signature)

        if local_id is None:
            if next_local_id > 15:
                raise FitCreateError("Generated FIT needs more local message definitions than FIT supports.")
            local_id = next_local_id
            next_local_id += 1
            local_ids_by_signature[signature] = local_id
            definition.local_id = local_id
            definitions_by_signature[signature] = definition
            records.append(
                Record(
                    header=RecordHeader(is_definition=True, has_developer_fields=False, local_id=local_id),
                    message=definition,
                )
            )
        else:
            definition = definitions_by_signature[signature]

        message.local_id = local_id
        try:
            message.set_definition_message(definition)
        except Exception:
            pass
        records.append(
            Record(
                header=RecordHeader(is_definition=False, has_developer_fields=False, local_id=local_id),
                message=message,
            )
        )

    return records


def _smoothstep(value: float) -> float:
    clamped = max(0.0, min(1.0, value))
    return clamped * clamped * (3.0 - 2.0 * clamped)


def _air_density(temp_c: float | None, humidity_pct: float | None) -> float:
    temp = 15.0 if temp_c is None else float(temp_c)
    humidity = 50.0 if humidity_pct is None else max(0.0, min(100.0, float(humidity_pct)))
    dry_air = 1.225 * (288.15 / (273.15 + temp))
    return dry_air * (1.0 - 0.0009 * humidity)


def _power_to_speed_flat(
    power_w: float,
    *,
    mass_kg: float,
    cda_m2: float,
    crr: float,
    rho: float,
    drivetrain_efficiency: float,
) -> float:
    if power_w <= 0:
        return 0.0

    gravity = 9.80665
    wheel_power = power_w * drivetrain_efficiency

    def resistive_power(speed_mps: float) -> float:
        rolling = speed_mps * (crr * mass_kg * gravity)
        aero = 0.5 * rho * cda_m2 * speed_mps**3
        return rolling + aero

    lo = 0.0
    hi = 25.0
    while resistive_power(hi) < wheel_power and hi < 60.0:
        hi *= 1.5

    for _ in range(60):
        mid = (lo + hi) / 2.0
        if resistive_power(mid) > wheel_power:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2.0


def _wave_value(rng: random.Random, avg: float, min_value: float, max_value: float, phase: float) -> float:
    low = min(avg, min_value)
    high = max(avg, max_value)
    base_wave = (
        0.58 * math.sin(2.0 * math.pi * (phase * 2.2 + 0.13))
        + 0.25 * math.sin(2.0 * math.pi * (phase * 7.0 + 0.41))
        + rng.uniform(-0.17, 0.17)
    )
    if base_wave >= 0:
        return avg + (high - avg) * min(base_wave, 1.0)
    return avg + (avg - low) * max(base_wave, -1.0)


def _hr_value(
    rng: random.Random,
    start_hr: float,
    end_hr: float,
    avg_hr: float,
    min_hr: float,
    max_hr: float,
    phase: float,
    *,
    is_first: bool,
    is_last: bool,
) -> float:
    if is_first:
        return start_hr
    if is_last:
        return end_hr

    baseline = start_hr + (end_hr - start_hr) * _smoothstep(phase)
    midpoint_avg = (start_hr + end_hr) / 2.0
    bell = math.sin(math.pi * phase)
    correction = (avg_hr - midpoint_avg) * bell * 1.35
    ripple = math.sin(2.0 * math.pi * (phase * 3.0 + 0.2)) * 1.2 + rng.uniform(-0.8, 0.8)
    return max(min_hr, min(max_hr, baseline + correction + ripple))


def _normalize_intervals(raw_intervals: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_intervals, list) or not raw_intervals:
        raise FitCreateError("At least one interval is required.")

    intervals: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_intervals, start=1):
        if not isinstance(raw, dict):
            raise FitCreateError("Each interval must be an object.")

        duration_seconds = max(1, _safe_int(raw.get("duration_seconds"), 0))
        if duration_seconds < 30:
            raise FitCreateError("Each interval must be at least 30 seconds long.")

        avg_power = _safe_float(raw.get("avg_power_w"), 0.0)
        min_power = _safe_float(raw.get("min_power_w"), avg_power)
        max_power = _safe_float(raw.get("max_power_w"), avg_power)
        avg_hr = _safe_float(raw.get("avg_hr_bpm"), 0.0)
        min_hr = _safe_float(raw.get("min_hr_bpm"), avg_hr)
        max_hr = _safe_float(raw.get("max_hr_bpm"), avg_hr)
        start_hr = _safe_float(raw.get("start_hr_bpm"), avg_hr)
        end_hr = _safe_float(raw.get("end_hr_bpm"), avg_hr)
        avg_cadence = _safe_float(raw.get("avg_cadence_rpm"), 0.0)
        min_cadence = _safe_float(raw.get("min_cadence_rpm"), avg_cadence)
        max_cadence = _safe_float(raw.get("max_cadence_rpm"), avg_cadence)

        if min_power > avg_power or avg_power > max_power:
            raise FitCreateError(f"Interval {index}: power min <= avg <= max is required.")
        if min_hr > avg_hr or avg_hr > max_hr:
            raise FitCreateError(f"Interval {index}: HR min <= avg <= max is required.")
        if min_cadence > avg_cadence or avg_cadence > max_cadence:
            raise FitCreateError(f"Interval {index}: cadence min <= avg <= max is required.")

        intervals.append(
            {
                "name": str(raw.get("name") or f"Interval {index}").strip() or f"Interval {index}",
                "duration_seconds": duration_seconds,
                "avg_power_w": avg_power,
                "min_power_w": min_power,
                "max_power_w": max_power,
                "avg_hr_bpm": avg_hr,
                "min_hr_bpm": min_hr,
                "max_hr_bpm": max_hr,
                "start_hr_bpm": max(min_hr, min(max_hr, start_hr)),
                "end_hr_bpm": max(min_hr, min(max_hr, end_hr)),
                "avg_cadence_rpm": avg_cadence,
                "min_cadence_rpm": min_cadence,
                "max_cadence_rpm": max_cadence,
            }
        )

    return intervals


def _build_seed(payload: dict[str, Any]) -> int:
    stable = repr(
        {
            "start_time": payload.get("start_time"),
            "intervals": payload.get("intervals"),
            "location": payload.get("location"),
        }
    )
    return int(hashlib.sha256(stable.encode("utf-8")).hexdigest()[:16], 16)


def _fit_to_bytes(messages: list[Any]) -> bytes:
    header = FitFileHeader(records_size=0)
    fit_file = FitWriter(header=header, records=_wrap_fit_messages(messages))
    try:
        fit_file.crc = None
    except Exception:
        pass

    tmp_name = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".fit") as tmp:
            tmp_name = tmp.name
        fit_file.to_file(tmp_name)
        with open(tmp_name, "rb") as handle:
            return _finalize_fit_bytes(handle.read())
    finally:
        if tmp_name:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass


def _add_weather_message(messages: list[Any], start_time: datetime, temperature_c: float | None, humidity_pct: float | None) -> None:
    if temperature_c is None and humidity_pct is None:
        return
    try:
        from fit_tool.profile.messages.weather_conditions_message import WeatherConditionsMessage
    except Exception:
        return

    weather = WeatherConditionsMessage()
    _set_dt_encoded(weather, "timestamp", start_time)
    if temperature_c is not None:
        _safe_set(weather, "temperature", int(round(temperature_c)))
    if humidity_pct is not None:
        _safe_set(weather, "relative_humidity", int(round(humidity_pct)))
    messages.append(weather)


def _download_name(start_time: datetime, device: str) -> str:
    device_part = "technogym_indoor" if device == "technogym_indoor_trainer" else "indoor"
    return f"trainmind_{device_part}_{start_time.strftime('%Y%m%d_%H%M')}.fit"


def generate_indoor_bike_fit(payload: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    start_time = _parse_datetime(payload.get("start_time"))
    intervals = _normalize_intervals(payload.get("intervals"))
    include = payload.get("include") if isinstance(payload.get("include"), dict) else {}
    location = payload.get("location") if isinstance(payload.get("location"), dict) else None

    training_type = str(payload.get("training_type") or "indoor")
    device = str(payload.get("device") or "technogym_indoor_trainer")
    if training_type != "indoor":
        raise FitCreateError("Only indoor training is supported right now.")
    if device != "technogym_indoor_trainer":
        raise FitCreateError("Only Technogym Indoor Trainer is supported right now.")

    temperature_c = payload.get("temperature_c")
    humidity_pct = payload.get("humidity_pct")
    temperature = None if temperature_c is None else _safe_float(temperature_c)
    humidity = None if humidity_pct is None else max(0.0, min(100.0, _safe_float(humidity_pct)))
    system_mass_kg = max(40.0, min(180.0, _safe_float(payload.get("system_mass_kg"), 85.0)))
    cda_m2 = max(0.18, min(0.6, _safe_float(payload.get("cda_m2"), 0.32)))
    crr = max(0.002, min(0.02, _safe_float(payload.get("crr"), 0.004)))
    drivetrain_efficiency = max(0.85, min(1.0, _safe_float(payload.get("drivetrain_efficiency"), 0.975)))
    rho = _air_density(temperature, humidity)

    include_power = bool(include.get("power", True))
    include_hr = bool(include.get("heart_rate", True))
    include_cadence = bool(include.get("cadence", True))
    include_speed = bool(include.get("speed", True))
    include_distance = bool(include.get("distance", True))
    include_temperature = bool(include.get("temperature", True))
    include_humidity = bool(include.get("humidity", True))
    include_position = bool(include.get("gps_position", False))
    include_laps = bool(include.get("laps", True))
    include_calories = bool(include.get("calories", True))
    include_device_info = bool(include.get("device_info", True))

    seed = _build_seed(payload)
    rng = random.Random(seed)
    messages: list[Any] = []

    file_id = FileIdMessage()
    _safe_set(file_id, "type", 4)
    _safe_set(file_id, "manufacturer", 255)
    _safe_set(file_id, "product", 0)
    _safe_set(file_id, "serial_number", seed % 0xFFFFFFFF)
    _set_dt_encoded(file_id, "time_created", start_time)
    messages.append(file_id)

    if include_device_info:
        device_info = DeviceInfoMessage()
        _set_dt_encoded(device_info, "timestamp", start_time)
        _safe_set(device_info, "device_index", 0)
        _safe_set(device_info, "manufacturer", 255)
        _safe_set(device_info, "product", 0)
        _safe_set(device_info, "serial_number", seed % 0xFFFFFFFF)
        _safe_set(device_info, "software_version", 1.0)
        _safe_set(device_info, "product_name", "Technogym Indoor Trainer")
        messages.append(device_info)

    if include_temperature or include_humidity:
        _add_weather_message(
            messages,
            start_time,
            temperature if include_temperature else None,
            humidity if include_humidity else None,
        )

    start_event = EventMessage()
    _set_dt_encoded(start_event, "timestamp", start_time)
    _safe_set(start_event, "event", 0)
    _safe_set(start_event, "event_type", 0)
    _safe_set(start_event, "event_group", 0)
    messages.append(start_event)

    lat_deg: float | None = None
    lon_deg: float | None = None
    if location is not None:
        lat_deg = max(-90.0, min(90.0, _safe_float(location.get("latitude_deg"), 0.0)))
        lon_deg = max(-180.0, min(180.0, _safe_float(location.get("longitude_deg"), 0.0)))

    samples: list[dict[str, Any]] = []
    lap_summaries: list[dict[str, Any]] = []
    total_distance_m = 0.0
    total_work_j = 0.0
    current_second = 0

    for interval_index, interval in enumerate(intervals):
        interval_samples: list[dict[str, Any]] = []
        interval_distance_start = total_distance_m
        duration = int(interval["duration_seconds"])

        for second in range(duration):
            phase = 0.0 if duration <= 1 else second / float(duration - 1)
            timestamp = start_time.timestamp() + current_second
            power = _wave_value(
                rng,
                interval["avg_power_w"],
                interval["min_power_w"],
                interval["max_power_w"],
                phase,
            )
            hr = _hr_value(
                rng,
                interval["start_hr_bpm"],
                interval["end_hr_bpm"],
                interval["avg_hr_bpm"],
                interval["min_hr_bpm"],
                interval["max_hr_bpm"],
                phase,
                is_first=second == 0,
                is_last=second == duration - 1,
            )
            cadence = _wave_value(
                rng,
                interval["avg_cadence_rpm"],
                interval["min_cadence_rpm"],
                interval["max_cadence_rpm"],
                phase,
            )
            speed = _power_to_speed_flat(
                power,
                mass_kg=system_mass_kg,
                cda_m2=cda_m2,
                crr=crr,
                rho=rho,
                drivetrain_efficiency=drivetrain_efficiency,
            )

            total_work_j += max(0.0, power)
            total_distance_m += max(0.0, speed)
            sample = {
                "timestamp": datetime.fromtimestamp(timestamp, tz=timezone.utc),
                "power_w": max(0, int(round(power))),
                "heart_rate_bpm": max(0, int(round(hr))),
                "cadence_rpm": max(0, int(round(cadence))),
                "speed_mps": speed,
                "distance_m": total_distance_m,
                "interval_index": interval_index,
            }
            samples.append(sample)
            interval_samples.append(sample)
            current_second += 1

        power_values = [sample["power_w"] for sample in interval_samples]
        hr_values = [sample["heart_rate_bpm"] for sample in interval_samples]
        cadence_values = [sample["cadence_rpm"] for sample in interval_samples]
        speed_values = [sample["speed_mps"] for sample in interval_samples]
        interval_distance = total_distance_m - interval_distance_start
        lap_summaries.append(
            {
                "name": interval["name"],
                "start_time": interval_samples[0]["timestamp"],
                "end_time": interval_samples[-1]["timestamp"],
                "duration_seconds": duration,
                "distance_m": interval_distance,
                "avg_power_w": int(round(mean(power_values))),
                "max_power_w": int(max(power_values)),
                "min_power_w": int(min(power_values)),
                "avg_hr_bpm": int(round(mean(hr_values))),
                "max_hr_bpm": int(max(hr_values)),
                "min_hr_bpm": int(min(hr_values)),
                "avg_cadence_rpm": int(round(mean(cadence_values))),
                "max_cadence_rpm": int(max(cadence_values)),
                "min_cadence_rpm": int(min(cadence_values)),
                "avg_speed_mps": float(mean(speed_values)),
                "max_speed_mps": float(max(speed_values)),
            }
        )

    if not samples:
        raise FitCreateError("No samples could be generated.")

    for sample in samples:
        record = RecordMessage()
        _set_dt_encoded(record, "timestamp", sample["timestamp"])
        if include_power:
            _safe_set(record, "power", sample["power_w"])
        if include_hr:
            _safe_set(record, "heart_rate", sample["heart_rate_bpm"])
        if include_cadence:
            _safe_set(record, "cadence", sample["cadence_rpm"])
        if include_speed:
            _safe_set(record, "speed", float(sample["speed_mps"]))
            _safe_set(record, "enhanced_speed", float(sample["speed_mps"]))
        if include_distance:
            _safe_set(record, "distance", float(sample["distance_m"]))
        if include_temperature and temperature is not None:
            _safe_set(record, "temperature", int(round(temperature)))
        if include_position and lat_deg is not None and lon_deg is not None:
            route_lon = lon_deg + math.degrees(sample["distance_m"] / (6371000.0 * max(0.05, math.cos(math.radians(lat_deg)))))
            _safe_set(record, "position_lat", _deg_to_semicircles(lat_deg))
            _safe_set(record, "position_long", _deg_to_semicircles(route_lon))
        messages.append(record)

    total_duration_seconds = int(sum(interval["duration_seconds"] for interval in intervals))
    total_calories = int(round((total_work_j / 1000.0) / 0.24 / 4.184)) if total_work_j > 0 else 0
    end_time = datetime.fromtimestamp(start_time.timestamp() + total_duration_seconds, tz=timezone.utc)

    if include_laps:
        distance_before_lap = 0.0
        for index, lap_summary in enumerate(lap_summaries):
            lap = LapMessage()
            _set_dt_encoded(lap, "timestamp", lap_summary["end_time"])
            _set_dt_encoded(lap, "start_time", lap_summary["start_time"])
            _safe_set(lap, "message_index", index)
            _safe_set(lap, "total_elapsed_time", float(lap_summary["duration_seconds"]))
            _safe_set(lap, "total_timer_time", float(lap_summary["duration_seconds"]))
            if include_distance:
                _safe_set(lap, "total_distance", float(lap_summary["distance_m"]))
            if include_speed:
                _safe_set(lap, "avg_speed", float(lap_summary["avg_speed_mps"]))
                _safe_set(lap, "max_speed", float(lap_summary["max_speed_mps"]))
            if include_power:
                _safe_set(lap, "avg_power", int(lap_summary["avg_power_w"]))
                _safe_set(lap, "max_power", int(lap_summary["max_power_w"]))
                _safe_set(lap, "total_work", int(round(lap_summary["avg_power_w"] * lap_summary["duration_seconds"])))
            if include_hr:
                _safe_set(lap, "avg_heart_rate", int(lap_summary["avg_hr_bpm"]))
                _safe_set(lap, "max_heart_rate", int(lap_summary["max_hr_bpm"]))
            if include_cadence:
                _safe_set(lap, "avg_cadence", int(lap_summary["avg_cadence_rpm"]))
                _safe_set(lap, "max_cadence", int(lap_summary["max_cadence_rpm"]))
            if include_calories:
                lap_work_j = lap_summary["avg_power_w"] * lap_summary["duration_seconds"]
                _safe_set(lap, "total_calories", int(round((lap_work_j / 1000.0) / 0.24 / 4.184)))
            if include_position and lat_deg is not None and lon_deg is not None:
                start_lon = lon_deg + math.degrees(distance_before_lap / (6371000.0 * max(0.05, math.cos(math.radians(lat_deg)))))
                end_distance = distance_before_lap + lap_summary["distance_m"]
                end_lon = lon_deg + math.degrees(end_distance / (6371000.0 * max(0.05, math.cos(math.radians(lat_deg)))))
                _safe_set(lap, "start_position_lat", _deg_to_semicircles(lat_deg))
                _safe_set(lap, "start_position_long", _deg_to_semicircles(start_lon))
                _safe_set(lap, "end_position_lat", _deg_to_semicircles(lat_deg))
                _safe_set(lap, "end_position_long", _deg_to_semicircles(end_lon))
                distance_before_lap = end_distance
            messages.append(lap)

    stop_event = EventMessage()
    _set_dt_encoded(stop_event, "timestamp", end_time)
    _safe_set(stop_event, "event", 0)
    _safe_set(stop_event, "event_type", 9)
    _safe_set(stop_event, "event_group", 0)
    messages.append(stop_event)

    power_values = [sample["power_w"] for sample in samples]
    hr_values = [sample["heart_rate_bpm"] for sample in samples]
    cadence_values = [sample["cadence_rpm"] for sample in samples]
    speed_values = [sample["speed_mps"] for sample in samples]

    session = SessionMessage()
    _set_dt_encoded(session, "timestamp", end_time)
    _set_dt_encoded(session, "start_time", start_time)
    _safe_set(session, "total_elapsed_time", float(total_duration_seconds))
    _safe_set(session, "total_timer_time", float(total_duration_seconds))
    if include_distance:
        _safe_set(session, "total_distance", float(total_distance_m))
    if include_speed:
        _safe_set(session, "avg_speed", float(mean(speed_values)))
        _safe_set(session, "max_speed", float(max(speed_values)))
    if include_power:
        _safe_set(session, "avg_power", int(round(mean(power_values))))
        _safe_set(session, "max_power", int(max(power_values)))
        _safe_set(session, "total_work", int(round(total_work_j)))
    if include_hr:
        _safe_set(session, "avg_heart_rate", int(round(mean(hr_values))))
        _safe_set(session, "max_heart_rate", int(max(hr_values)))
    if include_cadence:
        _safe_set(session, "avg_cadence", int(round(mean(cadence_values))))
        _safe_set(session, "max_cadence", int(max(cadence_values)))
    if include_calories:
        _safe_set(session, "total_calories", total_calories)
    if include_temperature and temperature is not None:
        _safe_set(session, "avg_temperature", int(round(temperature)))
        _safe_set(session, "max_temperature", int(round(temperature)))
    try:
        from fit_tool.profile.profile_type import Sport, SubSport

        _safe_set(session, "sport", getattr(Sport, "CYCLING", getattr(Sport, "cycling", 2)))
        _safe_set(session, "sub_sport", getattr(SubSport, "INDOOR_CYCLING", getattr(SubSport, "indoor_cycling", 6)))
    except Exception:
        _safe_set(session, "sport", 2)
        _safe_set(session, "sub_sport", 6)
    if include_position and lat_deg is not None and lon_deg is not None:
        end_lon = lon_deg + math.degrees(total_distance_m / (6371000.0 * max(0.05, math.cos(math.radians(lat_deg)))))
        _safe_set(session, "start_position_lat", _deg_to_semicircles(lat_deg))
        _safe_set(session, "start_position_long", _deg_to_semicircles(lon_deg))
        _safe_set(session, "end_position_lat", _deg_to_semicircles(lat_deg))
        _safe_set(session, "end_position_long", _deg_to_semicircles(end_lon))
    messages.append(session)

    activity = ActivityMessage()
    _set_dt_encoded(activity, "timestamp", end_time)
    _safe_set(activity, "total_timer_time", float(total_duration_seconds))
    _safe_set(activity, "num_sessions", 1)
    _safe_set(activity, "type", 0)
    messages.append(activity)

    fit_bytes = _fit_to_bytes(messages)
    summary = {
        "download_name": _download_name(start_time, device),
        "duration_seconds": total_duration_seconds,
        "distance_m": round(total_distance_m, 1),
        "avg_speed_kmh": round(float(mean(speed_values)) * 3.6, 2),
        "max_speed_kmh": round(float(max(speed_values)) * 3.6, 2),
        "avg_power_w": int(round(mean(power_values))),
        "max_power_w": int(max(power_values)),
        "avg_hr_bpm": int(round(mean(hr_values))),
        "max_hr_bpm": int(max(hr_values)),
        "avg_cadence_rpm": int(round(mean(cadence_values))),
        "max_cadence_rpm": int(max(cadence_values)),
        "total_work_kj": round(total_work_j / 1000.0, 1),
        "estimated_calories": total_calories,
        "records_count": len(samples),
        "laps_count": len(lap_summaries) if include_laps else 0,
        "location_name": str(location.get("name") or "").strip() if location else None,
    }
    return fit_bytes, summary
