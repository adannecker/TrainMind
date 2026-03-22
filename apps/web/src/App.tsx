import { useEffect, useMemo, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { apiFetch } from "./api";
import { clearAuthToken, getAuthToken } from "./auth";
import { AchievementsPage } from "./pages/AchievementsPage";
import { ActivitiesWeekPage } from "./pages/ActivitiesWeekPage";
import { CheckRidesPage } from "./pages/CheckRidesPage";
import { FitRepairPage } from "./pages/FitRepairPage";
import { HomePage } from "./pages/HomePage";
import { IngredientsPage } from "./pages/IngredientsPage";
import { LoginPage } from "./pages/LoginPage";
import { NutritionPage } from "./pages/NutritionPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RecipesPage } from "./pages/RecipesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TrainingBasicsPage, TrainingConfigPage, TrainingPlansPage } from "./pages/TrainingPages";

type NavItem = {
  label: string;
  to: string;
};

type NavGroup = {
  key: string;
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    key: "setup",
    label: "Setup",
    items: [
      { label: "Einstellungen", to: "/setup/settings" },
      { label: "Neue Rides prüfen", to: "/setup/check-rides" },
      { label: "Fix FIT file", to: "/setup/fix-fit-file" },
    ],
  },
  {
    key: "activities",
    label: "Aktivitäten",
    items: [
      { label: "Wochenansicht", to: "/activities/week" },
      { label: "Alle Aktivitäten", to: "/activities/all" },
    ],
  },
  {
    key: "nutrition",
    label: "Ernährung",
    items: [
      { label: "Erfassen", to: "/nutrition/entries" },
      { label: "Zutaten", to: "/nutrition/ingredients" },
      { label: "Produkte", to: "/nutrition/products" },
      { label: "Rezepte", to: "/nutrition/recipes" },
    ],
  },
  {
    key: "training",
    label: "Training",
    items: [
      { label: "Grunddaten", to: "/training/basics" },
      { label: "Training Konfiguration", to: "/training/configuration" },
      { label: "Trainingspläne", to: "/training/plans" },
    ],
  },
  {
    key: "achievements",
    label: "Achievements",
    items: [
      { label: "Radfahren", to: "/achievements/cycling" },
      { label: "Ernährung", to: "/achievements/nutrition" },
      { label: "Gesundheit", to: "/achievements/health" },
    ],
  },
];

const NAV_GROUP_ORDER_STORAGE_KEY = "trainmind.navGroupOrder";

