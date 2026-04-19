import { useEffect, useMemo, useState } from "react";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { API_BASE_URL, MAP_MAX_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "../config";

type GeoPoint = {
  latitude_deg: number;
  longitude_deg: number;
};

type FindRidesMatch = {
  activity_id: number;
  activity_name: string;
  started_at: string | null;
  provider: string | null;
  sport: string | null;
  distance_m: number | null;
  duration_s: number | null;
  avg_power_w: number | null;
  avg_hr_bpm: number | null;
  closest_distance_m: number | null;
  route_distance_m: number | null;
  route_progress_pct: number | null;
  matched_point: GeoPoint | null;
  matched_timestamp: string | null;
};

type FindRidesResult = {
  point: GeoPoint;
  tolerance_m: number;
  limit: number;
  total_ride_total: number;
  candidate_total: number;
  checked_total: number;
  matched_total: number;
  is_limited: boolean;
  message?: string | null;
  matches: FindRidesMatch[];
};

type ClimbCompareListResponse = {
  map_center?: GeoPoint;
};

function pointToTuple(point: GeoPoint): LatLngTuple {
  return [point.latitude_deg, point.longitude_deg];
}

function tupleToPoint(point: LatLngTuple): GeoPoint {
  return { latitude_deg: point[0], longitude_deg: point[1] };
}

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function formatNumber(value: number | null, digits = 0, suffix = ""): string {
  if (value == null) return "-";
  return `${value.toFixed(digits)}${suffix}`;
}

function formatDurationSeconds(value: number | null): string {
  if (value == null || value <= 0) return "-";
  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function MapViewport({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize();
      if (points.length === 1) {
        map.setView(points[0], 13);
      } else {
        map.fitBounds(points as LatLngBoundsExpression, { padding: [26, 26] });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [map, points]);
  return null;
}

function MapPicker({ canPick, onPick }: { canPick: boolean; onPick: (point: LatLngTuple) => void }) {
  useMapEvents({
    click(event) {
      if (canPick) onPick([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

export function FindRidesOnMapPage() {
  const navigate = useNavigate();
  const [mapCenter, setMapCenter] = useState<LatLngTuple>([47.61, 7.66]);
  const [findPoint, setFindPoint] = useState<LatLngTuple | null>(null);
  const [findToleranceM, setFindToleranceM] = useState("50");
  const [pickMode, setPickMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FindRidesResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadMapCenter = async () => {
      try {
        const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare`);
        const payload = await parseJsonSafely<ClimbCompareListResponse>(response);
        if (!response.ok || !payload?.map_center) return;
        if (!cancelled) {
          setMapCenter(pointToTuple(payload.map_center));
        }
      } catch {
        // Fallback center remains active.
      }
    };
    void loadMapCenter();
    return () => {
      cancelled = true;
    };
  }, []);

  const toleranceValue = useMemo(() => {
    const parsed = Number(findToleranceM || "50");
    if (!Number.isFinite(parsed)) return 50;
    return Math.max(15, Math.min(500, parsed));
  }, [findToleranceM]);

  const mapFocusPoints = useMemo(() => (findPoint ? [findPoint] : [mapCenter]), [findPoint, mapCenter]);

  function handleMapPick(point: LatLngTuple) {
    setFindPoint(point);
    setPickMode(false);
    setError(null);
    setResult(null);
  }

  async function findRidesOnMap() {
    if (!findPoint) {
      setError("Bitte zuerst einen Suchpunkt auf der Karte setzen.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/find-rides-on-map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          point: tupleToPoint(findPoint),
          tolerance_m: toleranceValue,
          limit: 500,
        }),
      });
      const payload = await parseJsonSafely<FindRidesResult | { detail?: string }>(response);
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Ride-Suche auf der Karte fehlgeschlagen.");
      if (!payload || !("matches" in payload)) throw new Error("Leere Antwort bei der Karten-Suche.");
      setResult(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Aktivitäten</p>
        <h1>Find Rides on Map</h1>
        <p className="lead">Setze einen Punkt auf der Karte und finde alle Rides, die innerhalb deiner Toleranz daran vorbeifahren.</p>
      </div>

      <div className="climb-compare-layout">
        <div className="card climb-compare-editor">
          <div className="section-title-row">
            <h2>Sucheinstellungen</h2>
          </div>
          <div className="climb-compare-point-list">
            <div className={`climb-compare-point-pill ${findPoint ? "is-set" : ""}`}>
              <strong>Suchpunkt</strong>
              <span>{findPoint ? `${findPoint[0].toFixed(5)}, ${findPoint[1].toFixed(5)}` : "Noch nicht gesetzt"}</span>
            </div>
          </div>
          <div className="climb-compare-form-grid">
            <label className="settings-label">
              Toleranz (m)
              <input
                className="settings-input"
                type="number"
                min="15"
                max="500"
                step="5"
                value={findToleranceM}
                onChange={(event) => setFindToleranceM(event.target.value)}
              />
            </label>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={() => setPickMode(true)} disabled={running}>
              {pickMode ? "Kartenklick erwartet..." : "Punkt auf Karte setzen"}
            </button>
            <button className="primary-button" type="button" onClick={() => void findRidesOnMap()} disabled={running || !findPoint}>
              {running ? "Suche läuft..." : "Rides finden"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setFindPoint(null);
                setResult(null);
                setError(null);
                setPickMode(false);
              }}
              disabled={running || (!findPoint && !result && !error)}
            >
              Zurücksetzen
            </button>
          </div>
          {result ? (
            <div className="climb-compare-find-results">
              <div className="climb-compare-find-summary">
                <span><strong>{result.matched_total}</strong> Treffer</span>
                <span>{result.checked_total} geprüft</span>
                <span>{result.candidate_total} Kandidaten</span>
                <span>{formatNumber(result.tolerance_m, 0, " m")} Toleranz</span>
              </div>
              <p className="training-note">{result.message ?? "Suche abgeschlossen."}</p>
            </div>
          ) : null}
        </div>
        <div className="card climb-compare-map-card">
          <div className="section-title-row"><h2>Karte</h2></div>
          <MapContainer className="climb-compare-map" center={mapFocusPoints[0]} zoom={13} scrollWheelZoom>
            <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} />
            <MapViewport points={mapFocusPoints} />
            <MapPicker canPick={pickMode} onPick={handleMapPick} />
            {findPoint ? <Circle center={findPoint} radius={toleranceValue} pathOptions={{ color: "#2f6fab", weight: 2, opacity: 0.9, fillOpacity: 0.06 }} /> : null}
            {findPoint ? <CircleMarker center={findPoint} radius={9} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#2f6fab", fillOpacity: 1 }} /> : null}
          </MapContainer>
          <div className="training-note">
            {pickMode ? "Klicke jetzt den Suchpunkt auf der Karte." : findPoint ? "Suchpunkt gesetzt." : "Noch kein Suchpunkt gesetzt."}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title-row"><h2>Treffer</h2></div>
        {result?.matches?.length ? (
          <div className="rides-table-wrap climb-compare-results-table-wrap">
            <div className="table-scroll">
              <table className="rides-table">
                <thead>
                  <tr>
                    <th>Start</th>
                    <th>Ride</th>
                    <th>Sport</th>
                    <th>Abstand</th>
                    <th>Routenposition</th>
                    <th>Zeit</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.map((match) => (
                    <tr key={`map-find-${match.activity_id}`} className="climb-compare-match-row" style={{ cursor: "pointer" }} onClick={() => navigate(`/activities/${match.activity_id}`)}>
                      <td>{formatDateTime(match.started_at)}</td>
                      <td>
                        <Link className="climb-compare-match-link" to={`/activities/${match.activity_id}`} onClick={(event) => event.stopPropagation()}>
                          {match.activity_name}
                        </Link>
                      </td>
                      <td>{match.sport ?? "-"}</td>
                      <td>{formatNumber(match.closest_distance_m, 1, " m")}</td>
                      <td>{formatNumber(match.route_progress_pct, 1, " %")}</td>
                      <td>{formatDurationSeconds(match.duration_s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="training-note">Noch keine Suche gestartet oder keine Treffer gefunden.</p>
        )}
      </div>
    </section>
  );
}

