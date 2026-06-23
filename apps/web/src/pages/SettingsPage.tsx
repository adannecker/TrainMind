import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { API_BASE_URL } from "../config";

type SettingsTab = "personal" | "garmin" | "withings" | "llm" | "admin";

type CredentialStatus = {
  provider: string;
  has_encrypted_credentials: boolean;
  has_env_credentials: boolean;
  active_source: "db" | "env" | "none";
};

type GarminSessionStatus = {
  provider: string;
  active_source: "env" | "none";
  email_configured: boolean;
  token_files_present: boolean;
  tokenstore_path: string;
  auth_mode: string | null;
  login_ok: boolean | null;
};

type WithingsStatus = {
  provider: string;
  configured: boolean;
  connected: boolean;
  redirect_uri: string | null;
  redirect_configured?: boolean;
  credential_source?: "user" | "env" | "none";
  has_user_app_credentials?: boolean;
  has_env_app_credentials?: boolean;
  client_id_hint?: string | null;
  scopes: string;
  userid: string | null;
  scope: string | null;
  expires_at: string | null;
};

type LlmStatus = {
  provider: string;
  configured: boolean;
  key_hint: string | null;
  key_source?: "user" | "env" | "none";
  has_user_key?: boolean;
  has_env_key?: boolean;
  model: string | null;
  admin_key_configured: boolean;
  balance_available: boolean;
  balance_value: number | null;
  balance_currency: string | null;
  balance_note: string | null;
  org_costs: {
    today: LlmCostSummary;
    last_7_days: LlmCostSummary;
    last_30_days: LlmCostSummary;
  };
  local_usage: LlmLocalUsage;
  recent_events: LlmRecentEvent[];
};

type LlmCostSummary = {
  available: boolean;
  value: number | null;
  currency: string | null;
  message: string | null;
};

type LlmLocalUsage = {
  last_7_days_requests: number;
  last_30_days_requests: number;
  last_30_days_success: number;
  last_30_days_errors: number;
  last_30_days_input_tokens: number;
  last_30_days_output_tokens: number;
  last_30_days_total_tokens: number;
  last_used_at: string | null;
};

type LlmRecentEvent = {
  id: number;
  feature_key: string;
  model: string | null;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
  error_message: string | null;
};

type UserProfile = {
  email?: string;
  display_name: string;
  date_of_birth: string | null;
  gender: string | null;
  height_cm: number | null;
  current_weight_kg: number | null;
  target_weight_kg: number | null;
  start_weight_kg: number | null;
  goal_start_date: string | null;
  goal_end_date: string | null;
  goal_period_days: number | null;
  weekly_target_hours: number | null;
  weekly_target_stress: number | null;
  training_config?: {
    sections?: Partial<
      Record<
        "profile" | "goals" | "week" | "sources",
        {
          focus_ids?: string[];
          notes?: string;
        }
      >
    >;
    updated_at?: string | null;
  } | null;
  training_plan?: {
    plan_title?: string;
    summary?: string;
  } | null;
  updated_at: string | null;
};

type AdminUser = {
  id: number;
  email: string;
  display_name: string;
  is_admin: boolean;
  has_password: boolean;
  created_at: string | null;
};

type InviteDelivery = {
  attempted?: boolean;
  sent?: boolean;
  detail?: string;
};

type AuthMe = {
  id: number;
  email: string;
  display_name: string;
  is_admin?: boolean;
};

const baseTabs: Array<{ id: Exclude<SettingsTab, "admin">; label: string; description: string }> = [
  { id: "personal", label: "Persönliche Daten", description: "Name und Zielrahmen pflegen" },
  { id: "garmin", label: "Garmin Zugang", description: ".env-Status und Verbindung pruefen" },
  { id: "withings", label: "Withings Zugang", description: "OAuth, Callback und Waage" },
  { id: "llm", label: "LLM Zugang", description: "OpenAI-Konfiguration prüfen" },
];