function SidebarGroup({
  groupKey,
  label,
  open,
  onToggle,
  items,
  draggable,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  groupKey: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  items: NavItem[];
  draggable?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: (event: ReactDragEvent<HTMLDivElement>, key: string) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>, key: string) => void;
  onDrop?: (event: ReactDragEvent<HTMLDivElement>, key: string) => void;
}) {
  return (
    <div
      className={`nav-group ${dragging ? "nav-group-dragging" : ""} ${dropTarget ? "nav-group-drop-target" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart ? (event) => onDragStart(event, groupKey) : undefined}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver ? (event) => onDragOver(event, groupKey) : undefined}
      onDrop={onDrop ? (event) => onDrop(event, groupKey) : undefined}
    >
      <button
        className="nav-group-button"
        type="button"
        onClick={onToggle}
        title="Klicken zum Auf- und Zuklappen, ziehen zum Tauschen"
      >
        <span>{label}</span>
        <span className={`chevron ${open ? "open" : ""}`}>v</span>
      </button>
      {open ? (
        <div className="nav-sub-list">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-sub-link ${isActive ? "active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Layout() {
  const location = useLocation();
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [userLabel, setUserLabel] = useState("User");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [groupOrder, setGroupOrder] = useState(() => {
    if (typeof window === "undefined") {
      return navGroups.map((group) => group.key);
    }
    const stored = window.localStorage.getItem(NAV_GROUP_ORDER_STORAGE_KEY);
    if (!stored) {
      return navGroups.map((group) => group.key);
    }
    try {
      const parsed = JSON.parse(stored) as string[];
      const validKeys = new Set(navGroups.map((group) => group.key));
      const normalized = parsed.filter((key) => validKeys.has(key));
      const missing = navGroups.map((group) => group.key).filter((key) => !normalized.includes(key));
      return normalized.length ? [...normalized, ...missing] : navGroups.map((group) => group.key);
    } catch {
      return navGroups.map((group) => group.key);
    }
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    setup: true,
    activities: true,
    nutrition: true,
    training: true,
    achievements: true,
  });
  const [draggedGroupKey, setDraggedGroupKey] = useState<string | null>(null);
  const [dropTargetGroupKey, setDropTargetGroupKey] = useState<string | null>(null);

  const isHomeActive = useMemo(() => location.pathname === "/", [location.pathname]);
  const orderedGroups = useMemo(() => {
    const groupMap = new Map(navGroups.map((group) => [group.key, group]));
    return groupOrder.map((key) => groupMap.get(key)).filter((group): group is NavGroup => Boolean(group));
  }, [groupOrder]);

  useEffect(() => {
    async function verifySession() {
      const token = getAuthToken();
      if (!token) {
        setAuthenticated(false);
        setAuthReady(true);
        return;
      }
      try {
        const response = await apiFetch("/api/auth/me");
        if (!response.ok) {
          clearAuthToken();
          setAuthenticated(false);
        } else {
          const me = (await response.json()) as { email?: string; display_name?: string };
          const fallbackFromEmail = (me.email ?? "").split("@")[0] || "User";
          setUserLabel((me.display_name || "").trim() || fallbackFromEmail);
          setAuthenticated(true);
        }
      } catch {
        clearAuthToken();
        setAuthenticated(false);
      } finally {
        setAuthReady(true);
      }
    }
    void verifySession();
  }, []);

  useEffect(() => {
    function handleUserLabelUpdate(event: Event) {
      const detail = (event as CustomEvent<{ displayName?: string }>).detail;
      const nextLabel = (detail?.displayName || "").trim();
      if (nextLabel) {
        setUserLabel(nextLabel);
      }
    }

    window.addEventListener("trainmind:user-label-updated", handleUserLabelUpdate);
    return () => window.removeEventListener("trainmind:user-label-updated", handleUserLabelUpdate);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(NAV_GROUP_ORDER_STORAGE_KEY, JSON.stringify(groupOrder));
  }, [groupOrder]);

  async function doLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    clearAuthToken();
    setAuthenticated(false);
    setUserLabel("User");
    setShowLogoutConfirm(false);
  }

  function swapGroups(sourceKey: string, targetKey: string) {
    if (sourceKey === targetKey) return;
    setGroupOrder((current) => {
      const sourceIndex = current.indexOf(sourceKey);
      const targetIndex = current.indexOf(targetKey);
      if (sourceIndex === -1 || targetIndex === -1) return current;
      const next = current.slice();
      [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
      return next;
    });
  }

  function handleGroupDragStart(event: ReactDragEvent<HTMLDivElement>, key: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
    setDraggedGroupKey(key);
    setDropTargetGroupKey(null);
  }

  function handleGroupDragOver(event: ReactDragEvent<HTMLDivElement>, key: string) {
    event.preventDefault();
    if (!draggedGroupKey || draggedGroupKey === key) {
      setDropTargetGroupKey(null);
      return;
    }
    event.dataTransfer.dropEffect = "move";
    setDropTargetGroupKey(key);
  }

  function handleGroupDrop(event: ReactDragEvent<HTMLDivElement>, key: string) {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData("text/plain") || draggedGroupKey;
    if (!sourceKey) return;
    swapGroups(sourceKey, key);
    setDraggedGroupKey(null);
    setDropTargetGroupKey(null);
  }

  function handleGroupDragEnd() {
    setDraggedGroupKey(null);
    setDropTargetGroupKey(null);
  }

  if (!authReady) {
    return (
      <main className="content">
        <section className="page">
          <div className="card">
            <p>Lade Session...</p>
          </div>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="content">
        <LoginPage onLoggedIn={() => setAuthenticated(true)} />
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-main">
            <div className="brand-dot" />
            <div>
              <p className="brand-name">TrainMind</p>
              <p className="brand-sub">Prototype UI</p>
              <p className="brand-user">{userLabel}</p>
            </div>
          </div>
          <button
            className="brand-logout-icon"
            type="button"
            title="Logout"
            onClick={() => setShowLogoutConfirm(true)}
          >
            {"\u23FB"}
          </button>
        </div>

        <nav className="nav">
          <Link to="/" className={`nav-link ${isHomeActive ? "active" : ""}`}>
            Startseite
          </Link>

          {orderedGroups.map((group) => (
            <SidebarGroup
              key={group.key}
              groupKey={group.key}
              label={group.label}
              open={Boolean(openGroups[group.key])}
              onToggle={() =>
                setOpenGroups((prev) => ({
                  ...prev,
                  [group.key]: !prev[group.key],
                }))
              }
              items={group.items}
              draggable
              dragging={draggedGroupKey === group.key}
              dropTarget={dropTargetGroupKey === group.key}
              onDragStart={handleGroupDragStart}
              onDragEnd={handleGroupDragEnd}
              onDragOver={handleGroupDragOver}
              onDrop={handleGroupDrop}
            />
          ))}
        </nav>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/setup/settings" element={<SettingsPage />} />
          <Route path="/setup/check-rides" element={<CheckRidesPage />} />
          <Route path="/setup/fix-fit-file" element={<FitRepairPage />} />
          <Route path="/activities/week" element={<ActivitiesWeekPage />} />
          <Route path="/nutrition/entries" element={<NutritionPage />} />
          <Route path="/nutrition/ingredients" element={<IngredientsPage initialKind="base_ingredient" />} />
          <Route path="/nutrition/products" element={<IngredientsPage initialKind="product" />} />
          <Route path="/nutrition/recipes" element={<RecipesPage />} />
          <Route path="/training/basics" element={<TrainingBasicsPage />} />
          <Route path="/training/configuration" element={<TrainingConfigPage />} />
          <Route path="/training/plans" element={<TrainingPlansPage />} />
          <Route path="/achievements/cycling" element={<AchievementsPage initialSection="Radfahren" />} />
          <Route path="/achievements/nutrition" element={<AchievementsPage initialSection="Ernährung" />} />
          <Route path="/achievements/health" element={<AchievementsPage initialSection="Gesundheit" />} />
          <Route
            path="/activities/all"
            element={
              <PlaceholderPage
                badge="Aktivitäten"
                title="Alle Aktivitäten"
                description="Diese Seite wird die komplette Aktivitätsliste mit Filter und Suche enthalten."
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {showLogoutConfirm ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Logout bestätigen">
          <div className="confirm-card">
            <h2>Logout</h2>
            <p>Willst du dich wirklich ausloggen?</p>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" onClick={() => setShowLogoutConfirm(false)}>
                Abbrechen
              </button>
              <button className="primary-button" type="button" onClick={() => void doLogout()}>
                Ausloggen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Layout;
