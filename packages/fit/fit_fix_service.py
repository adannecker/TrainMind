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


SUMMARY_FIELD_SPECS: tuple[dict[str, Any], ...] = (
    {
        "key": "avg_power",
        "label": "Durchschnittsleistung",
        "field_names": ("avg_power", "total_average_power"),
        "scopes": ("lap", "session"),
    },
    {
        "key": "max_power",
        "label": "Maximalleistung",
        "field_names": ("max_power",),
        "scopes": ("lap", "session"),
    },
    {
        "key": "normalized_power",
        "label": "Normalized Power",
        "field_names": ("normalized_power",),
        "scopes": ("lap", "session"),
    },
    {
        "key": "total_work_kj",
        "label": "Arbeit",
        "field_names": ("total_work",),
        "scopes": ("lap", "session"),
    },
    {
        "key": "estimated_calories",
        "label": "Kalorien",
        "field_names": ("total_calories", "calories"),
        "scopes": ("lap", "session"),
    },
    {
        "key": "intensity_factor",
        "label": "Intensity Factor",
        "field_names": ("intensity_factor",),
        "scopes": ("lap", "session"),
    },
    {
        "key": "training_stress_score",
        "label": "Training Stress Score",
        "field_names": ("training_stress_score",),
        "scopes": ("lap", "session"),
    },
)


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


def _power_1s_array(rows: list[dict[str, Any]]) -> list[float]:
    if not rows:
        return []

    duration_seconds = max(int(rows[-1]["offset_seconds"]), 0)
    power_by_second = [0.0] * (duration_seconds + 1)

    for index, row in enumerate(rows):
        start = max(0, int(row["offset_seconds"]))
        next_offset = duration_seconds + 1 if index == len(rows) - 1 else max(start + 1, int(rows[index + 1]["offset_seconds"]))
        power_value = float(row["power"] or 0.0)
        for second in range(start, min(next_offset, duration_seconds + 1)):
            power_by_second[second] = power_value

    return power_by_second


def _estimate_work_kj(rows: list[dict[str, Any]]) -> int:
    power_series = _power_1s_array(rows)
    if not power_series:
        return 0
    total_joules = sum(max(value, 0.0) for value in power_series)
    return int(round(total_joules / 1000.0))


def _estimate_calories_from_work_kj(total_work_kj: int, eff_metabolic: float = 0.24) -> int:
    if total_work_kj <= 0:
        return 0
    kcal = float(total_work_kj) / eff_metabolic / 4.184
    return int(round(kcal))


def _estimate_normalized_power(rows: list[dict[str, Any]]) -> int:
    power_series = _power_1s_array(rows)
    if not power_series:
        return 0

    rolling_averages: list[float] = []
    running_sum = 0.0
    for index, value in enumerate(power_series):
        running_sum += value
        if index >= 30:
            running_sum -= power_series[index - 30]
        window_len = min(index + 1, 30)
        rolling_averages.append(running_sum / float(window_len))

    fourth_power_mean = sum(avg ** 4 for avg in rolling_averages) / float(len(rolling_averages))
    return int(round(fourth_power_mean ** 0.25))


def _build_metric_summary(rows: list[dict[str, Any]], ftp_w: float | None = None) -> dict[str, Any]:
    power_records = [row for row in rows if row["power"] is not None]
    if not power_records:
        raise FitFixError("Die FIT-Datei enthält keine Power-Werte, die angepasst werden können.")

    powers = [int(row["power"]) for row in power_records]
    avg_power = int(round(mean(powers)))
    max_power = int(max(powers))
    normalized_power = _estimate_normalized_power(rows)
    total_work_kj = _estimate_work_kj(rows)
    estimated_calories = _estimate_calories_from_work_kj(total_work_kj)

    intensity_factor: float | None = None
    training_stress_score: float | None = None
    if ftp_w is not None and ftp_w > 0:
        duration_seconds = max(len(_power_1s_array(rows)), 1)
        intensity_factor = float(normalized_power) / float(ftp_w)
        training_stress_score = (
            (float(duration_seconds) * float(normalized_power) * float(intensity_factor))
            / (float(ftp_w) * 3600.0)
            * 100.0
        )

    return {
        "avg_power": avg_power,
        "max_power": max_power,
        "normalized_power": normalized_power,
        "total_work_kj": total_work_kj,
        "estimated_calories": estimated_calories,
        "intensity_factor": round(intensity_factor, 3) if intensity_factor is not None else None,
        "training_stress_score": round(training_stress_score, 1) if training_stress_score is not None else None,
        "power_record_count": len(power_records),
    }


