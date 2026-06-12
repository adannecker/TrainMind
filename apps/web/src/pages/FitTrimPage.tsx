import { ChangeEvent, PointerEvent, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type TrimMetricKey = "speed" | "power";

type FitTrimRecord = {
  offset_seconds: number;
  timestamp: string;
  power: number | null;
  speed_kmh: number | null;
  distance_m: number | null;
};

type FitTrimSeriesBucket = {
  start_second: number;
  end_second: number;
  avg_value: number;
  max_value: number;
  record_count: number;
};

type FitTrimMetricSummary = {
  key: TrimMetricKey;
  label: string;
  unit: string;
  record_count: number;
  avg_value: number;
  max_value: number;
  series: FitTrimSeriesBucket[];
};

type FitTrimInspectResponse = {
  file_name: string;
  duration_seconds: number;
  record_count: number;
  start_time: string;
  end_time: string;
  total_distance_m: number;
  available_metrics: TrimMetricKey[];
  metrics: Partial<Record<TrimMetricKey, FitTrimMetricSummary>>;
  records: FitTrimRecord[];
};

type FitTrimSegment = {
  id: string;
  start_second: number;
  end_second: number;
  deleted: boolean;
};

type DragSelection = {
  anchorIndex: number;
  currentIndex: number;
};

type HoveredBucket = {
  index: number;
  x: number;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  return match?.[1] ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function buildInitialSegments(durationSeconds: number): FitTrimSegment[] {
  return [
    {
      id: `segment-0-${durationSeconds}`,
      start_second: 0,
      end_second: durationSeconds,
      deleted: false,
    },
  ];
}

function metricValue(record: FitTrimRecord, metric: TrimMetricKey): number | null {
  if (metric === "power") return record.power;
  return record.speed_kmh;
}

function formatMetricValue(value: number, metric: TrimMetricKey): string {
  if (metric === "power") return `${Math.round(value)} W`;
  return `${value.toFixed(1)} km/h`;
}

function summarizeSegment(records: FitTrimRecord[], segment: FitTrimSegment, metric: TrimMetricKey) {
  const rows = records.filter(
    (record) => record.offset_seconds >= segment.start_second && record.offset_seconds <= segment.end_second,
  );
  const values = rows.map((record) => metricValue(record, metric)).filter((value): value is number => value !== null);
  const distanceRows = rows.filter((record) => record.distance_m !== null);
  const distanceM =
    distanceRows.length >= 2
      ? Math.max(0, Number(distanceRows[distanceRows.length - 1].distance_m) - Number(distanceRows[0].distance_m))
      : 0;

  if (!values.length) {
    return {
      count: rows.length,
      avg: 0,
      max: 0,
      distanceM,
    };
  }

  return {
    count: rows.length,
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
    distanceM,
  };
}

export function FitTrimPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspectData, setInspectData] = useState<FitTrimInspectResponse | null>(null);
  const [activeMetric, setActiveMetric] = useState<TrimMetricKey>("speed");
  const [segments, setSegments] = useState<FitTrimSegment[]>([]);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(0);
  const [cutSecond, setCutSecond] = useState(0);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  const [hoveredBucket, setHoveredBucket] = useState<HoveredBucket | null>(null);

  const chartRef = useRef<HTMLDivElement | null>(null);

  async function inspectFile(file: File) {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiFetch(`${API_BASE_URL}/fit-trim/inspect`, {
        method: "POST",
        body: formData,
      });
      const payload = await parseJsonSafely<FitTrimInspectResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "detail" in payload && payload.detail
            ? payload.detail
            : "FIT-Datei konnte nicht gelesen werden.",
        );
      }
      const next = payload as FitTrimInspectResponse;
      const preferredMetric = next.available_metrics.includes("speed") ? "speed" : next.available_metrics[0] ?? "power";
      setSelectedFile(file);
      setInspectData(next);
      setActiveMetric(preferredMetric);
      setSegments(buildInitialSegments(next.duration_seconds));
      setViewStart(0);
      setViewEnd(next.duration_seconds);
      setCutSecond(Math.round(next.duration_seconds / 2));
      setDragSelection(null);
      setHoveredBucket(null);
      setMessage(`FIT-Datei geladen: ${next.file_name}`);
    } catch (err) {
      setInspectData(null);
      setSelectedFile(null);
      setSegments([]);
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await inspectFile(file);
  }

  const activeMetricSummary = inspectData?.metrics[activeMetric] ?? null;
  const visibleSeries = useMemo(() => {
    if (!activeMetricSummary) return [];
    return activeMetricSummary.series.filter((item) => item.end_second >= viewStart && item.start_second <= viewEnd);
  }, [activeMetricSummary, viewEnd, viewStart]);

  const deletedSegments = useMemo(() => segments.filter((segment) => segment.deleted), [segments]);
  const tailDeletedSegment = useMemo(() => {
    if (!inspectData || deletedSegments.length !== 1) return null;
    const segment = deletedSegments[0];
    if (segment.start_second <= 0) return null;
    return segment.end_second >= inspectData.duration_seconds - 1 ? segment : null;
  }, [deletedSegments, inspectData]);
  const canExportTrim = tailDeletedSegment !== null;
  const deletedDuration = useMemo(
    () => deletedSegments.reduce((sum, segment) => sum + Math.max(0, segment.end_second - segment.start_second), 0),
    [deletedSegments],
  );
  const remainingDuration = Math.max(0, (inspectData?.duration_seconds ?? 0) - deletedDuration);
  const sortedSegments = useMemo(
    () => segments.slice().sort((left, right) => left.start_second - right.start_second),
    [segments],
  );

  const activeHighlight = useMemo(() => {
    if (!visibleSeries.length || !dragSelection) return null;
    const startIndex = Math.min(dragSelection.anchorIndex, dragSelection.currentIndex);
    const endIndex = Math.max(dragSelection.anchorIndex, dragSelection.currentIndex);
    return { startIndex, endIndex };
  }, [dragSelection, visibleSeries.length]);

  const maxChartValue = Math.max(...visibleSeries.map((item) => item.max_value), 1);
  const duration = inspectData?.duration_seconds ?? 0;
  const zoomed = inspectData !== null && (viewStart > 0 || viewEnd < duration);
  const cutLeftPercent = viewEnd > viewStart ? ((cutSecond - viewStart) / (viewEnd - viewStart)) * 100 : 0;
  const hoveredSeries = hoveredBucket ? visibleSeries[hoveredBucket.index] ?? null : null;
  const hoveredTooltipLeft = useMemo(() => {
    if (!hoveredBucket || !chartRef.current) return 0;
    const rect = chartRef.current.getBoundingClientRect();
    const relativeX = hoveredBucket.x - rect.left;
    return clamp(relativeX, 54, Math.max(rect.width - 54, 54));
  }, [hoveredBucket]);
  const timeAxisTicks = useMemo(() => {
    if (!inspectData) return [];
    const segmentsCount = 5;
    const span = Math.max(viewEnd - viewStart, 1);
    return Array.from({ length: segmentsCount + 1 }, (_, index) => {
      const ratio = index / segmentsCount;
      const second = Math.round(viewStart + span * ratio);
      return {
        label: formatSeconds(second),
        left: `${ratio * 100}%`,
      };
    });
  }, [inspectData, viewEnd, viewStart]);

  function setViewRange(start: number, end: number) {
    if (!inspectData) return;
    const nextStart = clamp(Math.min(start, end), 0, inspectData.duration_seconds);
    const nextEnd = clamp(Math.max(start, end), 0, inspectData.duration_seconds);
    setViewStart(nextStart);
    setViewEnd(nextEnd);
    setCutSecond(clamp(Math.round((nextStart + nextEnd) / 2), nextStart, nextEnd));
  }

  function resetZoom() {
    if (!inspectData) return;
    setViewRange(0, inspectData.duration_seconds);
    setDragSelection(null);
    setHoveredBucket(null);
  }

  function resetWorkbench() {
    if (!inspectData) return;
    setSegments(buildInitialSegments(inspectData.duration_seconds));
    setViewRange(0, inspectData.duration_seconds);
    setError(null);
    setMessage("Schnitte und Löschmarkierungen zurückgesetzt.");
  }

  function bucketIndexFromPointer(clientX: number): number | null {
    if (!chartRef.current || visibleSeries.length === 0) return null;
    const rect = chartRef.current.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const relative = clamp((clientX - rect.left) / rect.width, 0, 0.999999);
    return clamp(Math.floor(relative * visibleSeries.length), 0, visibleSeries.length - 1);
  }

  function handleChartPointerDown(event: PointerEvent<HTMLDivElement>) {
    const index = bucketIndexFromPointer(event.clientX);
    if (index === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragSelection({ anchorIndex: index, currentIndex: index });
    setHoveredBucket({ index, x: event.clientX });
  }

  function handleChartPointerMove(event: PointerEvent<HTMLDivElement>) {
    const index = bucketIndexFromPointer(event.clientX);
    if (index === null) return;
    setHoveredBucket({ index, x: event.clientX });
    setDragSelection((prev) => (prev ? { ...prev, currentIndex: index } : prev));
  }

  function finalizeChartSelection() {
    if (!dragSelection || visibleSeries.length === 0) return;
    const startIndex = Math.min(dragSelection.anchorIndex, dragSelection.currentIndex);
    const endIndex = Math.max(dragSelection.anchorIndex, dragSelection.currentIndex);
    const nextStart = visibleSeries[startIndex]?.start_second ?? viewStart;
    const nextEnd = visibleSeries[endIndex]?.end_second ?? viewEnd;
    setViewRange(nextStart, nextEnd);
    setDragSelection(null);
  }

  function handleChartPointerLeave() {
    finalizeChartSelection();
    setHoveredBucket(null);
  }

  function segmentForSecond(second: number): FitTrimSegment | null {
    return sortedSegments.find((segment) => second > segment.start_second && second < segment.end_second) ?? null;
  }

  function addCut() {
    if (!inspectData) return;
    const cut = clamp(Math.round(cutSecond), 0, inspectData.duration_seconds);
    const target = segmentForSecond(cut);
    if (!target) {
      setError("Der Schnitt muss innerhalb eines bestehenden Segments liegen.");
      return;
    }

    setSegments((current) =>
      current
        .flatMap((segment) => {
          if (segment.id !== target.id) return [segment];
          return [
            {
              id: `${segment.id}-a-${cut}`,
              start_second: segment.start_second,
              end_second: cut,
              deleted: segment.deleted,
            },
            {
              id: `${segment.id}-b-${cut}`,
              start_second: cut,
              end_second: segment.end_second,
              deleted: segment.deleted,
            },
          ];
        })
        .sort((left, right) => left.start_second - right.start_second),
    );
    setError(null);
    setMessage(`Schnitt bei ${formatSeconds(cut)} gesetzt.`);
  }

  function toggleSegmentDeleted(id: string) {
    setSegments((current) =>
      current.map((segment) => (segment.id === id ? { ...segment, deleted: !segment.deleted } : segment)),
    );
  }

  function bucketIsDeleted(bucket: FitTrimSeriesBucket): boolean {
    const middle = Math.round((bucket.start_second + bucket.end_second) / 2);
    return deletedSegments.some((segment) => middle >= segment.start_second && middle <= segment.end_second);
  }

  async function downloadTrimmedFit() {
    if (!selectedFile || !tailDeletedSegment) {
      setError("Bitte genau das letzte Segment mit dem Papierkorb markieren. Für Garmin wird nur am Ende gekürzt.");
      return;
    }
    setApplying(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append(
        "delete_segments_json",
        JSON.stringify(
          [
            {
              start_second: tailDeletedSegment.start_second,
              end_second: tailDeletedSegment.end_second,
            },
          ],
        ),
      );

      const response = await apiFetch(`${API_BASE_URL}/fit-trim/apply`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await parseJsonSafely<{ detail?: string }>(response);
        throw new Error(payload?.detail || "FIT-Datei konnte nicht gekürzt werden.");
      }

      const blob = await response.blob();
      const downloadName = parseDownloadFilename(response.headers.get("Content-Disposition")) || "fit_trimmed.fit";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const keptRecords = response.headers.get("X-TrainMind-Kept-Records");
      const removedRecords = response.headers.get("X-TrainMind-Removed-Records");
      const newDuration = response.headers.get("X-TrainMind-Duration-Seconds");
      setMessage(
        `Neue FIT-Datei erstellt. Dauer: ${formatSeconds(Number(newDuration ?? 0))}, behaltene Records: ${keptRecords ?? "-"}, gelöschte Records: ${removedRecords ?? "-"}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Tools</p>
        <h1>FIT file kürzen</h1>
        <p className="lead">
          FIT-Datei laden, Geschwindigkeit oder Power auf der Timeline ansehen, in Bereiche zoomen, Schnitte setzen
          und überflüssige Teile aus der Aktivität entfernen.
        </p>
      </div>

      <div className="fit-repair-layout fit-trim-layout">
        <div className="fit-repair-main">
          <div className="card">
            <div className="section-title-row">
              <h2>Datei-Upload</h2>
            </div>
            <label className="settings-label">
              FIT-Datei auswählen
              <input className="settings-input" type="file" accept=".fit,application/octet-stream" onChange={(event) => void handleFileChange(event)} />
            </label>
            <div className="settings-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={!selectedFile || loading}
                onClick={() => (selectedFile ? void inspectFile(selectedFile) : undefined)}
              >
                {loading ? "Lade..." : "Datei neu einlesen"}
              </button>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
            {message ? <p className="info-text">{message}</p> : null}
          </div>

          {inspectData && activeMetricSummary ? (
            <>
              <div className="card">
                <div className="section-title-row fit-section-head">
                  <h2>Timeline</h2>
                  <span className="fit-repair-pill fit-file-pill" title={inspectData.file_name}>
                    {inspectData.file_name}
                  </span>
                </div>

                <div className="settings-status-grid">
                  <div className="settings-status-chip">
                    <span>Dauer</span>
                    <strong>{formatSeconds(inspectData.duration_seconds)}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Neue Dauer</span>
                    <strong>{formatSeconds(remainingDuration)}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Records</span>
                    <strong>{inspectData.record_count}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Distanz</span>
                    <strong>{(inspectData.total_distance_m / 1000).toFixed(2)} km</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>{activeMetricSummary.label} Schnitt</span>
                    <strong>{formatMetricValue(activeMetricSummary.avg_value, activeMetric)}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>{activeMetricSummary.label} Max</span>
                    <strong>{formatMetricValue(activeMetricSummary.max_value, activeMetric)}</strong>
                  </div>
                </div>

                <div className="fit-mode-row" role="tablist" aria-label="Timeline-Metrik">
                  <button
                    className={`fit-mode-button ${activeMetric === "speed" ? "active" : ""}`}
                    type="button"
                    disabled={!inspectData.available_metrics.includes("speed")}
                    onClick={() => setActiveMetric("speed")}
                  >
                    Geschwindigkeit
                  </button>
                  <button
                    className={`fit-mode-button ${activeMetric === "power" ? "active" : ""}`}
                    type="button"
                    disabled={!inspectData.available_metrics.includes("power")}
                    onClick={() => setActiveMetric("power")}
                  >
                    Power
                  </button>
                </div>

                <div className="fit-chart-toolbar">
                  <div className="fit-chart-meta">
                    <span>Ansicht: {formatSeconds(viewStart)} bis {formatSeconds(viewEnd)}</span>
                    <span>Schnittposition: {formatSeconds(cutSecond)}</span>
                    <span>{deletedSegments.length} Teil(e) markiert</span>
                  </div>
                  <div className="settings-actions">
                    <button className="secondary-button" type="button" onClick={resetZoom} disabled={!zoomed}>
                      Zoom zurücksetzen
                    </button>
                    <button className="secondary-button" type="button" onClick={resetWorkbench}>
                      Schnitte zurücksetzen
                    </button>
                  </div>
                </div>

                <div
                  ref={chartRef}
                  className="fit-power-chart fit-power-chart-selectable fit-trim-chart"
                  onPointerDown={handleChartPointerDown}
                  onPointerMove={handleChartPointerMove}
                  onPointerUp={finalizeChartSelection}
                  onPointerLeave={handleChartPointerLeave}
                >
                  {hoveredSeries ? (
                    <div className="fit-chart-tooltip" style={{ left: hoveredTooltipLeft }}>
                      <strong>{formatMetricValue(hoveredSeries.avg_value, activeMetric)}</strong>
                      <span>
                        {formatSeconds(hoveredSeries.start_second)} - {formatSeconds(hoveredSeries.end_second)}
                      </span>
                    </div>
                  ) : null}
                  <div className="fit-trim-cut-marker" style={{ left: `${clamp(cutLeftPercent, 0, 100)}%` }} aria-hidden="true" />
                  {visibleSeries.map((item, index) => {
                    const highlighted =
                      activeHighlight !== null && index >= activeHighlight.startIndex && index <= activeHighlight.endIndex;
                    const deleted = bucketIsDeleted(item);
                    const height = `${Math.max(7, Math.round((item.avg_value / maxChartValue) * 100))}%`;
                    return (
                      <div
                        key={`${item.start_second}-${item.end_second}`}
                        className={`fit-power-bar-stack fit-trim-bar-stack ${highlighted ? "selected" : ""} ${deleted ? "deleted" : ""}`}
                        title={`${formatSeconds(item.start_second)} - ${formatSeconds(item.end_second)} | ${formatMetricValue(item.avg_value, activeMetric)}`}
                      >
                        <div className={`fit-power-bar fit-trim-bar fit-trim-bar-${activeMetric}`} style={{ height }} />
                      </div>
                    );
                  })}
                </div>
                <div className="fit-time-axis" aria-hidden="true">
                  {timeAxisTicks.map((tick) => (
                    <div key={`${tick.left}-${tick.label}`} className="fit-time-axis-tick" style={{ left: tick.left }}>
                      <span className="fit-time-axis-line" />
                      <span className="fit-time-axis-label">{tick.label}</span>
                    </div>
                  ))}
                </div>
                <p className="fit-chart-caption">
                  In der Timeline ziehst du einen Bereich auf, um in diesen Abschnitt zu zoomen. Danach setzt du die Schnittposition genauer.
                </p>
              </div>

              <div className="card">
                <div className="section-title-row">
                  <h2>Cut Instrument</h2>
                </div>
                <div className="fit-trim-cut-grid">
                  <label className="settings-label">
                    Schnittposition
                    <input
                      className="settings-input"
                      type="number"
                      min={viewStart}
                      max={viewEnd}
                      value={cutSecond}
                      onChange={(event) => setCutSecond(clamp(Number(event.target.value), viewStart, viewEnd))}
                    />
                    <span className="fit-inline-help">{formatSeconds(cutSecond)}</span>
                  </label>
                  <div className="settings-label">
                    Aktuelle Ansicht
                    <div className="settings-input settings-static-field">
                      {formatSeconds(viewStart)} bis {formatSeconds(viewEnd)}
                    </div>
                  </div>
                </div>
                <div className="fit-dual-range">
                  <div className="fit-dual-range-head">
                    <strong>Position im Zoom setzen</strong>
                    <span>{formatSeconds(cutSecond)}</span>
                  </div>
                  <div className="fit-dual-range-track">
                    <div className="fit-dual-range-line" />
                    <div
                      className="fit-dual-range-active fit-trim-cut-active"
                      style={{
                        left: `${viewEnd > viewStart ? ((cutSecond - viewStart) / (viewEnd - viewStart)) * 100 : 0}%`,
                        width: "0.55rem",
                      }}
                    />
                    <input
                      className="fit-dual-range-input"
                      type="range"
                      min={viewStart}
                      max={viewEnd}
                      value={cutSecond}
                      onChange={(event) => setCutSecond(clamp(Number(event.target.value), viewStart, viewEnd))}
                    />
                  </div>
                  <div className="fit-dual-range-labels">
                    <span>{formatSeconds(viewStart)}</span>
                    <span>{formatSeconds(viewEnd)}</span>
                  </div>
                </div>
                <div className="settings-actions">
                  <button className="primary-button" type="button" onClick={addCut} disabled={!segmentForSecond(cutSecond)}>
                    Schnitt setzen
                  </button>
                </div>
              </div>

              <div className="card">
                <div className="section-title-row">
                  <h2>Segmente</h2>
                  <span className="fit-repair-pill">{sortedSegments.length} Teile</span>
                </div>
                <div className="fit-trim-segment-list">
                  {sortedSegments.map((segment, index) => {
                    const summary = summarizeSegment(inspectData.records, segment, activeMetric);
                    return (
                      <article className={`fit-trim-segment ${segment.deleted ? "deleted" : ""}`} key={segment.id}>
                        <div className="fit-trim-segment-main">
                          <strong>
                            Teil {index + 1}: {formatSeconds(segment.start_second)} bis {formatSeconds(segment.end_second)}
                          </strong>
                          <p>
                            Dauer {formatSeconds(Math.max(0, segment.end_second - segment.start_second))} |{" "}
                            {formatMetricValue(summary.avg, activeMetric)} Schnitt | {formatMetricValue(summary.max, activeMetric)} Max |{" "}
                            {(summary.distanceM / 1000).toFixed(2)} km
                          </p>
                        </div>
                        <button
                          className={`icon-button fit-trim-trash-button ${segment.deleted ? "active" : "danger"}`}
                          type="button"
                          onClick={() => toggleSegmentDeleted(segment.id)}
                          aria-label={segment.deleted ? "Segment wiederherstellen" : "Segment löschen"}
                          title={segment.deleted ? "Wiederherstellen" : "Segment löschen"}
                        >
                          <span className="fit-trim-trash-icon" aria-hidden="true">
                            <span />
                          </span>
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="card fit-repair-download-card">
                <div className="section-title-row">
                  <h2>Export</h2>
                </div>
                <p>
                  Für Garmin wird nur das letzte markierte Segment entfernt. Alle Record-Daten davor bleiben unverändert;
                  der Export setzt nur das neue Aktivitätsende.
                </p>
                <div className="settings-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!canExportTrim || applying}
                    onClick={() => void downloadTrimmedFit()}
                  >
                    {applying ? "Erstelle FIT..." : "Neue FIT-Datei herunterladen"}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