const trainingConfigSectionLabels: Record<"profile" | "goals" | "week" | "sources", string> = {
  profile: "Athletenprofil",
  goals: "Ziele und Eventkontext",
  week: "Wochenorganisation",
  sources: "Quellenbasiertes Setup",
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function normalizeGender(value: string | null | undefined): "male" | "female" | "unknown" {
  if (value === "male" || value === "female" || value === "unknown") return value;
  return "unknown";
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeTextValue(value: string | null | undefined): string {
  return (value || "").trim();
}

function formatCurrencyValue(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null) return "-";
  const normalizedCurrency = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${normalizedCurrency}`;
  }
}

function formatTokenCount(value: number | null | undefined): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("de-DE").format(value);
}

function formatLlmFeatureLabel(value: string): string {
  if (value === "training_plan:derive") return "Trainingsplan";
  if (value === "training_config:profile") return "Athletenprofil";
  if (value === "training_config:goals") return "Ziele";
  if (value === "training_config:week") return "Wochenorganisation";
  if (value === "training_config:sources") return "Quellen";
  return value;
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("personal");
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [sessionStatus, setSessionStatus] = useState<GarminSessionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [withingsStatus, setWithingsStatus] = useState<WithingsStatus | null>(null);
  const [withingsLoading, setWithingsLoading] = useState(true);
  const [withingsConnecting, setWithingsConnecting] = useState(false);
  const [withingsError, setWithingsError] = useState<string | null>(null);
  const [withingsClientId, setWithingsClientId] = useState("");
  const [withingsClientSecret, setWithingsClientSecret] = useState("");
  const [withingsSaving, setWithingsSaving] = useState(false);
  const [withingsMessage, setWithingsMessage] = useState<string | null>(null);
  const [settingsHelp, setSettingsHelp] = useState<"withings" | "openai" | null>(null);

  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [llmLoading, setLlmLoading] = useState(true);
  const [llmError, setLlmError] = useState<string | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("unknown");
  const [heightCm, setHeightCm] = useState("");
  const [currentWeight, setCurrentWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [startWeight, setStartWeight] = useState("");
  const [goalStartDate, setGoalStartDate] = useState("");
  const [goalEndDate, setGoalEndDate] = useState("");
  const [weeklyTargetHours, setWeeklyTargetHours] = useState("");
  const [weeklyTargetStress, setWeeklyTargetStress] = useState("");
  const [garminEmail, setGarminEmail] = useState("");
  const [garminPassword, setGarminPassword] = useState("");
  const [garminRefreshing, setGarminRefreshing] = useState(false);
  const [garminMessage, setGarminMessage] = useState<string | null>(null);
  const [openAiKey, setOpenAiKey] = useState("");
  const [openAiSaving, setOpenAiSaving] = useState(false);
  const [openAiMessage, setOpenAiMessage] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [latestInviteUrl, setLatestInviteUrl] = useState("");

  const tabs = isAdmin ? [{ id: "admin" as const, label: "Admin", description: "Nutzer anlegen und löschen" }] : baseTabs;

  const personalDataChanged =
    normalizeTextValue(displayName) !== normalizeTextValue(profile?.display_name) ||
    dateOfBirth !== (profile?.date_of_birth || "") ||
    normalizeGender(gender) !== normalizeGender(profile?.gender) ||
    heightCm !== (profile?.height_cm == null ? "" : String(profile.height_cm));

  const trainingConfigSections = (Object.keys(trainingConfigSectionLabels) as Array<keyof typeof trainingConfigSectionLabels>).map((key) => ({
    key,
    title: trainingConfigSectionLabels[key],
    focusIds: profile?.training_config?.sections?.[key]?.focus_ids ?? [],
    notes: profile?.training_config?.sections?.[key]?.notes?.trim() ?? "",
  }));
  const hasTrainingConfig = trainingConfigSections.some((section) => section.focusIds.length || section.notes);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const [credentialsResponse, sessionResponse] = await Promise.all([
        apiFetch(`${API_BASE_URL}/garmin/credentials-status`),
        apiFetch(`${API_BASE_URL}/garmin/session-status`),
      ]);
      const credentialsPayload = await parseJsonSafely<CredentialStatus | { detail?: string }>(credentialsResponse);
      const sessionPayload = await parseJsonSafely<GarminSessionStatus | { detail?: string }>(sessionResponse);
      if (!credentialsResponse.ok) {
        throw new Error(typeof credentialsPayload === "object" && credentialsPayload && "detail" in credentialsPayload && credentialsPayload.detail ? credentialsPayload.detail : "Failed to load credential status");
      }
      if (!sessionResponse.ok) {
        throw new Error(typeof sessionPayload === "object" && sessionPayload && "detail" in sessionPayload && sessionPayload.detail ? sessionPayload.detail : "Garmin-Session konnte nicht geprueft werden.");
      }
      if (!credentialsPayload || !sessionPayload) {
        throw new Error("Garmin-Status konnte nicht geladen werden: leere Antwort.");
      }
      setStatus(credentialsPayload as CredentialStatus);
      setSessionStatus(sessionPayload as GarminSessionStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function loadWithingsStatus() {
    setWithingsLoading(true);
    setWithingsError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/withings/status`);
      const payload = await parseJsonSafely<WithingsStatus | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Withings-Status konnte nicht geladen werden.");
      }
      setWithingsStatus(payload as WithingsStatus);
    } catch (err) {
      setWithingsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setWithingsLoading(false);
    }
  }

  async function saveWithingsAppCredentials(e: FormEvent) {
    e.preventDefault();
    if (withingsSaving || !withingsClientId.trim() || !withingsClientSecret.trim()) return;
    setWithingsSaving(true);
    setWithingsError(null);
    setWithingsMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/withings/app-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: withingsClientId.trim(), client_secret: withingsClientSecret.trim() }),
      });
      const payload = await parseJsonSafely<{ detail?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.detail || "Withings Client-Daten konnten nicht gespeichert werden.");
      }
      setWithingsClientSecret("");
      setWithingsMessage("Withings Client-Daten gespeichert.");
      await loadWithingsStatus();
    } catch (err) {
      setWithingsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setWithingsSaving(false);
    }
  }

  async function deleteWithingsAppCredentials() {
    setWithingsSaving(true);
    setWithingsError(null);
    setWithingsMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/withings/app-credentials`, { method: "DELETE" });
      const payload = await parseJsonSafely<{ detail?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.detail || "Withings Client-Daten konnten nicht gelöscht werden.");
      }
      setWithingsClientId("");
      setWithingsClientSecret("");
      setWithingsMessage("Gespeicherte Withings Client-Daten gelöscht.");
      await loadWithingsStatus();
    } catch (err) {
      setWithingsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setWithingsSaving(false);
    }
  }

  async function connectWithings() {
    setWithingsConnecting(true);
    setWithingsError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/withings/login`);
      const payload = await parseJsonSafely<{ authorize_url?: string; detail?: string }>(response);
      if (!response.ok || !payload?.authorize_url) {
        throw new Error(payload?.detail || "Withings-Verbindung konnte nicht gestartet werden.");
      }
      window.location.href = payload.authorize_url;
    } catch (err) {
      setWithingsError(err instanceof Error ? err.message : "Unknown error");
      setWithingsConnecting(false);
    }
  }

  async function loadLlmStatus() {
    setLlmLoading(true);
    setLlmError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/llm/status`);
      const payload = await parseJsonSafely<LlmStatus | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "LLM-Status konnte nicht geladen werden.");
      }
      setLlmStatus(payload as LlmStatus);
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLlmLoading(false);
    }
  }

  async function loadProfile() {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const profileRes = await apiFetch(`${API_BASE_URL}/profile`);
      const profileBody = await parseJsonSafely<UserProfile | { detail?: string }>(profileRes);
      if (!profileRes.ok) {
        throw new Error(typeof profileBody === "object" && profileBody && "detail" in profileBody && profileBody.detail ? profileBody.detail : "Profil konnte nicht geladen werden.");
      }
      const p = profileBody as UserProfile;
      setProfile(p);
      setDisplayName(p.display_name || "");
      setDateOfBirth(p.date_of_birth || "");
      setGender(normalizeGender(p.gender));
      setHeightCm(p.height_cm == null ? "" : String(p.height_cm));
      setCurrentWeight(p.current_weight_kg == null ? "" : String(p.current_weight_kg));
      setTargetWeight(p.target_weight_kg == null ? "" : String(p.target_weight_kg));
      setStartWeight(p.start_weight_kg == null ? "" : String(p.start_weight_kg));
      setGoalStartDate(toLocalInputValue(p.goal_start_date));
      setGoalEndDate(toLocalInputValue(p.goal_end_date));
      setWeeklyTargetHours(p.weekly_target_hours == null ? "" : String(p.weekly_target_hours));
      setWeeklyTargetStress(p.weekly_target_stress == null ? "" : String(p.weekly_target_stress));
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadAuthMe() {
    try {
      const response = await apiFetch(`${API_BASE_URL}/auth/me`);
      const payload = await parseJsonSafely<AuthMe | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Session konnte nicht geladen werden.");
      }
      const me = payload as AuthMe;
      setIsAdmin(Boolean(me.is_admin));
      setCurrentUserId(me.id);
      window.dispatchEvent(
        new CustomEvent("trainmind:user-label-updated", {
          detail: {
            displayName: me.display_name || me.email.split("@")[0] || "User",
            roleLabel: me.is_admin ? "Admin" : "Nutzer",
          },
        }),
      );
    } catch {
      setIsAdmin(false);
      setCurrentUserId(null);
    }
  }

  async function loadAdminUsers() {
    if (!isAdmin) return;
    setAdminLoading(true);
    setAdminError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/admin/users`);
      const payload = await parseJsonSafely<{ users: AdminUser[] } | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Nutzer konnten nicht geladen werden.");
      }
      setAdminUsers((payload as { users: AdminUser[] }).users ?? []);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAdminLoading(false);
    }
  }

  async function createAdminUser(e: FormEvent) {
    e.preventDefault();
    if (!newUserEmail.trim() || adminSaving) return;
    setAdminSaving(true);
    setAdminError(null);
    setAdminMessage(null);
    setLatestInviteUrl("");
    try {
      const response = await apiFetch(`${API_BASE_URL}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newUserEmail.trim(),
          is_admin: newUserIsAdmin,
        }),
      });
      const payload = await parseJsonSafely<{ invite_url: string; email_delivery?: InviteDelivery; detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Nutzer konnte nicht angelegt werden.");
      }
      setNewUserEmail("");
      setNewUserIsAdmin(false);
      const invitePayload = payload as { invite_url: string; email_delivery?: InviteDelivery };
      setLatestInviteUrl(invitePayload.invite_url);
      if (invitePayload.email_delivery?.sent) {
        setAdminMessage("Einladung erstellt und per E-Mail versendet.");
      } else if (invitePayload.email_delivery?.attempted) {
        setAdminMessage(
          `Einladung erstellt, aber der Mailversand ist fehlgeschlagen${invitePayload.email_delivery.detail ? `: ${invitePayload.email_delivery.detail}` : "."}`
        );
      } else {
        setAdminMessage("Einladung erstellt. SMTP ist noch nicht konfiguriert, daher bitte den Link manuell teilen.");
      }
      await loadAdminUsers();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAdminSaving(false);
    }
  }

  async function deleteAdminUser(userId: number) {
    if (!window.confirm("Diesen Nutzer wirklich löschen?")) return;
    setAdminError(null);
    setAdminMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/admin/users/${userId}`, {
        method: "DELETE",
      });
      const payload = await parseJsonSafely<{ status?: string; detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && payload.detail ? payload.detail : "Nutzer konnte nicht gelöscht werden.");
      }
      setAdminMessage("Nutzer gelöscht.");
      await loadAdminUsers();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : "Unknown error");
    }
  }


  async function refreshGarminSession(e: FormEvent) {
    e.preventDefault();
    if (garminRefreshing) return;
    setGarminRefreshing(true);
    setError(null);
    setGarminMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/garmin/session-refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: garminEmail.trim(), password: garminPassword }),
      });
      const payload = await parseJsonSafely<{ login_ok?: boolean; auth_mode?: string | null; detail?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.detail || "Garmin-Session konnte nicht aktualisiert werden.");
      }
      setGarminPassword("");
      setGarminMessage(`Garmin-Session aktualisiert (${payload?.auth_mode || "Token gespeichert"}). Passwort wurde nicht gespeichert.`);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGarminRefreshing(false);
    }
  }

  async function saveOpenAiKey(e: FormEvent) {
    e.preventDefault();
    if (openAiSaving || !openAiKey.trim()) return;
    setOpenAiSaving(true);
    setLlmError(null);
    setOpenAiMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/llm/openai-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: openAiKey.trim() }),
      });
      const payload = await parseJsonSafely<{ detail?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.detail || "OpenAI-Key konnte nicht gespeichert werden.");
      }
      setOpenAiKey("");
      setOpenAiMessage("OpenAI-Key gespeichert.");
      await loadLlmStatus();
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setOpenAiSaving(false);
    }
  }

  async function deleteOpenAiKey() {
    setOpenAiSaving(true);
    setLlmError(null);
    setOpenAiMessage(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/llm/openai-key`, { method: "DELETE" });
      const payload = await parseJsonSafely<{ detail?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.detail || "OpenAI-Key konnte nicht gelöscht werden.");
      }
      setOpenAiMessage("Gespeicherter OpenAI-Key gelöscht.");
      await loadLlmStatus();
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setOpenAiSaving(false);
    }
  }


  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (profileSaving) return;
    setProfileSaving(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const toNumberOrNull = (v: string) => {
        const t = v.trim();
        if (!t) return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };
      const response = await apiFetch(`${API_BASE_URL}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          date_of_birth: dateOfBirth || null,
          gender: normalizeGender(gender),
          height_cm: toNumberOrNull(heightCm),
          current_weight_kg: toNumberOrNull(currentWeight),
          target_weight_kg: toNumberOrNull(targetWeight),
          start_weight_kg: toNumberOrNull(startWeight),
          goal_start_date: goalStartDate || null,
          goal_end_date: goalEndDate || null,
          weekly_target_hours: toNumberOrNull(weeklyTargetHours),
          weekly_target_stress: toNumberOrNull(weeklyTargetStress),
        }),
      });
      const payload = await parseJsonSafely<UserProfile | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "detail" in payload && payload.detail ? payload.detail : "Profil konnte nicht gespeichert werden.");
      }
      const next = payload as UserProfile;
      setProfile(next);
      setDisplayName(next.display_name || "");
      setDateOfBirth(next.date_of_birth || "");
      setGender(normalizeGender(next.gender));
      setHeightCm(next.height_cm == null ? "" : String(next.height_cm));
      setCurrentWeight(next.current_weight_kg == null ? "" : String(next.current_weight_kg));
      setTargetWeight(next.target_weight_kg == null ? "" : String(next.target_weight_kg));
      setStartWeight(next.start_weight_kg == null ? "" : String(next.start_weight_kg));
      setGoalStartDate(toLocalInputValue(next.goal_start_date));
      setGoalEndDate(toLocalInputValue(next.goal_end_date));
      setWeeklyTargetHours(next.weekly_target_hours == null ? "" : String(next.weekly_target_hours));
      setWeeklyTargetStress(next.weekly_target_stress == null ? "" : String(next.weekly_target_stress));
      window.dispatchEvent(new CustomEvent("trainmind:user-label-updated", { detail: { displayName: next.display_name || "" } }));
      setProfileMessage("Persönliche Daten gespeichert.");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProfileSaving(false);
    }
  }



  useEffect(() => {
    void loadAuthMe();
    if (!isAdmin) {
      void loadStatus();
      void loadWithingsStatus();
      void loadProfile();
      void loadLlmStatus();
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setAdminUsers([]);
      if (activeTab === "admin") {
        setActiveTab("personal");
      }
      return;
    }
    setActiveTab("admin");
    void loadAdminUsers();
  }, [isAdmin]);

  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">Setup</p>
        <h1>Einstellungen</h1>
        <p className="lead">Persönliche Daten, Provider-Zugänge, Gewicht und LLM-Konfiguration an einer Stelle verwalten.</p>
      </div>

      <div className="settings-tabs-layout">
        <aside className="settings-tabs-nav card">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab-button ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <strong>{tab.label}</strong>
              <span>{tab.description}</span>
            </button>
          ))}
        </aside>

        <div className="settings-tab-panel">
          {activeTab === "personal" ? (
            <div className="card">
              <div className="section-title-row">
                <h2>Persönliche Daten</h2>
              </div>
              {profileLoading ? <p>Profil wird geladen...</p> : null}
              {profileError ? <p className="error-text">{profileError}</p> : null}
              {profileMessage ? <p className="info-text">{profileMessage}</p> : null}

              <form className="nutrition-form" onSubmit={(e) => void saveProfile(e)}>
                <label className="settings-label">
                  E-Mail
                  <input className="settings-input" type="email" value={profile?.email || ""} readOnly />
                </label>
                <label className="settings-label">
                  Name
                  <input className="settings-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="z. B. Achim" />
                </label>
                <label className="settings-label">
                  Geburtsdatum
                  <input className="settings-input" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                </label>
                <label className="settings-label">
                  Geschlecht
                  <select className="settings-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="unknown">Keine Angabe</option>
                    <option value="male">Männlich</option>
                    <option value="female">Weiblich</option>
                  </select>
                </label>
                <label className="settings-label">
                  Größe (cm)
                  <input className="settings-input" type="number" min="80" max="260" step="0.1" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="z. B. 180" />
                </label>
                <div className="settings-actions nutrition-span-2">
                  <button className="primary-button" type="submit" disabled={profileSaving || !personalDataChanged}>
                    {profileSaving ? "Speichere..." : "Persönliche Daten speichern"}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => void loadProfile()} disabled={profileLoading || profileSaving}>
                    Aktualisieren
                  </button>
                </div>
              </form>

              <div className="settings-training-config-box">
                <div className="section-title-row">
                  <h3>Gespeicherte Trainingskonfiguration</h3>
                </div>
                {hasTrainingConfig ? (
                  <div className="settings-training-config-grid">
                    {trainingConfigSections.map((section) => (
                      <div key={section.key} className="settings-training-config-card">
                        <strong>{section.title}</strong>
                        {section.focusIds.length ? (
                          <div className="settings-training-config-pills">
                            {section.focusIds.map((focusId) => (
                              <span key={focusId} className="settings-training-config-pill">
                                {focusId}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="settings-training-config-empty">Keine Fokus-Bausteine gespeichert.</span>
                        )}
                        {section.notes ? <p>{section.notes}</p> : null}
                      </div>
                    ))}
                    {profile?.training_plan?.plan_title ? (
                      <div className="settings-training-config-card settings-training-config-card-highlight">
                        <strong>Übernommener Trainingsplan</strong>
                        <span>{profile.training_plan.plan_title}</span>
                        {profile.training_plan.summary ? <p>{profile.training_plan.summary}</p> : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="info-text">Noch keine Trainingskonfiguration im Profil gespeichert.</p>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "garmin" ? (
            <div className="card">
              <div className="section-title-row">
                <h2>Garmin Zugang</h2>
              </div>
              {loading ? <p>Status wird geladen...</p> : null}
              {!loading && status ? (
                <div className="settings-status-grid">
                  <div className="settings-status-chip">
                    <span>Aktive Quelle</span>
                    <strong>{status.active_source}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Env vorhanden</span>
                    <strong>{status.has_env_credentials ? "Ja" : "Nein"}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Service-Speicherung</span>
                    <strong>Deaktiviert</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Session-Modus</span>
                    <strong>{sessionStatus?.auth_mode ?? "-"}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Token-Dateien</span>
                    <strong>{sessionStatus?.token_files_present ? "Ja" : "Nein"}</strong>
                  </div>
                  <div className="settings-status-chip">
                    <span>Login-Test</span>
                    <strong>{sessionStatus?.login_ok ? "OK" : sessionStatus?.login_ok === false ? "Fehler" : "-"}</strong>
                  </div>
                </div>
              ) : null}
              {error ? <p className="error-text">{error}</p> : null}
              <p className="info-text">
                Garmin-Zugangsdaten werden hier nur einmalig für den Login verwendet. Gespeichert werden nur die erzeugten Session-Token im Tokenstore.
              </p>
              {sessionStatus?.tokenstore_path ? (
                <p className="info-text">Tokenstore: <code>{sessionStatus.tokenstore_path}</code></p>
              ) : null}
              {garminMessage ? <p className="info-text">{garminMessage}</p> : null}
              <form className="nutrition-form" onSubmit={(e) => void refreshGarminSession(e)}>
                <label className="settings-label">
                  Garmin E-Mail
                  <input className="settings-input" type="email" value={garminEmail} onChange={(e) => setGarminEmail(e.target.value)} autoComplete="username" />
                </label>
                <label className="settings-label">
                  Garmin Passwort
                  <input className="settings-input" type="password" value={garminPassword} onChange={(e) => setGarminPassword(e.target.value)} autoComplete="current-password" />
                </label>
                <div className="settings-actions nutrition-span-2">
                  <button className="primary-button" type="submit" disabled={garminRefreshing || !garminEmail.trim() || !garminPassword}>
                    {garminRefreshing ? "Aktualisiere..." : "Session aktualisieren"}
                  </button>
                  <button className="secondary-button" type="button" disabled={loading || garminRefreshing} onClick={() => void loadStatus()}>
                    Status aktualisieren
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {activeTab === "withings" ? (
            <div className="card">
              <div className="section-title-row">
                <h2>Withings Zugang</h2>
                <button className="settings-help-button" type="button" onClick={() => setSettingsHelp(settingsHelp === "withings" ? null : "withings")} aria-label="Withings Hilfe">?</button>
              </div>
              {withingsLoading ? <p>Withings-Status wird geladen...</p> : null}
              {withingsError ? <p className="error-text">{withingsError}</p> : null}
              {!withingsLoading && withingsStatus ? (
                <>
                  <div className="settings-status-grid">
                    <div className="settings-status-chip">
                      <span>Konfiguriert</span>
                      <strong>{withingsStatus.configured ? "Ja" : "Nein"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Client-Quelle</span>
                      <strong>{withingsStatus.credential_source ?? "none"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Client ID</span>
                      <strong>{withingsStatus.client_id_hint ?? "-"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>OAuth-Session</span>
                      <strong>{withingsStatus.connected ? "Verbunden" : "Nicht verbunden"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Withings User</span>
                      <strong>{withingsStatus.userid ?? "-"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Token gültig bis</span>
                      <strong>{withingsStatus.expires_at ? new Date(withingsStatus.expires_at).toLocaleString() : "-"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Scopes</span>
                      <strong>{withingsStatus.scope || withingsStatus.scopes || "-"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Callback</span>
                      <strong>{withingsStatus.redirect_uri ? "OK" : "Fehlt"}</strong>
                    </div>
                  </div>
                  {settingsHelp === "withings" ? (
                    <div className="settings-help-card">
                      <strong>Withings Client ID und Secret bekommen</strong>
                      <p>Lege im Withings Developer Dashboard eine App an, kopiere Client ID und Consumer Secret hier hinein und trage dort exakt die Redirect URI ein, die unten angezeigt wird.</p>
                      <p>Die Redirect URI kommt aus <code>WITHINGS_REDIRECT_URI</code> und muss bei Withings identisch hinterlegt sein, sonst schlägt OAuth fehl.</p>
                    </div>
                  ) : null}
                  {withingsMessage ? <p className="info-text">{withingsMessage}</p> : null}
                  <form className="nutrition-form settings-subsection-title" onSubmit={(e) => void saveWithingsAppCredentials(e)}>
                    <label className="settings-label">
                      Withings Client ID
                      <input className="settings-input" value={withingsClientId} onChange={(e) => setWithingsClientId(e.target.value)} placeholder={withingsStatus.has_user_app_credentials ? "Gespeichert" : "Client ID"} autoComplete="off" />
                    </label>
                    <label className="settings-label">
                      Withings Client Secret
                      <input className="settings-input" type="password" value={withingsClientSecret} onChange={(e) => setWithingsClientSecret(e.target.value)} placeholder={withingsStatus.has_user_app_credentials ? "Gespeichert" : "Client Secret"} autoComplete="off" />
                    </label>
                    <div className="settings-actions nutrition-span-2">
                      <button className="primary-button" type="submit" disabled={withingsSaving || !withingsClientId.trim() || !withingsClientSecret.trim()}>
                        {withingsSaving ? "Speichere..." : "Withings Client-Daten speichern"}
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void deleteWithingsAppCredentials()} disabled={withingsSaving || !withingsStatus.has_user_app_credentials}>
                        Gespeicherte Client-Daten löschen
                      </button>
                    </div>
                  </form>
                  {withingsStatus.redirect_uri ? <p className="info-text">Redirect URI: <code>{withingsStatus.redirect_uri}</code></p> : null}
                  <p className="info-text">
                    Withings nutzt OAuth mit Access- und Refresh-Token. Eine dauerhafte Passwort-Session wie bei Garmin gibt es hier nicht; die Verbindung wird über den Refresh-Token erneuert.
                  </p>
                  <div className="settings-note-card">
                    <strong>Geplante Datenbereiche</strong>
                    <p className="info-text">Gewicht und Körpermesswerte, Aktivität/Schritte sowie Schlafdaten können nach Freigabe über die Withings API synchronisiert werden.</p>
                  </div>
                  <div className="settings-actions">
                    <button className="primary-button" type="button" onClick={() => void connectWithings()} disabled={withingsConnecting || !withingsStatus.configured}>
                      {withingsConnecting ? "Öffne Withings..." : withingsStatus.connected ? "Withings neu verbinden" : "Withings verbinden"}
                    </button>
                    <button className="secondary-button" type="button" onClick={() => void loadWithingsStatus()} disabled={withingsLoading}>
                      Status aktualisieren
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {activeTab === "llm" ? (
            <div className="card">
              <div className="section-title-row">
                <h2>LLM Zugang</h2>
                <button className="settings-help-button" type="button" onClick={() => setSettingsHelp(settingsHelp === "openai" ? null : "openai")} aria-label="OpenAI Hilfe">?</button>
              </div>
              {llmLoading ? <p>LLM-Status wird geladen...</p> : null}
              {llmError ? <p className="error-text">{llmError}</p> : null}
              {!llmLoading && llmStatus ? (
                <>
                  <div className="settings-status-grid">
                    <div className="settings-status-chip">
                      <span>Provider</span>
                      <strong>{llmStatus.provider}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Konfiguriert</span>
                      <strong>{llmStatus.configured ? "Ja" : "Nein"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Key-Hinweis</span>
                      <strong>{llmStatus.key_hint ?? "-"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Aktive Quelle</span>
                      <strong>{llmStatus.key_source ?? (llmStatus.configured ? "env" : "none")}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Modell</span>
                      <strong>{llmStatus.model ?? "-"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Admin-Key</span>
                      <strong>{llmStatus.admin_key_configured ? "Ja" : "Nein"}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Restguthaben</span>
                      <strong>
                        {llmStatus.balance_available
                          ? formatCurrencyValue(llmStatus.balance_value, llmStatus.balance_currency)
                          : "Nicht direkt verfügbar"}
                      </strong>
                    </div>
                  </div>
                  {settingsHelp === "openai" ? (
                    <div className="settings-help-card">
                      <strong>OpenAI API Key bekommen</strong>
                      <p>Öffne die OpenAI Platform, lege unter API Keys einen neuen Secret Key an und kopiere ihn direkt hier hinein. Der Key wird nur einmal vollständig angezeigt.</p>
                      <p>Für Kosten-/Usage-Daten ist ein separater Admin-Key nötig; normale API Keys reichen für LLM-Funktionen wie Training und Nutrition.</p>
                    </div>
                  ) : null}
                  <div className="settings-note-card">
                    <p className="info-text">
                      Ein gespeicherter Nutzer-Key wird verschlüsselt abgelegt und überschreibt den `.env`-Fallback nur für deinen Account.
                    </p>
                    {openAiMessage ? <p className="info-text">{openAiMessage}</p> : null}
                    {llmStatus.balance_note ? <p className="info-text">{llmStatus.balance_note}</p> : null}
                  </div>

                  <form className="nutrition-form settings-subsection-title" onSubmit={(e) => void saveOpenAiKey(e)}>
                    <label className="settings-label nutrition-span-2">
                      OpenAI API Key
                      <input className="settings-input" type="password" value={openAiKey} onChange={(e) => setOpenAiKey(e.target.value)} placeholder={llmStatus.has_user_key ? "Gespeicherter Key vorhanden" : "sk-..."} autoComplete="off" />
                    </label>
                    <div className="settings-actions nutrition-span-2">
                      <button className="primary-button" type="submit" disabled={openAiSaving || !openAiKey.trim()}>
                        {openAiSaving ? "Speichere..." : "OpenAI-Key speichern"}
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void deleteOpenAiKey()} disabled={openAiSaving || !llmStatus.has_user_key}>
                        Gespeicherten Key löschen
                      </button>
                    </div>
                  </form>

                  <div className="section-title-row settings-subsection-title">
                    <h3>Lokale Nutzung</h3>
                  </div>
                  <div className="settings-status-grid">
                    <div className="settings-status-chip">
                      <span>Requests 7 Tage</span>
                      <strong>{formatTokenCount(llmStatus.local_usage.last_7_days_requests)}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Requests 30 Tage</span>
                      <strong>{formatTokenCount(llmStatus.local_usage.last_30_days_requests)}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Erfolge 30 Tage</span>
                      <strong>{formatTokenCount(llmStatus.local_usage.last_30_days_success)}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Fehler 30 Tage</span>
                      <strong>{formatTokenCount(llmStatus.local_usage.last_30_days_errors)}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Input-Tokens 30 Tage</span>
                      <strong>{formatTokenCount(llmStatus.local_usage.last_30_days_input_tokens)}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Output-Tokens 30 Tage</span>
                      <strong>{formatTokenCount(llmStatus.local_usage.last_30_days_output_tokens)}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Total Tokens 30 Tage</span>
                      <strong>{formatTokenCount(llmStatus.local_usage.last_30_days_total_tokens)}</strong>
                    </div>
                    <div className="settings-status-chip">
                      <span>Letzte Nutzung</span>
                      <strong>{llmStatus.local_usage.last_used_at ? new Date(llmStatus.local_usage.last_used_at).toLocaleString() : "-"}</strong>
                    </div>
                  </div>

                  <div className="section-title-row settings-subsection-title">
                    <h3>OpenAI Kosten</h3>
                  </div>
                  <div className="settings-status-grid">
                    <div className="settings-status-chip">
                      <span>Heute</span>
                      <strong>{formatCurrencyValue(llmStatus.org_costs.today.value, llmStatus.org_costs.today.currency)}</strong>
                      <small>{llmStatus.org_costs.today.available ? "Org/Account" : llmStatus.org_costs.today.message ?? "Nicht verfügbar"}</small>
                    </div>
                    <div className="settings-status-chip">
                      <span>Letzte 7 Tage</span>
                      <strong>{formatCurrencyValue(llmStatus.org_costs.last_7_days.value, llmStatus.org_costs.last_7_days.currency)}</strong>
                      <small>{llmStatus.org_costs.last_7_days.available ? "Org/Account" : llmStatus.org_costs.last_7_days.message ?? "Nicht verfügbar"}</small>
                    </div>
                    <div className="settings-status-chip">
                      <span>Letzte 30 Tage</span>
                      <strong>{formatCurrencyValue(llmStatus.org_costs.last_30_days.value, llmStatus.org_costs.last_30_days.currency)}</strong>
                      <small>{llmStatus.org_costs.last_30_days.available ? "Org/Account" : llmStatus.org_costs.last_30_days.message ?? "Nicht verfügbar"}</small>
                    </div>
                  </div>

                  <div className="section-title-row settings-subsection-title">
                    <h3>Letzte LLM-Aufrufe</h3>
                  </div>
                  <div className="settings-llm-events">
                    {llmStatus.recent_events.length === 0 ? <p className="info-text">Noch keine lokal protokollierten LLM-Aufrufe vorhanden.</p> : null}
                    {llmStatus.recent_events.map((event) => (
                      <article className="settings-llm-event" key={event.id}>
                        <div className="settings-llm-event-head">
                          <strong>{formatLlmFeatureLabel(event.feature_key)}</strong>
                          <span>{new Date(event.created_at).toLocaleString()}</span>
                        </div>
                        <div className="settings-llm-event-meta">
                          <span>Modell: {event.model ?? "-"}</span>
                          <span>Status: {event.status}</span>
                          <span>Tokens: {formatTokenCount(event.total_tokens)}</span>
                          <span>Latenz: {event.latency_ms != null ? `${event.latency_ms} ms` : "-"}</span>
                        </div>
                        {event.error_message ? <p className="error-text">{event.error_message}</p> : null}
                      </article>
                    ))}
                  </div>
                  <div className="settings-actions">
                    <button className="secondary-button" type="button" onClick={() => void loadLlmStatus()}>
                      Status aktualisieren
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {activeTab === "admin" && isAdmin ? (
            <div className="settings-weight-stack">
              <div className="card">
                <div className="section-title-row">
                  <h2>Admin Nutzerverwaltung</h2>
                </div>
                {adminError ? <p className="error-text">{adminError}</p> : null}
                {adminMessage ? <p className="info-text">{adminMessage}</p> : null}
                <form className="nutrition-form" onSubmit={(e) => void createAdminUser(e)}>
                  <label className="settings-label">
                    E-Mail
                    <input className="settings-input" type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} required />
                  </label>
                  <label className="settings-label">
                    Rolle
                    <select className="settings-input" value={newUserIsAdmin ? "admin" : "user"} onChange={(e) => setNewUserIsAdmin(e.target.value === "admin")}>
                      <option value="user">Normaler Nutzer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                  <div className="settings-actions nutrition-span-2">
                    <button className="primary-button" type="submit" disabled={adminSaving}>
                      {adminSaving ? "Lege an..." : "Nutzer anlegen"}
                    </button>
                    <button className="secondary-button" type="button" onClick={() => void loadAdminUsers()} disabled={adminLoading || adminSaving}>
                      Aktualisieren
                    </button>
                  </div>
                </form>
                {latestInviteUrl ? (
                  <div className="settings-invite-box">
                    <strong>Einladungslink</strong>
                    <input className="settings-input" value={latestInviteUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
                  </div>
                ) : null}
              </div>

              <div className="card">
                <div className="section-title-row">
                  <h2>Vorhandene Nutzer</h2>
                </div>
                {adminLoading ? <p>Nutzer werden geladen...</p> : null}
                <div className="nutrition-list settings-weight-list">
                  {adminUsers.length === 0 && !adminLoading ? <p>Noch keine Nutzer vorhanden.</p> : null}
                  {adminUsers.map((user) => (
                    <article className="nutrition-entry" key={user.id}>
                      <div className="nutrition-entry-head">
                        <strong>{user.email}</strong>
                        <span>{user.is_admin ? "Admin" : "Nutzer"}</span>
                      </div>
                      <p className="nutrition-notes">
                        Status: {user.has_password ? "Aktiv" : "Eingeladen"}
                      </p>
                      <p className="nutrition-notes">
                        Erstellt: {user.created_at ? new Date(user.created_at).toLocaleString() : "-"}
                      </p>
                      <div className="settings-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void deleteAdminUser(user.id)}
                          disabled={currentUserId === user.id}
                        >
                          {currentUserId === user.id ? "Aktueller Admin" : "Nutzer löschen"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
