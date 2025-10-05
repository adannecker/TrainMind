# -*- coding: utf-8 -*-
import random, math, datetime as dt
from pathlib import Path

import numpy as np

from typing import Iterable, List, Optional, Tuple

from fitparse import FitFile as FitReader          # für Lesen
from fit_tool.fit_file import FitFile as FitWriter, FitFileHeader  # schreiben

from fit_tool.profile.messages.record_message import RecordMessage
from fit_tool.profile.messages.file_id_message import FileIdMessage
from fit_tool.profile.messages.event_message import EventMessage
from fit_tool.profile.messages.session_message import SessionMessage
from fit_tool.profile.messages.lap_message import LapMessage
from fit_tool.profile.profile_type import Sport


# Projekt-Root: .../TrainMind
REPO_ROOT  = Path(__file__).resolve().parents[2]

INPUT_DIR  = REPO_ROOT / "data"
EXPORT_DIR = REPO_ROOT / "data" / "exports"

FILENAME   = "20588898298_ACTIVITY.fit"

IN_FIT  = (INPUT_DIR  / FILENAME).resolve()
OUT_FIT = (EXPORT_DIR / "GA2_rebuilt_with_power.fit").resolve()

# Ordner anlegen (falls nicht da)
INPUT_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

# Sanity check
print(f"IN_FIT:  {IN_FIT}")
print(f"Exists? {IN_FIT.exists()}")

if not IN_FIT.exists():
    raise FileNotFoundError(
        f"Eingangsdatei nicht gefunden:\n  {IN_FIT}\n"
        f"Lege die Datei hier ab oder passe FILENAME/INPUT_DIR an."
    )

# dein Segmentplan (Start in Sekunden ab Beginn, Dauer in Sekunden, Zielwatt)
# exakt wie du es beschrieben hast:
SEGMENTS = [
    ("WU",  10*60, 135),
    ("GA2", 20*60, 158),
    ("SS1", 10*60, 203),
    ("GA2", 20*60, 158),
    ("SS2", 10*60, 203),
    ("GA2", 20*60, 158),
    ("SS3", 10*60, 203),
    ("GA2", 20*60, 158),
    ("CD",  10*60, 124),
]

# Variation um den Zielwert (für realistischere Kurve)
POWER_JITTER_W = 3
# =========================================================================



def load_hr_cad_speed(fit_path: Path):
    """Liest Timestamp, HR, Cadence und Speed (falls vorhanden) aus der Original-FIT."""
    fit = FitReader(str(fit_path))
    fit.parse()

    rows = []
    start_ts = None
    for msg in fit.get_messages("record"):
        ts = msg.get_value("timestamp")
        if start_ts is None:
            start_ts = ts
        hr  = msg.get_value("heart_rate")
        cad = msg.get_value("cadence")
        spd = msg.get_value("speed")  # m/s
        rows.append((ts, hr, cad, spd))
    return start_ts, rows


def build_power_series(rows, start_ts):
    """Erzeugt für jeden vorhandenen Timestamp eine Power gemäß Segmentplan."""
    # Baue eine Liste (sekundengenau) vom ersten bis letzten Timestamp
    if not rows:
        raise RuntimeError("In der Originaldatei wurden keine Record-Daten gefunden.")

    first = rows[0][0]
    last  = rows[-1][0]
    total_secs = int((last - first).total_seconds()) + 1

    # Falls die Aktivität länger/kürzer ist als dein Plan, nehmen wir min()
    planned_secs = sum(d for _, d, _ in SEGMENTS)
    usable_secs  = min(total_secs, planned_secs)

    # Sekundengenauer Zielwert (mit jitter)
    pw = np.zeros(usable_secs, dtype=float)

    offset = 0
    for name, dur, target in SEGMENTS:
        for s in range(min(dur, usable_secs - offset)):
            jitter = random.uniform(-POWER_JITTER_W, POWER_JITTER_W)
            pw[offset + s] = max(0.0, target + jitter)
        offset += dur
        if offset >= usable_secs:
            break

    # Mappe zurück auf die echten Fit-Records (es gibt nicht zwingend jede Sekunde einen Record)
    # Wir nehmen den Sekundenindex relativ zum Start_ts
    time_to_power = {}
    for (ts, *_ ) in rows:
        sec_idx = int((ts - first).total_seconds())
        if 0 <= sec_idx < usable_secs:
            time_to_power[ts] = float(pw[sec_idx])
        else:
            # Falls die Originaldatei länger ist als der Plan: setze letzten bekannten Wert/GA1
            time_to_power[ts] = float(SEGMENTS[-1][2])

    return time_to_power, usable_secs

