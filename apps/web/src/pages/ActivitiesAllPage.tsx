import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type ActivityRow = {
  id: number;
  external_id: string;
  name: string;
  provider: string | null;
  sport: string | null;
  started_at: string | null;
  duration_s: number | null;
  duration_label: string | null;
  distance_m: number | null;
  avg_power_w: number | null;
  avg_hr_bpm: number | null;
  avg_speed_kmh: number | null;
  stress_score: number | null;
};

type ActivitiesResponse = {
  activities: ActivityRow[];
  filters: {
    providers: string[];
    sports: string[];
  };
  summary: {
    count: number;
  };
};

type SortKey =
  | "started_at"
  | "name"
  | "sport"
  | "provider"
  | "duration_s"
  | "distance_m"
  | "avg_power_w"
  | "avg_hr_bpm";

type ColumnKey =
  | "started_at"
  | "name"
  | "sport"
  | "provider"
  | "garmin_id"
  | "duration"
  | "distance"
  | "avg_speed"
  | "avg_power"
  | "avg_hr"
  | "stress"
  | "external_id";

type ColumnDef = {
  key: ColumnKey;
  label: string;
  sortable?: SortKey;
  render: (row: ActivityRow) => string;
};

type AdvancedFilters = {
  avgPowerMin: string;
  avgPowerMax: string;
  avgHrMin: string;
  avgHrMax: string;
  avgSpeedMin: string;
  avgSpeedMax: string;
  distanceMinKm: string;
  distanceMaxKm: string;
  durationMinMin: string;
  durationMaxMin: string;
};

const COLUMN_STORAGE_KEY = "trainmind.activities.columns";
const DEFAULT_COLUMNS: ColumnKey[] = ["started_at", "name", "sport", "garmin_id", "distance", "duration", "avg_power", "avg_hr"];

const COLUMN_DEFS: ColumnDef[] = [
  {
    key: "started_at",
    label: "Start",
    sortable: "started_at",
    render: (row) => formatDateTime(row.started_at),
  },
  {
    key: "name",
    label: "Name",
    sortable: "name",
    render: (row) => row.name,
  },
  {
    key: "sport",
    label: "Sport",
    sortable: "sport",
    render: (row) => row.sport || "-",
  },
  {
    key: "provider",
    label: "Provider",
    sortable: "provider",
    render: (row) => row.provider || "-",
  },
  {
    key: "garmin_id",
    label: "Garmin-ID",
    render: (row) => ((row.provider || "").toLowerCase() === "garmin" ? row.external_id || "-" : "-"),
  },
  {
    key: "duration",
    label: "Dauer",
    sortable: "duration_s",
    render: (row) => row.duration_label || "-",
  },
  {
    key: "distance",
    label: "Distanz",
    sortable: "distance_m",
    render: (row) => formatDistance(row.distance_m),
  },
  {
    key: "avg_speed",
    label: "Ø km/h",
    render: (row) => formatDecimal(row.avg_speed_kmh, 1),
  },
  {
    key: "avg_power",
    label: "Ø Watt",
    sortable: "avg_power_w",
    render: (row) => formatInteger(row.avg_power_w, "W"),
  },
  {
    key: "avg_hr",
    label: "Ø HF",
    sortable: "avg_hr_bpm",
    render: (row) => formatInteger(row.avg_hr_bpm, "bpm"),
  },
  {
    key: "stress",
    label: "Stress",
    render: (row) => formatDecimal(row.stress_score, 1),
  },
  {
    key: "external_id",
    label: "Externe ID",
    render: (row) => row.external_id || "-",
  },
];

const EMPTY_ADVANCED_FILTERS: AdvancedFilters = {
  avgPowerMin: "",
  avgPowerMax: "",
  avgHrMin: "",
  avgHrMax: "",
  avgSpeedMin: "",
  avgSpeedMax: "",
  distanceMinKm: "",
  distanceMaxKm: "",
  durationMinMin: "",
  durationMaxMin: "",
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}

