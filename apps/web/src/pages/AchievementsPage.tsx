import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type AchievementRecordHistory = {
  achieved_at: string | null;
  achieved_at_label: string | null;
  value_numeric: number | null;
  value_label: string | null;
  summary: string | null;
  activity_id?: number | null;
  activity_name: string | null;
};

type AchievementItem = {
  key: string;
  title: string;
  detail: string;
  icon: string;
  status: "earned" | "locked";
  hint: string | null;
  accent: "endurance" | "weekly" | "record" | "zone" | "moment";
  achieved_at: string | null;
  achieved_at_label: string | null;
  activity_id?: number | null;
  activity_name?: string | null;
  current_value: number | null;
  current_value_label: string | null;
  record_info?: { metric: string; window: string; meaning: string } | null;
  record_history: AchievementRecordHistory[];
};

type HfBucketValue = {
  avg_hr_bpm: number;
  avg_power_w: number | null;
  activity_name: string;
  activity_id: number;
  achieved_at: string | null;
  achieved_at_label: string | null;
  proof?: string | null;
};

type AchievementCategory = {
  id: string;
  label: string;
  description: string;
  items: AchievementItem[];
  kind?: "trophies" | "hf_buckets";
  hf_bucket_matrix?: {
    windows: Array<{ key: string; seconds: number; label: string }>;
    rows: Array<{
      bucket_start_w: number;
      bucket_end_w: number;
      bucket_label: string;
      values: Array<HfBucketValue | null>;
    }>;
    filled_cells: number;
    max_bucket_label: string | null;
  } | null;
};

type AchievementSectionResponse = {
  section_key: string;
  title: string;
  eyebrow: string;
  intro: string;
  categories?: AchievementCategory[];
  cards?: Array<{ title: string; description: string }>;
};

type AchievementStatusResponse = {
  status: string;
  achievements?: {
    current_check_version: number;
    total_activities: number;
    checked_activities: number;
    open_activities: number;
  } | null;
};

type AchievementsPageProps = {
  initialSection?: string;
};

/* const sectionKeyMap: Record<string, string> = {
  Radfahren: "cycling",
  Ernährung: "nutrition",
  Ernährung: "nutrition",
  Gesundheit: "health",
}; */
const sectionKeyMap: Record<string, string> = {
  Radfahren: "cycling",
  Ernährung: "nutrition",
  Gesundheit: "health",
};

function statusLabel(status: "earned" | "locked"): string {
  return status === "earned" ? "Erreicht" : "Noch offen";
}

function categoryProgressLabel(category: AchievementCategory): string {
  if (category.kind === "hf_buckets") {
    const filled = category.hf_bucket_matrix?.filled_cells ?? 0;
    const rows = category.hf_bucket_matrix?.rows.length ?? 0;
    const windows = category.hf_bucket_matrix?.windows.length ?? 0;
    return `${filled} Felder aus ${rows * windows}`;
  }
  return `${category.items.filter((item) => item.status === "earned").length}/${category.items.length} erreicht`;
}