def _interp_with_jitter(values: Iterable[Optional[float]],
                        jitter_amp: float = 1.0,
                        bounds: Tuple[float, float] | None = None,
                        seed: int | None = None) -> List[int]:
    """
    Füllt None-Lücken linear zwischen bekannten Punkten und fügt pro Punkt
    einen kleinen ±jitter_amp Jitter hinzu. Führt an den Rändern (vor erstem /
    nach letztem Wert) eine 'Hold'-Füllung mit Jitter durch.
    Gibt gerundete int-Werte zurück (für HR/Cadence ideal).

    values     : Liste mit float|int oder None (z. B. HR oder Cadence)
    jitter_amp : maximale Abweichung (z. B. 1 bpm)
    bounds     : (min, max) zur Begrenzung; None -> keine Begrenzung
    seed       : RNG-Seed für reproduzierbares Ergebnis
    """
    rng = random.Random(seed)
    vals = list(values)
    n = len(vals)
    out: List[Optional[float]] = list(vals)  # wird überschrieben

    # Indizes mit echten Werten
    known = [i for i, v in enumerate(vals) if v is not None]
    if not known:
        # nichts bekannt → alles 0 (oder lass es None, wenn dir das lieber ist)
        return [0] * n

    def clamp(x: float) -> float:
        if bounds is None:
            return x
        lo, hi = bounds
        return max(lo, min(hi, x))

    # Vorlauf (vor erstem bekannten Wert): Hold mit Jitter
    first = known[0]
    for i in range(0, first):
        base = float(vals[first])
        out[i] = clamp(base + rng.uniform(-jitter_amp, jitter_amp))

    # Zwischenräume: linear + Jitter
    for a, b in zip(known, known[1:]):
        va = float(vals[a])
        vb = float(vals[b])
        out[a] = float(va)  # original erhalten
        gap = b - a
        if gap > 1:
            for k in range(a + 1, b):
                t = (k - a) / gap
                base = va + (vb - va) * t
                out[k] = clamp(base + rng.uniform(-jitter_amp, jitter_amp))

    # Nachlauf (nach letztem bekannten Wert): Hold mit Jitter
    last = known[-1]
    out[last] = float(vals[last])  # original erhalten
    for i in range(last + 1, n):
        base = float(vals[last])
        out[i] = clamp(base + rng.uniform(-jitter_amp, jitter_amp))

    # ints zurückgeben
    return [int(round(x if x is not None else 0)) for x in out]


def fill_missing_hr_and_cadence(
    rows: list[tuple],
    hr_jitter_bpm: float = 1.0,
    cad_jitter_rpm: float = 2.0,
    cad_extra_jitter_everywhere: float = 0.0,
    seed: int = 42,
) -> list[tuple]:
    """
    Füllt HR- und Cadence-Lücken mit _interp_with_jitter.
    Optional: kleine Variation auch für vorhandene Cadence-Werte (cad_extra_jitter_everywhere).

    rows: [(ts, hr, cad, spd), ...]
    """
    rng = random.Random(seed + 99)
    ts_list, hr_list, cad_list, spd_list = [], [], [], []
    for ts, hr, cad, spd in rows:
        ts_list.append(ts)
        hr_list.append(hr)
        cad_list.append(cad)
        spd_list.append(spd)

    hr_filled = _interp_with_jitter(
        hr_list, jitter_amp=hr_jitter_bpm, bounds=(40, 220), seed=seed
    )
    cad_filled = _interp_with_jitter(
        cad_list, jitter_amp=cad_jitter_rpm, bounds=(0, 200), seed=seed + 1
    )

    # Optional: vorhandene Cadence zusätzlich minimal variieren (z. B. ±1 rpm)
    if cad_extra_jitter_everywhere > 0:
        for i, c in enumerate(cad_filled):
            if cad_list[i] is not None:  # nur dort, wo ursprünglich ein Wert war
                j = rng.uniform(-cad_extra_jitter_everywhere, cad_extra_jitter_everywhere)
                cad_filled[i] = int(max(0, min(200, round(c + j))))

    # Re-assemble
    new_rows = []
    for i in range(len(rows)):
        new_rows.append((ts_list[i], hr_filled[i], cad_filled[i], spd_list[i]))
    return new_rows

import math

