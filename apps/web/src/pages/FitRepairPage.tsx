import { ChangeEvent, PointerEvent, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type PowerRecord = {
  offset_seconds: number;
  timestamp: string;
  power: number;
};

type PowerSeriesBucket = {
  start_second: number;
  end_second: number;
  avg_power: number;
  max_power: number;
};

type FitInspectResponse = {
  file_name: string;
  duration_seconds: number;
  record_count: number;
  power_record_count: number;
  avg_power: number;
  max_power: number;
  power_records: PowerRecord[];
  power_series: PowerSeriesBucket[];
};

type AdjustmentMode = "percent" | "fixed";

type PowerAdjustment = {
  id: string;
  start_second: number;
  end_second: number;
  mode: AdjustmentMode;
  value: number;
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

function applyAdjustments(power: number, offsetSeconds: number, adjustments: PowerAdjustment[]): number {
  let next = power;
  for (const adjustment of adjustments) {
    if (offsetSeconds < adjustment.start_second || offsetSeconds > adjustment.end_second) {
      continue;
    }
    if (adjustment.mode === "percent") {
      next *= 1 + adjustment.value / 100;
    } else {
      next += adjustment.value;
    }
  }
  return Math.max(0, Math.round(next));
}

function buildSeriesFromRecords(records: PowerRecord[], durationSeconds: number, bucketTarget = 160): PowerSeriesBucket[] {
  if (records.length === 0) return [];
  const bucketSize = Math.max(1, Math.ceil(Math.max(durationSeconds, 1) / bucketTarget));
  const buckets = new Map<number, number[]>();

  for (const row of records) {
    const bucketIndex = Math.floor(row.offset_seconds / bucketSize);
    const list = buckets.get(bucketIndex) ?? [];
    list.push(row.power);
    buckets.set(bucketIndex, list);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketIndex, values]) => {
      const start = bucketIndex * bucketSize;
      const end = Math.min(durationSeconds, start + bucketSize - 1);
      const avg = Math.round(values.reduce((sum, entry) => sum + entry, 0) / values.length);
      const max = Math.max(...values);
      return {
        start_second: start,
        end_second: end,
        avg_power: avg,
        max_power: max,
      };
    });
}

function summarizeRange(records: PowerRecord[], startSecond: number, endSecond: number) {
  const inRange = records.filter((row) => row.offset_seconds >= startSecond && row.offset_seconds <= endSecond);
  if (inRange.length === 0) {
    return { count: 0, avg: 0, max: 0 };
  }
  const sum = inRange.reduce((acc, row) => acc + row.power, 0);
  return {
    count: inRange.length,
    avg: Math.round(sum / inRange.length),
    max: Math.max(...inRange.map((row) => row.power)),
  };
}

function parseDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  return match?.[1] ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function FitRepairPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspectData, setInspectData] = useState<FitInspectResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(0);
  const [mode, setMode] = useState<AdjustmentMode>("percent");
  const [value, setValue] = useState("5");
  const [adjustments, setAdjustments] = useState<PowerAdjustment[]>([]);
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
      const response = await apiFetch(`${API_BASE_URL}/fit-fix/inspect`, {
        method: "POST",
        body: formData,
      });
      const payload = await parseJsonSafely<FitInspectResponse | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "FIT-Datei konnte nicht gelesen werden.");
      }
      const next = payload as FitInspectResponse;
      setSelectedFile(file);
      setInspectData(next);
      setAdjustments([]);
      setRangeStart(0);
      setRangeEnd(next.duration_seconds);
      setViewStart(0);
      setViewEnd(next.duration_seconds);
      setMode("percent");
      setValue("5");
      setDragSelection(null);
      setHoveredBucket(null);
      setMessage(`FIT-Datei geladen: ${next.file_name}`);
    } catch (err) {
      setInspectData(null);
      setSelectedFile(null);
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

  const previewRecords = useMemo(() => {
    if (!inspectData) return [];
    return inspectData.power_records.map((row) => ({
      ...row,
      power: applyAdjustments(row.power, row.offset_seconds, adjustments),
    }));
  }, [inspectData, adjustments]);

  const previewSeries = useMemo(() => {
    if (!inspectData) return [];
    return buildSeriesFromRecords(previewRecords, inspectData.duration_seconds);
  }, [inspectData, previewRecords]);

  const originalVisibleSeries = useMemo(() => {
    if (!inspectData) return [];
    return inspectData.power_series.filter((item) => item.end_second >= viewStart && item.start_second <= viewEnd);
  }, [inspectData, viewEnd, viewStart]);

  const visibleSeries = useMemo(() => {
    return previewSeries.filter((item) => item.end_second >= viewStart && item.start_second <= viewEnd);
  }, [previewSeries, viewStart, viewEnd]);

  const currentRangeBefore = useMemo(() => {
    if (!inspectData) return { count: 0, avg: 0, max: 0 };
    return summarizeRange(inspectData.power_records, rangeStart, rangeEnd);
  }, [inspectData, rangeStart, rangeEnd]);

  const currentRangeAfter = useMemo(() => {
    if (!inspectData) return { count: 0, avg: 0, max: 0 };
    return summarizeRange(previewRecords, rangeStart, rangeEnd);
  }, [inspectData, previewRecords, rangeStart, rangeEnd]);

  const overallAfter = useMemo(() => {
    if (!inspectData) return { count: 0, avg: 0, max: 0 };
    return summarizeRange(previewRecords, 0, inspectData.duration_seconds);
  }, [inspectData, previewRecords]);

  const activeHighlight = useMemo(() => {
    if (!visibleSeries.length || !dragSelection) return null;
    const startIndex = Math.min(dragSelection.anchorIndex, dragSelection.currentIndex);
    const endIndex = Math.max(dragSelection.anchorIndex, dragSelection.currentIndex);
    return {
      startIndex,
      endIndex,
      startSecond: visibleSeries[startIndex]?.start_second ?? rangeStart,
      endSecond: visibleSeries[endIndex]?.end_second ?? rangeEnd,
    };
  }, [dragSelection, rangeEnd, rangeStart, visibleSeries]);

  function updateRange(start: number, end: number) {
    const max = inspectData?.duration_seconds ?? 0;
    const nextStart = clamp(Math.min(start, end), 0, max);
    const nextEnd = clamp(Math.max(start, end), 0, max);
    setRangeStart(nextStart);
    setRangeEnd(nextEnd);
    setViewStart(nextStart);
    setViewEnd(nextEnd);
  }

  function clampRangeStart(nextValue: number) {
    updateRange(nextValue, rangeEnd);
  }

  function clampRangeEnd(nextValue: number) {
    updateRange(rangeStart, nextValue);
  }

  function resetZoom() {
    const max = inspectData?.duration_seconds ?? 0;
    setViewStart(0);
    setViewEnd(max);
    setDragSelection(null);
    setHoveredBucket(null);
  }

  function resetSelection() {
    const max = inspectData?.duration_seconds ?? 0;
    setRangeStart(0);
    setRangeEnd(max);
    setViewStart(0);
    setViewEnd(max);
    setDragSelection(null);
    setHoveredBucket(null);
  }

  function addAdjustment() {
    const parsedValue = Number(value.replace(",", "."));
    if (!Number.isFinite(parsedValue) || parsedValue === 0) {
      setError("Bitte einen gültigen Wert für die Watt-Anpassung eingeben.");
      return;
    }
    const nextItem: PowerAdjustment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      start_second: rangeStart,
      end_second: rangeEnd,
      mode,
      value: parsedValue,
    };
    setAdjustments((prev) => [...prev, nextItem]);
    setError(null);
    setMessage("Watt-Anpassung zur Liste hinzugefügt.");
  }

  function removeAdjustment(id: string) {
    setAdjustments((prev) => prev.filter((item) => item.id !== id));
  }

  async function downloadAdjustedFit() {
    if (!selectedFile || adjustments.length === 0) {
      setError("Bitte zuerst eine FIT-Datei laden und mindestens eine Anpassung hinzufügen.");
      return;
    }
    setApplying(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append(
        "adjustments_json",
        JSON.stringify(
          adjustments.map((item) => ({
            start_second: item.start_second,
            end_second: item.end_second,
            mode: item.mode,
            value: item.value,
          })),
        ),
      );

      const response = await apiFetch(`${API_BASE_URL}/fit-fix/apply`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await parseJsonSafely<{ detail?: string }>(response);
        throw new Error(payload?.detail || "FIT-Datei konnte nicht angepasst werden.");
      }

      const blob = await response.blob();
      const downloadName = parseDownloadFilename(response.headers.get("Content-Disposition")) || "fitfix_power.fit";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const changed = response.headers.get("X-TrainMind-Changed-Records");
      const avgPower = response.headers.get("X-TrainMind-Avg-Power");
      const maxPower = response.headers.get("X-TrainMind-Max-Power");
      setMessage(`Neue FIT-Datei erstellt. Geänderte Records: ${changed ?? "-"}, Ø Watt: ${avgPower ?? "-"}, Max Watt: ${maxPower ?? "-"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setApplying(false);
    }
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
    setDragSelection({ anchorIndex: index, currentIndex: index });
    setHoveredBucket({ index, x: event.clientX });
  }

  function handleChartPointerMove(event: PointerEvent<HTMLDivElement>) {
    const index = bucketIndexFromPointer(event.clientX);
    if (index === null) return;
    setHoveredBucket({ index, x: event.clientX });
    if (!dragSelection) return;
    setDragSelection((prev) => (prev ? { ...prev, currentIndex: index } : prev));
  }

  function finalizeChartSelection() {
    if (!dragSelection || visibleSeries.length === 0) return;
    const startIndex = Math.min(dragSelection.anchorIndex, dragSelection.currentIndex);
    const endIndex = Math.max(dragSelection.anchorIndex, dragSelection.currentIndex);
    const nextStart = visibleSeries[startIndex]?.start_second ?? rangeStart;
    const nextEnd = visibleSeries[endIndex]?.end_second ?? rangeEnd;
    updateRange(nextStart, nextEnd);
    setViewStart(nextStart);
    setViewEnd(nextEnd);
    setDragSelection(null);
  }

  function handleChartPointerLeave() {
    finalizeChartSelection();
    setHoveredBucket(null);
  }

  const maxChartPower = Math.max(
    ...visibleSeries.map((item) => item.max_power),
    ...originalVisibleSeries.map((item) => item.max_power),
    1,
  );
  const duration = inspectData?.duration_seconds ?? 0;
  const rangeStartPercent = duration > 0 ? (rangeStart / duration) * 100 : 0;
  const rangeEndPercent = duration > 0 ? (rangeEnd / duration) * 100 : 100;
  const zoomed = viewStart > 0 || (inspectData !== null && viewEnd < duration);
  const hoveredSeries = hoveredBucket ? visibleSeries[hoveredBucket.index] ?? null : null;
  const hoveredOriginalSeries = hoveredBucket ? originalVisibleSeries[hoveredBucket.index] ?? null : null;
  const hoveredTooltipLeft = useMemo(() => {
    if (!hoveredBucket || !chartRef.current) return 0;
    const rect = chartRef.current.getBoundingClientRect();
    const relativeX = hoveredBucket.x - rect.left;
    return clamp(relativeX, 48, Math.max(rect.width - 48, 48));
  }, [hoveredBucket]);
  const timeAxisTicks = useMemo(() => {
    if (!inspectData) return [];
    const segments = 5;
    const span = Math.max(viewEnd - viewStart, 1);
    return Array.from({ length: segments + 1 }, (_, index) => {
      const ratio = index / segments;
      const second = Math.round(viewStart + span * ratio);
      return {
        label: formatSeconds(second),
        left: `${ratio * 100}%`,
      };
    });
  }, [inspectData, viewEnd, viewStart]);

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Setup</p>
        <h1>Fix FIT file</h1>
        <p className="lead">
          FIT-Datei hochladen, Leistungsübersicht ansehen und Watt gezielt in ausgewählten Bereichen anpassen.
          Der erste Fokus liegt bewusst auf Power-Korrekturen pro Bereich.
        </p>
      </div>

      <div className="fit-repair-layout">
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

          <div className="card fit-repair-download-card">
            <div className="section-title-row">
              <h2>Export</h2>
            </div>
            <p>Wenn die Bereiche passen, kannst du direkt die neue FIT-Datei erzeugen und herunterladen.</p>
            <div className="settings-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!inspectData || adjustments.length === 0 || applying}
                onClick={() => void downloadAdjustedFit()}
              >
                {applying ? "Erstelle FIT..." : "Neue FIT-Datei herunterladen"}
              </button>
            </div>
          </div>

          {inspectData ? (
            <>
              <div className="card">
                <div className="section-title-row fit-section-head">
                  <h2>Übersicht</h2>
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
                    <span>Power-Records</span>
                    <strong>{inspectData.power_record_count}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Ø Watt original</span>
                    <strong>{inspectData.avg_power} W</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Ø Watt Vorschau</span>
                    <strong>{overallAfter.avg} W</strong>
                  </div>
                </div>

                <div className="fit-chart-toolbar">
                  <div className="fit-chart-meta">
                    <span>Ansicht: {formatSeconds(viewStart)} bis {formatSeconds(viewEnd)}</span>
                    <span>Auswahl: {formatSeconds(rangeStart)} bis {formatSeconds(rangeEnd)}</span>
                  </div>
                  <div className="settings-actions">
                    <button className="secondary-button" type="button" onClick={resetZoom} disabled={!zoomed}>
                      Zoom zurücksetzen
                    </button>
                    <button className="secondary-button" type="button" onClick={resetSelection}>
                      Alles zurücksetzen
                    </button>
                  </div>
                </div>

                <div
                  ref={chartRef}
                  className="fit-power-chart fit-power-chart-selectable"
                  onPointerDown={handleChartPointerDown}
                  onPointerMove={handleChartPointerMove}
                  onPointerUp={finalizeChartSelection}
                  onPointerLeave={handleChartPointerLeave}
                >
                  {hoveredSeries ? (
                    <div className="fit-chart-tooltip" style={{ left: hoveredTooltipLeft }}>
                      <strong>Orig: {hoveredOriginalSeries?.avg_power ?? hoveredSeries.avg_power} W</strong>
                      <strong>Neu: {hoveredSeries.avg_power} W</strong>
                      <span>
                        {formatSeconds(hoveredSeries.start_second)} – {formatSeconds(hoveredSeries.end_second)}
                      </span>
                    </div>
                  ) : null}
                  {visibleSeries.map((item, index) => {
                    const originalItem = originalVisibleSeries[index];
                    const originalAvg = originalItem?.avg_power ?? item.avg_power;
                    const previewAvg = item.avg_power;
                    const delta = previewAvg - originalAvg;
                    const highlighted =
                      activeHighlight !== null &&
                      index >= activeHighlight.startIndex &&
                      index <= activeHighlight.endIndex;
                    const originalHeight = `${Math.max(8, Math.round((originalAvg / maxChartPower) * 100))}%`;
                    const previewHeight = `${Math.max(8, Math.round((previewAvg / maxChartPower) * 100))}%`;
                    const capHeight =
                      delta > 0 ? `${Math.max(6, Math.round((delta / maxChartPower) * 100))}%` : "0%";
                    return (
                      <div
                        key={`${item.start_second}-${item.end_second}`}
                        className={`fit-power-bar-stack ${highlighted ? "selected" : ""}`}
                        title={`${formatSeconds(item.start_second)} – ${formatSeconds(item.end_second)} | Orig: ${originalAvg} W | Neu: ${previewAvg} W`}
                      >
                        <div className="fit-power-bar fit-power-bar-original" style={{ height: originalHeight }} />
                        {delta > 0 ? (
                          <div
                            className="fit-power-bar fit-power-bar-cap"
                            style={{ bottom: originalHeight, height: capHeight }}
                          />
                        ) : null}
                        {delta < 0 ? (
                          <div className="fit-power-bar fit-power-bar-marker" style={{ bottom: previewHeight }} />
                        ) : null}
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
                  In der Grafik kannst du direkt einen Bereich markieren. Die Ansicht zoomt anschließend auf den gewählten Abschnitt.
                </p>
                <div className="fit-chart-legend">
                  <span><i className="legend-swatch original" /> Original</span>
                  <span><i className="legend-swatch preview" /> Änderung oben drauf</span>
                </div>
              </div>

              <div className="card">
                <div className="section-title-row">
                  <h2>Bereich auswählen</h2>
                </div>

                <div className="fit-range-grid">
                  <label className="settings-label">
                    Start
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      max={inspectData.duration_seconds}
                      value={rangeStart}
                      onChange={(event) => clampRangeStart(Number(event.target.value))}
                    />
                    <span className="fit-inline-help">{formatSeconds(rangeStart)}</span>
                  </label>
                  <label className="settings-label">
                    Ende
                    <input
                      className="settings-input"
                      type="number"
                      min={rangeStart}
                      max={inspectData.duration_seconds}
                      value={rangeEnd}
                      onChange={(event) => clampRangeEnd(Number(event.target.value))}
                    />
                    <span className="fit-inline-help">{formatSeconds(rangeEnd)}</span>
                  </label>
                </div>

                <div className="fit-dual-range">
                  <div className="fit-dual-range-head">
                    <strong>Bereich per Slider eingrenzen</strong>
                    <span>{formatSeconds(rangeStart)} bis {formatSeconds(rangeEnd)}</span>
                  </div>
                  <div className="fit-dual-range-track">
                    <div className="fit-dual-range-line" />
                    <div
                      className="fit-dual-range-active"
                      style={{
                        left: `${rangeStartPercent}%`,
                        width: `${Math.max(rangeEndPercent - rangeStartPercent, 0)}%`,
                      }}
                    />
                    <input
                      className="fit-dual-range-input"
                      type="range"
                      min={0}
                      max={inspectData.duration_seconds}
                      value={rangeStart}
                      onChange={(event) => clampRangeStart(Number(event.target.value))}
                    />
                    <input
                      className="fit-dual-range-input"
                      type="range"
                      min={0}
                      max={inspectData.duration_seconds}
                      value={rangeEnd}
                      onChange={(event) => clampRangeEnd(Number(event.target.value))}
                    />
                  </div>
                  <div className="fit-dual-range-labels">
                    <span>0:00</span>
                    <span>{formatSeconds(inspectData.duration_seconds)}</span>
                  </div>
                </div>

                <div className="fit-summary-compare">
                  <article className="fit-summary-card">
                    <span>Bereich vorher</span>
                    <strong>{currentRangeBefore.avg} W</strong>
                    <p>Max {currentRangeBefore.max} W · {currentRangeBefore.count} Records</p>
                  </article>
                  <article className="fit-summary-card fit-summary-card-accent">
                    <span>Bereich nachher</span>
                    <strong>{currentRangeAfter.avg} W</strong>
                    <p>Max {currentRangeAfter.max} W · {currentRangeAfter.count} Records</p>
                  </article>
                </div>
              </div>

              <div className="card">
                <div className="section-title-row">
                  <h2>Watt-Anpassung</h2>
                </div>
                <div className="fit-mode-row">
                  <button
                    className={`fit-mode-button ${mode === "percent" ? "active" : ""}`}
                    type="button"
                    onClick={() => setMode("percent")}
                  >
                    Prozentual
                  </button>
                  <button
                    className={`fit-mode-button ${mode === "fixed" ? "active" : ""}`}
                    type="button"
                    onClick={() => setMode("fixed")}
                  >
                    Fix
                  </button>
                </div>

                <div className="fit-range-grid">
                  <label className="settings-label">
                    {mode === "percent" ? "Änderung in %" : "Änderung in Watt"}
                    <input
                      className="settings-input"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder={mode === "percent" ? "z. B. 5" : "z. B. 20"}
                    />
                  </label>
                  <div className="settings-label">
                    Auswahl
                    <div className="settings-input settings-static-field">
                      {formatSeconds(rangeStart)} bis {formatSeconds(rangeEnd)}
                    </div>
                  </div>
                </div>

                <div className="settings-actions">
                  <button className="primary-button" type="button" onClick={addAdjustment}>
                    Bereich zur Liste hinzufügen
                  </button>
                </div>
                <p className="fit-chart-caption">
                  Prozentual skaliert bestehende Watt-Werte. Fix addiert oder subtrahiert eine feste Watt-Zahl im gewählten Bereich.
                </p>
              </div>

              <div className="card">
                <div className="section-title-row">
                  <h2>Geplante Anpassungen</h2>
                  <span className="fit-repair-pill">{adjustments.length} aktiv</span>
                </div>
                <div className="fit-adjustment-list">
                  {adjustments.length === 0 ? <p>Noch keine Bereichsanpassungen angelegt.</p> : null}
                  {adjustments.map((item) => (
                    <article className="fit-adjustment-item" key={item.id}>
                      <div>
                        <strong>
                          {formatSeconds(item.start_second)} bis {formatSeconds(item.end_second)}
                        </strong>
                        <p>{item.mode === "percent" ? `Prozentual ${item.value}%` : `Fix ${item.value} W`}</p>
                      </div>
                      <button className="icon-button danger" type="button" onClick={() => removeAdjustment(item.id)} aria-label="Anpassung entfernen">
                        ×
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
