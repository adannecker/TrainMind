import { useEffect, useMemo, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { apiFetch } from "./api";
import { clearAuthToken, getAuthToken } from "./auth";
import { API_BASE_URL } from "./config";
import { AchievementsPage } from "./pages/AchievementsPage";
import { ActivityDetailPage } from "./pages/ActivityDetailPage";
import { ActivitiesAllPage } from "./pages/ActivitiesAllPage";
import { ActivitiesWeekPage } from "./pages/ActivitiesWeekPage";
import { CheckRidesPage } from "./pages/CheckRidesPage";
import { FitRepairPage } from "./pages/FitRepairPage";
import { HomePage } from "./pages/HomePage";
import { ImportFilesPage } from "./pages/ImportFilesPage";
import { IngredientsPage } from "./pages/IngredientsPage";
import { LoginPage } from "./pages/LoginPage";
import { NutritionPage } from "./pages/NutritionPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RecheckRidesPage } from "./pages/RecheckRidesPage";
import { RecipesPage } from "./pages/RecipesPage";
import { SetPasswordPage } from "./pages/SetPasswordPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ImpressumPage, PrivacyPage } from "./pages/LegalPages";
import {
  TrainingAnalysisPage,
  TrainingBasicsPage,
  TrainingConfigPage,
  TrainingHfDevelopmentPage,
  TrainingPlansPage,
} from "./pages/TrainingPages";

type NavItem = {
  label: string;
  to?: string;
  disabled?: boolean;
  note?: string;
  children?: NavItem[];
};

type NavGroup = {
  key: string;
  label: string;
  items: NavItem[];
};

type UserProfileNavSettings = {
  nav_group_order: string[] | null;
};

const navGroups: NavGroup[] = [
  {
    key: "setup",
    label: "Setup",
    items: [
      { label: "Einstellungen", to: "/setup/settings" },
      { label: "Neue Rides prüfen", to: "/setup/check-rides" },
    ],
  },
  {
    key: "helper",
    label: "Helper",
    items: [
      { label: "Recheck Achievements", to: "/helper/recheck-achievements" },
      { label: "Recheck Missing Data", to: "/helper/recheck-missing-data" },
    ],
  },
  {
    key: "tools",
    label: "Tools",
    items: [
      { label: "Import Files", to: "/tools/import-files" },
      { label: "Fix FIT file", to: "/tools/fix-fit-file" },
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
      {
        label: "Analyse",
        to: "/training/analysis",
        children: [{ label: "HF Entwicklung", to: "/training/analysis/hf-development" }],
      },
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

function getDefaultNavGroupOrder(): string[] {
  return navGroups.map((group) => group.key);
}

function normalizeNavGroupOrder(order: string[] | null | undefined): string[] {
  const defaultOrder = getDefaultNavGroupOrder();
  const validKeys = new Set(defaultOrder);
  const normalized = (order ?? []).filter((key, index, list) => validKeys.has(key) && list.indexOf(key) === index);
  if (!normalized.length) {
    return defaultOrder;
  }

  const result = normalized.slice();
  for (const key of defaultOrder) {
    if (result.includes(key)) continue;

    const defaultIndex = defaultOrder.indexOf(key);
    let insertAt = result.length;

    for (let index = defaultIndex + 1; index < defaultOrder.length; index += 1) {
      const nextKeyIndex = result.indexOf(defaultOrder[index]);
      if (nextKeyIndex !== -1) {
        insertAt = nextKeyIndex;
        break;
      }
    }

    if (insertAt === result.length) {
      for (let index = defaultIndex - 1; index >= 0; index -= 1) {
        const previousKeyIndex = result.indexOf(defaultOrder[index]);
        if (previousKeyIndex !== -1) {
          insertAt = previousKeyIndex + 1;
          break;
        }
      }
    }

    result.splice(insertAt, 0, key);
  }

  return result;
}

function navOrdersEqual(left: string[] | null, right: string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function SidebarGroup({
  groupKey,
  label,
  open,
  onToggle,
  items,
  currentPath,
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
  currentPath: string;
  draggable?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: (event: ReactDragEvent<HTMLDivElement>, key: string) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>, key: string) => void;
  onDrop?: (event: ReactDragEvent<HTMLDivElement>, key: string) => void;
}) {
  function isPathActive(path?: string): boolean {
    if (!path) return false;
    return currentPath === path || currentPath.startsWith(`${path}/`);
  }

  function renderItem(item: NavItem, depth = 0): JSX.Element {
    const hasChildren = Boolean(item.children?.length);
    const childActive = hasChildren ? item.children!.some((child) => isPathActive(child.to)) : false;
    const itemActive = isPathActive(item.to) || childActive;
    const className = `nav-sub-link ${depth > 0 ? "nav-sub-link-child" : ""} ${itemActive ? "active" : ""}`.trim();

    if (item.disabled && item.to !== "/setup/check-rides") {
      return (
        <div key={`${item.label}-${depth}`} className={`${className} disabled`} aria-disabled="true">
          <span>{item.label}</span>
          {item.note ? <small>{item.note}</small> : null}
        </div>
      );
    }

    if (hasChildren) {
      return (
        <div key={item.to ?? item.label} className="nav-sub-section">
          {item.to ? (
            <NavLink to={item.to} end className={() => className}>
              <span>{item.label}</span>
              {item.note ? <small>{item.note}</small> : null}
            </NavLink>
          ) : (
            <div className={className}>
              <span>{item.label}</span>
              {item.note ? <small>{item.note}</small> : null}
            </div>
          )}
          <div className="nav-sub-children">
            {item.children!.map((child) => renderItem(child, depth + 1))}
          </div>
        </div>
      );
    }

    if (item.to) {
      return (
        <NavLink key={item.to} to={item.to} end className={() => className}>
          <span>{item.label}</span>
          {item.note ? <small>{item.note}</small> : null}
        </NavLink>
      );
    }

    return (
      <div key={item.label} className={className}>
        <span>{item.label}</span>
        {item.note ? <small>{item.note}</small> : null}
      </div>
    );
  }

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
          {items.map((item) => renderItem(item))}
        </div>
      ) : null}
    </div>
  );
}

function Layout() {
  const location = useLocation();
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userLabel, setUserLabel] = useState("User");
  const [userRoleLabel, setUserRoleLabel] = useState("Nutzer");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [groupOrder, setGroupOrder] = useState(() => {
    if (typeof window === "undefined") {
      return getDefaultNavGroupOrder();
    }
    const stored = window.localStorage.getItem(NAV_GROUP_ORDER_STORAGE_KEY);
    if (!stored) {
      return getDefaultNavGroupOrder();
    }
    try {
      const parsed = JSON.parse(stored) as string[];
      return normalizeNavGroupOrder(parsed);
    } catch {
      return getDefaultNavGroupOrder();
    }
  });
  const [profileNavOrderLoaded, setProfileNavOrderLoaded] = useState(false);
  const [savedGroupOrder, setSavedGroupOrder] = useState<string[] | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    setup: true,
    helper: true,
    tools: true,
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
        setProfileNavOrderLoaded(true);
        setAuthReady(true);
        return;
      }
      try {
        const response = await apiFetch(`${API_BASE_URL}/auth/me`);
        if (!response.ok) {
          clearAuthToken();
          setAuthenticated(false);
          setProfileNavOrderLoaded(true);
        } else {
          const me = (await response.json()) as { email?: string; display_name?: string; is_admin?: boolean };
          const fallbackFromEmail = (me.email ?? "").split("@")[0] || "User";
          setIsAdmin(Boolean(me.is_admin));
          setUserLabel((me.display_name || "").trim() || fallbackFromEmail);
          setUserRoleLabel(me.is_admin ? "Admin" : "Nutzer");
          setAuthenticated(true);
          setProfileNavOrderLoaded(false);
        }
      } catch {
        clearAuthToken();
        setIsAdmin(false);
        setAuthenticated(false);
        setProfileNavOrderLoaded(true);
      } finally {
        setAuthReady(true);
      }
    }
    void verifySession();
  }, []);

  useEffect(() => {
    if (!authenticated || profileNavOrderLoaded) return;
    let cancelled = false;

    async function loadProfileNavOrder() {
      try {
        const profileResponse = await apiFetch(`${API_BASE_URL}/profile`);
        const profilePayload = (await profileResponse.json()) as UserProfileNavSettings;
        if (!profileResponse.ok) {
          throw new Error("Profil konnte nicht geladen werden.");
        }
        const nextOrder = normalizeNavGroupOrder(profilePayload.nav_group_order);
        if (cancelled) return;
        setGroupOrder(nextOrder);
        setSavedGroupOrder(nextOrder);
        window.localStorage.setItem(NAV_GROUP_ORDER_STORAGE_KEY, JSON.stringify(nextOrder));
      } catch {
        if (cancelled) return;
        setSavedGroupOrder(null);
      } finally {
        if (!cancelled) {
          setProfileNavOrderLoaded(true);
        }
      }
    }

    void loadProfileNavOrder();
    return () => {
      cancelled = true;
    };
  }, [authenticated, profileNavOrderLoaded]);

  useEffect(() => {
    function handleUserLabelUpdate(event: Event) {
      const detail = (event as CustomEvent<{ displayName?: string; roleLabel?: string; isAdmin?: boolean }>).detail;
      const nextLabel = (detail?.displayName || "").trim();
      if (nextLabel) {
        setUserLabel(nextLabel);
      }
      if (detail?.roleLabel) {
        setUserRoleLabel(detail.roleLabel);
      }
      if (typeof detail?.isAdmin === "boolean") {
        setIsAdmin(detail.isAdmin);
      }
    }

    window.addEventListener("trainmind:user-label-updated", handleUserLabelUpdate);
    return () => window.removeEventListener("trainmind:user-label-updated", handleUserLabelUpdate);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(NAV_GROUP_ORDER_STORAGE_KEY, JSON.stringify(groupOrder));
  }, [groupOrder]);

  useEffect(() => {
    if (!authenticated || !profileNavOrderLoaded) return;
    if (navOrdersEqual(savedGroupOrder, groupOrder)) return;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await apiFetch(`${API_BASE_URL}/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nav_group_order: groupOrder,
            }),
          });
          if (!response.ok) {
            throw new Error("Profil konnte nicht gespeichert werden.");
          }
          setSavedGroupOrder(groupOrder);
        } catch {
          // localStorage remains as fallback
        }
      })();
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [authenticated, groupOrder, profileNavOrderLoaded, savedGroupOrder]);

  async function doLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    clearAuthToken();
    setAuthenticated(false);
    setIsAdmin(false);
    setUserLabel("User");
    setSavedGroupOrder(null);
    setProfileNavOrderLoaded(false);
    setUserRoleLabel("Nutzer");
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
      <main className="content content-login content-with-footer">
        <div className="content-stack">
          <Routes>
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/impressum" element={<ImpressumPage />} />
            <Route path="/datenschutz" element={<PrivacyPage />} />
            <Route path="*" element={<LoginPage onLoggedIn={() => setAuthenticated(true)} />} />
          </Routes>
        </div>
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
              <p className="brand-user">{userLabel}</p>
              <p className="brand-sub">{userRoleLabel}</p>
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
          {isAdmin ? (
            <NavLink to="/setup/settings" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              Nutzerverwaltung
            </NavLink>
          ) : (
            <>
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
                  currentPath={location.pathname}
                  draggable
                  dragging={draggedGroupKey === group.key}
                  dropTarget={dropTargetGroupKey === group.key}
                  onDragStart={handleGroupDragStart}
                  onDragEnd={handleGroupDragEnd}
                  onDragOver={handleGroupDragOver}
                  onDrop={handleGroupDrop}
                />
              ))}
            </>
          )}
        </nav>
      </aside>

      <main className="content content-with-footer">
        <div className="content-stack">
          {isAdmin ? (
            <Routes>
              <Route path="/setup/settings" element={<SettingsPage />} />
              <Route path="/impressum" element={<ImpressumPage />} />
              <Route path="/datenschutz" element={<PrivacyPage />} />
              <Route path="*" element={<Navigate to="/setup/settings" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/setup/settings" element={<SettingsPage />} />
              <Route path="/setup/check-rides" element={<CheckRidesPage />} />
              <Route path="/setup/import-files" element={<Navigate to="/tools/import-files" replace />} />
              <Route path="/setup/recheck-rides" element={<Navigate to="/helper/recheck-achievements" replace />} />
              <Route path="/setup/fix-fit-file" element={<Navigate to="/tools/fix-fit-file" replace />} />
              <Route path="/helper/recheck-achievements" element={<RecheckRidesPage />} />
              <Route
                path="/helper/recheck-missing-data"
                element={
                  <PlaceholderPage
                    badge="Helper"
                    title="Recheck Missing Data"
                    description="Hier können wir künftig einmal komplett prüfen, ob berechnete Felder, Kennzahlen und Analyse-Caches für alle Aktivitäten vollständig belegt sind."
                  />
                }
              />
              <Route path="/tools/import-files" element={<ImportFilesPage />} />
              <Route path="/tools/fix-fit-file" element={<FitRepairPage />} />
              <Route path="/activities/week" element={<ActivitiesWeekPage />} />
              <Route path="/activities/:activityId" element={<ActivityDetailPage />} />
              <Route path="/nutrition/entries" element={<NutritionPage />} />
              <Route path="/nutrition/ingredients" element={<IngredientsPage initialKind="base_ingredient" />} />
              <Route path="/nutrition/products" element={<IngredientsPage initialKind="product" />} />
              <Route path="/nutrition/recipes" element={<RecipesPage />} />
              <Route path="/training/basics" element={<TrainingBasicsPage />} />
              <Route path="/training/analysis" element={<TrainingAnalysisPage />} />
              <Route path="/training/analysis/hf-development" element={<TrainingHfDevelopmentPage />} />
              <Route path="/training/configuration" element={<TrainingConfigPage />} />
              <Route path="/training/plans" element={<TrainingPlansPage />} />
              <Route path="/achievements/cycling" element={<AchievementsPage initialSection="Radfahren" />} />
              <Route path="/achievements/nutrition" element={<AchievementsPage initialSection="Ernährung" />} />
              <Route path="/achievements/health" element={<AchievementsPage initialSection="Gesundheit" />} />
              <Route path="/set-password" element={<SetPasswordPage />} />
              <Route path="/impressum" element={<ImpressumPage />} />
              <Route path="/datenschutz" element={<PrivacyPage />} />
              <Route path="/activities/all" element={<ActivitiesAllPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </div>
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