def _parse_summary_messages(file_bytes: bytes) -> list[dict[str, Any]]:
    fit = ParsedFitFile(io.BytesIO(file_bytes))
    messages: list[dict[str, Any]] = []
    for scope in ("lap", "session"):
        for message in fit.get_messages(scope):
            values: dict[str, Any] = {}
            for spec in SUMMARY_FIELD_SPECS:
                for field_name in spec["field_names"]:
                    value = message.get_value(field_name)
                    if value is not None:
                        values[field_name] = value
            if values:
                messages.append({"scope": scope, "values": values})
    return messages


def _first_numeric_value(messages: list[dict[str, Any]], field_names: tuple[str, ...]) -> float | None:
    for preferred_scope in ("session", "lap"):
        for message in messages:
            if message["scope"] != preferred_scope:
                continue
            for field_name in field_names:
                value = message["values"].get(field_name)
                if isinstance(value, (int, float)):
                    return float(value)
    return None


def _infer_ftp_w(summary_messages: list[dict[str, Any]], duration_seconds: int) -> float | None:
    original_np = _first_numeric_value(summary_messages, ("normalized_power",))
    original_if = _first_numeric_value(summary_messages, ("intensity_factor",))
    if original_np and original_if and original_np > 0 and original_if > 0:
        return float(original_np / original_if)

    original_tss = _first_numeric_value(summary_messages, ("training_stress_score",))
    if original_np and original_tss and original_np > 0 and original_tss > 0 and duration_seconds > 0:
        return float(original_np * math.sqrt((float(duration_seconds) * 100.0) / (float(original_tss) * 3600.0)))

    return None


def _build_summary_field_analysis(
    summary_messages: list[dict[str, Any]],
    metric_summary: dict[str, Any],
    ftp_w: float | None,
) -> list[dict[str, Any]]:
    analysis: list[dict[str, Any]] = []
    for spec in SUMMARY_FIELD_SPECS:
        scopes_present = sorted(
            {
                message["scope"]
                for message in summary_messages
                if any(field_name in message["values"] for field_name in spec["field_names"])
            }
        )
        estimated_value = metric_summary.get(spec["key"])
        auto_update_possible = bool(scopes_present) and (estimated_value is not None)
        if spec["key"] in {"intensity_factor", "training_stress_score"} and ftp_w is None:
            auto_update_possible = False

        note = None
        if scopes_present and spec["key"] in {"intensity_factor", "training_stress_score"} and ftp_w is None:
            note = "Im FIT vorhanden, aber ohne ableitbares FTP nicht sicher neu berechenbar."
        elif scopes_present:
            note = "Wird beim Export automatisch mitsynchronisiert."
        else:
            note = "Nicht im FIT gefunden; kann deshalb nicht direkt zurückgeschrieben werden."

        analysis.append(
            {
                "key": spec["key"],
                "label": spec["label"],
                "present": bool(scopes_present),
                "scopes": scopes_present,
                "field_names": list(spec["field_names"]),
                "auto_update_possible": auto_update_possible,
                "estimated_value": estimated_value,
                "note": note,
            }
        )
    return analysis


def _update_message_fields(message: Any, field_names: tuple[str, ...], value: Any) -> bool:
    if value is None:
        return False

    updated = False
    for field_name in field_names:
        try:
            current_value = getattr(message, field_name, None)
        except Exception:
            continue
        if current_value is None:
            continue
        try:
            setattr(message, field_name, value)
            updated = True
        except Exception:
            continue
    return updated