def power_to_speed_flat(p_w: float,
                        mass_kg: float = 80.0,     # Fahrer+Rad
                        cda_m2: float = 0.32,      # Aerodynamik (Hoods ~0.32–0.36)
                        crr: float = 0.004,        # Rollwiderstand (Straße)
                        rho: float = 1.225,        # Luftdichte (Meereshöhe, 15°C)
                        drivetrain_eff: float = 0.975,  # Antriebswirkungsgrad
                        grade: float = 0.0,        # Steigung (z.B. 0.01 = 1%)
                        v_max: float = 25.0        # obere Klammer (m/s ~ 90 km/h)
                       ) -> float:
    """
    Liefert stationäre Geschwindigkeit v (m/s) auf flacher Strecke für gegebene Leistung p_w.
    Nutzt Bisektion (monoton), robust auch bei p=0.
    """
    if p_w <= 0:
        return 0.0
    g = 9.80665
    # Näherungen für kleine Steigungen:
    sin_th = grade
    cos_th = 1.0
    # Radleistungsabgabe am Rad (Verluste abgezogen)
    p_wheel = p_w * drivetrain_eff

    def resistive_power(v):
        # Rolling + climbing sind ~linear in v, Aero ~ v^3
        p_roll  = v * (crr * mass_kg * g * cos_th)
        p_grav  = v * (mass_kg * g * sin_th)
        p_aero  = 0.5 * rho * cda_m2 * v**3
        return p_roll + p_grav + p_aero

    lo, hi = 0.0, v_max
    # Falls obere Klammer zu klein ist, erweitern
    while resistive_power(hi) < p_wheel and hi < 60.0:
        hi *= 1.5 if hi > 0 else 1.0
        hi = max(hi, 5.0)

    for _ in range(60):  # Bisektion
        mid = 0.5 * (lo + hi)
        if resistive_power(mid) > p_wheel:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)

from collections import deque

def apply_speed_from_power(rows, time_to_power,
                           mass_kg=80.0, cda_m2=0.32, crr=0.004,
                           rho=1.225, drivetrain_eff=0.975, grade=0.0,
                           smooth_window_s=5):
    """
    rows: [(ts, hr, cad, spd)], spd wird überschrieben durch aus Power berechnete m/s.
    Glättung: gleitendes Mittel (Sekundenfenster).
    """
    # 1) rohe v aus Power
    v_raw = []
    ts_list = [r[0] for r in rows]
    for ts, *_ in rows:
        p = float(time_to_power.get(ts, 0.0))
        v = power_to_speed_flat(p, mass_kg, cda_m2, crr, rho, drivetrain_eff, grade)
        v_raw.append(v)

    # 2) gleichmäßig auf Zeit glätten (moving average über ~smooth_window_s)
    v_smooth = []
    buf = deque()
    last_t = ts_list[0]
    acc_time = 0.0
    for i, (ts, *_ ) in enumerate(rows):
        dt = (ts - last_t).total_seconds() if i > 0 else 1.0
        last_t = ts
        buf.append((v_raw[i], dt))
        acc_time += dt
        # Fenster schrumpfen, bis Sum dt <= smooth_window_s
        while acc_time > smooth_window_s and len(buf) > 1:
            v0, dt0 = buf[0]
            if acc_time - dt0 >= smooth_window_s:
                acc_time -= dt0
                buf.popleft()
            else:
                # Teile des ersten Buckets abschneiden
                keep = acc_time - smooth_window_s
                buf[0] = (v0 * (dt0 - keep) / dt0, dt0 - keep)
                acc_time = smooth_window_s
                break
        # gewichtetes Mittel
        if acc_time > 0:
            num = sum(v*dt for v, dt in buf)
            v_smooth.append(num / acc_time)
        else:
            v_smooth.append(v_raw[i])

    # 3) rows mit neuer speed zurückgeben
    new_rows = []
    for (v, (ts, hr, cad, _spd)) in zip(v_smooth, rows):
        new_rows.append((ts, hr, cad, float(v)))
    return new_rows

def estimate_kcal(time_to_power, eff_metabolic=0.24):
    """
    Rechnet mechanische Arbeit (kJ) in kcal um (metabolisch, ~24% Effizienz).
    """
    # einfache Summation über Zeitdifferenzen
    items = sorted(time_to_power.items(), key=lambda x: x[0])
    if not items:
        return 0
    total_j = 0.0
    prev_ts, prev_p = items[0]
    for ts, p in items[1:]:
        dt = (ts - prev_ts).total_seconds()
        total_j += max(prev_p, 0.0) * dt    # J = W * s
        prev_ts, prev_p = ts, p
    kJ_mech = total_j / 1000.0
    kcal = kJ_mech / eff_metabolic / 4.184
    return int(round(kcal))


