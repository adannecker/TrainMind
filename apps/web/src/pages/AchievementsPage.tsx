import { useEffect, useState } from "react";

import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type AchievementRecordHistory = {
  achieved_at: string | null;
  achieved_at_label: string | null;
  value_numeric: number | null;
  value_label: string | null;
  summary: string | null;
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
  current_value: number | null;
  current_value_label: string | null;
  record_info?: { metric: string; window: string; meaning: string } | null;
  record_history: AchievementRecordHistory[];
};

type AchievementCategory = {
  id: string;
  label: string;
  description: string;
  items: AchievementItem[];
};

type AchievementSectionResponse = {
  section_key: string;
  title: string;
  eyebrow: string;
  intro: string;
  categories?: AchievementCategory[];
  cards?: Array<{ title: string; description: string }>;
};

type AchievementsPageProps = {
  initialSection?: string;
};

const sectionKeyMap: Record<string, string> = {
  Radfahren: "cycling",
  Ernährung: "nutrition",
  Gesundheit: "health",
};

function statusLabel(status: "earned" | "locked"): string {
  return status === "earned" ? "Erreicht" : "Noch offen";
}

export function AchievementsPage({ initialSection = "Radfahren" }: AchievementsPageProps) {
  const [data, setData] = useState<AchievementSectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const sectionKey = sectionKeyMap[initialSection] ?? "cycling";
        const response = await apiFetch(`${API_BASE_URL}/achievements/${sectionKey}`);
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
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [initialSection]);

  const activeCategoryData = data?.categories?.find((category) => category.id === activeCategory) ?? data?.categories?.[0];
  const summaryUnlocked = activeCategoryData?.items.filter((item) => item.status === "earned").length ?? 0;
  const summaryTotal = activeCategoryData?.items.length ?? 0;
  const nextOpen = activeCategoryData?.items.find((item) => item.status === "locked")?.title ?? "Alle erreicht";

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Achievements</p>
        <h1>Erfolge mit Charakter</h1>
        <p className="lead">
          Radfahren ist jetzt der erste große Bereich. Ernährung und Gesundheit sind vorbereitet und lassen sich später ebenfalls datenbasiert ausbauen.
        </p>
      </div>

      {loading ? (
        <div className="card"><p>Lade Achievements...</p></div>
      ) : error ? (
        <div className="card"><p className="error-text">{error}</p></div>
      ) : (
        <div className="achievement-cycling-layout achievement-cycling-layout-single-nav">
          {data?.section_key === "cycling" ? (
            <aside className="achievement-side-nav card">
              <p className="achievement-kicker">Radfahren</p>
              <h2>Kategorien</h2>
              <div className="achievement-side-list">
                {data.categories?.map((category) => {
                  const unlocked = category.items.filter((item) => item.status === "earned").length;
                  return (
                    <button
                      key={category.id}
                      className={`achievement-side-button ${activeCategoryData?.id === category.id ? "active" : ""}`}
                      type="button"
                      onClick={() => setActiveCategory(category.id)}
                    >
                      <strong>{category.label}</strong>
                      <span>{category.description}</span>
                      <small>{unlocked}/{category.items.length} erreicht</small>
                    </button>
                  );
                })}
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
                      <span>Erreicht</span>
                      <strong>{summaryUnlocked} / {summaryTotal}</strong>
                    </div>
                    <div className="achievement-summary-card">
                      <span>Nächstes Ziel</span>
                      <strong>{nextOpen}</strong>
                    </div>
                  </div>
                </section>

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
              </>
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