export function AchievementsPage({ initialSection = "Radfahren" }: AchievementsPageProps) {
  const [data, setData] = useState<AchievementSectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [statusInfo, setStatusInfo] = useState<AchievementStatusResponse["achievements"] | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const sectionKey = sectionKeyMap[initialSection] ?? "cycling";
        const [statusResponse, response] = await Promise.all([
          apiFetch(`${API_BASE_URL}/activities/recheck-history/status`),
          apiFetch(`${API_BASE_URL}/achievements/${sectionKey}`),
        ]);
        const statusPayload = (await statusResponse.json()) as AchievementStatusResponse | { detail?: string };
        setStatusInfo(statusResponse.ok ? (statusPayload as AchievementStatusResponse).achievements ?? null : null);
        const payload = (await response.json()) as AchievementSectionResponse | { detail?: string };
        if (!response.ok) {
          throw new Error("detail" in payload && payload.detail ? payload.detail : "Achievements konnten nicht geladen werden.");
        }
        const nextData = payload as AchievementSectionResponse;
        setData(nextData);
        setActiveCategory(nextData.categories?.[0]?.id ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unbekannter Fehler");
        setData(null);
        setActiveCategory("");
        setStatusInfo(null);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [initialSection]);

  const activeCategoryData = data?.categories?.find((category) => category.id === activeCategory) ?? data?.categories?.[0];
  const isHfCategory = activeCategoryData?.kind === "hf_buckets";
  const summaryUnlocked = isHfCategory
    ? activeCategoryData?.hf_bucket_matrix?.filled_cells ?? 0
    : activeCategoryData?.items.filter((item) => item.status === "earned").length ?? 0;
  const summaryTotal = isHfCategory
    ? (activeCategoryData?.hf_bucket_matrix?.rows.length ?? 0) * (activeCategoryData?.hf_bucket_matrix?.windows.length ?? 0)
    : activeCategoryData?.items.length ?? 0;
  const nextOpen = isHfCategory
    ? activeCategoryData?.hf_bucket_matrix?.max_bucket_label ?? "Noch keine Daten"
    : activeCategoryData?.items.find((item) => item.status === "locked")?.title ?? "Alle erreicht";

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Achievements</p>
        <h1>Erfolge mit Charakter</h1>
        <p className="lead legacy-encoding-hidden">
          Radfahren ist jetzt der erste große Bereich. Ernährung und Gesundheit sind vorbereitet und lassen sich später ebenfalls datenbasiert ausbauen.
        </p>
        <p className="lead">
          Radfahren ist jetzt der erste große Bereich. Ernährung und Gesundheit sind vorbereitet und lassen sich später ebenfalls datenbasiert ausbauen.
        </p>
        {statusInfo ? (
          <div className="achievement-inline-status">
            <span>Cache: {statusInfo.checked_activities} geprüft</span>
            <span>Offen: {statusInfo.open_activities}</span>
            <span>Version: {statusInfo.current_check_version}</span>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="card achievement-loading-card">
          <p><strong>Lade gespeicherte Achievements...</strong></p>
          <p className="training-note">Dabei werden zuerst vorhandene Ergebnisse geladen. Offene Aktivitäten werden nicht bei jedem Seitenaufruf komplett neu analysiert.</p>
        </div>
      ) : error ? (
        <div className="card"><p className="error-text">{error}</p></div>
      ) : (
        <div className="achievement-cycling-layout achievement-cycling-layout-single-nav">
          {data?.section_key === "cycling" ? (
            <aside className="achievement-side-nav card">
              <p className="achievement-kicker">Radfahren</p>
              <h2>Kategorien</h2>
              <div className="achievement-side-list">
                {data.categories?.map((category) => (
                  <button
                    key={category.id}
                    className={`achievement-side-button ${activeCategoryData?.id === category.id ? "active" : ""}`}
                    type="button"
                    onClick={() => setActiveCategory(category.id)}
                  >
                    <strong>{category.label}</strong>
                    <span>{category.description}</span>
                    <small>{categoryProgressLabel(category)}</small>
                  </button>
                ))}
              </div>
            </aside>
          ) : null}

          <div className="achievement-content-stack">
            {data?.section_key === "cycling" && activeCategoryData ? (
              <>
                <section className="hero achievement-hero-panel">
                  <p className="eyebrow">{data.title}</p>
                  <h2>{activeCategoryData.label}</h2>
                  <p className="lead">{activeCategoryData.description}</p>
                  <div className="achievement-summary-grid">
                    <div className="achievement-summary-card">
                      <span>{isHfCategory ? "Gefüllte Felder" : "Erreicht"}</span>
                      <strong>{summaryUnlocked} / {summaryTotal}</strong>
                    </div>
                    <div className="achievement-summary-card">
                      <span>{isHfCategory ? "Höchster Bereich" : "Nächstes Ziel"}</span>
                      <strong>{nextOpen}</strong>
                    </div>
                  </div>
                  <div className="achievement-summary-grid legacy-encoding-hidden">
                    <div className="achievement-summary-card">
                      <span>{isHfCategory ? "Gefüllte Felder" : "Erreicht"}</span>
                      <strong>{summaryUnlocked} / {summaryTotal}</strong>
                    </div>
                    <div className="achievement-summary-card">
                      <span>{isHfCategory ? "Höchster Bereich" : "Nächstes Ziel"}</span>
                      <strong>{nextOpen}</strong>
                    </div>
                  </div>
                </section>

                {isHfCategory ? (
                  <div className="achievement-hf-board card">
                    <div className="achievement-hf-board-head">
                      <h3>Beste Durchschnitts-HF nach Wattbereich</h3>
                      <p>
                        Pro Zelle wird die niedrigste gefundene Durchschnitts-Herzfrequenz gezeigt, sobald der jeweilige
                        Durchschnittsbereich mindestens 130 W erreicht.
                      </p>
                    </div>

                    {activeCategoryData.hf_bucket_matrix?.rows.length ? (
                      <div className="achievement-hf-table-wrap">
                        <table className="achievement-hf-table">
                          <thead>
                            <tr>
                              <th className="achievement-hf-row-head">Wattbereich</th>
                              {activeCategoryData.hf_bucket_matrix.windows.map((window) => (
                                <th key={window.key} className="achievement-hf-col-head">{window.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {activeCategoryData.hf_bucket_matrix.rows.map((row) => (
                              <tr key={row.bucket_start_w}>
                                <th className="achievement-hf-row-head">{row.bucket_label}</th>
                                {row.values.map((value, index) => (
                                  <td key={`${row.bucket_start_w}-${activeCategoryData.hf_bucket_matrix?.windows[index]?.key ?? index}`}>
                                    {value ? (
                                      <Link className="achievement-hf-cell achievement-hf-cell-link" to={`/activities/${value.activity_id}`}>
                                        <strong>{Math.round(value.avg_hr_bpm)} bpm</strong>
                                        <span>{value.proof ?? (value.avg_power_w != null ? `Avg Power ${Math.round(value.avg_power_w)} W` : "HF Bestwert")}</span>
                                        <small>{value.achieved_at_label ?? "-"}</small>
                                        <div className="achievement-hf-hover-panel">
                                          <strong>{value.activity_name}</strong>
                                          <span>{value.achieved_at_label ?? "-"}</span>
                                          <span>Avg HF {Math.round(value.avg_hr_bpm)} bpm</span>
                                          <span>{value.proof ?? (value.avg_power_w != null ? `Avg Power ${Math.round(value.avg_power_w)} W` : "HF Bestwert")}</span>
                                          <p>Klick öffnet die zugehörige Fahrt.</p>
                                        </div>
                                      </Link>
                                    ) : (
                                      <div className="achievement-hf-cell achievement-hf-cell-empty">
                                        <span>Keine Daten</span>
                                      </div>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="achievement-empty-note">
                        Für diese HF-Auswertung sind noch nicht genug Leistungs- und Herzfrequenzdaten vorhanden.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="achievement-trophy-grid">
                    {activeCategoryData.items.map((item) => (
                      <article key={item.key} className={`achievement-trophy-card ${item.status === "earned" ? "earned" : "locked"}`}>
                        <div className="achievement-trophy-head">
                          <div className={`achievement-icon achievement-icon-${item.accent}`}>{item.icon}</div>
                          <span className={`achievement-status-chip ${item.status}`}>{statusLabel(item.status)}</span>
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.detail}</p>
                        {item.current_value_label ? <small>{item.current_value_label}</small> : null}
                        {item.achieved_at_label ? (
                          <small className="achievement-date-label">Erreicht am {item.achieved_at_label}</small>
                        ) : (
                          <small className="achievement-date-label">Noch nicht erreicht</small>
                        )}
                        {item.activity_id ? (
                          <Link className="achievement-date-label" to={`/activities/${item.activity_id}`}>
                            {item.activity_name ? `Ride ansehen: ${item.activity_name}` : "Ride ansehen"}
                          </Link>
                        ) : null}
                        {item.record_info ? (
                          <div className="achievement-hover-panel">
                            <strong>Mehr Info</strong>
                            <span>{item.record_info.metric}</span>
                            <span>{item.record_info.window}</span>
                            <p>{item.record_info.meaning}</p>
                            {item.record_history.length > 0 ? (
                              <div className="achievement-history-list">
                                {item.record_history.map((entry, index) => (
                                  <div key={`${item.key}-${index}`} className="achievement-history-row">
                                    <strong>{entry.value_label ?? "-"}</strong>
                                    <span>{entry.achieved_at_label ?? "-"}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : data?.section_key === "cycling" ? (
              <div className="card achievement-loading-card">
                <h2>Noch keine gespeicherten Achievements</h2>
                <p className="training-note">
                  Für die Achievement-Seite liegen aktuell noch keine gespeicherten Ergebnisse vor. Nutze den Recheck oder importiere einen neuen Ride, damit die Daten aufgebaut werden.
                </p>
              </div>
            ) : (
              <>
                <section className="hero achievement-hero-panel">
                  <p className="eyebrow">{data?.eyebrow}</p>
                  <h2>{data?.title}</h2>
                  <p className="lead">{data?.intro}</p>
                </section>

                <div className="achievements-grid">
                  {data?.cards?.map((card) => (
                    <article key={card.title} className="card achievement-card">
                      <p className="achievement-kicker">{data.title}</p>
                      <h2>{card.title}</h2>
                      <p>{card.description}</p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