function formatDistance(value: number | null): string {
  if (value == null) return "-";
  return `${(value / 1000).toFixed(1)} km`;
}

function formatInteger(value: number | null, unit: string): string {
  if (value == null) return "-";
  return `${Math.round(value)} ${unit}`;
}

function formatDecimal(value: number | null, digits: number): string {
  if (value == null) return "-";
  return value.toFixed(digits);
}

function loadStoredColumns(): ColumnKey[] {
  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw) as ColumnKey[];
    const validKeys = new Set(COLUMN_DEFS.map((column) => column.key));
    const next = parsed.filter((key) => validKeys.has(key));
    return next.length ? next : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function hasAdvancedFilterValue(filters: AdvancedFilters): boolean {
  return Object.values(filters).some((value) => value.trim() !== "");
}

function addNumberParam(params: URLSearchParams, key: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;
  params.set(key, trimmed);
}

export function ActivitiesAllPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [sports, setSports] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [sport, setSport] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [columnOverlayOpen, setColumnOverlayOpen] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [sortBy, setSortBy] = useState<SortKey>("started_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => (typeof window === "undefined" ? DEFAULT_COLUMNS : loadStoredColumns()));
  const [deleteCandidate, setDeleteCandidate] = useState<ActivityRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const visibleColumnDefs = useMemo(
    () => COLUMN_DEFS.filter((column) => visibleColumns.includes(column.key)),
    [visibleColumns],
  );

  useEffect(() => {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  async function loadActivities() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        sort_by: sortBy,
        sort_dir: sortDir,
        limit: "500",
      });
      if (query.trim()) params.set("q", query.trim());
      if (provider) params.set("provider", provider);
      if (sport) params.set("sport", sport);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      addNumberParam(params, "avg_power_min", advancedFilters.avgPowerMin);
      addNumberParam(params, "avg_power_max", advancedFilters.avgPowerMax);
      addNumberParam(params, "avg_hr_min", advancedFilters.avgHrMin);
      addNumberParam(params, "avg_hr_max", advancedFilters.avgHrMax);
      addNumberParam(params, "avg_speed_min", advancedFilters.avgSpeedMin);
      addNumberParam(params, "avg_speed_max", advancedFilters.avgSpeedMax);
      addNumberParam(params, "distance_min_km", advancedFilters.distanceMinKm);
      addNumberParam(params, "distance_max_km", advancedFilters.distanceMaxKm);
      addNumberParam(params, "duration_min_min", advancedFilters.durationMinMin);
      addNumberParam(params, "duration_max_min", advancedFilters.durationMaxMin);

      const response = await apiFetch(`${API_BASE_URL}/activities?${params.toString()}`);
      const payload = await parseJsonSafely<ActivitiesResponse | { detail?: string }>(response);
      if (!response.ok || !payload || !("activities" in payload)) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Aktivitäten konnten nicht geladen werden.");
      }
      setRows(payload.activities);
      setProviders(payload.filters.providers);
      setSports(payload.filters.sports);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadActivities();
  }, []);

  useEffect(() => {
    void loadActivities();
  }, [sortBy, sortDir]);

  function toggleColumn(columnKey: ColumnKey, checked: boolean) {
    setVisibleColumns((current) => {
      if (checked) {
        const next = [...current, columnKey];
        return COLUMN_DEFS.map((column) => column.key).filter((key) => next.includes(key));
      }
      if (current.length <= 1) return current;
      return current.filter((key) => key !== columnKey);
    });
  }

  function toggleSort(column: ColumnDef) {
    if (!column.sortable) return;
    if (sortBy === column.sortable) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column.sortable);
    setSortDir(column.sortable === "name" || column.sortable === "sport" || column.sortable === "provider" ? "asc" : "desc");
  }

  function updateAdvancedFilter(key: keyof AdvancedFilters, value: string) {
    setAdvancedFilters((current) => ({ ...current, [key]: value }));
  }

  function clearAdvancedFilters() {
    setAdvancedFilters(EMPTY_ADVANCED_FILTERS);
  }

  async function confirmDelete() {
    if (!deleteCandidate || deleting) return;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/activities/${deleteCandidate.id}`, {
        method: "DELETE",
      });
      const payload = await parseJsonSafely<{ name?: string; detail?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.detail || "Aktivität konnte nicht gelöscht werden.");
      }
      setMessage(`Aktivität gelöscht: ${payload?.name || deleteCandidate.name}`);
      setDeleteCandidate(null);
      await loadActivities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktivität konnte nicht gelöscht werden.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Aktivitäten</p>
        <h1>Alle Aktivitäten</h1>
        <p className="lead">Chronologische Tabelle mit frei wählbaren Spalten, Filtern, Sortierung und sicherem Lösch-Flow.</p>
      </div>

      <div className="card">
        <div className="section-title-row">
          <h2>Filter und Ansicht</h2>
          <div className="settings-actions">
            <button className="secondary-button" type="button" disabled={loading} onClick={() => void loadActivities()}>
              Neu laden
            </button>
          </div>
        </div>

        <div className="settings-status-grid" style={{ marginBottom: "0.6rem" }}>
          <label className="settings-label">
            <span>Suche</span>
            <input className="settings-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, Sport, Provider, ID" />
          </label>
          <label className="settings-label">
            <span>Provider</span>
            <select className="settings-input" value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="">Alle</option>
              {providers.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-label">
            <span>Sport</span>
            <select className="settings-input" value={sport} onChange={(event) => setSport(event.target.value)}>
              <option value="">Alle</option>
              {sports.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-label">
            <span>Von</span>
            <input className="settings-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="settings-label">
            <span>Bis</span>
            <input className="settings-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label className="settings-label">
            <span>&nbsp;</span>
            <button className="primary-button" type="button" disabled={loading} onClick={() => void loadActivities()}>
              Filter anwenden
            </button>
          </label>
        </div>

        <button
          type="button"
          className="secondary-button"
          style={{ marginBottom: advancedOpen ? "0.9rem" : "0.3rem" }}
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          Advanced {advancedOpen ? "−" : "+"}
        </button>

        {advancedOpen ? (
          <div className="settings-status-grid" style={{ marginBottom: "1rem" }}>
            <label className="settings-label">
              <span>Ø Watt von</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.avgPowerMin} onChange={(event) => updateAdvancedFilter("avgPowerMin", event.target.value)} placeholder="z. B. 180" />
            </label>
            <label className="settings-label">
              <span>Ø Watt bis</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.avgPowerMax} onChange={(event) => updateAdvancedFilter("avgPowerMax", event.target.value)} placeholder="z. B. 260" />
            </label>
            <label className="settings-label">
              <span>Ø HF von</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.avgHrMin} onChange={(event) => updateAdvancedFilter("avgHrMin", event.target.value)} placeholder="z. B. 120" />
            </label>
            <label className="settings-label">
              <span>Ø HF bis</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.avgHrMax} onChange={(event) => updateAdvancedFilter("avgHrMax", event.target.value)} placeholder="z. B. 165" />
            </label>
            <label className="settings-label">
              <span>Ø km/h von</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.avgSpeedMin} onChange={(event) => updateAdvancedFilter("avgSpeedMin", event.target.value)} placeholder="z. B. 25" />
            </label>
            <label className="settings-label">
              <span>Ø km/h bis</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.avgSpeedMax} onChange={(event) => updateAdvancedFilter("avgSpeedMax", event.target.value)} placeholder="z. B. 35" />
            </label>
            <label className="settings-label">
              <span>Distanz von km</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.distanceMinKm} onChange={(event) => updateAdvancedFilter("distanceMinKm", event.target.value)} placeholder="z. B. 40" />
            </label>
            <label className="settings-label">
              <span>Distanz bis km</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.distanceMaxKm} onChange={(event) => updateAdvancedFilter("distanceMaxKm", event.target.value)} placeholder="z. B. 120" />
            </label>
            <label className="settings-label">
              <span>Dauer von min</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.durationMinMin} onChange={(event) => updateAdvancedFilter("durationMinMin", event.target.value)} placeholder="z. B. 60" />
            </label>
            <label className="settings-label">
              <span>Dauer bis min</span>
              <input className="settings-input" inputMode="decimal" value={advancedFilters.durationMaxMin} onChange={(event) => updateAdvancedFilter("durationMaxMin", event.target.value)} placeholder="z. B. 180" />
            </label>
            <label className="settings-label">
              <span>&nbsp;</span>
              <button className="secondary-button" type="button" onClick={clearAdvancedFilters}>
                Advanced leeren
              </button>
            </label>
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p className="info-text">{message}</p> : null}
        <p className="training-note">
          {loading ? "Aktivitäten werden geladen..." : `${rows.length} Aktivitäten in der aktuellen Ansicht.${hasAdvancedFilterValue(advancedFilters) ? " Advanced-Filter aktiv." : ""}`}
        </p>
      </div>

      <div className="card rides-table-wrap">
        <div className="table-toolbar">
          <h2>Aktivitätenliste</h2>
          <button className="icon-button" type="button" aria-label="Tabellenspalten wählen" title="Tabellenspalten wählen" onClick={() => setColumnOverlayOpen(true)}>
            ☷
          </button>
        </div>

        <div className="table-scroll">
          <table className="rides-table">
            <thead>
              <tr>
                {visibleColumnDefs.map((column) => (
                  <th key={column.key}>
                    {column.sortable ? (
                      <button className="secondary-button" type="button" onClick={() => toggleSort(column)}>
                        {column.label} {sortBy === column.sortable ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumnDefs.length + 1}>Keine Aktivitäten für die aktuelle Filterung gefunden.</td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={row.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/activities/${row.id}`)}>
                  {visibleColumnDefs.map((column) => (
                    <td key={`${row.id}-${column.key}`}>{column.render(row)}</td>
                  ))}
                  <td>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label={`Aktivität ${row.name} löschen`}
                      title="Aktivität löschen"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteCandidate(row);
                      }}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {columnOverlayOpen ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Tabellenspalten auswählen" onClick={() => setColumnOverlayOpen(false)}>
          <div className="confirm-card training-overlay-card" style={{ width: "min(420px, calc(100vw - 2rem))" }} onClick={(event) => event.stopPropagation()}>
            <div className="training-overlay-head">
              <h2>Tabellenspalten</h2>
              <button className="icon-button" type="button" onClick={() => setColumnOverlayOpen(false)} aria-label="Overlay schließen">
                ×
              </button>
            </div>
            <p className="lead training-overlay-lead">Wähle aus, welche Spalten in der Aktivitätenliste sichtbar sein sollen.</p>
            <div className="settings-status-grid">
              {COLUMN_DEFS.map((column) => (
                <label key={column.key} className="settings-static-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input type="checkbox" checked={visibleColumns.includes(column.key)} onChange={(event) => toggleColumn(column.key, event.target.checked)} />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Aktivität löschen">
          <div className="confirm-card">
            <h2>Aktivität löschen?</h2>
            <p>
              Willst du die Aktivität <strong>{deleteCandidate.name}</strong> vom {formatDateTime(deleteCandidate.started_at)} wirklich löschen?
            </p>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" disabled={deleting} onClick={() => setDeleteCandidate(null)}>
                Abbrechen
              </button>
              <button className="primary-button" type="button" disabled={deleting} onClick={() => void confirmDelete()}>
                {deleting ? "Lösche..." : "Jetzt löschen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
