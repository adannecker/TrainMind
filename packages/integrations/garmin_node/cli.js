const fs = require("fs");
const os = require("os");
const path = require("path");

const { GarminConnect } = require("garmin-connect");

// Some upstream library code writes debug output to stdout.
// Redirect that to stderr so our stdout stays machine-readable JSON.
console.log = (...args) => {
  process.stderr.write(`${args.map((value) => String(value)).join(" ")}\n`);
};

function fail(message, details) {
  const payload = {
    ok: false,
    error: String(message || "Unknown Garmin helper error"),
  };
  if (details !== undefined) {
    payload.details = details;
  }
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(1);
}

function readEnv(name, required = true) {
  const value = (process.env[name] || "").trim();
  if (!value && required) {
    fail(`Missing environment variable: ${name}`);
  }
  return value;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hasTokenFiles(tokenstorePath) {
  return (
    fs.existsSync(path.join(tokenstorePath, "oauth1_token.json")) &&
    fs.existsSync(path.join(tokenstorePath, "oauth2_token.json"))
  );
}

function parsePayload() {
  const raw = process.argv[3];
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail("Invalid JSON payload.", error.message || String(error));
  }
}

async function buildClient() {
  const username = readEnv("GARMIN_EMAIL");
  const password = readEnv("GARMIN_PASSWORD");
  const tokenstorePath = readEnv("GARMIN_TOKENSTORE_PATH");

  ensureDir(tokenstorePath);

  const client = new GarminConnect({ username, password });
  let authMode = "credential_login";

  try {
    if (hasTokenFiles(tokenstorePath)) {
      client.loadTokenByFile(tokenstorePath);
      await client.getUserProfile();
      authMode = "token_reuse";
      return { client, authMode, tokenstorePath };
    }
  } catch (_error) {
    try {
      fs.rmSync(tokenstorePath, { recursive: true, force: true });
    } catch (_rmError) {
      // Ignore cleanup issues and continue with credential login.
    }
    ensureDir(tokenstorePath);
  }

  await client.login();
  client.exportTokenToFile(tokenstorePath);
  return { client, authMode, tokenstorePath };
}

async function commandHealth() {
  process.stdout.write(JSON.stringify({ ok: true, status: "healthy" }));
}

async function commandSessionStatus(payload) {
  const username = readEnv("GARMIN_EMAIL");
  const tokenstorePath = readEnv("GARMIN_TOKENSTORE_PATH");
  const checkLogin = Boolean(payload.check_login);
  const status = {
    ok: true,
    email_configured: Boolean(username),
    token_files_present: hasTokenFiles(tokenstorePath),
    tokenstore_path: tokenstorePath,
    auth_mode: "unknown",
    login_ok: null,
  };

  if (!checkLogin) {
    process.stdout.write(JSON.stringify(status));
    return;
  }

  const built = await buildClient();
  status.auth_mode = built.authMode;
  status.login_ok = true;
  process.stdout.write(JSON.stringify(status));
}

async function commandRecentActivities(client, authMode, payload) {
  const start = Number.isFinite(payload.start) ? payload.start : 0;
  const limit = Number.isFinite(payload.limit) ? payload.limit : 20;
  const activities = await client.getActivities(start, limit);
  process.stdout.write(JSON.stringify({ ok: true, auth_mode: authMode, activities }));
}

async function commandActivity(client, authMode, payload) {
  const activityId = String(payload.activity_id || "").trim();
  if (!activityId) {
    fail("activity_id is required.");
  }
  const activity = await client.getActivity({ activityId });
  process.stdout.write(JSON.stringify({ ok: true, auth_mode: authMode, activity }));
}

async function commandDownloadOriginal(client, authMode, payload) {
  const activityId = String(payload.activity_id || "").trim();
  if (!activityId) {
    fail("activity_id is required.");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainmind-garmin-"));
  const filePath = path.join(tempDir, `${activityId}.zip`);

  try {
    await client.downloadOriginalActivityData({ activityId }, tempDir, "zip");
    const content = fs.readFileSync(filePath);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        auth_mode: authMode,
        activity_id: activityId,
        file_name: `${activityId}.zip`,
        content_base64: content.toString("base64"),
      })
    );
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore temp cleanup issues.
    }
  }
}

async function main() {
  const command = (process.argv[2] || "").trim();
  if (!command) {
    fail("Missing command.");
  }

  if (command === "health") {
    await commandHealth();
    return;
  }

  const payload = parsePayload();
  if (command === "session-status") {
    await commandSessionStatus(payload);
    return;
  }

  const built = await buildClient();
  const client = built.client;
  const authMode = built.authMode;

  if (command === "recent-activities") {
    await commandRecentActivities(client, authMode, payload);
    return;
  }
  if (command === "activity") {
    await commandActivity(client, authMode, payload);
    return;
  }
  if (command === "download-original") {
    await commandDownloadOriginal(client, authMode, payload);
    return;
  }

  fail(`Unsupported command: ${command}`);
}

main().catch((error) => {
  fail(error.message || String(error));
});
