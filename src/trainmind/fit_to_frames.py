# -*- coding: utf-8 -*-
from __future__ import annotations
from pathlib import Path
from datetime import datetime, timedelta
from fitparse import FitFile
import pandas as pd
import json

SC_TO_DEG = 180 / 2**31  # semicircles -> degrees

def load_fit(path: Path):
    fit = FitFile(str(path))

    # ---------- RECORDS ----------
    rec_rows = []
    for msg in fit.get_messages("record"):
        d = {f.name: f.value for f in msg}
        ts = d.get("timestamp")
        if ts and not isinstance(ts, datetime):
            # fitparse gibt normalerweise datetime, nur fallback
            ts = pd.to_datetime(ts)
        d["timestamp"] = ts
        if d.get("position_lat") is not None:
            d["lat_deg"] = d["position_lat"] * SC_TO_DEG
        if d.get("position_long") is not None:
            d["lon_deg"] = d["position_long"] * SC_TO_DEG
        if d.get("speed") is not None:
            d["speed_kmh"] = d["speed"] * 3.6
        if d.get("enhanced_speed") is not None:
            d["enhanced_speed_kmh"] = d["enhanced_speed"] * 3.6
        rec_rows.append(d)
    df_rec = pd.DataFrame(rec_rows).sort_values("timestamp").reset_index(drop=True)

    # ---------- LAPS ----------
    lap_rows = []
    for msg in fit.get_messages("lap"):
        d = {f.name: f.value for f in msg}
        # Harmonisierung üblicher alternativer Felder
        alt_map = {
            "total_average_power": "avg_power",
            "avg_watts": "avg_power",
            "total_average_hr": "avg_heart_rate",
            "avg_hr": "avg_heart_rate",
        }
        for old, new in alt_map.items():
            if old in d and new not in d:
                d[new] = d.pop(old)

        # Dauer/Endzeit ableiten
        start = d.get("start_time")
        dur = d.get("total_timer_time") or d.get("total_elapsed_time")  # Sek.
        if isinstance(start, datetime) and isinstance(dur, (int, float)):
            d["end_time"] = start + timedelta(seconds=float(dur))
        if d.get("total_distance") is not None:
            d["total_distance_km"] = d["total_distance"] / 1000.0

        lap_rows.append(d)
    df_lap = pd.DataFrame(lap_rows).reset_index(drop=True)
    if "start_time" in df_lap.columns:
        df_lap = df_lap.sort_values("start_time").reset_index(drop=True)
    df_lap["lap_index"] = df_lap.index + 1  # 1-basiert

    # ---------- SESSION (Summary) ----------
    sess = {}
    for msg in fit.get_messages("session"):
        s = {f.name: f.value for f in msg}
        if s.get("total_distance") is not None:
            s["total_distance_km"] = s["total_distance"] / 1000.0
        sess = s  # meist nur eine, nimm die letzte
    return df_rec, df_lap, sess

def map_records_to_laps(df_rec: pd.DataFrame, df_lap: pd.DataFrame) -> pd.DataFrame:
    if df_rec.empty or df_lap.empty or "timestamp" not in df_rec.columns:
        return df_rec
    # Default: keinem Lap zugeordnet
    df_rec["lap_index"] = pd.NA

    # Baue Zeitfenster aus den Laps
    if "start_time" not in df_lap.columns:
        return df_rec
    # Endzeit ggf. bauen
    if "end_time" not in df_lap.columns:
        df_lap["end_time"] = df_lap["start_time"] + pd.to_timedelta(df_lap.get("total_timer_time", 0), unit="s")

    for _, lap in df_lap.iterrows():
        start = lap.get("start_time")
        end = lap.get("end_time")
        idx = lap.get("lap_index")
        if isinstance(start, datetime) and isinstance(end, datetime):
            mask = (df_rec["timestamp"] >= start) & (df_rec["timestamp"] <= end)
            df_rec.loc[mask, "lap_index"] = idx
    return df_rec

def export_csv_json(fit_path: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    df_rec, df_lap, session = load_fit(fit_path)
    df_rec = map_records_to_laps(df_rec, df_lap)

    # CSVs
    rec_csv = out_dir / f"{fit_path.stem}_records.csv"
    lap_csv = out_dir / f"{fit_path.stem}_laps.csv"
    df_rec.to_csv(rec_csv, index=False)
    df_lap.to_csv(lap_csv, index=False)

    # JSON (kompakt, analysierbar)
    activity = {
        "activity_id": fit_path.stem,
        "source": "FIT",
        "start_time": (df_rec["timestamp"].min().isoformat() if "timestamp" in df_rec else None),
        "summary": {
            "total_time_s": float(session.get("total_timer_time", 0) or 0),
            "total_distance_km": float(session.get("total_distance_km", 0) or 0),
            "avg_power_w": float(session.get("avg_power", session.get("total_average_power", 0)) or 0),
            "max_power_w": float(session.get("max_power", 0) or 0),
            "avg_hr_bpm": float(session.get("avg_heart_rate", session.get("total_average_hr", 0)) or 0),
            "max_hr_bpm": float(session.get("max_heart_rate", 0) or 0),
            "total_work_kj": float(session.get("total_work", 0) or 0) / 1000.0 if session.get("total_work") else None,
        },
        "laps": [],
        "records": []
    }

    # Laps in JSON
    lap_cols = ["lap_index","start_time","end_time","total_timer_time","total_elapsed_time",
                "total_distance","total_distance_km","avg_power","max_power",
                "avg_heart_rate","max_heart_rate","avg_cadence","max_cadence","intensity",
                "message_index","lap_trigger"]
    for _, r in df_lap.iterrows():
        lap = {}
        for c in lap_cols:
            v = r.get(c, None)
            if isinstance(v, pd.Timestamp):
                v = v.to_pydatetime().isoformat()
            elif isinstance(v, datetime):
                v = v.isoformat()
            lap[c] = (float(v) if isinstance(v, (int, float)) else v)
        activity["laps"].append(lap)

    # Records in JSON (leicht komprimiert; nimm nur gebräuchliche Felder)
    rec_keep = ["timestamp","power","heart_rate","cadence","speed","enhanced_speed",
                "distance","altitude","enhanced_altitude","lat_deg","lon_deg","lap_index"]
    for _, r in df_rec.iterrows():
        item = {}
        for c in rec_keep:
            if c not in df_rec.columns: 
                continue
            v = r[c]
            if pd.isna(v):
                continue
            if isinstance(v, pd.Timestamp):
                v = v.to_pydatetime().isoformat()
            elif isinstance(v, datetime):
                v = v.isoformat()
            elif isinstance(v, (pd.Int64Dtype, pd.Float64Dtype)):
                v = float(v)
            item[c] = float(v) if isinstance(v, (int, float)) else v
        activity["records"].append(item)

    json_path = out_dir / f"{fit_path.stem}.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(activity, f, ensure_ascii=False, separators=(",", ":"), indent=2)

    print(f"✓ CSV: {rec_csv.name}, {lap_csv.name}")
    print(f"✓ JSON: {json_path.name}")
    return rec_csv, lap_csv, json_path

if __name__ == "__main__":
    # Repo-Root (anpassen falls Struktur anders ist)
    repo = Path(__file__).resolve().parents[2]
    FIT_NAME = "ROUVY-W1-Mi-Zone2-60min.fit"  # <--- hier deinen Dateinamen setzen
    fit_file = repo / "data" / FIT_NAME
    out_dir = repo / "data" / "exports"
    export_csv_json(fit_file, out_dir)