def write_fit(OUT_FIT, rows, start_ts, time_to_power):
    """
    Erzeugt eine neue FIT-Datei mit HR/Cad/Speed (original) und rekonstruierter Power.
    Kompatibel mit deiner fit_tool-Version.
    """
    import datetime as dt
    from fit_tool.fit_file import FitFile as FitWriter, FitFileHeader
    from fit_tool.profile.messages.file_id_message import FileIdMessage
    from fit_tool.profile.messages.device_info_message import DeviceInfoMessage
    from fit_tool.profile.messages.event_message import EventMessage
    from fit_tool.profile.messages.record_message import RecordMessage
    from fit_tool.profile.messages.lap_message import LapMessage
    from fit_tool.profile.messages.session_message import SessionMessage
    from fit_tool.profile.messages.activity_message import ActivityMessage

    # ---------- Helpers ----------
    FIT_EPOCH = dt.datetime(1989, 12, 31, tzinfo=dt.timezone.utc)

    def to_fit_seconds(ts):
        """datetime/int -> FIT-Sekunden (seit 1989-12-31)."""
        if isinstance(ts, int):
            return ts
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=dt.timezone.utc)
        return int((ts - FIT_EPOCH).total_seconds())

    FIELD_NUM = {"timestamp": 253, "start_time": 2, "time_created": 4}

    def set_dt_encoded(msg, field_name: str, ts_val):
        """
        Setzt ein date_time-Feld so, dass der encodierte Wert korrekt ist.
        Nutzt Offset/Scale des Feldtyps → keine doppelten Epoch-Abzüge.
        """
        raw = to_fit_seconds(ts_val)

        fld = None
        if hasattr(msg, "get_field_by_name"):
            try:
                fld = msg.get_field_by_name(field_name)
            except Exception:
                fld = None
        if fld is None and hasattr(msg, "get_field"):
            num = FIELD_NUM.get(field_name)
            if num is not None:
                try:
                    fld = msg.get_field(num)
                except Exception:
                    fld = None

        if fld is not None and hasattr(fld, "set_encoded_value"):
            bt = getattr(fld, "base_type", None)
            scale  = (getattr(bt, "scale", 1)  or 1)
            offset = (getattr(bt, "offset", 0) or 0)
            enc = int(round((raw + offset) * scale))
            enc = max(0, min(enc, 0xFFFFFFFF))
            fld.set_encoded_value(0, enc)
        else:
            setattr(msg, field_name, int(raw))

    # ---------- Messages zusammenbauen ----------
    msgs = []

    # File ID (mit time_created)
    file_id = FileIdMessage()
    file_id.manufacturer  = 1           # Garmin (alternativ 255 = development)
    file_id.product       = 1
    file_id.serial_number = 12345678
    file_id.type          = 4           # activity
    set_dt_encoded(file_id, "time_created", start_ts)
    msgs.append(file_id)

    # Device Info
    dev = DeviceInfoMessage()
    dev.device_index     = 0
    dev.manufacturer     = file_id.manufacturer
    dev.product          = file_id.product
    dev.serial_number    = file_id.serial_number
    dev.software_version = 1.0
    set_dt_encoded(dev, "timestamp", start_ts)
    msgs.append(dev)

    # Start-Event
    ev_start = EventMessage()
    ev_start.event = 0                  # timer
    ev_start.event_type = 0             # start
    ev_start.event_group = 0
    set_dt_encoded(ev_start, "timestamp", start_ts)
    msgs.append(ev_start)

    # Records
    first_ts = rows[0][0]
    for (ts, hr, cad, spd) in rows:
        rec = RecordMessage()
        set_dt_encoded(rec, "timestamp", ts)
        if hr  is not None: rec.heart_rate = int(hr)
        if cad is not None: rec.cadence    = int(cad)
        if spd is not None: rec.speed      = float(spd)  # m/s
        p = time_to_power.get(ts)
        if p is not None:  rec.power       = int(round(p))
        msgs.append(rec)

    total_elapsed = float((rows[-1][0] - first_ts).total_seconds())

    # Stop-Event
    ev_stop = EventMessage()
    ev_stop.event = 0
    ev_stop.event_type = 9               # stop_all
    ev_stop.event_group = 0
    set_dt_encoded(ev_stop, "timestamp", rows[-1][0])
    msgs.append(ev_stop)

    # Lap
    lap = LapMessage()
    set_dt_encoded(lap, "timestamp",  rows[-1][0])
    set_dt_encoded(lap, "start_time", rows[0][0])
    lap.total_elapsed_time = total_elapsed
    lap.total_timer_time   = total_elapsed
    msgs.append(lap)

    # Session
    sess = SessionMessage()
    set_dt_encoded(sess, "timestamp",  rows[-1][0])
    set_dt_encoded(sess, "start_time", rows[0][0])
    try:
        from fit_tool.profile.profile_type import Sport, SubSport
        sess.sport = getattr(Sport, "CYCLING", getattr(Sport, "cycling", 2))
        sess.sub_sport = getattr(SubSport, "INDOOR_CYCLING", getattr(SubSport, "indoor_cycling", 6))
    except Exception:
        sess.sport = 2
        sess.sub_sport = 6
    sess.total_elapsed_time = total_elapsed
    sess.total_timer_time   = total_elapsed
    msgs.append(sess)

    # Activity (am Schluss)
    act = ActivityMessage()
    set_dt_encoded(act, "timestamp", rows[-1][0])
    act.total_timer_time = total_elapsed
    act.num_sessions     = 1
    act.type             = 0   # manual
    msgs.append(act)

    # ---------- Schreiben (Header nur minimal initialisieren) ----------
    header = FitFileHeader(records_size=0)  # <- wichtig: required param
    # KEINE weiteren Header-Felder setzen (keine header_size/protocol/profile/data_type)!

    fw = FitWriter(header=header, records=msgs)
    fw.to_file(str(OUT_FIT))


