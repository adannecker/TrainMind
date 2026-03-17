from __future__ import annotations

import io
import math
from datetime import datetime
from statistics import mean
from typing import Any

from fit_tool.fit_file import FitFile as WritableFitFile
from fitparse import FitFile as ParsedFitFile


class FitFixError(ValueError):
    pass


def _ensure_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    raise FitFixError("Die FIT-Datei enthält keine lesbaren Zeitstempel.")


def _collect_record_rows(file_bytes: bytes) -> tuple[list[dict[str, Any]], datetime]:
    fit = ParsedFitFile(io.BytesIO(file_bytes))
    records: list[dict[str, Any]] = []
    start_ts: datetime | None = None

    for message in fit.get_messages("record"):
        timestamp = message.get_value("timestamp")
        if timestamp is None:
            continue
        timestamp_dt = _ensure_datetime(timestamp)
        if start_ts is None:
            start_ts = timestamp_dt
        offset_seconds = int((timestamp_dt - start_ts).total_seconds())
        power_value = message.get_value("power")
        records.append(
            {
                "offset_seconds": offset_seconds,
                "timestamp": timestamp_dt.isoformat(),
                "power": int(power_value) if power_value is not None else None,
            }
        )

    if start_ts is None or not records:
        raise FitFixError("In der FIT-Datei wurden keine Record-Daten gefunden.")

    return records, start_ts


def _sample_power_series(power_records: list[dict[str, Any]], duration_seconds: int, bucket_target: int = 160) -> list[dict[str, int]]:
    if not power_records:
        return []

    bucket_size = max(1, math.ceil(max(duration_seconds, 1) / bucket_target))
    buckets: dict[int, list[int]] = {}

    for row in power_records:
        bucket_index = row["offset_seconds"] // bucket_size
        buckets.setdefault(bucket_index, []).append(int(row["power"]))

    series: list[dict[str, int]] = []
    for bucket_index in sorted(buckets):
        values = buckets[bucket_index]
        start_second = bucket_index * bucket_size
        end_second = min(duration_seconds, start_second + bucket_size - 1)
        series.append(
            {
                "start_second": start_second,
                "end_second": end_second,
                "avg_power": int(round(mean(values))),
                "max_power": int(max(values)),
            }
        )

    return series


def inspect_fit_file(file_bytes: bytes, filename: str) -> dict[str, Any]:
    records, _ = _collect_record_rows(file_bytes)
    power_records = [row for row in records if row["power"] is not None]
    duration_seconds = int(records[-1]["offset_seconds"])

    if not power_records:
        raise FitFixError("Die FIT-Datei enthält keine Power-Werte, die angepasst werden können.")

    powers = [int(row["power"]) for row in power_records]
    return {
        "file_name": filename,
        "duration_seconds": duration_seconds,
        "record_count": len(records),
        "power_record_count": len(power_records),
        "avg_power": int(round(mean(powers))),
        "max_power": int(max(powers)),
        "power_records": power_records,
        "power_series": _sample_power_series(power_records, duration_seconds),
    }


def normalize_adjustments(raw_adjustments: Any) -> list[dict[str, int | float | str]]:
    if not isinstance(raw_adjustments, list):
        raise FitFixError("Die Anpassungen müssen als Liste übergeben werden.")

    normalized: list[dict[str, int | float | str]] = []
    for item in raw_adjustments:
        if not isinstance(item, dict):
            raise FitFixError("Jede Anpassung muss ein Objekt sein.")
        mode = str(item.get("mode", "")).strip().lower()
        if mode not in {"percent", "fixed"}:
            raise FitFixError("Der Modus muss 'percent' oder 'fixed' sein.")

        try:
            start_second = max(0, int(float(item.get("start_second", 0))))
            end_second = max(start_second, int(float(item.get("end_second", start_second))))
            value = float(item.get("value", 0))
        except (TypeError, ValueError) as exc:
            raise FitFixError("Die Anpassung enthält ungültige Zahlenwerte.") from exc

        normalized.append(
            {
                "start_second": start_second,
                "end_second": end_second,
                "mode": mode,
                "value": value,
            }
        )

    if not normalized:
        raise FitFixError("Bitte mindestens eine Watt-Anpassung anlegen.")

    return normalized


def _apply_adjustments_to_power(power_value: int, offset_seconds: int, adjustments: list[dict[str, int | float | str]]) -> int:
    adjusted_value = float(power_value)
    for adjustment in adjustments:
        start_second = int(adjustment["start_second"])
        end_second = int(adjustment["end_second"])
        if start_second <= offset_seconds <= end_second:
            if adjustment["mode"] == "percent":
                adjusted_value *= 1 + (float(adjustment["value"]) / 100.0)
            else:
                adjusted_value += float(adjustment["value"])
    return max(0, int(round(adjusted_value)))


def apply_power_adjustments(file_bytes: bytes, adjustments: list[dict[str, int | float | str]]) -> tuple[bytes, dict[str, Any]]:
    parsed_rows, start_ts = _collect_record_rows(file_bytes)
    writable_fit = WritableFitFile.from_bytes(file_bytes)
    writable_records = [
        record.message
        for record in writable_fit.records
        if not record.is_definition and getattr(record.message, "name", None) == "record"
    ]

    if len(writable_records) != len(parsed_rows):
        raise FitFixError("Die FIT-Datei konnte nicht konsistent für die Bearbeitung gelesen werden.")

    updated_powers: list[int] = []
    changed_records = 0

    for parsed_row, writable_record in zip(parsed_rows, writable_records):
        original_power = parsed_row["power"]
        if original_power is None:
            continue
        next_power = _apply_adjustments_to_power(
            power_value=int(original_power),
            offset_seconds=int(parsed_row["offset_seconds"]),
            adjustments=adjustments,
        )
        if next_power != int(original_power):
            writable_record.power = next_power
            changed_records += 1
        updated_powers.append(next_power)

    if not updated_powers:
        raise FitFixError("Es konnten keine Power-Daten angepasst werden.")

    avg_power = int(round(mean(updated_powers)))
    max_power = int(max(updated_powers))

    for record in writable_fit.records:
        if record.is_definition:
            continue
        message = record.message
        if getattr(message, "name", None) not in {"lap", "session"}:
            continue
        for field_name, value in (("avg_power", avg_power), ("max_power", max_power)):
            try:
                if getattr(message, field_name, None) is not None:
                    setattr(message, field_name, value)
            except Exception:
                continue

    writable_fit.crc = None

    return (
        writable_fit.to_bytes(),
        {
            "changed_records": changed_records,
            "duration_seconds": int(parsed_rows[-1]["offset_seconds"]),
            "avg_power": avg_power,
            "max_power": max_power,
            "start_time": start_ts.isoformat(),
        },
    )
