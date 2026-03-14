import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { apiFetch } from "./api";
import { clearAuthToken, getAuthToken } from "./auth";
import { ActivitiesWeekPage } from "./pages/ActivitiesWeekPage";
import { CheckRidesPage } from "./pages/CheckRidesPage";
import { HomePage } from "./pages/HomePage";
import { IngredientsPage } from "./pages/IngredientsPage";
import { LoginPage } from "./pages/LoginPage";
import { NutritionPage } from "./pages/NutritionPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RecipesPage } from "./pages/RecipesPage";
import { SettingsPage } from "./pages/SettingsPage";

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
];

function SidebarGroup({
  label,
  open,
  onToggle,
  items,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  items: NavItem[];
}) {
  return (
    <div className="nav-group">
      <button className="nav-group-button" type="button" onClick={onToggle}>
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    setup: true,
    activities: true,
    nutrition: true,
  });

  const isHomeActive = useMemo(() => location.pathname === "/", [location.pathname]);

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

          {navGroups.map((group) => (
            <SidebarGroup
              key={group.key}
              label={group.label}
              open={Boolean(openGroups[group.key])}
              onToggle={() =>
                setOpenGroups((prev) => ({
                  ...prev,
                  [group.key]: !prev[group.key],
                }))
              }
              items={group.items}
            />
          ))}
        </nav>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/setup/settings" element={<SettingsPage />} />
          <Route path="/setup/check-rides" element={<CheckRidesPage />} />
          <Route path="/activities/week" element={<ActivitiesWeekPage />} />
          <Route path="/nutrition/entries" element={<NutritionPage />} />
          <Route path="/nutrition/ingredients" element={<IngredientsPage initialKind="base_ingredient" />} />
          <Route path="/nutrition/products" element={<IngredientsPage initialKind="product" />} />
          <Route path="/nutrition/recipes" element={<RecipesPage />} />
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