def generate_flat_route(start_lat, start_lon, total_distance_m, points=2000, bearing_deg=90.0):
    import math
    R = 6371000.0
    lat0 = math.radians(start_lat)
    dlon_total = (total_distance_m / (R*math.cos(lat0)))
    lats, lons = [], []
    for i in range(points):
        f = i/(points-1)
        dlon = f*dlon_total
        lats.append(start_lat)
        lons.append(start_lon + math.degrees(dlon))
    # cumulative dists entlang Route:
    cum = [0.0]
    for i in range(1, points):
        dl = (R*math.cos(lat0))*math.radians(lons[i]-lons[i-1])
        cum.append(cum[-1] + abs(dl))
    return lats, lons, cum


def interpolate_positions(route_lat, route_lon, route_cum, activity_cum):
    # Map jede Aktivitätsdistanz auf Längenparameter der Route
    pos=[]
    j=0
    for s in activity_cum:
        while j+1<len(route_cum) and route_cum[j+1]<s: j+=1
        if j+1>=len(route_cum): j=len(route_cum)-2
        s0,s1=route_cum[j],route_cum[j+1]
        f=0.0 if s1==s0 else (s-s0)/(s1-s0)
        lat=route_lat[j]+f*(route_lat[j+1]-route_lat[j])
        lon=route_lon[j]+f*(route_lon[j+1]-route_lon[j])
        pos.append((lat,lon))
    return pos

import numpy as np

def compute_np_if_tss(time_to_power, ftp_w):
    items=sorted(time_to_power.items(), key=lambda x:x[0])
    if not items: return 0.0, 0.0, 0.0
    start,end=items[0][0], items[-1][0]
    n = int((end-start).total_seconds())+1
    P = np.zeros(n, dtype=float)
    for (t,p),(t2,_) in zip(items, items[1:]+[(end,0)]):
        i = int((t-start).total_seconds())
        j = int((t2-start).total_seconds())
        P[i:j] = float(p)
    # 30s gleitender Mittelwert (edge-handling 'same')
    win = np.ones(30)/30.0
    P30 = np.convolve(P, win, mode='same')
    NP = (np.mean(P30**4))**0.25
    IF = 0.0 if ftp_w<=0 else NP/ftp_w
    secs = n
    TSS = 0.0 if ftp_w<=0 else (secs*NP*IF)/(ftp_w*3600.0)*100.0
    return float(NP), float(IF), float(TSS)

def _cum_dist_from_rows(rows):
    """Integriert Distanz aus spd (m/s)."""
    if not rows: return 0.0, 0.0, 0.0, 0.0
    dist = 0.0
    v_max = 0.0
    moving_time = 0.0
    last_t = rows[0][0]
    for i, (t, _hr, _cad, v) in enumerate(rows):
        if i == 0:
            v_max = max(v_max, float(v or 0.0))
            continue
        dt = (t - last_t).total_seconds()
        last_t = t
        vv = float(v or 0.0)
        dist += max(0.0, vv) * max(0.0, dt)
        v_max = max(v_max, vv)
        if vv > 0.5:               # >0.5 m/s = “in Bewegung”
            moving_time += dt
    total_time = (rows[-1][0] - rows[0][0]).total_seconds()
    return dist, total_time, moving_time, v_max

