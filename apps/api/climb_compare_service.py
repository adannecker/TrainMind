from __future__ import annotations

import json
import math
from datetime import datetime
from typing import Any, Callable

from sqlalchemy import func, select

from packages.db.models import Activity, ActivityClimbCompare, ActivityRecord
from packages.db.session import SessionLocal


DEFAULT_COMPARE_CENTER = {"latitude_deg": 47.61, "longitude_deg": 7.66}
DEFAULT_SEARCH_TOLERANCE_M = 50.0
MIN_SEARCH_TOLERANCE_M = 15.0
MIN_PREVIEW_TOLERANCE_M = 50.0
MAX_ROUTE_POINTS = 280
MAX_PROFILE_POINTS = 320
MAX_MATCH_CANDIDATES = 36
DEFAULT_CHECK_RIDES_LIMIT = 0
MIN_MOVING_SPEED_MPS = 0.6
MIN_MOVING_DISTANCE_M = 1.0
CLIMB_COMPARE_SEARCH_ALGORITHM_VERSION = 3


def _now() -> datetime:
    return datetime.utcnow()


def _round_float(value: float | None, digits: int = 1) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def _normalize_point(payload: dict[str, Any] | None, field_name: str) -> dict[str, float]:
    if not isinstance(payload, dict):
        raise ValueError(f"{field_name} is required.")
    try:
        latitude_deg = float(payload.get("latitude_deg"))
        longitude_deg = float(payload.get("longitude_deg"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must contain numeric latitude_deg and longitude_deg.") from exc
    if not (-90.0 <= latitude_deg <= 90.0):
        raise ValueError(f"{field_name}.latitude_deg must be between -90 and 90.")
    if not (-180.0 <= longitude_deg <= 180.0):
        raise ValueError(f"{field_name}.longitude_deg must be between -180 and 180.")
    return {"latitude_deg": latitude_deg, "longitude_deg": longitude_deg}


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_m = 6371000.0
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    a = math.sin(delta_lat / 2.0) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2.0) ** 2
    return 2.0 * radius_m * math.asin(math.sqrt(a))


def _sum_positive_deltas(values: list[float]) -> float:
    total = 0.0
    for previous, current in zip(values, values[1:]):
        delta = current - previous
        if delta > 0:
            total += delta
    return total


def _sum_negative_deltas(values: list[float]) -> float:
    total = 0.0
    for previous, current in zip(values, values[1:]):
        delta = current - previous
        if delta < 0:
            total += abs(delta)
    return total


def _compact_dict_points(points: list[dict[str, float]], max_points: int) -> list[dict[str, float]]:
    if len(points) <= max_points:
        return points
    step = max(1, math.ceil(len(points) / max_points))
    compacted = points[::step]
    if compacted[-1] != points[-1]:
        compacted.append(points[-1])
    return compacted


def _safe_json_list(raw_json: str | None) -> list[dict[str, float | None]]:
    if not raw_json:
        return []
    try:
        parsed = json.loads(raw_json)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    clean_items: list[dict[str, float | None]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        normalized: dict[str, float | None] = {}
        try:
            for key, value in item.items():
                normalized[str(key)] = None if value is None else float(value)
        except (TypeError, ValueError):
            continue
        clean_items.append(normalized)
    return clean_items


def _safe_json_payload(raw_json: str | None) -> Any:
    if not raw_json:
        return None
    try:
        return json.loads(raw_json)
    except Exception:
        return None


def _extract_geo_records(records: list[ActivityRecord]) -> list[ActivityRecord]:
    return [row for row in records if row.latitude_deg is not None and row.longitude_deg is not None]


def _grade_pct(distance_delta_m: float, altitude_delta_m: float) -> float | None:
    if distance_delta_m < 5:
        return None
    return round((altitude_delta_m / distance_delta_m) * 100.0, 1)


def _record_point(row: ActivityRecord | None) -> dict[str, float] | None:
    if row is None or row.latitude_deg is None or row.longitude_deg is None:
        return None
    return {"latitude_deg": round(float(row.latitude_deg), 7), "longitude_deg": round(float(row.longitude_deg), 7)}


def _record_distance_delta_m(previous: ActivityRecord, current: ActivityRecord) -> float | None:
    if previous.distance_m is not None and current.distance_m is not None:
        return max(0.0, float(current.distance_m) - float(previous.distance_m))
    if (
        previous.latitude_deg is not None
        and previous.longitude_deg is not None
        and current.latitude_deg is not None
        and current.longitude_deg is not None
    ):
        return _haversine_m(
            float(previous.latitude_deg),
            float(previous.longitude_deg),
            float(current.latitude_deg),
            float(current.longitude_deg),
        )
    return None


def _record_time_delta_s(previous: ActivityRecord, current: ActivityRecord) -> float | None:
    if previous.timestamp is not None and current.timestamp is not None:
        delta_seconds = (current.timestamp - previous.timestamp).total_seconds()
        if delta_seconds > 0:
            return float(delta_seconds)
    if previous.elapsed_s is not None and current.elapsed_s is not None:
        delta_seconds = float(current.elapsed_s) - float(previous.elapsed_s)
        if delta_seconds > 0:
            return delta_seconds
    return None


def _local_xy_m(latitude_deg: float, longitude_deg: float, *, origin_latitude_deg: float, origin_longitude_deg: float) -> tuple[float, float]:
    meters_per_degree_lat = 111320.0
    meters_per_degree_lon = math.cos(math.radians(origin_latitude_deg)) * 111320.0
    x_m = (longitude_deg - origin_longitude_deg) * meters_per_degree_lon
    y_m = (latitude_deg - origin_latitude_deg) * meters_per_degree_lat
    return (x_m, y_m)


def _distance_point_to_segment_m(point: dict[str, float], start_row: ActivityRecord, end_row: ActivityRecord) -> tuple[float, float]:
    if (
        start_row.latitude_deg is None
        or start_row.longitude_deg is None
        or end_row.latitude_deg is None
        or end_row.longitude_deg is None
    ):
        return (math.inf, 0.0)
    ax, ay = _local_xy_m(
        float(start_row.latitude_deg),
        float(start_row.longitude_deg),
        origin_latitude_deg=point["latitude_deg"],
        origin_longitude_deg=point["longitude_deg"],
    )
    bx, by = _local_xy_m(
        float(end_row.latitude_deg),
        float(end_row.longitude_deg),
        origin_latitude_deg=point["latitude_deg"],
        origin_longitude_deg=point["longitude_deg"],
    )
    abx = bx - ax
    aby = by - ay
    length_sq = (abx * abx) + (aby * aby)
    if length_sq <= 1e-9:
        return (math.hypot(ax, ay), 0.0)
    projection_t = -((ax * abx) + (ay * aby)) / length_sq
    projection_t = max(0.0, min(1.0, projection_t))
    nearest_x = ax + (projection_t * abx)
    nearest_y = ay + (projection_t * aby)
    return (math.hypot(nearest_x, nearest_y), projection_t)


def _build_route_distances_m(records: list[ActivityRecord]) -> list[float]:
    if not records:
        return []
    route_distances_m: list[float] = [0.0]
    first_distance_m = next((float(row.distance_m) for row in records if row.distance_m is not None), None)
    for index in range(1, len(records)):
        previous = records[index - 1]
        current = records[index]
        if first_distance_m is not None and current.distance_m is not None:
            current_distance_m = max(0.0, float(current.distance_m) - first_distance_m)
        else:
            current_distance_m = route_distances_m[-1]
            previous_point = _record_point(previous)
            current_point = _record_point(current)
            if previous_point is not None and current_point is not None:
                current_distance_m += _haversine_m(
                    previous_point["latitude_deg"],
                    previous_point["longitude_deg"],
                    current_point["latitude_deg"],
                    current_point["longitude_deg"],
                )
        route_distances_m.append(max(route_distances_m[-1], current_distance_m))
    return route_distances_m


def _segment_candidates(records: list[ActivityRecord], point: dict[str, float], tolerance_m: float, *, after_route_distance_m: float = -1.0) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    if len(records) < 2:
        return candidates
    route_distances_m = _build_route_distances_m(records)
    for segment_index in range(len(records) - 1):
        start_row = records[segment_index]
        end_row = records[segment_index + 1]
        distance_m, projection_t = _distance_point_to_segment_m(point, start_row, end_row)
        if distance_m > tolerance_m:
            continue
        start_route_distance_m = route_distances_m[segment_index]
        end_route_distance_m = route_distances_m[segment_index + 1]
        projected_route_distance_m = start_route_distance_m + ((end_route_distance_m - start_route_distance_m) * projection_t)
        if projected_route_distance_m <= after_route_distance_m:
            continue
        matched_record_index = segment_index if projection_t <= 0.5 else segment_index + 1
        candidates.append(
            {
                "segment_index": segment_index,
                "projection_t": projection_t,
                "distance_m": distance_m,
                "route_distance_m": projected_route_distance_m,
                "matched_record_index": matched_record_index,
            }
        )
    candidates.sort(key=lambda item: (float(item["route_distance_m"]), float(item["distance_m"])))
    return candidates[: max(MAX_MATCH_CANDIDATES * 4, 200)]


def _find_best_segment_indices(
    records: list[ActivityRecord],
    *,
    start_point: dict[str, float],
    via_point: dict[str, float],
    end_point: dict[str, float],
    tolerance_m: float,
) -> dict[str, Any] | None:
    start_candidates = _segment_candidates(records, start_point, tolerance_m)
    if not start_candidates:
        return None
    via_candidates = _segment_candidates(records, via_point, tolerance_m)
    if not via_candidates:
        return None
    end_candidates = _segment_candidates(records, end_point, tolerance_m)
    if not end_candidates:
        return None
    best_match: dict[str, Any] | None = None
    for start_candidate in start_candidates:
        for via_candidate in via_candidates:
            if float(via_candidate["route_distance_m"]) <= float(start_candidate["route_distance_m"]):
                continue
            for end_candidate in end_candidates:
                if float(end_candidate["route_distance_m"]) <= float(via_candidate["route_distance_m"]):
                    continue
                score = float(start_candidate["distance_m"]) + float(via_candidate["distance_m"]) + float(end_candidate["distance_m"])
                if best_match is None or score < float(best_match["score"]):
                    start_index = int(start_candidate["segment_index"])
                    via_index = int(via_candidate["matched_record_index"])
                    end_index = min(len(records) - 1, int(end_candidate["segment_index"]) + 1)
                    if via_index <= start_index:
                        via_index = min(len(records) - 1, start_index + 1)
                    if via_index >= end_index:
                        via_index = max(start_index + 1, end_index - 1)
                    best_match = {
                        "start_index": start_index,
                        "via_index": via_index,
                        "end_index": end_index,
                        "matched_start_index": int(start_candidate["matched_record_index"]),
                        "matched_via_index": int(via_candidate["matched_record_index"]),
                        "matched_end_index": int(end_candidate["matched_record_index"]),
                        "start_route_distance_m": float(start_candidate["route_distance_m"]),
                        "via_route_distance_m": float(via_candidate["route_distance_m"]),
                        "end_route_distance_m": float(end_candidate["route_distance_m"]),
                        "score": score,
                    }
    return best_match


def _derive_segment_summary(records: list[ActivityRecord]) -> dict[str, Any]:
    if not records:
        return {
            "distance_m": None,
            "ascent_m": None,
            "descent_m": None,
            "moving_time_s": None,
            "average_speed_kmh": None,
            "average_power_w": None,
            "max_power_w": None,
            "avg_hr_bpm": None,
            "route_points": [],
            "profile_points": [],
        }

    first_distance_m = next((float(row.distance_m) for row in records if row.distance_m is not None), None)
    cumulative_distance_m = 0.0
    previous_latlon: tuple[float, float] | None = None
    altitude_values: list[float] = []
    route_points: list[dict[str, float]] = []
    profile_points: list[dict[str, float]] = []
    first_altitude_m: float | None = None
    last_altitude_m: float | None = None
    previous_route_altitude_m: float | None = None
    previous_route_distance_m: float | None = None
    moving_time_s = 0.0
    moving_power_total = 0.0
    moving_power_duration_s = 0.0
    moving_hr_total = 0.0
    moving_hr_duration_s = 0.0
    max_power_w: float | None = None
    previous_row: ActivityRecord | None = None

    for row in records:
        current_latlon = None
        altitude_m = float(row.altitude_m) if row.altitude_m is not None else None
        if row.latitude_deg is not None and row.longitude_deg is not None:
            current_latlon = (float(row.latitude_deg), float(row.longitude_deg))
        if first_distance_m is not None and row.distance_m is not None:
            cumulative_distance_m = max(cumulative_distance_m, max(0.0, float(row.distance_m) - first_distance_m))
        elif current_latlon is not None and previous_latlon is not None:
            cumulative_distance_m += _haversine_m(previous_latlon[0], previous_latlon[1], current_latlon[0], current_latlon[1])
        if current_latlon is not None:
            previous_latlon = current_latlon
            local_grade_pct = None
            if altitude_m is not None and previous_route_altitude_m is not None and previous_route_distance_m is not None:
                local_grade_pct = _grade_pct(cumulative_distance_m - previous_route_distance_m, altitude_m - previous_route_altitude_m)
            route_points.append(
                {
                    "latitude_deg": current_latlon[0],
                    "longitude_deg": current_latlon[1],
                    "distance_m": round(cumulative_distance_m, 1),
                    "altitude_m": round(altitude_m, 1) if altitude_m is not None else None,
                    "grade_pct": local_grade_pct,
                }
            )
            if altitude_m is not None:
                previous_route_altitude_m = altitude_m
                previous_route_distance_m = cumulative_distance_m
        if altitude_m is not None:
            if first_altitude_m is None:
                first_altitude_m = altitude_m
            last_altitude_m = altitude_m
            altitude_values.append(altitude_m)
            profile_points.append({"distance_m": round(cumulative_distance_m, 1), "altitude_m": round(altitude_m, 1)})
        if previous_row is not None:
            time_delta_s = _record_time_delta_s(previous_row, row)
            distance_delta_m = _record_distance_delta_m(previous_row, row)
            speed_mps = float(row.speed_mps) if row.speed_mps is not None else None
            derived_speed_mps = None
            if time_delta_s is not None and time_delta_s > 0 and distance_delta_m is not None:
                derived_speed_mps = distance_delta_m / time_delta_s
            is_moving = False
            if speed_mps is not None and speed_mps >= MIN_MOVING_SPEED_MPS:
                is_moving = True
            elif derived_speed_mps is not None and derived_speed_mps >= MIN_MOVING_SPEED_MPS:
                is_moving = True
            elif distance_delta_m is not None and distance_delta_m >= MIN_MOVING_DISTANCE_M:
                is_moving = True
            if is_moving and time_delta_s is not None and time_delta_s > 0:
                moving_time_s += time_delta_s
                if row.power_w is not None:
                    max_power_w = float(row.power_w) if max_power_w is None else max(max_power_w, float(row.power_w))
                    moving_power_total += float(row.power_w) * time_delta_s
                    moving_power_duration_s += time_delta_s
                if row.heart_rate_bpm is not None:
                    moving_hr_total += float(row.heart_rate_bpm) * time_delta_s
                    moving_hr_duration_s += time_delta_s
            elif row.power_w is not None:
                max_power_w = float(row.power_w) if max_power_w is None else max(max_power_w, float(row.power_w))
        previous_row = row

    distance_m = cumulative_distance_m if cumulative_distance_m > 0 else None
    ascent_m = _sum_positive_deltas(altitude_values) if altitude_values else None
    descent_m = _sum_negative_deltas(altitude_values) if altitude_values else None
    net_gain_m = (last_altitude_m - first_altitude_m) if first_altitude_m is not None and last_altitude_m is not None else None
    average_grade_pct = ((ascent_m / distance_m) * 100.0) if ascent_m is not None and distance_m and distance_m > 0 else None
    average_speed_kmh = ((distance_m / moving_time_s) * 3.6) if distance_m is not None and moving_time_s > 0 else None
    average_power_w = (moving_power_total / moving_power_duration_s) if moving_power_duration_s > 0 else None
    avg_hr_bpm = (moving_hr_total / moving_hr_duration_s) if moving_hr_duration_s > 0 else None
    return {
        "distance_m": _round_float(distance_m, 1),
        "ascent_m": _round_float(ascent_m, 1),
        "descent_m": _round_float(descent_m, 1),
        "net_gain_m": _round_float(net_gain_m, 1),
        "average_grade_pct": _round_float(average_grade_pct, 1),
        "start_altitude_m": _round_float(first_altitude_m, 1),
        "end_altitude_m": _round_float(last_altitude_m, 1),
        "moving_time_s": _round_float(moving_time_s, 1) if moving_time_s > 0 else None,
        "average_speed_kmh": _round_float(average_speed_kmh, 1),
        "average_power_w": _round_float(average_power_w, 1),
        "max_power_w": _round_float(max_power_w, 1),
        "avg_hr_bpm": _round_float(avg_hr_bpm, 1),
        "route_points": _compact_dict_points(route_points, MAX_ROUTE_POINTS),
        "profile_points": _compact_dict_points(profile_points, MAX_PROFILE_POINTS),
    }


def _is_valid_climb_summary(summary: dict[str, Any]) -> bool:
    distance_m = float(summary.get("distance_m") or 0.0)
    ascent_m = float(summary.get("ascent_m") or 0.0)
    descent_m = float(summary.get("descent_m") or 0.0)
    net_gain_m = float(summary.get("net_gain_m") or 0.0)
    return distance_m >= 100.0 and ascent_m >= 10.0 and net_gain_m > 0.0 and ascent_m > descent_m


def _find_match_on_activity(
    session,
    *,
    activity: Activity,
    start_point: dict[str, float],
    via_point: dict[str, float],
    end_point: dict[str, float],
    tolerance_m: float,
) -> dict[str, Any] | None:
    records = session.scalars(
        select(ActivityRecord)
        .where(ActivityRecord.activity_id == activity.id)
        .where(ActivityRecord.latitude_deg.is_not(None))
        .where(ActivityRecord.longitude_deg.is_not(None))
        .order_by(ActivityRecord.record_index.asc())
    ).all()
    geo_records = _extract_geo_records(records)
    if len(geo_records) < 3:
        try:
            from apps.api.activity_service import _hydrate_activity_streams_from_fit

            _, _, hydrated_records = _hydrate_activity_streams_from_fit(session, activity)
            geo_records = _extract_geo_records(hydrated_records)
        except Exception:
            geo_records = _extract_geo_records(records)
    if len(geo_records) < 3:
        return None
    match = _find_best_segment_indices(
        geo_records,
        start_point=start_point,
        via_point=via_point,
        end_point=end_point,
        tolerance_m=tolerance_m,
    )
    if match is None:
        return None
    start_index = int(match["start_index"])
    end_index = int(match["end_index"])
    matched_start_record = geo_records[int(match.get("matched_start_index", start_index))]
    matched_via_record = geo_records[int(match.get("matched_via_index", int(match["via_index"])))]
    matched_end_record = geo_records[int(match.get("matched_end_index", end_index))]
    segment_summary = _derive_segment_summary(geo_records[start_index : end_index + 1])
    if not _is_valid_climb_summary(segment_summary):
        return None
    return {
        "score": float(match["score"]),
        "activity": activity,
        "summary": segment_summary,
        "matched_start_point": _record_point(matched_start_record),
        "matched_via_point": _record_point(matched_via_record),
        "matched_end_point": _record_point(matched_end_record),
    }


def _find_representative_segment(
    session,
    *,
    user_id: int,
    start_point: dict[str, float],
    via_point: dict[str, float],
    end_point: dict[str, float],
    tolerance_m: float,
) -> dict[str, Any] | None:
    activities = session.scalars(
        select(Activity)
        .where(Activity.user_id == user_id)
        .where(Activity.started_at.is_not(None))
        .order_by(Activity.started_at.desc(), Activity.id.desc())
    ).all()
    best_result: dict[str, Any] | None = None
    for activity in activities:
        result = _find_match_on_activity(
            session,
            activity=activity,
            start_point=start_point,
            via_point=via_point,
            end_point=end_point,
            tolerance_m=tolerance_m,
        )
        if result is None:
            continue
        if best_result is None or float(result["score"]) < float(best_result["score"]):
            best_result = result
    return best_result


def _find_representative_segment_with_preview_fallback(
    session,
    *,
    user_id: int,
    start_point: dict[str, float],
    via_point: dict[str, float],
    end_point: dict[str, float],
    tolerance_m: float,
) -> dict[str, Any] | None:
    result = _find_representative_segment(
        session,
        user_id=user_id,
        start_point=start_point,
        via_point=via_point,
        end_point=end_point,
        tolerance_m=tolerance_m,
    )
    if result is not None or tolerance_m >= MIN_PREVIEW_TOLERANCE_M:
        return result
    return _find_representative_segment(
        session,
        user_id=user_id,
        start_point=start_point,
        via_point=via_point,
        end_point=end_point,
        tolerance_m=MIN_PREVIEW_TOLERANCE_M,
    )


def _load_compare(session, *, user_id: int, compare_id: int) -> ActivityClimbCompare | None:
    return session.scalar(
        select(ActivityClimbCompare).where(
            ActivityClimbCompare.user_id == user_id,
            ActivityClimbCompare.id == compare_id,
        )
    )


def _normalize_compare_tolerance(compare: ActivityClimbCompare) -> float:
    tolerance_m = float(compare.search_tolerance_m or DEFAULT_SEARCH_TOLERANCE_M)
    if tolerance_m < MIN_SEARCH_TOLERANCE_M:
        compare.search_tolerance_m = MIN_SEARCH_TOLERANCE_M
        compare.updated_at = _now()
        return MIN_SEARCH_TOLERANCE_M
    return tolerance_m


def _apply_match_to_compare(compare: ActivityClimbCompare, result: dict[str, Any] | None) -> None:
    if result is None:
        compare.representative_activity_id = None
        compare.representative_activity_name = None
        compare.representative_started_at = None
        compare.representative_distance_m = None
        compare.representative_ascent_m = None
        compare.representative_descent_m = None
        compare.route_points_json = None
        compare.profile_points_json = None
        compare.updated_at = _now()
        return
    activity = result["activity"]
    summary = result["summary"]
    compare.representative_activity_id = activity.id
    compare.representative_activity_name = activity.name or "Unbenannte Aktivitaet"
    compare.representative_started_at = activity.started_at
    compare.representative_distance_m = summary["distance_m"]
    compare.representative_ascent_m = summary["ascent_m"]
    compare.representative_descent_m = summary["descent_m"]
    compare.route_points_json = json.dumps(summary["route_points"])
    compare.profile_points_json = json.dumps(summary["profile_points"])
    start_point = result.get("matched_start_point")
    via_point = result.get("matched_via_point")
    end_point = result.get("matched_end_point")
    if isinstance(start_point, dict):
        compare.start_latitude_deg = float(start_point["latitude_deg"])
        compare.start_longitude_deg = float(start_point["longitude_deg"])
    if isinstance(via_point, dict):
        compare.via_latitude_deg = float(via_point["latitude_deg"])
        compare.via_longitude_deg = float(via_point["longitude_deg"])
        compare.location_label = f"Mitte {compare.via_latitude_deg:.5f}, {compare.via_longitude_deg:.5f}"
    if isinstance(end_point, dict):
        compare.end_latitude_deg = float(end_point["latitude_deg"])
        compare.end_longitude_deg = float(end_point["longitude_deg"])
    compare.updated_at = _now()


def _reset_compare_search_cache(compare: ActivityClimbCompare) -> None:
    compare.search_matches_json = None
    compare.last_search_started_at = None
    compare.last_search_completed_at = None
    compare.last_search_activity_created_at = None
    compare.last_search_checked_total = None
    compare.last_search_matched_total = None
    compare.last_search_algorithm_version = None


def _serialize_cached_result(compare: ActivityClimbCompare) -> dict[str, Any] | None:
    payload = _safe_json_payload(compare.search_matches_json)
    if not isinstance(payload, dict):
        return None
    matches = payload.get("matches")
    return {
        "status": str(payload.get("status") or "completed"),
        "message": payload.get("message"),
        "checked_total": int(compare.last_search_checked_total or payload.get("checked_total") or 0),
        "matched_total": int(compare.last_search_matched_total or payload.get("matched_total") or 0),
        "matches": matches if isinstance(matches, list) else [],
    }


def _serialize_search_state(session, compare: ActivityClimbCompare) -> dict[str, Any]:
    total_ride_total = int(
        session.scalar(
            select(func.count(Activity.id))
            .where(Activity.user_id == int(compare.user_id))
            .where(Activity.started_at.is_not(None))
        )
        or 0
    )
    needs_full_rescan = int(compare.last_search_algorithm_version or 0) != CLIMB_COMPARE_SEARCH_ALGORITHM_VERSION
    if needs_full_rescan or compare.last_search_activity_created_at is None:
        pending_ride_total = total_ride_total
    else:
        pending_ride_total = int(
            session.scalar(
                select(func.count(Activity.id))
                .where(Activity.user_id == int(compare.user_id))
                .where(Activity.started_at.is_not(None))
                .where(Activity.created_at > compare.last_search_activity_created_at)
            )
            or 0
        )
    return {
        "algorithm_version": CLIMB_COMPARE_SEARCH_ALGORITHM_VERSION,
        "last_search_algorithm_version": compare.last_search_algorithm_version,
        "searched_ride_total": int(compare.last_search_checked_total or 0),
        "matched_total": int(compare.last_search_matched_total or 0),
        "pending_ride_total": pending_ride_total,
        "total_ride_total": total_ride_total,
        "last_checked_at": compare.last_search_completed_at.isoformat() if compare.last_search_completed_at else None,
        "last_checked_started_at": compare.last_search_started_at.isoformat() if compare.last_search_started_at else None,
        "last_checked_activity_created_at": compare.last_search_activity_created_at.isoformat() if compare.last_search_activity_created_at else None,
        "needs_full_rescan": needs_full_rescan,
    }


def _get_map_center(session, user_id: int) -> dict[str, float]:
    row = session.execute(
        select(ActivityRecord.latitude_deg, ActivityRecord.longitude_deg)
        .join(Activity, ActivityRecord.activity_id == Activity.id)
        .where(Activity.user_id == user_id)
        .where(ActivityRecord.latitude_deg.is_not(None))
        .where(ActivityRecord.longitude_deg.is_not(None))
        .order_by(Activity.started_at.desc(), ActivityRecord.record_index.asc())
        .limit(1)
    ).first()
    if row is None:
        return dict(DEFAULT_COMPARE_CENTER)
    latitude_deg = float(row[0])
    longitude_deg = float(row[1])
    if not math.isfinite(latitude_deg) or not math.isfinite(longitude_deg):
        return dict(DEFAULT_COMPARE_CENTER)
    return {"latitude_deg": latitude_deg, "longitude_deg": longitude_deg}


def _serialize_compare(session, row: ActivityClimbCompare) -> dict[str, Any]:
    route_points = _safe_json_list(row.route_points_json)
    profile_points = _safe_json_list(row.profile_points_json)
    start_altitude_m = profile_points[0].get("altitude_m") if profile_points else None
    end_altitude_m = profile_points[-1].get("altitude_m") if profile_points else None
    net_gain_m = None
    if start_altitude_m is not None and end_altitude_m is not None:
        net_gain_m = round(float(end_altitude_m) - float(start_altitude_m), 1)
    average_grade_pct = None
    if row.representative_distance_m and row.representative_ascent_m and row.representative_distance_m > 0:
        average_grade_pct = round((float(row.representative_ascent_m) / float(row.representative_distance_m)) * 100.0, 1)
    return {
        "id": row.id,
        "name": row.name,
        "notes": row.notes,
        "location_label": row.location_label,
        "search_tolerance_m": row.search_tolerance_m,
        "start_point": {"latitude_deg": row.start_latitude_deg, "longitude_deg": row.start_longitude_deg},
        "via_point": {"latitude_deg": row.via_latitude_deg, "longitude_deg": row.via_longitude_deg},
        "end_point": {"latitude_deg": row.end_latitude_deg, "longitude_deg": row.end_longitude_deg},
        "representative_activity": (
            {
                "id": row.representative_activity_id,
                "name": row.representative_activity_name,
                "started_at": row.representative_started_at.isoformat() if row.representative_started_at else None,
            }
            if row.representative_activity_id is not None
            else None
        ),
        "summary": {
            "distance_m": row.representative_distance_m,
            "ascent_m": row.representative_ascent_m,
            "descent_m": row.representative_descent_m,
            "net_gain_m": net_gain_m,
            "average_grade_pct": average_grade_pct,
            "start_altitude_m": start_altitude_m,
            "end_altitude_m": end_altitude_m,
        },
        "route_points": route_points,
        "profile_points": profile_points,
        "search_state": _serialize_search_state(session, row),
        "last_check_result": _serialize_cached_result(row),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _activity_label(activity: Activity) -> str:
    return str(activity.name or f"Aktivitaet {activity.id}")


def _serialize_check_match(
    *,
    activity: Activity,
    score: float,
    summary: dict[str, Any],
    compare: ActivityClimbCompare,
    matched_start_point: dict[str, float] | None,
    matched_via_point: dict[str, float] | None,
    matched_end_point: dict[str, float] | None,
) -> dict[str, Any]:
    distance_delta_m = None
    if summary.get("distance_m") is not None and compare.representative_distance_m is not None:
        distance_delta_m = float(summary["distance_m"]) - float(compare.representative_distance_m)
    ascent_delta_m = None
    if summary.get("ascent_m") is not None and compare.representative_ascent_m is not None:
        ascent_delta_m = float(summary["ascent_m"]) - float(compare.representative_ascent_m)
    return {
        "activity_id": activity.id,
        "activity_name": _activity_label(activity),
        "started_at": activity.started_at.isoformat() if activity.started_at else None,
        "provider": activity.provider,
        "sport": activity.sport,
        "score": _round_float(score, 1),
        "moving_time_s": summary.get("moving_time_s"),
        "average_speed_kmh": summary.get("average_speed_kmh"),
        "average_power_w": summary.get("average_power_w"),
        "max_power_w": summary.get("max_power_w"),
        "avg_hr_bpm": summary.get("avg_hr_bpm"),
        "summary": {
            "distance_m": summary.get("distance_m"),
            "ascent_m": summary.get("ascent_m"),
            "descent_m": summary.get("descent_m"),
            "net_gain_m": summary.get("net_gain_m"),
            "average_grade_pct": summary.get("average_grade_pct"),
            "start_altitude_m": summary.get("start_altitude_m"),
            "end_altitude_m": summary.get("end_altitude_m"),
        },
        "delta_to_reference": {"distance_m": _round_float(distance_delta_m, 1), "ascent_m": _round_float(ascent_delta_m, 1)},
        "matched_points": {
            "start_point": matched_start_point,
            "via_point": matched_via_point,
            "end_point": matched_end_point,
        },
        "is_reference_activity": compare.representative_activity_id is not None and int(compare.representative_activity_id) == int(activity.id),
    }


def _merge_cached_matches(existing_matches: list[dict[str, Any]], new_matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged_by_activity_id: dict[int, dict[str, Any]] = {}
    for match in existing_matches + new_matches:
        try:
            activity_id = int(match.get("activity_id"))
        except Exception:
            continue
        previous = merged_by_activity_id.get(activity_id)
        if previous is None or float(match.get("score") or math.inf) < float(previous.get("score") or math.inf):
            merged_by_activity_id[activity_id] = match
    return sorted(merged_by_activity_id.values(), key=lambda item: str(item.get("started_at") or ""), reverse=True)


def _write_search_cache(
    compare: ActivityClimbCompare,
    *,
    checked_total: int,
    matches: list[dict[str, Any]],
    message: str,
    started_at: datetime,
    completed_at: datetime,
    latest_activity_created_at: datetime | None,
) -> None:
    compare.search_matches_json = json.dumps(
        {
            "status": "completed",
            "message": message,
            "checked_total": checked_total,
            "matched_total": len(matches),
            "matches": matches,
        }
    )
    compare.last_search_started_at = started_at
    compare.last_search_completed_at = completed_at
    compare.last_search_activity_created_at = latest_activity_created_at
    compare.last_search_checked_total = checked_total
    compare.last_search_matched_total = len(matches)
    compare.last_search_algorithm_version = CLIMB_COMPARE_SEARCH_ALGORITHM_VERSION
    compare.updated_at = completed_at


def list_climb_compares(user_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        rows = session.scalars(
            select(ActivityClimbCompare)
            .where(ActivityClimbCompare.user_id == user_id)
            .order_by(ActivityClimbCompare.created_at.desc(), ActivityClimbCompare.id.desc())
        ).all()
        for row in rows:
            _normalize_compare_tolerance(row)
        session.commit()
        return {"map_center": _get_map_center(session, user_id), "compares": [_serialize_compare(session, row) for row in rows]}


def get_climb_compare_brief(user_id: int, compare_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        compare = _load_compare(session, user_id=user_id, compare_id=compare_id)
        if compare is None:
            raise ValueError("Climb Compare not found.")
        _normalize_compare_tolerance(compare)
        return {
            "id": compare.id,
            "name": compare.name,
            "needs_full_rescan": int(compare.last_search_algorithm_version or 0) != CLIMB_COMPARE_SEARCH_ALGORITHM_VERSION,
        }


def create_climb_compare(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    start_point = _normalize_point(payload.get("start_point"), "start_point")
    via_point = _normalize_point(payload.get("via_point"), "via_point")
    end_point = _normalize_point(payload.get("end_point"), "end_point")
    if _haversine_m(start_point["latitude_deg"], start_point["longitude_deg"], end_point["latitude_deg"], end_point["longitude_deg"]) < 50:
        raise ValueError("Start- und Endpunkt liegen zu nah beieinander.")
    raw_tolerance_m = payload.get("search_tolerance_m")
    tolerance_m = DEFAULT_SEARCH_TOLERANCE_M if raw_tolerance_m is None else float(raw_tolerance_m)
    if tolerance_m < 15 or tolerance_m > 500:
        raise ValueError("search_tolerance_m must be between 15 and 500.")
    clean_name = str(payload.get("name") or "").strip() or "Neuer Climb Compare"
    clean_notes = str(payload.get("notes") or "").strip() or None
    with SessionLocal() as session:
        representative = _find_representative_segment_with_preview_fallback(
            session,
            user_id=user_id,
            start_point=start_point,
            via_point=via_point,
            end_point=end_point,
            tolerance_m=tolerance_m,
        )
        now = _now()
        compare = ActivityClimbCompare(
            user_id=user_id,
            name=clean_name,
            notes=clean_notes,
            location_label=f"Mitte {via_point['latitude_deg']:.5f}, {via_point['longitude_deg']:.5f}",
            search_tolerance_m=tolerance_m,
            start_latitude_deg=start_point["latitude_deg"],
            start_longitude_deg=start_point["longitude_deg"],
            via_latitude_deg=via_point["latitude_deg"],
            via_longitude_deg=via_point["longitude_deg"],
            end_latitude_deg=end_point["latitude_deg"],
            end_longitude_deg=end_point["longitude_deg"],
            created_at=now,
            updated_at=now,
        )
        _reset_compare_search_cache(compare)
        if representative is not None:
            _apply_match_to_compare(compare, representative)
        session.add(compare)
        session.commit()
        session.refresh(compare)
        return {
            "compare": _serialize_compare(session, compare),
            "message": "Climb Compare gespeichert. Eine Referenzfahrt wurde bereits gefunden." if compare.representative_activity_id is not None else "Climb Compare gespeichert. Eine passende Referenzfahrt wurde noch nicht gefunden.",
        }


def update_climb_compare(user_id: int, compare_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    start_point = _normalize_point(payload.get("start_point"), "start_point")
    via_point = _normalize_point(payload.get("via_point"), "via_point")
    end_point = _normalize_point(payload.get("end_point"), "end_point")
    raw_tolerance_m = payload.get("search_tolerance_m")
    tolerance_m = DEFAULT_SEARCH_TOLERANCE_M if raw_tolerance_m is None else float(raw_tolerance_m)
    if tolerance_m < 15 or tolerance_m > 500:
        raise ValueError("search_tolerance_m must be between 15 and 500.")
    with SessionLocal() as session:
        compare = _load_compare(session, user_id=user_id, compare_id=compare_id)
        if compare is None:
            raise ValueError("Climb Compare not found.")
        compare.name = str(payload.get("name") or "").strip() or compare.name
        compare.notes = str(payload.get("notes") or "").strip() or None
        compare.location_label = f"Mitte {via_point['latitude_deg']:.5f}, {via_point['longitude_deg']:.5f}"
        compare.search_tolerance_m = tolerance_m
        compare.start_latitude_deg = start_point["latitude_deg"]
        compare.start_longitude_deg = start_point["longitude_deg"]
        compare.via_latitude_deg = via_point["latitude_deg"]
        compare.via_longitude_deg = via_point["longitude_deg"]
        compare.end_latitude_deg = end_point["latitude_deg"]
        compare.end_longitude_deg = end_point["longitude_deg"]
        _reset_compare_search_cache(compare)
        representative = _find_representative_segment_with_preview_fallback(
            session,
            user_id=user_id,
            start_point=start_point,
            via_point=via_point,
            end_point=end_point,
            tolerance_m=tolerance_m,
        )
        _apply_match_to_compare(compare, representative)
        compare.updated_at = _now()
        session.commit()
        session.refresh(compare)
        return {"compare": _serialize_compare(session, compare), "message": "Climb Compare aktualisiert. Gespeicherte Suchergebnisse wurden zur Sicherheit zurueckgesetzt."}


def rename_climb_compare(user_id: int, compare_id: int, name: str) -> dict[str, Any]:
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("Name darf nicht leer sein.")
    with SessionLocal() as session:
        compare = _load_compare(session, user_id=user_id, compare_id=compare_id)
        if compare is None:
            raise ValueError("Climb Compare not found.")
        compare.name = clean_name
        compare.updated_at = _now()
        session.commit()
        session.refresh(compare)
        return {"compare": _serialize_compare(session, compare), "message": "Name aktualisiert."}


def duplicate_climb_compare(user_id: int, compare_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        source = _load_compare(session, user_id=user_id, compare_id=compare_id)
        if source is None:
            raise ValueError("Climb Compare not found.")
        now = _now()
        compare = ActivityClimbCompare(
            user_id=int(source.user_id),
            name=f"{source.name} Kopie",
            notes=source.notes,
            location_label=source.location_label,
            search_tolerance_m=float(source.search_tolerance_m),
            start_latitude_deg=float(source.start_latitude_deg),
            start_longitude_deg=float(source.start_longitude_deg),
            via_latitude_deg=float(source.via_latitude_deg),
            via_longitude_deg=float(source.via_longitude_deg),
            end_latitude_deg=float(source.end_latitude_deg),
            end_longitude_deg=float(source.end_longitude_deg),
            representative_activity_id=source.representative_activity_id,
            representative_activity_name=source.representative_activity_name,
            representative_started_at=source.representative_started_at,
            representative_distance_m=source.representative_distance_m,
            representative_ascent_m=source.representative_ascent_m,
            representative_descent_m=source.representative_descent_m,
            route_points_json=source.route_points_json,
            profile_points_json=source.profile_points_json,
            search_matches_json=source.search_matches_json,
            last_search_started_at=source.last_search_started_at,
            last_search_completed_at=source.last_search_completed_at,
            last_search_activity_created_at=source.last_search_activity_created_at,
            last_search_checked_total=source.last_search_checked_total,
            last_search_matched_total=source.last_search_matched_total,
            last_search_algorithm_version=source.last_search_algorithm_version,
            created_at=now,
            updated_at=now,
        )
        session.add(compare)
        session.commit()
        session.refresh(compare)
        return {"compare": _serialize_compare(session, compare), "message": "Climb Compare kopiert."}


def delete_climb_compare(user_id: int, compare_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        compare = _load_compare(session, user_id=user_id, compare_id=compare_id)
        if compare is None:
            raise ValueError("Climb Compare not found.")
        deleted_name = compare.name
        session.delete(compare)
        session.commit()
        return {"status": "deleted", "id": compare_id, "name": deleted_name}


def trigger_climb_compare_check(
    user_id: int,
    compare_id: int,
    *,
    limit: int = DEFAULT_CHECK_RIDES_LIMIT,
    progress_callback: Callable[[int, int, str | None], None] | None = None,
    full_refresh: bool = False,
) -> dict[str, Any]:
    with SessionLocal() as session:
        compare = _load_compare(session, user_id=user_id, compare_id=compare_id)
        if compare is None:
            raise ValueError("Climb Compare not found.")
        tolerance_m = _normalize_compare_tolerance(compare)
        if int(compare.last_search_algorithm_version or 0) != CLIMB_COMPARE_SEARCH_ALGORITHM_VERSION:
            full_refresh = True

        start_point = {"latitude_deg": float(compare.start_latitude_deg), "longitude_deg": float(compare.start_longitude_deg)}
        via_point = {"latitude_deg": float(compare.via_latitude_deg), "longitude_deg": float(compare.via_longitude_deg)}
        end_point = {"latitude_deg": float(compare.end_latitude_deg), "longitude_deg": float(compare.end_longitude_deg)}
        activities_query = select(Activity).where(Activity.user_id == user_id).where(Activity.started_at.is_not(None))
        if not full_refresh and compare.last_search_activity_created_at is not None:
            activities_query = activities_query.where(Activity.created_at > compare.last_search_activity_created_at)
        activities_query = activities_query.order_by(Activity.created_at.asc(), Activity.id.asc())
        if limit > 0:
            activities_query = activities_query.limit(limit)
        activities = session.scalars(activities_query).all()

        cached_result = _serialize_cached_result(compare)
        existing_matches = [] if full_refresh or cached_result is None else list(cached_result.get("matches") or [])
        checked_before = 0 if full_refresh else int(compare.last_search_checked_total or 0)
        latest_activity_created_at = compare.last_search_activity_created_at
        total = len(activities)
        started_at = _now()

        if progress_callback is not None:
            progress_callback(0, total, None)

        matches: list[dict[str, Any]] = []
        best_result: dict[str, Any] | None = None
        if not full_refresh and compare.representative_activity_id is not None:
            representative_activity = session.scalar(select(Activity).where(Activity.id == compare.representative_activity_id))
            if representative_activity is not None and int(representative_activity.user_id) == user_id:
                best_result = _find_match_on_activity(
                    session,
                    activity=representative_activity,
                    start_point=start_point,
                    via_point=via_point,
                    end_point=end_point,
                    tolerance_m=tolerance_m,
                )

        for index, activity in enumerate(activities, start=1):
            activity_name = _activity_label(activity)
            if progress_callback is not None:
                progress_callback(index - 1, total, activity_name)
            result = _find_match_on_activity(
                session,
                activity=activity,
                start_point=start_point,
                via_point=via_point,
                end_point=end_point,
                tolerance_m=tolerance_m,
            )
            if result is not None:
                if best_result is None or float(result["score"]) < float(best_result["score"]):
                    best_result = result
                matches.append(
                    _serialize_check_match(
                        activity=activity,
                        score=float(result["score"]),
                        summary=result["summary"],
                        compare=compare,
                        matched_start_point=result.get("matched_start_point"),
                        matched_via_point=result.get("matched_via_point"),
                        matched_end_point=result.get("matched_end_point"),
                    )
                )
            latest_activity_created_at = activity.created_at if latest_activity_created_at is None else max(latest_activity_created_at, activity.created_at)
            if progress_callback is not None:
                progress_callback(index, total, activity_name)

        all_matches = matches if full_refresh else _merge_cached_matches(existing_matches, matches)
        checked_total = total if full_refresh else checked_before + total
        if best_result is not None:
            _apply_match_to_compare(compare, best_result)

        completed_at = _now()
        if total == 0 and not full_refresh:
            message = "Keine neuen Rides gefunden."
        elif total == 0:
            message = "Keine Rides mit GPS-Daten zum Pruefen gefunden."
        else:
            message = f"{total} neue Rides geprueft, insgesamt {len(all_matches)} Treffer gespeichert." if not full_refresh else f"{total} Rides komplett neu geprueft, {len(all_matches)} Treffer gefunden."

        _write_search_cache(
            compare,
            checked_total=checked_total,
            matches=all_matches,
            message=message,
            started_at=started_at,
            completed_at=completed_at,
            latest_activity_created_at=latest_activity_created_at,
        )
        session.commit()
        session.refresh(compare)
        result_payload = _serialize_cached_result(compare) or {"status": "completed", "checked_total": checked_total, "matched_total": len(all_matches), "matches": all_matches}
        result_payload["compare"] = _serialize_compare(session, compare)
        return result_payload
