import { useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

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
      { label: "Neue Rides prüfen", to: "/setup/check-rides" }
    ]
  },
  {
    key: "activities",
    label: "Aktivitäten",
    items: [{ label: "Alle Aktivitäten", to: "/activities/all" }]
  }
];

function SidebarGroup({
  label,
  open,
  onToggle,
  items
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    setup: true,
    activities: true
  });

  const isHomeActive = useMemo(() => location.pathname === "/", [location.pathname]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-dot" />
          <div>
            <p className="brand-name">TrainMind</p>
            <p className="brand-sub">Prototype UI</p>
          </div>
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
                  [group.key]: !prev[group.key]
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
          <Route
            path="/setup/settings"
            element={
              <PlaceholderPage
                badge="Setup"
                title="Einstellungen"
                description="Hier kommen globale Einstellungen, Accounts und Sync-Optionen hin."
              />
            }
          />
          <Route
            path="/setup/check-rides"
            element={
              <PlaceholderPage
                badge="Setup"
                title="Neue Rides prüfen"
                description="Hier siehst du später, wie viele Garmin-Rides noch importiert werden können."
              />
            }
          />
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
    </div>
  );
}

export default Layout;