def _power_1s_array(time_to_power):
    """Resample Power auf 1-s Raster (inkl. letztem Sample)."""
    items = sorted(time_to_power.items(), key=lambda x: x[0])
    if not items: return np.zeros(0), None
    t0, tN = items[0][0], items[-1][0]
    n = int((tN - t0).total_seconds()) + 1
    P = np.zeros(n, dtype=float)
    # piecewise constant bis zum nächsten Timestamp
    for (t, p), (t2, _p2) in zip(items, items[1:] + [(tN, 0)]):
        i = int((t - t0).total_seconds())
        j = int((t2 - t0).total_seconds())
        P[i:j] = float(p)
    P[-1] = float(items[-1][1])
    return P, t0

def compute_np_if_tss_and_p20(time_to_power, ftp_w):
    """NP, IF, TSS und maximale 20-min Durchschnittsleistung."""
    P, _ = _power_1s_array(time_to_power)
    if P.size == 0:
        return 0.0, 0.0, 0.0, 0.0
    # 30-s glättung (moving average)
    win = np.ones(30) / 30.0
    P30 = np.convolve(P, win, mode="same")
    NP = float(np.mean(P30**4) ** 0.25)
    IF = 0.0 if ftp_w <= 0 else NP / float(ftp_w)
    secs = float(P.size)
    TSS = 0.0 if ftp_w <= 0 else (secs * NP * IF) / (float(ftp_w) * 3600.0) * 100.0
    # beste 20-min (1200 s) Durchschnittsleistung
    w = 1200
    if P.size < w:
        P20 = float(np.mean(P)) if P.size > 0 else 0.0
    else:
        csum = np.cumsum(np.insert(P, 0, 0.0))
        roll = (csum[w:] - csum[:-w]) / w
        P20 = float(np.max(roll))
    return NP, IF, TSS, P20

def summarize_for_connect(rows, time_to_power, ftp_w):
    """Berechnet Distanz/Speed-Kennzahlen + NP/IF/TSS + 20min-Power."""
    dist_m, total_s, moving_s, v_max = _cum_dist_from_rows(rows)
    avg_v = 0.0 if total_s <= 0 else dist_m / total_s
    avg_v_mov = 0.0 if moving_s <= 0 else dist_m / moving_s
    NP, IF, TSS, P20 = compute_np_if_tss_and_p20(time_to_power, ftp_w)
    return {
        "distance_m": dist_m,
        "total_s": total_s,
        "moving_s": moving_s,
        "avg_v": avg_v,
        "avg_v_moving": avg_v_mov,
        "v_max": v_max,
        "NP": NP,
        "IF": IF,
        "TSS": TSS,
        "P20": P20,
    }

import xml.etree.ElementTree as ET

