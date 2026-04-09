import { useEffect, useMemo, useState } from "react";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Link, useNavigate } from "react-router-dom";
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

type ClimbCompareCheckMatch = {
  activity_id: number;
  activity_name: string;
  started_at: string | null;
  score: number | null;
  moving_time_s: number | null;
  average_speed_kmh: number | null;
  average_power_w: number | null;
  max_power_w: number | null;
  avg_hr_bpm: number | null;
  summary: {
    distance_m: number | null;
    ascent_m: number | null;
    average_grade_pct?: number | null;
  };
  delta_to_reference: {
    distance_m: number | null;
    ascent_m: number | null;
  };
  is_reference_activity: boolean;
};

type ClimbCompareCheckResult = {
  status: string;
  message?: string | null;
  checked_total: number;
  matched_total: number;
  matches: ClimbCompareCheckMatch[];
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
    average_grade_pct?: number | null;
    start_altitude_m?: number | null;
    end_altitude_m?: number | null;
  };
  route_points: RouteGeoPoint[];
  profile_points: ProfilePoint[];
  search_state: {
    algorithm_version: number;
    last_search_algorithm_version: number | null;
    searched_ride_total: number;
    matched_total: number;
    pending_ride_total: number;
    total_ride_total: number;
    last_checked_at: string | null;
    needs_full_rescan: boolean;
  };
  last_check_result: ClimbCompareCheckResult | null;
  created_at: string | null;
  updated_at: string | null;
};

type ClimbCompareResponse = {
  map_center: GeoPoint;
  compares: ClimbCompareItem[];
};

type MatchSortKey = "started_at" | "name" | "duration" | "avg_power" | "max_power" | "avg_hr" | "distance" | "ascent";
type SortDirection = "asc" | "desc";
type MatchAward = { label: string; tone: "time" | "power" | "hr" };

type ClimbCompareCheckJob = {
  status: string;
  compare_id: number;
  compare_name?: string | null;
  checked_current: number;
  checked_total: number;
  current_activity_name?: string | null;
  progress_percent: number;
  version: number;
  scope?: "new" | "all";
  message?: string | null;
  result?: (ClimbCompareCheckResult & { compare?: ClimbCompareItem | null }) | null;
  error?: string | null;
};

function pointToTuple(point: GeoPoint): LatLngTuple {
  return [point.latitude_deg, point.longitude_deg];
}

function tupleToPoint(point: LatLngTuple): GeoPoint {
  return { latitude_deg: point[0], longitude_deg: point[1] };
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
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function pointLabel(index: number): string {
  return index === 0 ? "Start" : index === 1 ? "Zwischenpunkt" : "Ende";
}

function compareNullableNumbers(left: number | null, right: number | null, direction: SortDirection): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return direction === "asc" ? left - right : right - left;
}

