import { useEffect, useMemo, useState } from "react";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { apiFetch } from "../api";
import { API_BASE_URL, MAP_MAX_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "../config";

type GeoPoint = {
  latitude_deg: number;
  longitude_deg: number;
};

type RouteGeoPoint = GeoPoint & {
  distance_m?: number;
  altitude_m?: number | null;
  grade_pct?: number | null;
};

type ProfilePoint = {
  distance_m: number;
  altitude_m: number;
};

type ClimbCompareItem = {
  id: number;
  name: string;
  notes: string | null;
  location_label: string | null;
  search_tolerance_m: number;
  start_point: GeoPoint;
  via_point: GeoPoint;
  end_point: GeoPoint;
  representative_activity: {
    id: number;
    name: string;
    started_at: string | null;
  } | null;
  summary: {
    distance_m: number | null;
    ascent_m: number | null;
    descent_m: number | null;
    net_gain_m?: number | null;
    average_grade_pct?: number | null;
    start_altitude_m?: number | null;
    end_altitude_m?: number | null;
  };
  route_points: RouteGeoPoint[];
  profile_points: ProfilePoint[];
  created_at: string | null;
  updated_at: string | null;
};

type ClimbCompareResponse = {
  map_center: GeoPoint;
  compares: ClimbCompareItem[];
};

type ClimbCompareCheckMatch = {
  activity_id: number;
  activity_name: string;
  started_at: string | null;
  provider: string | null;
  sport: string | null;
  score: number | null;
  moving_time_s: number | null;
  average_speed_kmh: number | null;
  average_power_w: number | null;
  summary: {
    distance_m: number | null;
    ascent_m: number | null;
    descent_m: number | null;
    net_gain_m?: number | null;
    average_grade_pct?: number | null;
    start_altitude_m?: number | null;
    end_altitude_m?: number | null;
  };
  delta_to_reference: {
    distance_m: number | null;
    ascent_m: number | null;
  };
  matched_points?: {
    start_point?: GeoPoint | null;
    via_point?: GeoPoint | null;
    end_point?: GeoPoint | null;
  };
  is_reference_activity: boolean;
};

type ClimbCompareCheckResult = {
  status: string;
  message?: string | null;
  compare?: ClimbCompareItem | null;
  checked_total: number;
  matched_total: number;
  matches: ClimbCompareCheckMatch[];
};

type ClimbCompareCheckJob = {
  status: string;
  compare_id: number;
  compare_name?: string | null;
  checked_current: number;
  checked_total: number;
  current_activity_name?: string | null;
  progress_percent: number;
  version: number;
  message?: string | null;
  result?: ClimbCompareCheckResult | null;
  error?: string | null;
};

function pointToTuple(point: GeoPoint): LatLngTuple {
  return [point.latitude_deg, point.longitude_deg];
}

function gradeColor(gradePct: number | null | undefined): string {
  if (gradePct == null) return "#1f8b6f";
  if (gradePct < 2) return "#4ab876";
  if (gradePct < 5) return "#c6c849";
  if (gradePct < 8) return "#ef9950";
  return "#d45f43";
}

function buildColoredRouteSegments(points: RouteGeoPoint[]): Array<{ positions: LatLngTuple[]; color: string }> {
  const segments: Array<{ positions: LatLngTuple[]; color: string }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    segments.push({
      positions: [pointToTuple(previous), pointToTuple(current)],
      color: gradeColor(current.grade_pct ?? previous.grade_pct ?? null),
    });
  }
  return segments;
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

function formatDistanceMeters(value: number | null): string {
  if (value == null) return "-";
  return `${(value / 1000).toFixed(1)} km`;
}

function formatDurationSeconds(value: number | null): string {
  if (value == null || value <= 0) return "-";
  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pointLabel(index: number): string {
  if (index === 0) return "Start";
  if (index === 1) return "Zwischenpunkt";
  return "Ende";
}

function buildProfileSvgPoints(points: ProfilePoint[], width = 760, height = 180): string | null {
  if (points.length < 2) return null;
  const minDistance = Math.min(...points.map((point) => point.distance_m));
  const maxDistance = Math.max(...points.map((point) => point.distance_m));
  const minAltitude = Math.min(...points.map((point) => point.altitude_m));
  const maxAltitude = Math.max(...points.map((point) => point.altitude_m));
  const distanceSpan = Math.max(1, maxDistance - minDistance);
  const altitudeSpan = Math.max(1, maxAltitude - minAltitude);
  return points
    .map((point) => {
      const x = ((point.distance_m - minDistance) / distanceSpan) * width;
      const y = height - ((point.altitude_m - minAltitude) / altitudeSpan) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildProfileAreaPath(points: ProfilePoint[], width = 760, height = 180): string | null {
  const line = buildProfileSvgPoints(points, width, height);
  if (!line || points.length < 2) return null;
  const coords = line.split(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  return `M ${line.replace(/ /g, " L ")} L ${last.split(",")[0]} ${height.toFixed(1)} L ${first.split(",")[0]} ${height.toFixed(1)} Z`;
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

function MapPicker({
  canPick,
  onPick,
}: {
  canPick: boolean;
  onPick: (point: LatLngTuple) => void;
}) {
  useMapEvents({
    click(event) {
      if (!canPick) return;
      onPick([event.latlng.lat, event.latlng.lng]);
    },
  });

  return null;
}

export function ClimbComparePage() {
  const [data, setData] = useState<ClimbCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [checkJob, setCheckJob] = useState<ClimbCompareCheckJob | null>(null);
  const [checkOverlayOpen, setCheckOverlayOpen] = useState(false);
  const [checkResultsByCompareId, setCheckResultsByCompareId] = useState<Record<number, ClimbCompareCheckResult>>({});
  const [draftPoints, setDraftPoints] = useState<LatLngTuple[]>([]);
  const [compareName, setCompareName] = useState("");
  const [compareNotes, setCompareNotes] = useState("");
  const [searchToleranceM, setSearchToleranceM] = useState("50");
  const [selectedCompareId, setSelectedCompareId] = useState<number | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ClimbCompareItem | null>(null);

  async function loadCompares() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare`);
      const payload = await parseJsonSafely<ClimbCompareResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Climb Compare konnte nicht geladen werden.");
      }
      if (!payload || !("compares" in payload)) {
        throw new Error("Leere Antwort beim Laden von Climb Compare.");
      }
      setData(payload);
      setSelectedCompareId((current) => current ?? payload.compares[0]?.id ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  function syncCompare(compare: ClimbCompareItem) {
    setData((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        compares: current.compares.map((item) => (item.id === compare.id ? compare : item)),
      };
    });
  }

  function applyCheckJob(nextJob: ClimbCompareCheckJob) {
    setCheckJob(nextJob);
    if (nextJob.result && nextJob.compare_id != null) {
      setCheckResultsByCompareId((current) => ({
        ...current,
        [nextJob.compare_id]: nextJob.result as ClimbCompareCheckResult,
      }));
      if (nextJob.result.compare) {
        syncCompare(nextJob.result.compare);
      }
    }
    if (nextJob.status === "running") {
      setCheckingId(nextJob.compare_id);
      return;
    }
    setCheckingId(null);
  }

  useEffect(() => {
    void loadCompares();
  }, []);

  useEffect(() => {
    if (checkingId == null || checkJob?.status !== "running") {
      return undefined;
    }

    let cancelled = false;

    const pollJob = async () => {
      try {
        const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/${checkingId}/check-rides/status`);
        const payload = await parseJsonSafely<ClimbCompareCheckJob | { detail?: string }>(response);
        if (!response.ok) {
          throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Ride-Prüfung konnte nicht aktualisiert werden.");
        }
        if (!cancelled && payload && "status" in payload) {
          applyCheckJob(payload);
        }
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setCheckJob((current) => ({
          ...(current ?? {
            status: "error",
            compare_id: checkingId,
            checked_current: 0,
            checked_total: 0,
            progress_percent: 0,
            version: 0,
          }),
          status: "error",
          error: nextError instanceof Error ? nextError.message : "Unbekannter Fehler",
        }));
        setCheckingId(null);
      }
    };

    void pollJob();
    const interval = window.setInterval(() => {
      void pollJob();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [checkJob?.status, checkingId]);

  const selectedCompare = useMemo(
    () => data?.compares.find((row) => row.id === selectedCompareId) ?? data?.compares[0] ?? null,
    [data, selectedCompareId],
  );

  const selectedRoutePoints = useMemo(
    () => (draftPoints.length ? [] : (selectedCompare?.route_points ?? []).map(pointToTuple)),
    [draftPoints, selectedCompare],
  );
  const coloredRouteSegments = useMemo(
    () => (draftPoints.length ? [] : buildColoredRouteSegments(selectedCompare?.route_points ?? [])),
    [draftPoints, selectedCompare],
  );

  const selectedPointMarkers = useMemo(() => {
    if (draftPoints.length) return draftPoints;
    if (!selectedCompare) return [];
    return [selectedCompare.start_point, selectedCompare.via_point, selectedCompare.end_point].map(pointToTuple);
  }, [draftPoints, selectedCompare]);

  const mapFocusPoints = useMemo(() => {
    if (selectedRoutePoints.length) return selectedRoutePoints;
    if (selectedPointMarkers.length) return selectedPointMarkers;
    if (data?.map_center) return [pointToTuple(data.map_center)];
    return [[47.61, 7.66] as LatLngTuple];
  }, [data, selectedPointMarkers, selectedRoutePoints]);

  const profileLine = useMemo(() => buildProfileSvgPoints(selectedCompare?.profile_points ?? []), [selectedCompare]);
  const profileArea = useMemo(() => buildProfileAreaPath(selectedCompare?.profile_points ?? []), [selectedCompare]);
  const selectedCheckResult = useMemo(
    () => (selectedCompareId != null ? (checkResultsByCompareId[selectedCompareId] ?? null) : null),
    [checkResultsByCompareId, selectedCompareId],
  );

  function handleMapPick(point: LatLngTuple) {
    setSaveMessage(null);
    setSaveError(null);
    setDraftPoints((current) => {
      if (current.length >= 3) return current;
      return [...current, point];
    });
  }

  function resetDraft() {
    setDraftPoints([]);
    setSaveMessage(null);
    setSaveError(null);
  }

  function removeLastDraftPoint() {
    setDraftPoints((current) => current.slice(0, -1));
    setSaveMessage(null);
    setSaveError(null);
  }

  async function saveCompare() {
    if (draftPoints.length !== 3) {
      setSaveError("Bitte zuerst Start, Zwischenpunkt und Ende auf der Karte setzen.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: compareName.trim() || null,
          notes: compareNotes.trim() || null,
          search_tolerance_m: Number(searchToleranceM || "50"),
          start_point: tupleToPoint(draftPoints[0]),
          via_point: tupleToPoint(draftPoints[1]),
          end_point: tupleToPoint(draftPoints[2]),
        }),
      });
      const payload = await parseJsonSafely<{ compare: ClimbCompareItem; message?: string } | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Climb Compare konnte nicht gespeichert werden.");
      }
      if (!payload || !("compare" in payload)) {
        throw new Error("Leere Antwort beim Speichern.");
      }
      setData((current) => ({
        map_center: current?.map_center ?? tupleToPoint(draftPoints[1]),
        compares: [payload.compare, ...(current?.compares ?? [])],
      }));
      setSelectedCompareId(payload.compare.id);
      setDraftPoints([]);
      setCompareName("");
      setCompareNotes("");
      setSearchToleranceM("50");
      setSaveMessage(payload.message ?? "Climb Compare gespeichert.");
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function checkRides(compareId: number) {
    setCheckingId(compareId);
    setSaveError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/${compareId}/check-rides`, {
        method: "POST",
      });
      const payload = await parseJsonSafely<{ message?: string } | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Ride-Prüfung konnte nicht gestartet werden.");
      }
      setSaveMessage(typeof payload === "object" && payload && "message" in payload ? payload.message ?? "Ride-Prüfung folgt später." : "Ride-Prüfung folgt später.");
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    } finally {
      setCheckingId(null);
    }
  }

  void checkRides;

  async function startRideCheck(compareId: number) {
    const compare = data?.compares.find((item) => item.id === compareId) ?? null;
    setCheckingId(compareId);
    setSaveError(null);
    setSaveMessage(null);
    setSelectedCompareId(compareId);
    setCheckOverlayOpen(true);
    setCheckJob({
      status: "running",
      compare_id: compareId,
      compare_name: compare?.name ?? null,
      checked_current: 0,
      checked_total: 0,
      current_activity_name: null,
      progress_percent: 0,
      version: 0,
      message: "Pruefung wird gestartet...",
      result: null,
      error: null,
    });
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/${compareId}/check-rides`, {
        method: "POST",
      });
      const payload = await parseJsonSafely<ClimbCompareCheckJob | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Ride-Pruefung konnte nicht gestartet werden.");
      }
      if (payload && "status" in payload) {
        applyCheckJob(payload);
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unbekannter Fehler";
      setSaveError(message);
      setCheckJob((current) => ({
        ...(current ?? {
          status: "error",
          compare_id: compareId,
          checked_current: 0,
          checked_total: 0,
          progress_percent: 0,
          version: 0,
        }),
        status: "error",
        error: message,
      }));
      setCheckOverlayOpen(true);
      setCheckingId(null);
    }
  }

  async function deleteCompare() {
    if (!deleteCandidate || deleting) return;
    setDeleting(true);
    setSaveError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/${deleteCandidate.id}`, {
        method: "DELETE",
      });
      const payload = await parseJsonSafely<{ name?: string; detail?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.detail || "Climb Compare konnte nicht gelöscht werden.");
      }
      let nextSelectedId = selectedCompareId;
      setData((current) => {
        if (!current) {
          nextSelectedId = null;
          return current;
        }
        const nextCompares = current.compares.filter((compare) => compare.id !== deleteCandidate.id);
        if (selectedCompareId === deleteCandidate.id) {
          nextSelectedId = nextCompares[0]?.id ?? null;
        }
        return { ...current, compares: nextCompares };
      });
      setCheckResultsByCompareId((current) => {
        const nextResults = { ...current };
        delete nextResults[deleteCandidate.id];
        return nextResults;
      });
      setSelectedCompareId(nextSelectedId ?? null);
      setDeleteCandidate(null);
      setSaveMessage(`Climb Compare gelöscht: ${payload?.name || deleteCandidate.name}`);
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Aktivitäten</p>
        <h1>Climb Compare</h1>
        <p className="lead">
          Lege einen Anstieg über drei Punkte fest: Start, Zwischenpunkt und Ende. Die Definition wird gespeichert, und wenn bereits passende Rides existieren, leiten wir daraus direkt Distanz, Höhenmeter und ein erstes Profil ab. Als Referenz zählen dabei nur Segmente mit klarem Nettoanstieg, keine Abfahrten.
        </p>
      </div>

      <div className="climb-compare-layout">
        <div className="card climb-compare-editor">
          <div className="section-title-row">
            <h2>Neuen Compare anlegen</h2>
          </div>
          <p className="training-note">
            Klicke auf der Karte in dieser Reihenfolge: <strong>Start</strong>, <strong>Zwischenpunkt</strong>, <strong>Ende</strong>. Der Zwischenpunkt hilft uns später, falsche Schleifen oder ähnliche Routen besser auszusortieren. Für die Referenz werden nur bergauf führende Segmente akzeptiert.
          </p>

          <div className="climb-compare-point-list">
            {[0, 1, 2].map((index) => {
              const point = draftPoints[index];
              return (
                <div key={index} className={`climb-compare-point-pill ${point ? "is-set" : ""}`}>
                  <strong>{pointLabel(index)}</strong>
                  <span>{point ? `${point[0].toFixed(5)}, ${point[1].toFixed(5)}` : "Noch nicht gesetzt"}</span>
                </div>
              );
            })}
          </div>

          <div className="climb-compare-form-grid">
            <label className="settings-label">
              Name des Anstiegs
              <input className="settings-input" value={compareName} onChange={(event) => setCompareName(event.target.value)} placeholder="z. B. Kandertal Nordrampe" />
            </label>
            <label className="settings-label">
              Toleranz für spätere Suche (m)
              <input className="settings-input" type="number" min="15" max="500" step="5" value={searchToleranceM} onChange={(event) => setSearchToleranceM(event.target.value)} />
            </label>
            <label className="settings-label climb-compare-span-2">
              Notiz
              <textarea className="settings-input climb-compare-textarea" value={compareNotes} onChange={(event) => setCompareNotes(event.target.value)} placeholder="optional: warum dieser Anstieg interessant ist, welche Richtung gemeint ist, Besonderheiten ..." />
            </label>
          </div>

          {saveMessage ? <p className="info-text">{saveMessage}</p> : null}
          {saveError ? <p className="error-text">{saveError}</p> : null}

          <div className="settings-actions">
            <button className="primary-button" type="button" onClick={() => void saveCompare()} disabled={saving || draftPoints.length !== 3}>
              {saving ? "Speichere..." : "Climb Compare speichern"}
            </button>
            <button className="secondary-button" type="button" onClick={removeLastDraftPoint} disabled={!draftPoints.length || saving}>
              Letzten Punkt entfernen
            </button>
            <button className="secondary-button" type="button" onClick={resetDraft} disabled={!draftPoints.length || saving}>
              Punkte zurücksetzen
            </button>
          </div>
        </div>

        <div className="card climb-compare-map-card">
          <div className="section-title-row">
            <h2>Karte</h2>
          </div>
          <MapContainer className="climb-compare-map" center={mapFocusPoints[0]} zoom={13} scrollWheelZoom>
            <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} />
            <MapViewport points={mapFocusPoints} />
            <MapPicker canPick={draftPoints.length < 3} onPick={handleMapPick} />
            {coloredRouteSegments.length
              ? coloredRouteSegments.map((segment, index) => (
                  <Polyline key={`${segment.color}-${index}`} positions={segment.positions} pathOptions={{ color: segment.color, weight: 7, opacity: 0.92 }} />
                ))
              : selectedRoutePoints.length >= 2
                ? <Polyline positions={selectedRoutePoints} pathOptions={{ color: "#1f8b6f", weight: 6, opacity: 0.9 }} />
                : null}
            {!draftPoints.length && selectedCompare ? (
              <>
                <CircleMarker center={pointToTuple(selectedCompare.start_point)} radius={8} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#1f8b6f", fillOpacity: 1 }} />
                <CircleMarker center={pointToTuple(selectedCompare.via_point)} radius={8} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#f3a34f", fillOpacity: 1 }} />
                <CircleMarker center={pointToTuple(selectedCompare.end_point)} radius={8} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#d45f43", fillOpacity: 1 }} />
              </>
            ) : null}
            {draftPoints.map((point, index) => (
              <CircleMarker
                key={`${point[0]}-${point[1]}-${index}`}
                center={point}
                radius={8}
                pathOptions={{
                  color: "#ffffff",
                  weight: 3,
                  fillColor: index === 0 ? "#1f8b6f" : index === 1 ? "#f3a34f" : "#d45f43",
                  fillOpacity: 1,
                }}
              />
            ))}
          </MapContainer>
          {!draftPoints.length && selectedCompare?.route_points?.length ? (
            <div className="climb-compare-grade-legend">
              <span><i style={{ background: "#4ab876" }} /> leicht</span>
              <span><i style={{ background: "#c6c849" }} /> moderat</span>
              <span><i style={{ background: "#ef9950" }} /> steil</span>
              <span><i style={{ background: "#d45f43" }} /> sehr steil</span>
            </div>
          ) : null}
          <div className="training-note">
            {draftPoints.length < 3
              ? `Noch ${3 - draftPoints.length} Punkt${3 - draftPoints.length === 1 ? "" : "e"} setzen.`
              : "Alle drei Punkte sind gesetzt. Du kannst jetzt speichern."}
          </div>
        </div>
      </div>

      <div className="climb-compare-detail-grid">
        <div className="card">
          <div className="section-title-row">
            <h2>Ausgewählter Climb</h2>
          </div>
          {selectedCompare ? (
            <div className="climb-compare-detail">
              <div className="climb-compare-summary-grid">
                <div className="climb-compare-summary-card">
                  <span>Name</span>
                  <strong>{selectedCompare.name}</strong>
                </div>
                <div className="climb-compare-summary-card">
                  <span>Lage</span>
                  <strong>{selectedCompare.location_label ?? "-"}</strong>
                </div>
                <div className="climb-compare-summary-card">
                  <span>Referenzdistanz</span>
                  <strong>{formatDistanceMeters(selectedCompare.summary.distance_m)}</strong>
                </div>
                <div className="climb-compare-summary-card">
                  <span>Anstieg</span>
                  <strong>{formatNumber(selectedCompare.summary.ascent_m, 0, " m")}</strong>
                </div>
                <div className="climb-compare-summary-card">
                  <span>Ø Steigung</span>
                  <strong>{formatNumber(selectedCompare.summary.average_grade_pct ?? null, 1, " %")}</strong>
                </div>
                <div className="climb-compare-summary-card">
                  <span>Toleranz</span>
                  <strong>{formatNumber(selectedCompare.search_tolerance_m, 0, " m")}</strong>
                </div>
              </div>

              {selectedCompare.representative_activity ? (
                <p className="training-note">
                  Referenzfahrt: <strong>{selectedCompare.representative_activity.name}</strong> vom {formatDateTime(selectedCompare.representative_activity.started_at)}
                </p>
              ) : (
                <p className="training-note">Für diesen Climb ist noch keine passende Referenzfahrt gefunden worden. Die Definition ist aber bereits gespeichert.</p>
              )}

              {selectedCompare.notes ? <p className="training-note">{selectedCompare.notes}</p> : null}

              {profileLine && profileArea ? (
                <div className="climb-compare-profile-card">
                  <div className="section-title-row">
                    <h3>Profil</h3>
                  </div>
                  <svg className="climb-compare-profile" viewBox="0 0 760 180" preserveAspectRatio="none" role="img" aria-label="Höhenprofil des ausgewählten Climb Compare">
                    <path d={profileArea} fill="rgba(31, 139, 111, 0.16)" />
                    <polyline points={profileLine} fill="none" stroke="#1f8b6f" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                  <div className="climb-compare-profile-legend">
                    <span>{formatDistanceMeters(selectedCompare.summary.distance_m)} Segmentlänge</span>
                    <span>{formatNumber(selectedCompare.summary.ascent_m, 0, " m")} Anstieg</span>
                    <span>{formatNumber(selectedCompare.summary.start_altitude_m ?? null, 0, " m")} Start</span>
                    <span>{formatNumber(selectedCompare.summary.end_altitude_m ?? null, 0, " m")} Ziel</span>
                  </div>
                </div>
              ) : null}
              <div className="climb-compare-check-results">
                <div className="section-title-row">
                  <h3>Treffer in allen Rides</h3>
                </div>
                {selectedCheckResult ? (
                  selectedCheckResult.matches.length ? (
                    <div className="climb-compare-match-list">
                      {selectedCheckResult.matches.map((match) => (
                        <article key={match.activity_id} className="climb-compare-match-card">
                          <div className="climb-compare-match-head">
                            <div>
                              <strong>{match.activity_name}</strong>
                              <span>{formatDateTime(match.started_at)}</span>
                            </div>
                            {match.is_reference_activity ? <span className="climb-compare-match-badge">Referenz</span> : null}
                          </div>
                          <div className="climb-compare-match-metrics">
                            <span>Zeit: {formatDurationSeconds(match.moving_time_s)}</span>
                            <span>Ø Tempo: {formatNumber(match.average_speed_kmh, 1, " km/h")}</span>
                            <span>Ø Watt: {formatNumber(match.average_power_w, 0, " W")}</span>
                            <span>Distanz: {formatDistanceMeters(match.summary.distance_m)}</span>
                            <span>Anstieg: {formatNumber(match.summary.ascent_m, 0, " m")}</span>
                            <span>Ø Steigung: {formatNumber(match.summary.average_grade_pct ?? null, 1, " %")}</span>
                            <span>Delta Distanz: {formatNumber(match.delta_to_reference.distance_m, 0, " m")}</span>
                            <span>Delta Anstieg: {formatNumber(match.delta_to_reference.ascent_m, 0, " m")}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="training-note">In den geprüften {selectedCheckResult.checked_total} Rides wurde noch kein passender Anstieg gefunden.</p>
                  )
                ) : (
                  <p className="training-note">Mit "Rides prüfen" scannen wir aktuell alle Rides und zeigen dir hier die Treffer an.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="training-note">Noch kein Climb Compare gespeichert. Lege oben deinen ersten Anstieg an.</p>
          )}
        </div>

        <div className="card">
          <div className="section-title-row">
            <h2>Gespeicherte Climb Compares</h2>
          </div>
          <p className="training-note">Der Check läuft jetzt über alle Rides. Währenddessen zeigen wir den Fortschritt mit aktuellem Ride-Namen in einem Overlay an.</p>
          {loading ? <p>Lade Climb Compares...</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
          {!loading && !error && !data?.compares.length ? <p className="training-note">Noch keine gespeicherten Climb Compares vorhanden.</p> : null}
          <div className="climb-compare-list">
            {data?.compares.map((compare) => (
              <article key={compare.id} className={`climb-compare-list-card ${selectedCompare?.id === compare.id ? "is-selected" : ""}`}>
                <div className="climb-compare-list-head">
                  <div>
                    <h3>{compare.name}</h3>
                    <p>{compare.location_label ?? "Ohne Lageinfo"}</p>
                  </div>
                  <div className="climb-compare-list-head-actions">
                    <span>{formatDateTime(compare.created_at)}</span>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label={`Climb Compare ${compare.name} löschen`}
                      title="Climb Compare löschen"
                      onClick={() => setDeleteCandidate(compare)}
                    >
                      🗑
                    </button>
                  </div>
                </div>
                <div className="climb-compare-list-metrics">
                  <span>Distanz: {formatDistanceMeters(compare.summary.distance_m)}</span>
                  <span>Anstieg: {formatNumber(compare.summary.ascent_m, 0, " m")}</span>
                  <span>Ø Steigung: {formatNumber(compare.summary.average_grade_pct ?? null, 1, " %")}</span>
                  <span>Toleranz: {formatNumber(compare.search_tolerance_m, 0, " m")}</span>
                </div>
                {checkResultsByCompareId[compare.id] ? (
                  <p className="training-note climb-compare-card-note">
                    Letzter Check: {checkResultsByCompareId[compare.id]?.matched_total ?? 0} Treffer in {checkResultsByCompareId[compare.id]?.checked_total ?? 0} Rides.
                  </p>
                ) : null}
                <div className="settings-actions">
                  <button className="secondary-button" type="button" onClick={() => setSelectedCompareId(compare.id)}>
                    Auf Karte zeigen
                  </button>
                  <button className="primary-button" type="button" onClick={() => void startRideCheck(compare.id)} disabled={checkingId !== null}>
                    {checkingId === compare.id ? "Prüfe..." : checkingId !== null ? "Bitte warten..." : "Rides prüfen"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      {checkOverlayOpen && checkJob ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Rides prüfen"
          onClick={() => (checkingId !== null ? null : setCheckOverlayOpen(false))}
        >
          <div className="confirm-card climb-compare-check-card" onClick={(event) => event.stopPropagation()}>
            <h2>Rides prüfen</h2>
            <p>
              {checkJob.compare_name ? (
                <>
                  Climb Compare <strong>{checkJob.compare_name}</strong>
                </>
              ) : (
                "Climb Compare"
              )}
            </p>
            <div className="climb-compare-check-progress">
              <div className="climb-compare-check-progress-bar">
                <span style={{ width: `${Math.max(0, Math.min(100, checkJob.progress_percent || 0))}%` }} />
              </div>
              <div className="climb-compare-check-progress-meta">
                <strong>
                  {checkJob.checked_current} / {checkJob.checked_total} geprüft
                </strong>
                <span>{checkJob.current_activity_name ?? checkJob.message ?? "Vorbereitung..."}</span>
              </div>
            </div>
            {checkJob.result ? (
              <div className="climb-compare-check-summary">
                <strong>{checkJob.result.matched_total} Treffer gefunden</strong>
                <span>Geprüft: {checkJob.result.checked_total} Rides</span>
              </div>
            ) : null}
            {checkJob.error ? <p className="error-text">{checkJob.error}</p> : null}
            <div className="confirm-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={checkingId !== null}
                onClick={() => setCheckOverlayOpen(false)}
              >
                {checkingId !== null ? "Prüfe..." : "Schließen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Climb Compare löschen" onClick={() => (deleting ? null : setDeleteCandidate(null))}>
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <h2>Climb Compare löschen?</h2>
            <p>
              Willst du <strong>{deleteCandidate.name}</strong> wirklich löschen?
            </p>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" disabled={deleting} onClick={() => setDeleteCandidate(null)}>
                Abbrechen
              </button>
              <button className="primary-button" type="button" disabled={deleting} onClick={() => void deleteCompare()}>
                {deleting ? "Lösche..." : "Jetzt löschen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