def write_tcx(out_fit_path,
              rows,
              start_ts,
              time_to_power,
              calories_override=None,
              positions=None,            # None = keine GPS-Positionen
              altitude_override=None,    # z.B. 100.0 für flach; None = weglassen
              summary=None,              # dict von summarize_for_connect(...)
              notes_text=None):          # zusätzlicher Text (z.B. "Indoor | TE 3.4")
    """
    Schreibt eine Garmin-kompatible TCX.
    - rows: [(ts, hr, cad, spd[m/s])...]
    - time_to_power: {ts: watt}
    - calories_override: int/None  -> <Calories> in Lap
    - positions: [(lat,lon)] oder None
    - altitude_override: konstante Höhe (m) oder None
    - summary: Ergebnis von summarize_for_connect(...) für Lap-Distanz/MaxSpeed & Notes
    - notes_text: optionaler Zusatztext für <Notes>
    """
    def iso8601(ts):
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=dt.timezone.utc)
        return ts.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # --- Namespaces ---
    NS = {
        "tcx": "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2",
        "xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "ext": "http://www.garmin.com/xmlschemas/ActivityExtension/v2",
    }
    ET.register_namespace("",   NS["tcx"])  # default
    ET.register_namespace("xsi", NS["xsi"])
    ET.register_namespace("ext", NS["ext"])

    # --- Root ---
    tdb = ET.Element("{%s}TrainingCenterDatabase" % NS["tcx"], {
        "{%s}schemaLocation" % NS["xsi"]:
        "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 "
        "http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd"
    })
    activities = ET.SubElement(tdb, "{%s}Activities" % NS["tcx"])
    act = ET.SubElement(activities, "{%s}Activity" % NS["tcx"], {"Sport": "Biking"})
    ET.SubElement(act, "{%s}Id" % NS["tcx"]).text = iso8601(start_ts)

    # --- Lap ---
    lap = ET.SubElement(act, "{%s}Lap" % NS["tcx"], {"StartTime": iso8601(start_ts)})
    total_secs = int((rows[-1][0] - rows[0][0]).total_seconds())
    ET.SubElement(lap, "{%s}TotalTimeSeconds" % NS["tcx"]).text = str(total_secs)
    ET.SubElement(lap, "{%s}Calories" % NS["tcx"]).text = str(0 if calories_override is None else int(calories_override))
    if summary is not None:
        ET.SubElement(lap, "{%s}DistanceMeters" % NS["tcx"]).text = f"{summary['distance_m']:.1f}"
        ET.SubElement(lap, "{%s}MaximumSpeed"   % NS["tcx"]).text = f"{summary['v_max']:.3f}"
    ET.SubElement(lap, "{%s}Intensity" % NS["tcx"]).text = "Active"
    ET.SubElement(lap, "{%s}TriggerMethod" % NS["tcx"]).text = "Manual"

    track = ET.SubElement(lap, "{%s}Track" % NS["tcx"])

    # --- Trackpoints: Zeit, (Höhe), (Position), Distanz, HR, Cad, Power ---
    dist_m = 0.0
    last_ts = rows[0][0]
    for i, (ts, hr, cad, spd) in enumerate(rows):
        tp = ET.SubElement(track, "{%s}Trackpoint" % NS["tcx"])
        ET.SubElement(tp, "{%s}Time" % NS["tcx"]).text = iso8601(ts)

        if altitude_override is not None:
            ET.SubElement(tp, "{%s}AltitudeMeters" % NS["tcx"]).text = f"{float(altitude_override):.1f}"

        if positions is not None:
            lat, lon = positions[i]
            pos = ET.SubElement(tp, "{%s}Position" % NS["tcx"])
            ET.SubElement(pos, "{%s}LatitudeDegrees"  % NS["tcx"]).text = f"{lat:.7f}"
            ET.SubElement(pos, "{%s}LongitudeDegrees" % NS["tcx"]).text = f"{lon:.7f}"

        # Distanz integrieren aus spd (m/s)
        if i > 0:
            dt_s = (ts - last_ts).total_seconds()
            v = float(spd or 0.0)
            if dt_s > 0 and v > 0:
                dist_m += v * dt_s
        last_ts = ts
        ET.SubElement(tp, "{%s}DistanceMeters" % NS["tcx"]).text = f"{dist_m:.1f}"

        if hr is not None:
            hrm = ET.SubElement(tp, "{%s}HeartRateBpm" % NS["tcx"])
            ET.SubElement(hrm, "{%s}Value" % NS["tcx"]).text = str(int(hr))

        if cad is not None:
            ET.SubElement(tp, "{%s}Cadence" % NS["tcx"]).text = str(int(cad))

        # Power (TPX/Watts)
        p = time_to_power.get(ts)
        if p is not None:
            ext = ET.SubElement(tp, "{%s}Extensions" % NS["tcx"])
            tpx = ET.SubElement(ext, "{%s}TPX" % NS["ext"])
            ET.SubElement(tpx, "{%s}Watts" % NS["ext"]).text = str(int(round(p)))

    # --- Creator (macht Garmin toleranter) ---
    creator = ET.SubElement(act, "{%s}Creator" % NS["tcx"], {
        "{%s}type" % NS["xsi"]: "Device_t"
    })
    ET.SubElement(creator, "{%s}Name" % NS["tcx"]).text = "TrainMind FIT Rebuilder"
    ET.SubElement(creator, "{%s}UnitId" % NS["tcx"]).text = "0"
    ET.SubElement(creator, "{%s}ProductID" % NS["tcx"]).text = "0"
    ver = ET.SubElement(creator, "{%s}Version" % NS["tcx"])
    ET.SubElement(ver, "{%s}VersionMajor" % NS["tcx"]).text = "1"
    ET.SubElement(ver, "{%s}VersionMinor" % NS["tcx"]).text = "0"

    # --- Notes: Kennzahlen als Text anhängen ---
    if summary is not None:
        avg_kmh = summary['avg_v'] * 3.6
        mov_kmh = summary['avg_v_moving'] * 3.6
        dist_km = summary['distance_m'] / 1000.0
        auto = (f"Dist {dist_km:.2f} km | Avg {avg_kmh:.1f} km/h "
                f"(moving {mov_kmh:.1f}) | NP {summary['NP']:.0f} W | "
                f"20min {summary['P20']:.0f} W | IF {summary['IF']:.3f} | "
                f"TSS {summary['TSS']:.1f}")
        ET.SubElement(act, "{%s}Notes" % NS["tcx"]).text = (notes_text + " | " if notes_text else "") + auto
    elif notes_text:
        ET.SubElement(act, "{%s}Notes" % NS["tcx"]).text = notes_text

    # --- Schreiben ---
    out_tcx = Path(out_fit_path).with_suffix(".tcx")
    tree = ET.ElementTree(tdb)
    try:
        ET.indent(tree, space="  ")
    except Exception:
        pass
    tree.write(str(out_tcx), encoding="utf-8", xml_declaration=True)
    print("✅ TCX geschrieben:", out_tcx)