def inspect_fit_file(file_bytes: bytes, filename: str) -> dict[str, Any]:
    records, _ = _collect_record_rows(file_bytes)
    duration_seconds = int(records[-1]["offset_seconds"])
    metric_summary = _build_metric_summary(records)
    summary_messages = _parse_summary_messages(file_bytes)
    ftp_w = _infer_ftp_w(summary_messages, duration_seconds)
    return {
        "file_name": filename,
        "duration_seconds": duration_seconds,
        "record_count": len(records),
        "power_record_count": metric_summary["power_record_count"],
        "avg_power": metric_summary["avg_power"],
        "max_power": metric_summary["max_power"],
        "normalized_power": metric_summary["normalized_power"],
        "total_work_kj": metric_summary["total_work_kj"],
        "estimated_calories": metric_summary["estimated_calories"],
        "intensity_factor": metric_summary["intensity_factor"],
        "training_stress_score": metric_summary["training_stress_score"],
        "ftp_inferred_w": round(ftp_w, 1) if ftp_w is not None else None,
        "power_records": [row for row in records if row["power"] is not None],
        "power_series": _sample_power_series([row for row in records if row["power"] is not None], duration_seconds),
        "summary_fields": _build_summary_field_analysis(summary_messages, metric_summary, ftp_w),
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
    summary_messages = _parse_summary_messages(file_bytes)
    ftp_w = _infer_ftp_w(summary_messages, int(parsed_rows[-1]["offset_seconds"]))
    writable_fit = WritableFitFile.from_bytes(file_bytes)
    writable_records = [
        record.message
        for record in writable_fit.records
        if not record.is_definition and getattr(record.message, "name", None) == "record"
    ]

    if len(writable_records) != len(parsed_rows):
        raise FitFixError("Die FIT-Datei konnte nicht konsistent für die Bearbeitung gelesen werden.")

    updated_rows: list[dict[str, Any]] = []
    changed_records = 0

    for parsed_row, writable_record in zip(parsed_rows, writable_records):
        original_power = parsed_row["power"]
        updated_row = dict(parsed_row)
        if original_power is None:
            updated_rows.append(updated_row)
            continue
        next_power = _apply_adjustments_to_power(
            power_value=int(original_power),
            offset_seconds=int(parsed_row["offset_seconds"]),
            adjustments=adjustments,
        )
        if next_power != int(original_power):
            writable_record.power = next_power
            changed_records += 1
        updated_row["power"] = next_power
        updated_rows.append(updated_row)

    if not any(row["power"] is not None for row in updated_rows):
        raise FitFixError("Es konnten keine Power-Daten angepasst werden.")

    metric_summary = _build_metric_summary(updated_rows, ftp_w=ftp_w)
    values_by_key = {
        "avg_power": metric_summary["avg_power"],
        "max_power": metric_summary["max_power"],
        "normalized_power": metric_summary["normalized_power"],
        "total_work_kj": metric_summary["total_work_kj"],
        "estimated_calories": metric_summary["estimated_calories"],
        "intensity_factor": metric_summary["intensity_factor"],
        "training_stress_score": metric_summary["training_stress_score"],
    }
    updated_fields: list[str] = []

    for record in writable_fit.records:
        if record.is_definition:
            continue
        message = record.message
        if getattr(message, "name", None) not in {"lap", "session"}:
            continue
        for spec in SUMMARY_FIELD_SPECS:
            value = values_by_key.get(spec["key"])
            if spec["key"] in {"intensity_factor", "training_stress_score"} and ftp_w is None:
                continue
            if _update_message_fields(message, spec["field_names"], value):
                updated_fields.append(f"{getattr(message, 'name', 'summary')}:{spec['key']}")

    writable_fit.crc = None

    return (
        writable_fit.to_bytes(),
        {
            "changed_records": changed_records,
            "duration_seconds": int(parsed_rows[-1]["offset_seconds"]),
            "avg_power": metric_summary["avg_power"],
            "max_power": metric_summary["max_power"],
            "normalized_power": metric_summary["normalized_power"],
            "total_work_kj": metric_summary["total_work_kj"],
            "estimated_calories": metric_summary["estimated_calories"],
            "intensity_factor": metric_summary["intensity_factor"],
            "training_stress_score": metric_summary["training_stress_score"],
            "updated_fields": sorted(set(updated_fields)),
            "ftp_inferred_w": round(ftp_w, 1) if ftp_w is not None else None,
            "start_time": start_ts.isoformat(),
        },
    )