function compareNullableStrings(left: string | null, right: string | null, direction: SortDirection): number {
  const safeLeft = left ?? "";
  const safeRight = right ?? "";
  return direction === "asc" ? safeLeft.localeCompare(safeRight) : safeRight.localeCompare(safeLeft);
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
    .map((point) => `${(((point.distance_m - minDistance) / distanceSpan) * width).toFixed(1)},${(height - (((point.altitude_m - minAltitude) / altitudeSpan) * height)).toFixed(1)}`)
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

function MapPicker({ canPick, onPick }: { canPick: boolean; onPick: (point: LatLngTuple) => void }) {
  useMapEvents({
    click(event) {
      if (canPick) onPick([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

export function ClimbComparePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ClimbCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingCompareId, setEditingCompareId] = useState<number | null>(null);
  const [draftPoints, setDraftPoints] = useState<LatLngTuple[]>([]);
  const [compareName, setCompareName] = useState("");
  const [compareNotes, setCompareNotes] = useState("");
  const [searchToleranceM, setSearchToleranceM] = useState("50");
  const [selectedCompareId, setSelectedCompareId] = useState<number | null>(null);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [checkJob, setCheckJob] = useState<ClimbCompareCheckJob | null>(null);
  const [checkOverlayOpen, setCheckOverlayOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [matchSortKey, setMatchSortKey] = useState<MatchSortKey>("started_at");
  const [matchSortDirection, setMatchSortDirection] = useState<SortDirection>("desc");
  const [renameCandidate, setRenameCandidate] = useState<ClimbCompareItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<ClimbCompareItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadCompares() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare`);
      const payload = await parseJsonSafely<ClimbCompareResponse | { detail?: string }>(response);
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Climb Compare konnte nicht geladen werden.");
      if (!payload || !("compares" in payload)) throw new Error("Leere Antwort beim Laden von Climb Compare.");
      setData(payload);
      setSelectedCompareId((current) => current ?? payload.compares[0]?.id ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  function syncCompare(compare: ClimbCompareItem, insertFirst = false) {
    setData((current) => {
      if (!current) return current;
      const exists = current.compares.some((item) => item.id === compare.id);
      return {
        ...current,
        compares: exists ? current.compares.map((item) => (item.id === compare.id ? compare : item)) : insertFirst ? [compare, ...current.compares] : [...current.compares, compare],
      };
    });
  }

  function startCreate() {
    setEditorMode("create");
    setEditingCompareId(null);
    setDraftPoints([]);
    setCompareName("");
    setCompareNotes("");
    setSearchToleranceM("50");
    setOpenMenuId(null);
    setMenuPosition(null);
    setSaveError(null);
  }

  function startEdit(compare: ClimbCompareItem) {
    setEditorMode("edit");
    setEditingCompareId(compare.id);
    setSelectedCompareId(compare.id);
    setDraftPoints([pointToTuple(compare.start_point), pointToTuple(compare.via_point), pointToTuple(compare.end_point)]);
    setCompareName(compare.name);
    setCompareNotes(compare.notes ?? "");
    setSearchToleranceM(String(compare.search_tolerance_m ?? 50));
    setOpenMenuId(null);
    setMenuPosition(null);
    setSaveError(null);
    setSaveMessage(null);
  }

  function applyCheckJob(nextJob: ClimbCompareCheckJob) {
    setCheckJob(nextJob);
    if (nextJob.result?.compare) syncCompare(nextJob.result.compare);
    setCheckingId(nextJob.status === "running" ? nextJob.compare_id : null);
  }

  useEffect(() => {
    void loadCompares();
  }, []);

  useEffect(() => {
    if (checkingId == null || checkJob?.status !== "running") return undefined;
    let cancelled = false;
    const pollJob = async () => {
      try {
        const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/${checkingId}/check-rides/status`);
        const payload = await parseJsonSafely<ClimbCompareCheckJob | { detail?: string }>(response);
        if (!response.ok) throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Ride-Prüfung konnte nicht aktualisiert werden.");
        if (!cancelled && payload && "status" in payload) applyCheckJob(payload);
      } catch (nextError) {
        if (cancelled) return;
        setCheckJob((current) => ({ ...(current ?? { status: "error", compare_id: checkingId, checked_current: 0, checked_total: 0, progress_percent: 0, version: 0 }), status: "error", error: nextError instanceof Error ? nextError.message : "Unbekannter Fehler" }));
        setCheckingId(null);
      }
    };
    void pollJob();
    const interval = window.setInterval(() => void pollJob(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [checkJob?.status, checkingId]);

  const selectedCompare = useMemo(() => data?.compares.find((row) => row.id === selectedCompareId) ?? data?.compares[0] ?? null, [data, selectedCompareId]);
  const selectedRoutePoints = useMemo(() => (draftPoints.length ? [] : (selectedCompare?.route_points ?? []).map(pointToTuple)), [draftPoints, selectedCompare]);
  const coloredRouteSegments = useMemo(() => (draftPoints.length ? [] : buildColoredRouteSegments(selectedCompare?.route_points ?? [])), [draftPoints, selectedCompare]);
  const selectedPointMarkers = useMemo(() => (draftPoints.length ? draftPoints : selectedCompare ? [selectedCompare.start_point, selectedCompare.via_point, selectedCompare.end_point].map(pointToTuple) : []), [draftPoints, selectedCompare]);
  const mapFocusPoints = useMemo(() => (selectedRoutePoints.length ? selectedRoutePoints : selectedPointMarkers.length ? selectedPointMarkers : data?.map_center ? [pointToTuple(data.map_center)] : [[47.61, 7.66] as LatLngTuple]), [data, selectedPointMarkers, selectedRoutePoints]);
  const profileLine = useMemo(() => buildProfileSvgPoints(selectedCompare?.profile_points ?? []), [selectedCompare]);
  const profileArea = useMemo(() => buildProfileAreaPath(selectedCompare?.profile_points ?? []), [selectedCompare]);
  const sortedMatches = useMemo(() => {
    const matches = [...(selectedCompare?.last_check_result?.matches ?? [])];
    matches.sort((left, right) => {
      switch (matchSortKey) {
        case "name":
          return compareNullableStrings(left.activity_name, right.activity_name, matchSortDirection);
        case "duration":
          return compareNullableNumbers(left.moving_time_s, right.moving_time_s, matchSortDirection);
        case "avg_power":
          return compareNullableNumbers(left.average_power_w, right.average_power_w, matchSortDirection);
        case "max_power":
          return compareNullableNumbers(left.max_power_w, right.max_power_w, matchSortDirection);
        case "avg_hr":
          return compareNullableNumbers(left.avg_hr_bpm, right.avg_hr_bpm, matchSortDirection);
        case "distance":
          return compareNullableNumbers(left.summary.distance_m, right.summary.distance_m, matchSortDirection);
        case "ascent":
          return compareNullableNumbers(left.summary.ascent_m, right.summary.ascent_m, matchSortDirection);
        case "started_at":
        default:
          return compareNullableStrings(left.started_at, right.started_at, matchSortDirection);
      }
    });
    return matches;
  }, [matchSortDirection, matchSortKey, selectedCompare]);
  const matchAwards = useMemo(() => {
    const awardsByActivityId = new Map<number, MatchAward[]>();
    const matches = selectedCompare?.last_check_result?.matches ?? [];
    const addAward = (match: ClimbCompareCheckMatch | null, award: MatchAward) => {
      if (!match) return;
      awardsByActivityId.set(match.activity_id, [...(awardsByActivityId.get(match.activity_id) ?? []), award]);
    };
    const topTime =
      matches
        .filter((match) => match.moving_time_s != null && match.moving_time_s > 0)
        .sort((left, right) => (left.moving_time_s ?? Number.POSITIVE_INFINITY) - (right.moving_time_s ?? Number.POSITIVE_INFINITY))[0] ?? null;
    const topMaxPower =
      matches
        .filter((match) => match.max_power_w != null)
        .sort((left, right) => (right.max_power_w ?? Number.NEGATIVE_INFINITY) - (left.max_power_w ?? Number.NEGATIVE_INFINITY))[0] ?? null;
    const topLowHr =
      matches
        .filter((match) => match.avg_hr_bpm != null && match.avg_hr_bpm > 0)
        .sort((left, right) => (left.avg_hr_bpm ?? Number.POSITIVE_INFINITY) - (right.avg_hr_bpm ?? Number.POSITIVE_INFINITY))[0] ?? null;
    addAward(topTime, { label: "Top Zeit", tone: "time" });
    addAward(topMaxPower, { label: "Top Maximalwatt", tone: "power" });
    addAward(topLowHr, { label: "Top Low HF Durchschnitt", tone: "hr" });
    return awardsByActivityId;
  }, [selectedCompare]);

  function toggleMatchSort(nextKey: MatchSortKey) {
    if (matchSortKey === nextKey) {
      setMatchSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setMatchSortKey(nextKey);
    setMatchSortDirection(nextKey === "name" || nextKey === "avg_hr" ? "asc" : "desc");
  }

  function handleMapPick(point: LatLngTuple) {
    setDraftPoints((current) => (current.length >= 3 ? current : [...current, point]));
    setSaveMessage(null);
    setSaveError(null);
  }

  function removeLastDraftPoint() {
    setDraftPoints((current) => current.slice(0, -1));
  }

  function resetDraft() {
    setDraftPoints([]);
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
      const body = JSON.stringify({
        name: compareName.trim() || null,
        notes: compareNotes.trim() || null,
        search_tolerance_m: Number(searchToleranceM || "50"),
        start_point: tupleToPoint(draftPoints[0]),
        via_point: tupleToPoint(draftPoints[1]),
        end_point: tupleToPoint(draftPoints[2]),
      });
      const response = await apiFetch(
        editorMode === "edit" && editingCompareId != null ? `${API_BASE_URL}/activities/climb-compare/${editingCompareId}` : `${API_BASE_URL}/activities/climb-compare`,
        { method: editorMode === "edit" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body },
      );
      const payload = await parseJsonSafely<{ compare: ClimbCompareItem; message?: string } | { detail?: string }>(response);
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Climb Compare konnte nicht gespeichert werden.");
      if (!payload || !("compare" in payload)) throw new Error("Leere Antwort beim Speichern.");
      syncCompare(payload.compare, editorMode === "create");
      setSelectedCompareId(payload.compare.id);
      setSaveMessage(payload.message ?? "Climb Compare gespeichert.");
      startCreate();
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function startRideCheck(compareId: number, scope: "new" | "all") {
    const compare = data?.compares.find((item) => item.id === compareId) ?? null;
    setCheckingId(compareId);
    setSelectedCompareId(compareId);
    setCheckOverlayOpen(true);
    setCheckJob({ status: "running", compare_id: compareId, compare_name: compare?.name ?? null, checked_current: 0, checked_total: 0, progress_percent: 0, version: 0, scope, message: scope === "all" ? "Komplette Prüfung wird gestartet..." : "Neue Rides werden geprüft..." });
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/${compareId}/check-rides?scope=${scope}`, { method: "POST" });
      const payload = await parseJsonSafely<ClimbCompareCheckJob | { detail?: string }>(response);
      if (!response.ok) throw new Error(typeof payload === "object" && payload && payload && "detail" in payload && payload.detail ? payload.detail : "Ride-Prüfung konnte nicht gestartet werden.");
      if (payload && "status" in payload) applyCheckJob(payload);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unbekannter Fehler";
      setSaveError(message);
      setCheckJob((current) => ({ ...(current ?? { status: "error", compare_id: compareId, checked_current: 0, checked_total: 0, progress_percent: 0, version: 0 }), status: "error", error: message }));
      setCheckingId(null);
    }
  }

  async function renameCompare() {
    if (!renameCandidate) return;
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/${renameCandidate.id}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue }),
      });
      const payload = await parseJsonSafely<{ compare: ClimbCompareItem; message?: string } | { detail?: string }>(response);
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Name konnte nicht gespeichert werden.");
      if (!payload || !("compare" in payload)) throw new Error("Leere Antwort.");
      syncCompare(payload.compare);
      setSaveMessage(payload.message ?? "Name aktualisiert.");
      setRenameCandidate(null);
      setRenameValue("");
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    }
  }

  async function copyCompare(compare: ClimbCompareItem) {
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/${compare.id}/copy`, { method: "POST" });
      const payload = await parseJsonSafely<{ compare: ClimbCompareItem; message?: string } | { detail?: string }>(response);
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Kopie konnte nicht erstellt werden.");
      if (!payload || !("compare" in payload)) throw new Error("Leere Antwort.");
      syncCompare(payload.compare, true);
      setSelectedCompareId(payload.compare.id);
      setSaveMessage(payload.message ?? "Climb Compare kopiert.");
      setOpenMenuId(null);
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Unbekannter Fehler");
    }
  }

  async function deleteCompare() {
    if (!deleteCandidate || deleting) return;
    setDeleting(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/climb-compare/${deleteCandidate.id}`, { method: "DELETE" });
      const payload = await parseJsonSafely<{ name?: string; detail?: string }>(response);
      if (!response.ok) throw new Error(payload?.detail || "Climb Compare konnte nicht geloescht werden.");
      setData((current) => current ? { ...current, compares: current.compares.filter((compare) => compare.id !== deleteCandidate.id) } : current);
      setSelectedCompareId((current) => (current === deleteCandidate.id ? (data?.compares.find((compare) => compare.id !== deleteCandidate.id)?.id ?? null) : current));
      setDeleteCandidate(null);
      setSaveMessage(`Climb Compare geloescht: ${payload?.name || deleteCandidate.name}`);
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
        <p className="lead">Lege einen Anstieg über drei Punkte fest, speichere ihn dauerhaft und prüfe danach nur neue Rides statt immer wieder alles komplett zu durchsuchen.</p>
      </div>

      <div className="climb-compare-layout">
        <div className="card climb-compare-editor">
          <div className="section-title-row">
            <h2>{editorMode === "edit" ? "Climb Compare bearbeiten" : "Neuen Compare anlegen"}</h2>
          </div>
          <p className="training-note">Klicke auf der Karte in dieser Reihenfolge: Start, Zwischenpunkt, Ende.</p>
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
              Name
              <input className="settings-input" value={compareName} onChange={(event) => setCompareName(event.target.value)} />
            </label>
            <label className="settings-label">
              Toleranz (m)
              <input className="settings-input" type="number" min="15" max="500" step="5" value={searchToleranceM} onChange={(event) => setSearchToleranceM(event.target.value)} />
            </label>
            <label className="settings-label climb-compare-span-2">
              Notiz
              <textarea className="settings-input climb-compare-textarea" value={compareNotes} onChange={(event) => setCompareNotes(event.target.value)} />
            </label>
          </div>
          {saveMessage ? <p className="info-text">{saveMessage}</p> : null}
          {saveError ? <p className="error-text">{saveError}</p> : null}
          <div className="settings-actions">
            <button className="primary-button" type="button" onClick={() => void saveCompare()} disabled={saving || draftPoints.length !== 3}>{saving ? "Speichere..." : editorMode === "edit" ? "Aenderungen speichern" : "Climb Compare speichern"}</button>
            <button className="secondary-button" type="button" onClick={removeLastDraftPoint} disabled={!draftPoints.length || saving}>Letzten Punkt entfernen</button>
            <button className="secondary-button" type="button" onClick={resetDraft} disabled={!draftPoints.length || saving}>Punkte zuruecksetzen</button>
            {editorMode === "edit" ? <button className="secondary-button" type="button" onClick={startCreate}>Bearbeiten abbrechen</button> : null}
          </div>
        </div>
        <div className="card climb-compare-map-card">
          <div className="section-title-row"><h2>Karte</h2></div>
          <MapContainer className="climb-compare-map" center={mapFocusPoints[0]} zoom={13} scrollWheelZoom>
            <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} />
            <MapViewport points={mapFocusPoints} />
            <MapPicker canPick={draftPoints.length < 3} onPick={handleMapPick} />
            {coloredRouteSegments.length ? coloredRouteSegments.map((segment, index) => <Polyline key={`${segment.color}-${index}`} positions={segment.positions} pathOptions={{ color: segment.color, weight: 7, opacity: 0.92 }} />) : selectedRoutePoints.length >= 2 ? <Polyline positions={selectedRoutePoints} pathOptions={{ color: "#1f8b6f", weight: 6, opacity: 0.9 }} /> : null}
            {selectedPointMarkers.map((point, index) => <CircleMarker key={`${point[0]}-${point[1]}-${index}`} center={point} radius={8} pathOptions={{ color: "#ffffff", weight: 3, fillColor: index === 0 ? "#1f8b6f" : index === 1 ? "#f3a34f" : "#d45f43", fillOpacity: 1 }} />)}
          </MapContainer>
          <div className="training-note">{draftPoints.length < 3 ? `Noch ${3 - draftPoints.length} Punkt${3 - draftPoints.length === 1 ? "" : "e"} setzen.` : "Alle drei Punkte sind gesetzt."}</div>
        </div>
      </div>

      <div className="climb-compare-detail-grid">
        <div className="card">
          <div className="section-title-row"><h2>Ausgewählter Climb</h2></div>
          {selectedCompare ? (
            <div className="climb-compare-detail">
              <div className="climb-compare-summary-grid">
                <div className="climb-compare-summary-card"><span>Name</span><strong>{selectedCompare.name}</strong></div>
                <div className="climb-compare-summary-card"><span>Lage</span><strong>{selectedCompare.location_label ?? "-"}</strong></div>
                <div className="climb-compare-summary-card"><span>Referenzdistanz</span><strong>{formatDistanceMeters(selectedCompare.summary.distance_m)}</strong></div>
                <div className="climb-compare-summary-card"><span>Anstieg</span><strong>{formatNumber(selectedCompare.summary.ascent_m, 0, " m")}</strong></div>
                <div className="climb-compare-summary-card"><span>{"\u00D8 Steigung"}</span><strong>{formatNumber(selectedCompare.summary.average_grade_pct ?? null, 1, " %")}</strong></div>
                <div className="climb-compare-summary-card"><span>Toleranz</span><strong>{formatNumber(selectedCompare.search_tolerance_m, 0, " m")}</strong></div>
              </div>
              <div className="climb-compare-status-grid">
                <div className="climb-compare-summary-card"><span>Schon angeschaut</span><strong>{selectedCompare.search_state.searched_ride_total}</strong></div>
                <div className="climb-compare-summary-card"><span>Letzte Prüfung</span><strong>{formatDateTime(selectedCompare.search_state.last_checked_at)}</strong></div>
                <div className="climb-compare-summary-card"><span>Noch offen</span><strong>{selectedCompare.search_state.pending_ride_total}</strong></div>
              </div>
              {selectedCompare.search_state.needs_full_rescan ? <p className="training-note">Der Suchalgorithmus wurde geändert. Für komplett frische Ergebnisse bitte einmal "Alles neu suchen" ausführen.</p> : null}
              <div className="settings-actions">
                <button className="primary-button" type="button" onClick={() => void startRideCheck(selectedCompare.id, "new")} disabled={checkingId !== null}>{checkingId === selectedCompare.id ? "Wird geprüft..." : "Neue Rides prüfen"}</button>
                <button className="secondary-button" type="button" onClick={() => void startRideCheck(selectedCompare.id, "all")} disabled={checkingId !== null}>Alles neu suchen</button>
              </div>
              {selectedCompare.notes ? <p className="training-note">{selectedCompare.notes}</p> : null}
              {profileLine && profileArea ? (
                <div className="climb-compare-profile-card">
                  <svg className="climb-compare-profile" viewBox="0 0 760 180" preserveAspectRatio="none">
                    <path d={profileArea} fill="rgba(31, 139, 111, 0.16)" />
                    <polyline points={profileLine} fill="none" stroke="#1f8b6f" strokeWidth="3" />
                  </svg>
                </div>
              ) : null}
              <div className="climb-compare-check-results">
                <div className="section-title-row"><h3>Treffer</h3></div>
                {selectedCompare.last_check_result?.matches?.length ? (
                  <div className="rides-table-wrap climb-compare-results-table-wrap">
                    <div className="table-scroll">
                      <table className="rides-table">
                        <thead>
                          <tr>
                            <th><button type="button" className="climb-compare-sort-button" onClick={() => toggleMatchSort("started_at")}>Start {matchSortKey === "started_at" ? (matchSortDirection === "asc" ? "^" : "v") : ""}</button></th>
                            <th><button type="button" className="climb-compare-sort-button" onClick={() => toggleMatchSort("name")}>Ride {matchSortKey === "name" ? (matchSortDirection === "asc" ? "^" : "v") : ""}</button></th>
                            <th><button type="button" className="climb-compare-sort-button" onClick={() => toggleMatchSort("duration")}>Zeit {matchSortKey === "duration" ? (matchSortDirection === "asc" ? "^" : "v") : ""}</button></th>
                            <th><button type="button" className="climb-compare-sort-button" onClick={() => toggleMatchSort("avg_power")}>{"\u00D8 Watt"} {matchSortKey === "avg_power" ? (matchSortDirection === "asc" ? "^" : "v") : ""}</button></th>
                            <th><button type="button" className="climb-compare-sort-button" onClick={() => toggleMatchSort("max_power")}>Max Watt {matchSortKey === "max_power" ? (matchSortDirection === "asc" ? "^" : "v") : ""}</button></th>
                            <th><button type="button" className="climb-compare-sort-button" onClick={() => toggleMatchSort("avg_hr")}>{"\u00D8 HF"} {matchSortKey === "avg_hr" ? (matchSortDirection === "asc" ? "^" : "v") : ""}</button></th>
                            <th><button type="button" className="climb-compare-sort-button" onClick={() => toggleMatchSort("distance")}>Distanz {matchSortKey === "distance" ? (matchSortDirection === "asc" ? "^" : "v") : ""}</button></th>
                            <th><button type="button" className="climb-compare-sort-button" onClick={() => toggleMatchSort("ascent")}>Anstieg {matchSortKey === "ascent" ? (matchSortDirection === "asc" ? "^" : "v") : ""}</button></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedMatches.map((match) => (
                            <tr key={match.activity_id} className="climb-compare-match-row" style={{ cursor: "pointer" }} onClick={() => navigate(`/activities/${match.activity_id}`)}>
                              <td>{formatDateTime(match.started_at)}</td>
                              <td>
                                <div className="climb-compare-match-name-cell">
                                  <Link className="climb-compare-match-link" to={`/activities/${match.activity_id}`} onClick={(event) => event.stopPropagation()}>
                                    {match.activity_name}
                                  </Link>
                                  <div className="climb-compare-match-badges">
                                    {match.is_reference_activity ? <span className="climb-compare-match-badge">Referenz</span> : null}
                                    {(matchAwards.get(match.activity_id) ?? []).map((award) => (
                                      <span key={award.label} className={`climb-compare-match-badge is-${award.tone}`}>{award.label}</span>
                                    ))}
                                  </div>
                                </div>
                              </td>
                              <td>{formatDurationSeconds(match.moving_time_s)}</td>
                              <td>{formatNumber(match.average_power_w, 0, " W")}</td>
                              <td>{formatNumber(match.max_power_w, 0, " W")}</td>
                              <td>{formatNumber(match.avg_hr_bpm, 0, " bpm")}</td>
                              <td>{formatDistanceMeters(match.summary.distance_m)}</td>
                              <td>{formatNumber(match.summary.ascent_m, 0, " m")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : <p className="training-note">{selectedCompare.last_check_result?.message ?? 'Mit "Neue Rides prüfen" werden nur frisch geladene Fahrten gecheckt.'}</p>}
              </div>
            </div>
          ) : <p className="training-note">Noch kein Climb Compare gespeichert.</p>}
        </div>

        <div className="card">
          <div className="section-title-row"><h2>Gespeicherte Climb Compares</h2></div>
          {loading ? <p>Lade Climb Compares...</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
          <div className="climb-compare-list">
            {data?.compares.map((compare) => (
              <article
                key={compare.id}
                className={`climb-compare-list-card ${selectedCompare?.id === compare.id ? "is-selected" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedCompareId(compare.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedCompareId(compare.id);
                  }
                }}
              >
                <div className="climb-compare-list-head">
                  <div><h3>{compare.name}</h3><p>{compare.location_label ?? "Ohne Lageinfo"}</p></div>
                  <div className="climb-compare-list-head-actions">
                    <span>{formatDateTime(compare.created_at)}</span>
                    <div className="recipe-card-menu">
                      <button
                        className="icon-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          const isClosing = openMenuId === compare.id;
                          setOpenMenuId(isClosing ? null : compare.id);
                          setMenuPosition(
                            isClosing
                              ? null
                              : {
                                  top: rect.bottom + 6,
                                  left: Math.max(16, rect.right - 180),
                                },
                          );
                        }}
                      >
                        ...
                      </button>
                    </div>
                  </div>
                </div>
                <div className="climb-compare-list-metrics">
                  <span>Angeschaut: {compare.search_state.searched_ride_total}</span>
                  <span>Noch offen: {compare.search_state.pending_ride_total}</span>
                  <span>Gefunden: {compare.search_state.matched_total}</span>
                </div>
                <div className="climb-compare-list-metrics climb-compare-list-metrics-secondary">
                  <span>Letzte Prüfung: {formatDateTime(compare.search_state.last_checked_at)}</span>
                  <span className="climb-compare-list-version">Version {compare.search_state.last_search_algorithm_version ?? compare.search_state.algorithm_version}</span>
                </div>
                {compare.search_state.needs_full_rescan ? <p className="training-note climb-compare-card-note">Algorithmus geändert. Ein kompletter Neu-Check ist sinnvoll.</p> : null}
              </article>
            ))}
          </div>
        </div>
      </div>

      {openMenuId && menuPosition ? (
        <div className="recipe-card-menu-popover recipe-card-menu-popover-floating" style={{ top: menuPosition.top, left: menuPosition.left }} onClick={(event) => event.stopPropagation()}>
          {(() => {
            const compare = data?.compares.find((entry) => entry.id === openMenuId);
            if (!compare) return null;
            return (
              <>
                <button
                  type="button"
                  className="recipe-card-menu-item"
                  onClick={() => {
                    setRenameCandidate(compare);
                    setRenameValue(compare.name);
                    setOpenMenuId(null);
                    setMenuPosition(null);
                  }}
                >
                  Name ändern
                </button>
                <button
                  type="button"
                  className="recipe-card-menu-item"
                  onClick={() => {
                    startEdit(compare);
                    setMenuPosition(null);
                  }}
                >
                  Bearbeiten
                </button>
                <button
                  type="button"
                  className="recipe-card-menu-item"
                  onClick={() => {
                    setOpenMenuId(null);
                    setMenuPosition(null);
                    void copyCompare(compare);
                  }}
                >
                  Kopieren
                </button>
                <button
                  type="button"
                  className="recipe-card-menu-item danger"
                  onClick={() => {
                    setDeleteCandidate(compare);
                    setOpenMenuId(null);
                    setMenuPosition(null);
                  }}
                >
                  Löschen
                </button>
              </>
            );
          })()}
        </div>
      ) : null}

      {checkOverlayOpen && checkJob ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Rides prüfen" onClick={() => setCheckOverlayOpen(false)}>
          <div className="confirm-card climb-compare-check-card" onClick={(event) => event.stopPropagation()}>
            <h2>{checkJob.scope === "all" ? "Alles neu suchen" : "Neue Rides prüfen"}</h2>
            <p>{checkJob.compare_name ?? "Climb Compare"}</p>
            <div className="climb-compare-check-progress">
              <div className="climb-compare-check-progress-bar"><span style={{ width: `${Math.max(0, Math.min(100, checkJob.progress_percent || 0))}%` }} /></div>
              <div className="climb-compare-check-progress-meta">
                <strong>{checkJob.checked_current} / {checkJob.checked_total} geprüft</strong>
                <span>{checkJob.current_activity_name ?? checkJob.message ?? "Vorbereitung..."}</span>
              </div>
            </div>
            {checkJob.error ? <p className="error-text">{checkJob.error}</p> : null}
            <div className="confirm-actions">
              <button className="secondary-button" type="button" onClick={() => setCheckOverlayOpen(false)}>{checkingId !== null ? "Abbrechen" : "Schließen"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {renameCandidate ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Name ändern" onClick={() => setRenameCandidate(null)}>
          <div className="confirm-card climb-compare-rename-card" onClick={(event) => event.stopPropagation()}>
            <h2>Name ändern</h2>
            <label className="settings-label">Neuer Name<input className="settings-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus /></label>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" onClick={() => setRenameCandidate(null)}>Abbrechen</button>
              <button className="primary-button" type="button" onClick={() => void renameCompare()}>Speichern</button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Climb Compare löschen" onClick={() => (deleting ? null : setDeleteCandidate(null))}>
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <h2>Climb Compare löschen?</h2>
            <p>Willst du <strong>{deleteCandidate.name}</strong> wirklich löschen?</p>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" disabled={deleting} onClick={() => setDeleteCandidate(null)}>Abbrechen</button>
              <button className="primary-button" type="button" disabled={deleting} onClick={() => void deleteCompare()}>{deleting ? "Lösche..." : "Jetzt löschen"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