def main():
    # === Parameter (gerne anpassen) ===
    FTP_W = 225                 # dein FTP für IF/TSS
    SYSTEM_MASS_KG = 80.0       # Fahrer+Bike+Flaschen
    CDA_M2 = 0.33               # Aerofläche (Hoods ~0.32–0.36)
    CRR = 0.004                 # Rollwiderstand
    RHO = 1.225                 # Luftdichte
    DRIVE_EFF = 0.975           # Antriebswirkungsgrad
    SEED = 1234                 # Reproduzierbarkeit

    # HR/Cadence Jitter/Interpolation
    HR_JITTER_BPM = 1.0
    CAD_JITTER_RPM = 2.0
    CAD_EXTRA_JITTER = 1.0      # 0.0 = aus

    # Optional: konstante Höhe (None = keine Höhe schreiben)
    ALT_FLAT = None             # z.B. 100.0 für "flach"

    # Optional: Zusatznotiz (hier könntest du z.B. TE notieren)
    NOTES = "Indoor Ride | TE 3.4"

    print(f"IN_FIT:  {IN_FIT}")
    print(f"Exists? {IN_FIT.exists()}")

    # 1) Originaldaten lesen
    start_ts, rows = load_hr_cad_speed(IN_FIT)

    # 2) HR-/Cadence-Lücken füllen + leichte Variation
    rows = fill_missing_hr_and_cadence(
        rows,
        hr_jitter_bpm=HR_JITTER_BPM,
        cad_jitter_rpm=CAD_JITTER_RPM,
        cad_extra_jitter_everywhere=CAD_EXTRA_JITTER,
        seed=SEED,
    )

    # 3) Power-Serie gemäß Segmentplan bauen (auf die gefüllten rows gemappt)
    time_to_power, _ = build_power_series(rows, start_ts)

    # 4) Geschwindigkeit aus Leistung (flach) ableiten und glätten
    rows = apply_speed_from_power(
        rows,
        time_to_power,
        mass_kg=SYSTEM_MASS_KG,
        cda_m2=CDA_M2,
        crr=CRR,
        rho=RHO,
        drivetrain_eff=DRIVE_EFF,
        grade=0.0,
        smooth_window_s=5,
    )

    # 5) Zusammenfassung/Metriken (Distanz/Ø-Speed, NP/IF/TSS, 20-min-Power)
    summary = summarize_for_connect(rows, time_to_power, ftp_w=FTP_W)

    # 6) Kalorien grob schätzen
    kcal = estimate_kcal(time_to_power, eff_metabolic=0.24)

    # 7) TCX schreiben (ohne GPS), inkl. Distanz/MaxSpeed/Notes
    write_tcx(
        OUT_FIT,
        rows,
        start_ts,
        time_to_power,
        calories_override=kcal,
        positions=None,                 # keine GPS-Positionen
        altitude_override=ALT_FLAT,     # None oder z.B. 100.0
        summary=summary,
        notes_text=NOTES,
    )

    # kurze Ausgabe
    km = summary["distance_m"] / 1000.0
    print(f"✅ TCX geschrieben: {OUT_FIT.with_suffix('.tcx')}")
    print(
        f"Dist {km:.2f} km | Avg {summary['avg_v']*3.6:.1f} km/h "
        f"(moving {summary['avg_v_moving']*3.6:.1f}) | "
        f"NP {summary['NP']:.0f} W | 20min {summary['P20']:.0f} W | "
        f"IF {summary['IF']:.3f} | TSS {summary['TSS']:.1f}"
    )


if __name__ == "__main__":
    main()

