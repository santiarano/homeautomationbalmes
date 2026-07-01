#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const { execFile, spawn } = require("node:child_process");

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;

    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

const ENV_PATH = process.env.JARVIS_ROUTER_ENV || "/Users/santiarano/.hermes/jarvis-router.env";
loadEnvFile(ENV_PATH);

const HOST = process.env.JARVIS_ROUTER_HOST || "127.0.0.1";
const PORT = Number(process.env.JARVIS_ROUTER_PORT || 8787);
const HA_URL = process.env.HOMEASSISTANT_URL || "http://192.168.1.55:8123";
const PROJECT_APP_JS =
  process.env.HA_APP_JS ||
  "/Users/santiarano/Desktop/CODING PROJECTS/Home Projects/homeautomationbalmes/app.js";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-lite";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2";
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";
const OPENAI_CLIENT_SECRET_URL = "https://api.openai.com/v1/realtime/client_secrets";
const TASKS_PATH = process.env.JARVIS_TASKS_PATH || "/Users/santiarano/.hermes/jarvis-tasks.json";
const MUSIC_HISTORY_PATH = process.env.JARVIS_MUSIC_HISTORY_PATH || "/Users/santiarano/.hermes/jarvis-music-history.json";
const CONNECTION_STATE_PATH =
  process.env.JARVIS_CONNECTION_STATE_PATH || "/Users/santiarano/.hermes/jarvis-connection-state.json";
const HERMES_ENV_PATH = process.env.HERMES_ENV_PATH || "/Users/santiarano/.hermes/.env";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const HERMES_API_URL = process.env.HERMES_API_URL || "http://127.0.0.1:8642";
const HERMES_MODEL = process.env.HERMES_MODEL || "jarvis-hermes";
const AIRPLAY_SELECT_SCRIPT =
  process.env.JARVIS_AIRPLAY_SELECT_SCRIPT || "/Users/santiarano/.hermes/scripts/jarvis-select-sonos-airplay.sh";
const PI_ASSIST_SATELLITE =
  process.env.JARVIS_PI_ASSIST_SATELLITE || "assist_satellite.assist_microphone";
const PI_SSH_HOST = process.env.JARVIS_PI_SSH_HOST || "192.168.1.55";
const PI_SSH_USER = process.env.JARVIS_PI_SSH_USER || "santiarano";
const PI_SSH_KEY = process.env.JARVIS_PI_SSH_KEY || "/Users/santiarano/.ssh/id_ed25519";
const LAPTOP_HEARTBEAT_ENTITY =
  process.env.JARVIS_LAPTOP_HEARTBEAT_ENTITY || "sensor.jarvis_laptop_heartbeat";
const LAPTOP_HEARTBEAT_INTERVAL_MS = Math.max(
  1_000,
  Number(process.env.JARVIS_LAPTOP_HEARTBEAT_INTERVAL_MS || "2000"),
);
const LAPTOP_HEARTBEAT_TTL_SECONDS = Math.max(
  3,
  Number(process.env.JARVIS_LAPTOP_HEARTBEAT_TTL_SECONDS || "6"),
);
const LAPTOP_ROUTER_URL =
  process.env.JARVIS_LAPTOP_ROUTER_URL || `http://${HOST}:${PORT}`;

const LIVING_ROOM_LIGHTS = [
  "light.moes_matter_light",
  "light.moes_matter_light_2",
  "light.moes_matter_light_3",
  "light.moes_matter_light_4",
];

const BLOCKED_ENTITIES = new Set([
  "light.terrace_lights",
  "switch.finger_robot_switch_1",
  "switch.finger_robot_2_switch_1",
]);

const HOME_CONTEXT = `
Apartment context:
- Living room lights are four Matter bulbs:
  ${LIVING_ROOM_LIGHTS.join(", ")}.
- Projector screen:
  Lower/deploy screen: script.screen_down_2.
  Raise/retract screen: script.screen_up_5.
- Projector tray:
  Lower/open tray: script.tray_down.
  Raise/close tray: script.tray_up.
- Terrace awning/toldo:
  Open/extend awning: script.awning_up.
  Close/retract awning: script.awning_down.
- Main Sonos speaker/media system: media_player.sonos.
- Bedroom Sonos speaker: media_player.bedroom.
- TV/display scripts:
  TV on / watch TV: script.turn_tv_on. This already turns on Apple TV, lowers the projector screen, lowers the projector tray, and powers the projector.
  TV off / stop watching: script.turn_tv_off. This already turns off the projector flow and raises the screen and tray.
  Apple TV on: script.appletv_turn_on.
  Projector on alone: script.projector_on.
  Projector off alone: script.turn_projector_off or script.projector_off.
- Never use projector screen scripts for awning/toldo commands.
- Never use light.terrace_lights, switch.finger_robot_switch_1, or switch.finger_robot_2_switch_1.
`.trim();

let cachedInventory = null;
let cachedInventoryAt = 0;
let cachedSonosPlaylists = null;
let cachedSonosPlaylistsAt = 0;
let cachedMusicHistory = null;
let pendingMusicConfirmation = null;
let voiceLightSnapshot = null;
let voiceLightCueMode = "";
const eventClients = new Set();
let piAudioProcess = null;
let piAudioBytes = 0;
let piAudioChunks = 0;
let piAudioStartedAt = null;
let recentSonosRestoreTarget = null;
let recentSonosRestoreTargetAt = 0;
const SONOS_RESTORE_GUARD_MS = 60_000;
let sonosVolumeCommandGeneration = 0;
let connectionState = loadConnectionState();

function log(message, data = {}) {
  const safe = { ...data };
  delete safe.token;
  delete safe.authorization;
  delete safe.api_key;
  const suffix = Object.keys(safe).length ? ` ${JSON.stringify(safe)}` : "";
  console.log(`${new Date().toISOString()} ${message}${suffix}`);
}

function actionServiceName(action) {
  const service = action?.service;
  const domain = action?.domain;
  if (service) {
    const serviceText = String(service);
    if (serviceText.includes(".") || !domain) return serviceText;
    return `${domain}.${serviceText}`;
  }
  if (domain && action?.service_name) return `${domain}.${action.service_name}`;
  return "";
}

function actionEntityIds(action) {
  const entityId = action?.service_data?.entity_id;
  if (Array.isArray(entityId)) return entityId.map(String);
  if (entityId) return [String(entityId)];
  return [];
}

function sonosRestoreTargetFromActions(actions) {
  if (!Array.isArray(actions)) return undefined;
  for (const action of actions) {
    const service = actionServiceName(action);
    if (!["media_player.volume_set", "media_player.volume_up", "media_player.volume_down", "media_player.volume_mute"].includes(service)) continue;
    const entities = actionEntityIds(action);
    if (entities.length && !entities.includes("media_player.sonos")) continue;
    if (service === "media_player.volume_set") {
      const volume = Number(action?.service_data?.volume_level);
      if (Number.isFinite(volume) && volume >= 0 && volume <= 1) return volume;
    }
    return "__skip__";
  }
  return undefined;
}

function rememberSonosRestoreTarget(response) {
  if (!response?.ok) return;
  const restoreTarget = sonosRestoreTargetFromActions(response.actions);
  if (restoreTarget === undefined) return;
  recentSonosRestoreTarget = "__skip__";
  recentSonosRestoreTargetAt = Date.now();
  log("Remembered Sonos restore guard", { restore_target: restoreTarget });

  if (typeof restoreTarget === "number") {
    scheduleSonosVolumeReassert(restoreTarget);
  }
}

function scheduleSonosVolumeReassert(volume) {
  const generation = ++sonosVolumeCommandGeneration;
  const entityId = process.env.JARVIS_SPEECH_MEDIA_PLAYER || "media_player.sonos";
  for (const delayMs of [350, 1200, 2800, 5200]) {
    setTimeout(async () => {
      if (generation !== sonosVolumeCommandGeneration) return;
      try {
        await callHomeAssistantService("media_player", "volume_set", {
          entity_id: entityId,
          volume_level: volume,
        });
        log("Reasserted Sonos volume command", { volume, generation, delay_ms: delayMs });
      } catch (error) {
        log("Sonos volume reassert failed", { error: error.message, generation, delay_ms: delayMs });
      }
    }, delayMs);
  }
}

function consumeRecentSonosRestoreTarget() {
  if (recentSonosRestoreTarget === null) return undefined;
  if (Date.now() - recentSonosRestoreTargetAt > SONOS_RESTORE_GUARD_MS) {
    recentSonosRestoreTarget = null;
    recentSonosRestoreTargetAt = 0;
    return undefined;
  }
  if (recentSonosRestoreTarget === "__skip__") {
    return "__skip__";
  }
  const target = recentSonosRestoreTarget;
  recentSonosRestoreTarget = null;
  recentSonosRestoreTargetAt = 0;
  return target;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function readBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readHomeAssistantToken() {
  if (process.env.HOMEASSISTANT_TOKEN) return process.env.HOMEASSISTANT_TOKEN;

  const appJs = fs.readFileSync(PROJECT_APP_JS, "utf8");
  const match = appJs.match(/const TOKEN = "([^"]+)"/);
  if (!match) {
    throw new Error(`Could not find Home Assistant token in ${PROJECT_APP_JS}`);
  }
  return match[1];
}

function getOpenRouterKey() {
  const key = process.env.OPENROUTER_API_KEY || "";
  if (!key || key.startsWith("replace-with-")) return "";
  return key;
}

function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key || key.startsWith("replace-with-")) return "";
  return key;
}

async function getSpotifyAccessToken() {
  const directToken = process.env.SPOTIFY_ACCESS_TOKEN || "";
  if (directToken) return directToken;

  const clientId = process.env.SPOTIFY_CLIENT_ID || "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN || "";
  if (!clientId || !clientSecret || !refreshToken) return "";

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) {
    log("Spotify token refresh failed", { status: response.status, error: (await response.text()).slice(0, 200) });
    return "";
  }
  const payload = await response.json();
  return String(payload.access_token || "");
}

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return "";
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    if (trimmed.slice(0, equals).trim() !== key) continue;
    return trimmed
      .slice(equals + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return "";
}

function getHermesApiKey() {
  const key = process.env.API_SERVER_KEY || readEnvValue(HERMES_ENV_PATH, "API_SERVER_KEY");
  if (!key || key.startsWith("replace-with-")) return "";
  return key;
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function html(res, body) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastEvent(event, data) {
  for (const client of eventClients) {
    try {
      sendEvent(client, event, data);
    } catch {
      eventClients.delete(client);
    }
  }
}

function loadConnectionState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONNECTION_STATE_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveConnectionState() {
  try {
    fs.writeFileSync(CONNECTION_STATE_PATH, JSON.stringify(connectionState, null, 2), { mode: 0o600 });
  } catch (error) {
    log("Connection state write failed", { error: error.message });
  }
}

function secondsSince(isoText) {
  const timestamp = Date.parse(isoText || "");
  if (!Number.isFinite(timestamp)) return Infinity;
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

function humanDuration(seconds) {
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function currentConnectionStatus() {
  const piMic = connectionState.pi_mic || {};
  const lastSeenSeconds = secondsSince(piMic.last_seen_at || piMic.connected_at || piMic.updated_at);
  const connected = Boolean(piMic.connected) && lastSeenSeconds <= 95;
  return {
    ok: true,
    router: {
      connected: true,
      host: HOST,
      port: PORT,
      started_at: connectionState.router_started_at || null,
    },
    pi_mic: {
      connected,
      raw_connected: Boolean(piMic.connected),
      stale: Boolean(piMic.connected) && !connected,
      host: piMic.host || PI_SSH_HOST,
      user: piMic.user || PI_SSH_USER,
      connected_at: piMic.connected_at || null,
      disconnected_at: piMic.disconnected_at || null,
      last_seen_at: piMic.last_seen_at || null,
      last_error: piMic.last_error || "",
      last_seen_seconds: Number.isFinite(lastSeenSeconds) ? lastSeenSeconds : null,
    },
  };
}

function connectionStatusSpeech(text) {
  const status = currentConnectionStatus();
  if (status.pi_mic.connected) {
    return reply(
      text,
      "Yes. I'm connected to this computer, and the Pi mic is online.",
      "Si. Estoy conectado a este ordenador, y el micro del Pi esta online.",
    );
  }
  if (status.pi_mic.stale) {
    return reply(
      text,
      `I'm on this computer, but the Pi mic heartbeat is stale. Last seen ${humanDuration(status.pi_mic.last_seen_seconds)} ago.`,
      `Estoy en este ordenador, pero el micro del Pi esta sin latido reciente. Lo vi por ultima vez hace ${humanDuration(status.pi_mic.last_seen_seconds)}.`,
    );
  }
  return reply(
    text,
    "I'm running on this computer, but I don't currently see the Pi mic.",
    "Estoy funcionando en este ordenador, pero ahora no veo el micro del Pi.",
  );
}

function isConnectionStatusQuestion(text) {
  const asksStatus = /\b(are you|you are|is jarvis|jarvis|connection|connected|online|status|running)\b/.test(text)
    && /\b(connect|connected|connection|online|status|computer|laptop|mac|pi|raspberry)\b/.test(text);
  const asksStatusEs = /\b(estas|esta|jarvis|conexion|conectado|conectada|online|ordenador|portatil|mac|pi|raspberry)\b/.test(text)
    && /\b(conectado|conectada|conexion|online|ordenador|portatil|mac|pi|raspberry)\b/.test(text);
  return asksStatus || asksStatusEs;
}

async function handlePiConnectionState(payload) {
  const now = new Date().toISOString();
  const connected = Boolean(payload.connected);
  const previous = connectionState.pi_mic || {};
  const wasConnected = Boolean(previous.connected) && secondsSince(previous.last_seen_at || previous.connected_at) <= 95;
  const shouldAnnounce = connected && Boolean(payload.announce) && !wasConnected;

  connectionState.pi_mic = {
    ...previous,
    connected,
    host: String(payload.host || previous.host || PI_SSH_HOST),
    user: String(payload.user || previous.user || PI_SSH_USER),
    source: String(payload.source || "jarvis-wake"),
    last_error: connected ? "" : String(payload.error || payload.last_error || previous.last_error || ""),
    updated_at: now,
    last_seen_at: connected ? now : previous.last_seen_at || null,
    connected_at: connected && !wasConnected ? now : previous.connected_at || (connected ? now : null),
    disconnected_at: connected ? previous.disconnected_at || null : now,
  };
  saveConnectionState();
  broadcastEvent("connection-status", currentConnectionStatus());

  if (shouldAnnounce) {
    connectionState.last_connected_announcement_at = now;
    saveConnectionState();
    announceOnPiSpeaker("Connected to computer.", false)
      .then(() => log("Announced Pi computer connection", { host: connectionState.pi_mic.host }))
      .catch((error) => log("Pi connection announcement failed", { error: error.message }));
  }

  return currentConnectionStatus();
}

function getSpeechVolume() {
  const value = Number(process.env.JARVIS_SPEECH_VOLUME || "0.4");
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.4;
}

function getListeningVolume() {
  const value = Number(process.env.JARVIS_LISTENING_VOLUME || "0.03");
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.03;
}

function getMicSource() {
  const source = String(process.env.JARVIS_MIC_SOURCE || "mac").toLowerCase();
  return source === "pi" ? "pi" : "mac";
}

function updateEnvValue(key, value) {
  const line = `${key}=${value}`;
  const current = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const next = current.match(new RegExp(`^${key}=.*$`, "m"))
    ? current.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${current.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, next, { mode: 0o600 });
  process.env[key] = String(value);
}

function settingsPayload() {
  return {
    ok: true,
    speech_output: process.env.JARVIS_SPEECH_OUTPUT || "sonos",
    speech_media_player: process.env.JARVIS_SPEECH_MEDIA_PLAYER || "media_player.sonos",
    speech_tts_entity: process.env.JARVIS_SPEECH_TTS_ENTITY || "tts.google_translate_en_com",
    pi_assist_satellite: PI_ASSIST_SATELLITE,
    mic_source: getMicSource(),
    speech_volume: getSpeechVolume(),
    listening_volume: getListeningVolume(),
  };
}

function selectSonosAirPlay() {
  return new Promise((resolve, reject) => {
    execFile(AIRPLAY_SELECT_SCRIPT, { timeout: 45_000 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || "AirPlay selection failed").trim();
        reject(new Error(detail));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function stopPiAudioStream() {
  if (!piAudioProcess) return;
  try {
    piAudioProcess.stdin.end();
  } catch {}
  try {
    piAudioProcess.kill("SIGTERM");
  } catch {}
  piAudioProcess = null;
  piAudioBytes = 0;
  piAudioChunks = 0;
  piAudioStartedAt = null;
}

function startPiAudioStream({ sampleRate = 48000 } = {}) {
  stopPiAudioStream();
  const safeRate = Number.isFinite(Number(sampleRate)) ? Math.max(8000, Math.min(96000, Math.round(Number(sampleRate)))) : 48000;
  const remoteCommand = [
    "PULSE_SERVER=unix:/run/audio/pulse.sock",
    "pacat",
    "--playback",
    "--raw",
    "--format=s16le",
    `--rate=${safeRate}`,
    "--channels=1",
    "--latency-msec=80",
    "--client-name=Jarvis",
    "--stream-name=Jarvis",
  ].join(" ");
  piAudioProcess = spawn(
    "ssh",
    [
      "-i",
      PI_SSH_KEY,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      `${PI_SSH_USER}@${PI_SSH_HOST}`,
      remoteCommand,
    ],
    { stdio: ["pipe", "ignore", "pipe"] }
  );
  piAudioBytes = 0;
  piAudioChunks = 0;
  piAudioStartedAt = Date.now();
  piAudioProcess.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) log("pi audio stream", { error: text.slice(0, 500) });
  });
  piAudioProcess.on("exit", (code, signal) => {
    if (piAudioProcess) {
      log("pi audio stream exited", { code, signal, bytes: piAudioBytes });
      piAudioProcess = null;
      piAudioBytes = 0;
      piAudioChunks = 0;
      piAudioStartedAt = null;
    }
  });
}

async function announceOnPiSpeaker(message, preannounce = false) {
  return callHomeAssistantService("assist_satellite", "announce", {
    entity_id: PI_ASSIST_SATELLITE,
    message: String(message || "").slice(0, 220),
    preannounce,
  });
}

function readTasks() {
  try {
    const tasks = JSON.parse(fs.readFileSync(TASKS_PATH, "utf8"));
    return Array.isArray(tasks) ? tasks : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks) {
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2), { mode: 0o600 });
}

function addTask(text, dueText = "") {
  const tasks = readTasks();
  const task = {
    id: `${Date.now()}`,
    text,
    due_text: dueText,
    status: "open",
    created_at: new Date().toISOString(),
  };
  tasks.push(task);
  writeTasks(tasks);
  return task;
}

async function callHomeAssistantService(domain, service, serviceData, dryRun = false) {
  const action = `${domain}.${service}`;
  if (dryRun) {
    return { dry_run: true, action, service_data: serviceData };
  }

  const token = readHomeAssistantToken();
  const response = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(serviceData),
  });

  if (!response.ok) {
    throw new Error(`Home Assistant service ${action} returned ${response.status}`);
  }

  return response.json();
}

async function fetchHomeAssistantJson(path) {
  const token = readHomeAssistantToken();
  const response = await fetch(`${HA_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Home Assistant ${path} returned ${response.status}`);
  }
  return response.json();
}

async function postHomeAssistantJson(path, payload) {
  const token = readHomeAssistantToken();
  const response = await fetch(`${HA_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Home Assistant ${path} returned ${response.status}`);
  }
  return response.json();
}

async function getHomeAssistantState(entityId) {
  return fetchHomeAssistantJson(`/api/states/${encodeURIComponent(entityId)}`);
}

async function publishLaptopHeartbeat() {
  const now = new Date().toISOString();
  const status = currentConnectionStatus();
  await postHomeAssistantJson(`/api/states/${encodeURIComponent(LAPTOP_HEARTBEAT_ENTITY)}`, {
    state: "online",
    attributes: {
      friendly_name: "Jarvis laptop heartbeat",
      icon: "mdi:laptop",
      last_seen_at: now,
      ttl_seconds: LAPTOP_HEARTBEAT_TTL_SECONDS,
      router_host: HOST,
      router_port: PORT,
      router_url: LAPTOP_ROUTER_URL,
      pid: process.pid,
      pi_mic_connected: status.pi_mic.connected,
      pi_mic_last_seen_at: status.pi_mic.last_seen_at,
      pi_mic_last_seen_seconds: status.pi_mic.last_seen_seconds,
    },
  });
}

function startLaptopHeartbeat() {
  let heartbeatInFlight = false;
  let lastHeartbeatErrorAt = 0;

  const tick = async () => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      await publishLaptopHeartbeat();
    } catch (error) {
      const now = Date.now();
      if (now - lastHeartbeatErrorAt >= 30_000) {
        log("Laptop heartbeat failed", { error: error.message });
        lastHeartbeatErrorAt = now;
      }
    } finally {
      heartbeatInFlight = false;
    }
  };

  tick();
  setInterval(tick, LAPTOP_HEARTBEAT_INTERVAL_MS);
}

async function getMediaPlayerVolume(entityId) {
  const state = await getHomeAssistantState(entityId);
  const volume = state?.attributes?.volume_level;
  return Number.isFinite(Number(volume)) ? Math.max(0, Math.min(1, Number(volume))) : null;
}

async function captureVoiceLightSnapshot() {
  if (voiceLightSnapshot) return;
  voiceLightSnapshot = await Promise.all(
    LIVING_ROOM_LIGHTS.map((entityId) => getHomeAssistantState(entityId).catch(() => ({ entity_id: entityId, state: "unavailable", attributes: {} }))),
  );
}

async function applyVoiceLightCue(mode) {
  if ((process.env.JARVIS_LIGHT_CUES || "true").toLowerCase() === "false") return;
  if (voiceLightCueMode === mode) return;
  await captureVoiceLightSnapshot();
  voiceLightCueMode = mode;

  const cues = {
    listening: { brightness_pct: 22, hs_color: [42, 28] },
    thinking: { brightness_pct: 26, hs_color: [42, 28] },
    speaking: { brightness_pct: 24, hs_color: [42, 28] },
  };
  const cue = cues[mode] || cues.thinking;
  await callHomeAssistantService("light", "turn_on", {
    entity_id: LIVING_ROOM_LIGHTS,
    transition: 0.25,
    ...cue,
  });
}

async function restoreVoiceLightCue() {
  if (!voiceLightSnapshot) return;
  const snapshot = voiceLightSnapshot;
  voiceLightSnapshot = null;
  voiceLightCueMode = "";

  for (const state of snapshot) {
    const entityId = state.entity_id;
    if (!entityId || state.state === "unavailable") continue;
    if (state.state !== "on") {
      await callHomeAssistantService("light", "turn_off", {
        entity_id: entityId,
        transition: 0.6,
      }).catch((error) => log("Voice light restore off failed", { entity_id: entityId, error: error.message }));
      continue;
    }
    const attrs = state.attributes || {};
    const serviceData = {
      entity_id: entityId,
      transition: 0.6,
    };
    if (Number.isFinite(Number(attrs.brightness))) serviceData.brightness = Number(attrs.brightness);
    if (Array.isArray(attrs.hs_color)) {
      serviceData.hs_color = attrs.hs_color;
    } else if (Number.isFinite(Number(attrs.color_temp_kelvin))) {
      serviceData.color_temp_kelvin = Number(attrs.color_temp_kelvin);
    }
    await callHomeAssistantService("light", "turn_on", serviceData)
      .catch((error) => log("Voice light restore on failed", { entity_id: entityId, error: error.message }));
  }
}

function clearVoiceLightCue() {
  voiceLightSnapshot = null;
  voiceLightCueMode = "";
}

async function getMediaPlaybackContext(entityId) {
  try {
    const state = await getHomeAssistantState(entityId);
    const updatedAt = Date.parse(state?.attributes?.media_position_updated || state?.last_changed || "");
    const ageMs = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Infinity;
    return {
      state: String(state?.state || "unknown"),
      title: state?.attributes?.media_title || "",
      playlist: state?.attributes?.media_playlist || state?.attributes?.queue_name || "",
      media_content_id: state?.attributes?.media_content_id || "",
      source: state?.attributes?.source || "",
      recent: ageMs >= 0 && ageMs < 2 * 60 * 60 * 1000,
    };
  } catch (error) {
    log("Media playback context unavailable", { entity_id: entityId, error: error.message });
    return { state: "unknown", title: "", playlist: "", media_content_id: "", source: "", recent: false };
  }
}

async function browseMedia(entityId, mediaContentType, mediaContentId) {
  const token = readHomeAssistantToken();
  const response = await fetch(`${HA_URL}/api/services/media_player/browse_media?return_response`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entity_id: entityId,
      media_content_type: mediaContentType,
      media_content_id: mediaContentId,
    }),
  });
  if (!response.ok) {
    throw new Error(`Home Assistant media browse returned ${response.status}`);
  }
  return response.json();
}

async function getSonosPlaylists(entityId = "media_player.sonos") {
  const now = Date.now();
  if (cachedSonosPlaylists && now - cachedSonosPlaylistsAt < 10 * 60 * 1000) return cachedSonosPlaylists;

  const favorites = await browseMedia(entityId, "favorites", "");
  const root = favorites?.service_response?.[entityId];
  const children = Array.isArray(root?.children) ? root.children : [];
  const playlistsFolder = children.find((item) => item.title === "Playlists" || item.media_content_type === "favorites_folder");
  const playlistChildren = playlistsFolder
    ? (await browseMedia(entityId, playlistsFolder.media_content_type, playlistsFolder.media_content_id))?.service_response?.[entityId]?.children
    : children;
  const playableFavorites = children.filter((item) => item.can_play);
  const playablePlaylistChildren = Array.isArray(playlistChildren) ? playlistChildren.filter((item) => item.can_play) : [];
  const uniqueItems = new Map();
  for (const item of [...playableFavorites, ...playablePlaylistChildren]) {
    const key = item.media_content_id || item.title;
    if (key) uniqueItems.set(key, item);
  }

  cachedSonosPlaylists = Array.from(uniqueItems.values())
    .map((item) => ({
      title: String(item.title || ""),
      media_content_type: item.media_content_type,
      media_content_id: item.media_content_id,
    }))
    .filter((item) => item.title && item.media_content_type && item.media_content_id);
  cachedSonosPlaylistsAt = now;
  return cachedSonosPlaylists;
}

function readMusicHistory() {
  if (cachedMusicHistory) return cachedMusicHistory;
  try {
    const parsed = JSON.parse(fs.readFileSync(MUSIC_HISTORY_PATH, "utf8"));
    cachedMusicHistory = Array.isArray(parsed?.plays) ? parsed.plays : [];
  } catch {
    cachedMusicHistory = [];
  }
  return cachedMusicHistory;
}

function writeMusicHistory(history) {
  cachedMusicHistory = history.slice(0, 40);
  try {
    fs.writeFileSync(MUSIC_HISTORY_PATH, JSON.stringify({ plays: cachedMusicHistory }, null, 2));
  } catch (error) {
    log("Music history write failed", { error: error.message });
  }
}

function rememberMusicChoice(entityId, playlist) {
  if (!playlist?.media_content_id) return;
  const history = readMusicHistory().filter((item) => item.media_content_id !== playlist.media_content_id);
  history.unshift({
    at: new Date().toISOString(),
    entity_id: entityId,
    title: playlist.title,
    media_content_type: playlist.media_content_type,
    media_content_id: playlist.media_content_id,
  });
  writeMusicHistory(history);
}

function playlistRecencyPenalty(playlist, playback, history) {
  const id = playlist.media_content_id;
  const title = normalized(playlist.title);
  const isCurrent =
    id === playback.media_content_id ||
    title === normalized(playback.playlist) ||
    title === normalized(playback.title);
  let penalty = isCurrent ? 80 : 0;
  const recentIndex = history.findIndex((item) => item.media_content_id === id || normalized(item.title) === title);
  if (recentIndex === 0) penalty += 70;
  else if (recentIndex === 1) penalty += 45;
  else if (recentIndex === 2) penalty += 25;
  else if (recentIndex >= 0 && recentIndex < 6) penalty += 10;
  return penalty;
}

function smartPlaylistChoice(playlists, {
  text = "",
  playback = {},
  baseScore = () => 0,
  allowZeroScore = true,
  preferredTitle = "",
} = {}) {
  if (!playlists.length) return null;
  const wanted = normalized(preferredTitle);
  if (wanted) {
    const exact = findPlaylistByTitle(playlists, wanted);
    if (exact && !isExploratoryMusicRequest(text)) return exact;
  }

  const history = readMusicHistory();
  const candidates = playlists
    .map((playlist) => {
      const score = Number(baseScore(playlist)) || 0;
      const freshness = Math.random() * 8;
      const penalty = playlistRecencyPenalty(playlist, playback, history);
      return { playlist, score, rank: (score * 20) + freshness - penalty };
    })
    .filter((item) => allowZeroScore || item.score > 0)
    .sort((a, b) => b.rank - a.rank);

  return candidates[0]?.playlist || null;
}

function scorePlaylistForMood(text, playlistTitle) {
  const title = normalized(playlistTitle);
  let score = 0;
  if (/\b(relax|relaxing|chill|calm|ambient|lofi|lo fi|suave|tranqui|tranquilo|tranquila|relajante)\b/.test(text)) {
    if (/\bsoft jazz\b/.test(title)) score += 10;
    if (/\bperfect mood\b/.test(title)) score += 8;
    if (/\bnostalgic\b/.test(title)) score += 3;
  }
  if (/\b(dinner|cooking|cook|wine|friends|cena|cenar|cocina|cocinar|amigos)\b/.test(text)) {
    if (/\bsoft jazz\b/.test(title)) score += 12;
    if (/\bperfect mood\b/.test(title)) score += 10;
    if (/\bnostalgic\b/.test(title)) score += 4;
    if (/\bdance\b/.test(title)) score -= 4;
    if (/\bhard life\b/.test(title)) score -= 6;
  }
  if (/\b(focus|concentrate|work|study|concentracion|trabajar|estudiar)\b/.test(text)) {
    if (/\bwork drive\b/.test(title)) score += 10;
    if (/\bsoft jazz\b/.test(title)) score += 4;
  }
  if (/\b(clean|cleaning|tidy|limpiar|ordenar)\b/.test(text)) {
    if (/\bdance\b/.test(title)) score += 9;
    if (/\bwork drive\b/.test(title)) score += 6;
    if (/\bperfect mood\b/.test(title)) score += 4;
  }
  if (/\b(party|dance|upbeat|fiesta|animada|bailar)\b/.test(text)) {
    if (/\bdance\b/.test(title)) score += 10;
    if (/\bperfect mood\b/.test(title)) score += 4;
  }
  if (/\b(mood|vibe|ambiente)\b/.test(text) && /\bperfect mood\b/.test(title)) score += 6;
  if (/\b(nostalgic|nostalgia)\b/.test(text) && /\bnostalgic\b/.test(title)) score += 10;
  if (/\b(ski|skiing|esqui)\b/.test(text) && /\bskiing\b/.test(title)) score += 10;
  return score;
}

async function playlistByName(text, entityId) {
  try {
    const normalizedText = normalized(text);
    const playlists = await getSonosPlaylists(entityId);
    return playlists
      .map((playlist) => {
        const title = normalized(playlist.title);
        const words = title.split(/\s+/).filter((word) => word.length > 2);
        const exact = normalizedText.includes(title) || title.includes(normalizedText);
        const wordMatches = words.filter((word) => new RegExp(`\\b${word}\\b`).test(normalizedText)).length;
        return { playlist, score: exact ? 100 + wordMatches : wordMatches };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.playlist || null;
  } catch (error) {
    log("Sonos playlist name lookup failed", { error: error.message });
    return null;
  }
}

async function playlistForMood(text, entityId) {
  try {
    const [playlists, playback] = await Promise.all([
      getSonosPlaylists(entityId),
      getMediaPlaybackContext(entityId),
    ]);
    return smartPlaylistChoice(playlists, {
      text,
      playback,
      baseScore: (playlist) => scorePlaylistForMood(text, playlist.title),
      allowZeroScore: false,
    });
  } catch (error) {
    log("Sonos playlist mood lookup failed", { error: error.message });
    return null;
  }
}

function isExploratoryMusicRequest(text) {
  return /\b(something|anything|some music|music|musica|algo|cualquier|surprise|surpriseme|surprise me|recommend|recommendation|new|different|fresh|otra cosa|algo nuevo|diferente|recomienda|sorprendeme|sorpréndeme)\b/.test(normalized(text));
}

function isVagueMusicChangeRequest(text) {
  const cleaned = normalized(text);
  return /\b(play|put on|start|change|switch|choose|pick|pon|poner|reproduce|cambia|elige|escoge)\b/.test(cleaned)
    && /\b(something|anything|something else|another|another one|different|new|fresh|otra cosa|algo|algo nuevo|diferente|otro|otra)\b/.test(cleaned);
}

function isDirectMusicChangeRequest(text) {
  const cleaned = normalized(text);
  return /\b(change|switch|cambia|cambiar)\b.*\b(music|song|track|station|radio|musica|cancion|tema|emisora)\b/.test(cleaned)
    || /\b(music|song|track|station|radio|musica|cancion|tema|emisora)\b.*\b(change|switch|cambia|cambiar)\b/.test(cleaned);
}

async function recommendedPlaylist(text, entityId) {
  try {
    const [playlists, playback] = await Promise.all([
      getSonosPlaylists(entityId),
      getMediaPlaybackContext(entityId),
    ]);
    return smartPlaylistChoice(playlists, { text, playback, allowZeroScore: true });
  } catch (error) {
    log("Sonos recommendation lookup failed", { error: error.message });
    return null;
  }
}

function extractPlaylistMood(text) {
  return normalized(text)
    .replace(/\b(create|make|build|generate|new|playlist|music|for|me|a|an|the|please|crea|crear|haz|hacer|nueva|nuevo|lista|musica|para|por favor)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "fresh music";
}

function spotifyPlaylistNameForMood(text) {
  const mood = extractPlaylistMood(text)
    .split(/\s+/)
    .slice(0, 5)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  const date = new Date().toISOString().slice(0, 10);
  return `Jarvis - ${mood || "Fresh Music"} - ${date}`;
}

async function planSpotifyTrackSearches(userText) {
  const fallback = [
    "Khruangbin",
    "Parcels",
    "FKJ",
    "Bonobo",
    "Tom Misch",
    "Nujabes",
    "Men I Trust",
    "Jungle",
    "Air",
    "Sade",
    "Nightmares On Wax",
    "Thievery Corporation",
  ];
  const apiKey = getOpenRouterKey();
  if (!apiKey) return fallback;

  const system = [
    "You create Spotify search seeds for a new playlist.",
    "Return only JSON.",
    "Given a mood request, produce 24 concise Spotify search queries.",
    "Queries may be artist names, song titles with artists, or genre/style phrases.",
    "Favor tasteful variety, a few fresh discoveries, and coherent flow.",
    "Return exactly: {\"queries\":[\"query one\",\"query two\"]}",
  ].join("\n");

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://jarvis.local",
        "X-Title": "Jarvis Spotify Playlist Builder",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0.8,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const payload = await response.json();
    const plan = extractJson(payload.choices?.[0]?.message?.content || "");
    const queries = Array.isArray(plan.queries) ? plan.queries.map(String).filter(Boolean) : [];
    return queries.length ? queries.slice(0, 32) : fallback;
  } catch (error) {
    log("Spotify search planning failed", { error: error.message });
    return fallback;
  }
}

async function spotifyFetch(path, options = {}) {
  const token = await getSpotifyAccessToken();
  if (!token) {
    const error = new Error("Spotify is not configured");
    error.code = "spotify_not_configured";
    throw error;
  }
  const response = await fetch(`${SPOTIFY_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(`Spotify returned ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function createSpotifyPlaylistForMood(userText) {
  const queries = await planSpotifyTrackSearches(userText);
  const seenTracks = new Set();
  const uris = [];

  for (const query of queries) {
    if (uris.length >= 35) break;
    const search = await spotifyFetch(`/search?${new URLSearchParams({ q: query, type: "track", limit: "3" })}`);
    const tracks = Array.isArray(search?.tracks?.items) ? search.tracks.items : [];
    const track = tracks.find((item) => item?.uri && !seenTracks.has(item.uri));
    if (!track) continue;
    seenTracks.add(track.uri);
    uris.push(track.uri);
  }

  if (!uris.length) throw new Error("Spotify search did not return usable tracks");

  const me = await spotifyFetch("/me");
  const name = spotifyPlaylistNameForMood(userText);
  const playlist = await spotifyFetch(`/users/${encodeURIComponent(me.id)}/playlists`, {
    method: "POST",
    body: JSON.stringify({
      name,
      public: false,
      description: `Created by Jarvis for: ${userText}`,
    }),
  });

  await spotifyFetch(`/playlists/${encodeURIComponent(playlist.id)}/tracks`, {
    method: "POST",
    body: JSON.stringify({ uris }),
  });

  return {
    name,
    id: playlist.id,
    uri: playlist.uri,
    url: playlist.external_urls?.spotify || "",
    track_count: uris.length,
  };
}

function playlistAction(entityId, playlist) {
  return {
    service: "media_player.play_media",
    service_data: {
      entity_id: entityId,
      media_content_type: playlist.media_content_type,
      media_content_id: playlist.media_content_id,
    },
  };
}

function findPlaylistByTitle(playlists, title) {
  const wanted = normalized(title);
  if (!wanted) return null;
  return playlists.find((playlist) => normalized(playlist.title) === wanted)
    || playlists.find((playlist) => normalized(playlist.title).includes(wanted) || wanted.includes(normalized(playlist.title)))
    || null;
}

function directPlaylistFromRequest(playlists, text) {
  const cleaned = normalized(text)
    .replace(/\b(please|por favor|sonos|music|musica|playlist|lista|play|put on|start|pon|poner|reproduce)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const exact = playlists.find((playlist) => normalized(playlist.title) === cleaned);
  if (exact) return exact;

  return playlists.find((playlist) => {
    const title = normalized(playlist.title);
    return title.length >= 4 && cleaned.includes(title);
  }) || null;
}

function musicConfirmationIsFresh() {
  return pendingMusicConfirmation && Date.now() - pendingMusicConfirmation.created_at < 45_000;
}

function clearPendingMusicConfirmation() {
  pendingMusicConfirmation = null;
}

function setPendingMusicConfirmation(entityId, playlist, originalText) {
  pendingMusicConfirmation = {
    entity_id: entityId,
    playlist,
    original_text: originalText,
    created_at: Date.now(),
  };
}

async function playConfirmedPlaylist(text, dryRun) {
  if (!musicConfirmationIsFresh()) {
    clearPendingMusicConfirmation();
    return null;
  }
  if (!/\b(yes|yeah|yep|sure|ok|okay|do it|play it|si|sí|vale|dale|hazlo|ponla|ponlo)\b/.test(text)) {
    if (/\b(no|nope|nah|cancel|stop|otra|different|different one|otro|otra cosa|diferente)\b/.test(text)) {
      clearPendingMusicConfirmation();
      return result(reply(text, "Okay, I won't play it.", "Vale, no la pongo."), "fast", [], {
        cancelled_pending_music: true,
      });
    }
    return null;
  }

  const pending = pendingMusicConfirmation;
  clearPendingMusicConfirmation();
  const action = playlistAction(pending.entity_id, pending.playlist);
  await callHomeAssistantService("media_player", "play_media", action.service_data, dryRun);
  if (!dryRun) rememberMusicChoice(pending.entity_id, pending.playlist);
  return result(reply(
    text,
    `I'll play ${pending.playlist.title} on ${mediaTargetName(pending.entity_id)}.`,
    `Pongo ${pending.playlist.title} en ${mediaTargetName(pending.entity_id)}.`,
  ), "fast", [action], {
    planner: "music_confirmation",
  });
}

async function planMusicRequest(userText, entityId) {
  const apiKey = getOpenRouterKey();
  if (!apiKey) return null;

  const [playlists, playback] = await Promise.all([
    getSonosPlaylists(entityId),
    getMediaPlaybackContext(entityId),
  ]);
  if (!playlists.length) return null;
  const recentMusic = readMusicHistory()
    .filter((item) => !item.entity_id || item.entity_id === entityId)
    .slice(0, 8)
    .map((item) => item.title);

  const system = [
    "You are Jarvis' music selection planner for Sonos.",
    "Return only JSON.",
    "You receive the user's music request, current playback state, recent Jarvis music choices, and playable Sonos favorites.",
    "Decide between play_playlist, resume, or ask.",
    "If the user names a listed playlist or asks for a mood/genre that plausibly matches one, choose play_playlist.",
    "For vague requests like play music, manage the music, surprise me, recommend music, or put something on, choose a playable favorite that is not in the recent choices when possible.",
    "Prefer variety and discovery over repeating the same playlist. Avoid the current playlist unless the user explicitly asks to resume or names it.",
    "Use resume only when the user clearly asks to resume, continue, or unpause.",
    "Do not ask 'which one' when a reasonable playlist choice exists.",
    "Keep spoken_response short and natural in the user's language.",
    "Return JSON exactly like: {\"decision\":\"play_playlist|resume|ask\",\"playlist_title\":\"optional exact listed title\",\"spoken_response\":\"short response\"}",
  ].join("\n");

  const content = [
    `User request: ${userText}`,
    `Playback state: ${JSON.stringify(playback)}`,
    `Recent Jarvis choices: ${recentMusic.length ? recentMusic.join(", ") : "none"}`,
    "Playable Sonos favorites:",
    playlists.map((playlist) => `- ${playlist.title}`).join("\n"),
  ].join("\n");

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://jarvis.local",
      "X-Title": "Jarvis Music Planner",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    }),
  });
  if (!response.ok) {
    log("Music planner failed", { status: response.status, error: (await response.text()).slice(0, 200) });
    return null;
  }

  try {
    const payload = await response.json();
    const plan = extractJson(payload.choices?.[0]?.message?.content || "");
    const decision = String(plan.decision || "").trim();
    if (!["play_playlist", "resume", "ask"].includes(decision)) return null;
    let playlist = decision === "play_playlist" ? findPlaylistByTitle(playlists, plan.playlist_title) : null;
    if (playlist && isExploratoryMusicRequest(userText)) {
      playlist = smartPlaylistChoice(playlists, {
        text: userText,
        playback,
        preferredTitle: playlist.title,
        allowZeroScore: true,
      }) || playlist;
    }
    if (decision === "play_playlist" && !playlist) return null;
    return {
      decision,
      playlist,
      spoken_response: String(plan.spoken_response || "").trim(),
    };
  } catch (error) {
    log("Music planner parse failed", { error: error.message });
    return null;
  }
}

async function buildInventory() {
  const now = Date.now();
  if (cachedInventory && now - cachedInventoryAt < 30_000) return cachedInventory;

  const states = await fetchHomeAssistantJson("/api/states");
  const usefulDomains = new Set([
    "light",
    "script",
    "scene",
    "switch",
    "cover",
    "media_player",
    "climate",
    "fan",
    "vacuum",
    "lock",
  ]);

  cachedInventory = states
    .filter((state) => usefulDomains.has(state.entity_id.split(".")[0]))
    .filter((state) => !BLOCKED_ENTITIES.has(state.entity_id))
    .map((state) => ({
      entity_id: state.entity_id,
      name: state.attributes?.friendly_name || state.entity_id,
      state: state.state,
    }))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
    .slice(0, 100);
  cachedInventoryAt = now;
  return cachedInventory;
}

function result(spokenResponse, route, actions = [], extra = {}) {
  return {
    ok: true,
    spoken_response: spokenResponse,
    route,
    actions,
    ...extra,
  };
}

function mediaTargetName(entityId) {
  return String(entityId || "").includes("bedroom") ? "bedroom speaker" : "Sonos";
}

function isSpotifyPlaylistCreationRequest(text) {
  const hasCreateVerb = /\b(create|make|build|generate|crea|crear|haz|hacer)\b/.test(text);
  if (!hasCreateVerb) return false;

  const isSelectionRequest = /\b(select|selection|choose|pick|change|switch|manage|recommend|play|seleccion|selecciona|elige|escoge|cambia|gestiona|maneja|recomienda|pon|poner|reproduce)\b/.test(text);
  if (isSelectionRequest && !/\b(create|crea|crear)\b/.test(text)) return false;

  return /\b(playlist|lista)\b/.test(text)
    || /\b(create|crea|crear)\b.*\b(music|musica)\b/.test(text);
}

function hasMediaAction(actions) {
  return Array.isArray(actions) && actions.some((action) => String(action?.service || "").startsWith("media_player."));
}

function routedSpokenResponse(originalText, hermesResponse, homeResponse) {
  if (hasMediaAction(homeResponse?.actions)) return homeResponse.spoken_response;
  if (/music|musica|sonos|speaker|altavoz|playlist|spotify|volume|volumen/i.test(String(originalText || ""))) {
    return homeResponse?.spoken_response || hermesResponse;
  }
  return hermesResponse || homeResponse?.spoken_response;
}

function normalized(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s%]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWakePrefix(text) {
  const cleaned = String(text || "").trim();
  return cleaned
    .replace(/^\s*(?:ok(?:ay)?|hey|hi|hello)?\s*(?:jarvis|jervis|charvis|service)\s*[,.:;-]?\s*/i, "")
    .trim() || cleaned;
}

function isSpanish(text) {
  return /\b(luces?|persiana|toldo|sombra|sol|salon|sala|enciende|apaga|pon|poner|sube|baja|rojo|azul|verde|blanco|calido|calida|musica|volumen|recuerdame|recordatorio|tarea|lista|ordenador|portatil|conectado|conectada|conexion)\b/.test(text);
}

function reply(text, english, spanish) {
  return isSpanish(normalized(text)) ? spanish : english;
}

function parsePercent(text) {
  const match = text.match(/\b(\d{1,3})(?:\.(\d+))?\s*(percent|%)?\b/);
  if (!match) return null;
  const raw = Number(match[0].replace(/[^\d.]/g, ""));
  if (!Number.isFinite(raw)) return null;
  const value = raw <= 1 && match[2] ? raw : Math.max(0, Math.min(100, raw)) / 100;
  return Math.max(0, Math.min(1, value));
}

function lightColorForText(text) {
  const colors = [
    { pattern: /\bred\b|\brojos?\b|\brojas?\b/, hs_color: [0, 100], name: "red", name_es: "rojo" },
    { pattern: /\bgreen\b|\bverdes?\b/, hs_color: [120, 100], name: "green", name_es: "verde" },
    { pattern: /\bblue\b|\bazules?\b/, hs_color: [240, 100], name: "blue", name_es: "azul" },
    { pattern: /\bpurple\b|\bviolet\b|\bmorados?\b|\bvioletas?\b/, hs_color: [275, 80], name: "purple", name_es: "morado" },
    { pattern: /\bpink\b|\bmagenta\b|\brosas?\b/, hs_color: [320, 80], name: "pink", name_es: "rosa" },
    { pattern: /\borange\b|\bamber\b|\bnaranjas?\b/, hs_color: [32, 100], name: "orange", name_es: "naranja" },
    { pattern: /\byellow\b|\bgold\b|\bamarillos?\b|\bdorados?\b/, hs_color: [50, 90], name: "yellow", name_es: "amarillo" },
    { pattern: /\bcyan\b|\bturquoise\b|\bteal\b|\bturquesas?\b/, hs_color: [180, 80], name: "cyan", name_es: "turquesa" },
  ];
  return colors.find((color) => color.pattern.test(text)) || null;
}

function safeEntity(entityId) {
  return typeof entityId === "string" && !BLOCKED_ENTITIES.has(entityId);
}

async function runScriptActions(actions, dryRun) {
  for (const action of actions) {
    await callHomeAssistantService("script", "turn_on", action.service_data, dryRun);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScriptActionSteps(steps, dryRun) {
  for (const step of steps) {
    await callHomeAssistantService("script", "turn_on", step.action.service_data, dryRun);
    if (!dryRun && step.delay_after_ms) {
      await sleep(step.delay_after_ms);
    }
  }
}

function scriptAction(entityId) {
  return {
    service: "script.turn_on",
    service_data: { entity_id: entityId },
  };
}

async function fastPath(userText, dryRun) {
  const text = normalized(userText);
  const lightsPattern = /\blights?\b|\bluces?\b/;
  const roomPattern = /\b(room|living room|here|salon|sala|aqui)\b/;

  const confirmedMusic = await playConfirmedPlaylist(text, dryRun);
  if (confirmedMusic) return confirmedMusic;

  if (isConnectionStatusQuestion(text)) {
    return result(connectionStatusSpeech(text), "fast", [], {
      connection_status: currentConnectionStatus(),
    });
  }

  const addTaskMatch =
    text.match(/\b(?:remind me to|remember to|add (?:a )?task to|add to my list|todo)\s+(.+)/) ||
    text.match(/\b(?:recuerdame|recordarme|anade (?:una )?tarea|agrega (?:una )?tarea|pon en mi lista)\s+(?:que\s+)?(.+)/);
  if (addTaskMatch) {
    const rawTask = addTaskMatch[1].trim();
    const dueMatch = rawTask.match(/\b(tomorrow|today|tonight|next week|manana|hoy|esta noche|la semana que viene)\b/);
    const dueText = dueMatch ? dueMatch[1] : "";
    const taskText = rawTask.replace(/\b(tomorrow|today|tonight|next week|manana|hoy|esta noche|la semana que viene)\b/g, "").trim() || rawTask;
    if (!dryRun) addTask(taskText, dueText);
    return result(
      reply(text, `Added to your Jarvis task list: ${taskText}.`, `Lo agregue a tu lista de tareas de Jarvis: ${taskText}.`),
      "fast",
      [],
      { task: { text: taskText, due_text: dueText }, dry_run: dryRun },
    );
  }

  if (/\b(?:list|show|read)\s+(?:my\s+)?(?:tasks|todos|reminders)\b|\b(?:lista|muestra|lee)\s+(?:mis\s+)?(?:tareas|recordatorios)\b/.test(text)) {
    const tasks = readTasks().filter((task) => task.status !== "done").slice(-5);
    const spoken = tasks.length
      ? reply(
          text,
          `You have ${tasks.length} open task${tasks.length === 1 ? "" : "s"}: ${tasks.map((task) => task.text).join("; ")}.`,
          `Tienes ${tasks.length} tarea${tasks.length === 1 ? "" : "s"} pendiente${tasks.length === 1 ? "" : "s"}: ${tasks.map((task) => task.text).join("; ")}.`,
        )
      : reply(text, "Your Jarvis task list is empty.", "Tu lista de tareas de Jarvis esta vacia.");
    return result(spoken, "fast", [], { tasks });
  }

  if (/\b(movie|film|cinema|cozy|cosy|pelicula|cine|acogedor|acogedora)\b/.test(text) && /\b(living room|room|movie|film|cinema|cozy|cosy|salon|sala|pelicula|cine|acogedor|acogedora)\b/.test(text)) {
    const lightData = {
      entity_id: LIVING_ROOM_LIGHTS,
      brightness_pct: 35,
      color_temp_kelvin: 2700,
    };
    const displayActions = [scriptAction("script.turn_tv_on")];
    await callHomeAssistantService("light", "turn_on", lightData, dryRun);
    await runScriptActions(displayActions, dryRun);
    return result(reply(text, "Movie mode.", "Modo cine."), "fast", [
      { service: "light.turn_on", service_data: lightData },
      ...displayActions,
    ]);
  }

  if (lightsPattern.test(text) && /\b(warm white|warm|white|normal|neutral|blanco|calido|calida|neutro|normal)\b/.test(text)) {
    const kelvin = /\b(warm|warm white|soft white|calido|calida)\b/.test(text)
      ? 2700
      : /\b(cool|cold|daylight|bright white)\b/.test(text)
        ? 4000
        : 3000;
    const serviceData = {
      entity_id: LIVING_ROOM_LIGHTS,
      brightness_pct: /\b(dim|low|soft)\b/.test(text) ? 40 : 80,
      color_temp_kelvin: kelvin,
    };
    await callHomeAssistantService("light", "turn_on", serviceData, dryRun);
    return result(reply(text, "Warm lights.", "Luces calidas."), "fast", [
      { service: "light.turn_on", service_data: serviceData },
    ]);
  }

  const requestedColor = lightsPattern.test(text) ? lightColorForText(text) : null;
  if (requestedColor) {
    const serviceData = {
      entity_id: LIVING_ROOM_LIGHTS,
      brightness_pct: /\b(dim|low|soft)\b/.test(text) ? 45 : 85,
      hs_color: requestedColor.hs_color,
    };
    await callHomeAssistantService("light", "turn_on", serviceData, dryRun);
    return result(reply(text, `${requestedColor.name} lights.`, `Luces ${requestedColor.name_es}.`), "fast", [
      { service: "light.turn_on", service_data: serviceData },
    ]);
  }

  if (lightsPattern.test(text) || roomPattern.test(text)) {
    if (/\b(too bright|dim|dimmer|less bright|lower the light|lower the lights|demasiada luz|muy fuerte|baja la luz|baja las luces|menos luz|atenua|atenuar)\b/.test(text)) {
      const serviceData = {
        entity_id: LIVING_ROOM_LIGHTS,
        brightness_pct: 25,
        color_temp_kelvin: 2700,
      };
      await callHomeAssistantService("light", "turn_on", serviceData, dryRun);
      return result(reply(text, "Cozy lights.", "Luces suaves."), "fast", [
        { service: "light.turn_on", service_data: serviceData },
      ]);
    }
    if (/\b(too dark|brighter|more light|raise the light|raise the lights|muy oscuro|mas luz|sube la luz|sube las luces|mas brillante)\b/.test(text)) {
      const serviceData = {
        entity_id: LIVING_ROOM_LIGHTS,
        brightness_pct: 85,
        color_temp_kelvin: 3000,
      };
      await callHomeAssistantService("light", "turn_on", serviceData, dryRun);
      return result(reply(text, "Brighter.", "Mas luz."), "fast", [
        { service: "light.turn_on", service_data: serviceData },
      ]);
    }
  }

  if (lightsPattern.test(text)) {
    if (/\b(turn|switch|set)\s+on\b|\bon\b|\benciende\b|\bprende\b|\bpon\b|\bponer\b/.test(text)) {
      const serviceData = { entity_id: LIVING_ROOM_LIGHTS };
      await callHomeAssistantService("light", "turn_on", serviceData, dryRun);
      return result(reply(text, "Lights on.", "Luces listas."), "fast", [
        { service: "light.turn_on", service_data: serviceData },
      ]);
    }
    if (/\b(turn|switch|set)\s+off\b|\boff\b|\bapaga\b|\bapagar\b/.test(text)) {
      const serviceData = { entity_id: LIVING_ROOM_LIGHTS };
      await callHomeAssistantService("light", "turn_off", serviceData, dryRun);
      return result(reply(text, "Lights off.", "Luces apagadas."), "fast", [
        { service: "light.turn_off", service_data: serviceData },
      ]);
    }
  }

  if (/\b(awning|shade|sun|sunny|toldo|sombra|sol|soleado)\b/.test(text)) {
    if (/\b(more shade|too sunny|block the sun|open|open awning|turn on|switch on|extend|lower|cover|mas sombra|mucho sol|demasiado sol|bloquea el sol|abre|abrir|enciende|prende|extiende|baja)\b/.test(text)) {
      const action = scriptAction("script.awning_up");
      await runScriptActions([action], dryRun);
      return result(reply(text, "Awning open.", "Toldo abierto."), "fast", [action]);
    }
    if (/\b(less shade|more sun|close|close awning|turn off|switch off|retract|raise|uncover|menos sombra|mas sol|cierra|cerrar|apaga|recoge|sube)\b/.test(text)) {
      const action = scriptAction("script.awning_down");
      await runScriptActions([action], dryRun);
      return result(reply(text, "Awning closed.", "Toldo cerrado."), "fast", [action]);
    }
  }

  if (/\b(sonos|music|song|track|speaker|volume|musica|cancion|canción|tema|altavoz|volumen|playlist|station|stations|radio|emisora|emisoras|jazz|dance|ambient|relax|relaxing|chill|focus|nostalgic|skiing|tranqui|tranquilo|tranquila|relajante)\b/.test(text) || isVagueMusicChangeRequest(text)) {
    const entityId = /\b(bedroom|habitacion|dormitorio)\b/.test(text) ? "media_player.bedroom" : "media_player.sonos";
    const createPlaylistRequest = isSpotifyPlaylistCreationRequest(text);
    if (createPlaylistRequest) {
      clearPendingMusicConfirmation();
      if (dryRun) {
        return result(reply(text, "I would create a new Spotify playlist for that.", "Crearia una nueva lista en Spotify para eso."), "fast", [], {
          planner: "spotify_create_playlist",
          dry_run: true,
        });
      }
      try {
        const playlist = await createSpotifyPlaylistForMood(userText);
        return result(
          reply(
            text,
            `Created ${playlist.name} with ${playlist.track_count} tracks.`,
            `He creado ${playlist.name} con ${playlist.track_count} canciones.`,
          ),
          "fast",
          [{
            service: "spotify.create_playlist",
            service_data: {
              name: playlist.name,
              id: playlist.id,
              uri: playlist.uri,
              url: playlist.url,
              track_count: playlist.track_count,
            },
          }],
          { planner: "spotify_create_playlist", spotify_playlist: playlist },
        );
      } catch (error) {
        if (error.code === "spotify_not_configured") {
          return result(
            reply(
              text,
              "I can choose from your existing playlists. New Spotify playlist creation needs OAuth setup.",
              "Puedo elegir de tus listas actuales. Para crear listas nuevas en Spotify falta configurar OAuth.",
            ),
            "fast",
            [],
            { needs_spotify_setup: true, planner: "spotify_create_playlist" },
          );
        }
        log("Spotify playlist creation failed", { error: error.message, status: error.status });
        return result(
          reply(text, "I couldn't create the Spotify playlist.", "No he podido crear la lista en Spotify."),
          "fast",
          [],
          { planner: "spotify_create_playlist", error: error.message },
        );
      }
    }

    if (/\b(volume|volumen|percent|por ciento|level|nivel|%)\b/.test(text)) {
      const volumeLevel = parsePercent(text);
      if (volumeLevel !== null) {
        const serviceData = { entity_id: entityId, volume_level: volumeLevel };
        await callHomeAssistantService("media_player", "volume_set", serviceData, dryRun);
        return result(reply(
          text,
          `I'll set ${mediaTargetName(entityId)} volume to ${Math.round(volumeLevel * 100)}%.`,
          `Pongo el volumen de ${mediaTargetName(entityId)} al ${Math.round(volumeLevel * 100)}%.`,
        ), "fast", [
          { service: "media_player.volume_set", service_data: serviceData },
        ]);
      }
    }
    const mediaStopIntent =
      /\b(pause|stop|quiet|silence|kill|pausa|para|deten|silencio|calla|quita|apaga|apagar)\b/.test(text) ||
      /\b(turn|switch|shut|cut)\s+off\b/.test(text) ||
      /\boff\b.*\b(music|sonos|speaker|song|track|radio|musica|cancion|tema|altavoz)\b/.test(text);
    if (mediaStopIntent) {
      const serviceData = { entity_id: entityId };
      await callHomeAssistantService("media_player", "media_pause", serviceData, dryRun);
      return result(reply(
        text,
        `I'll pause ${mediaTargetName(entityId)}.`,
        `Pauso ${mediaTargetName(entityId)}.`,
      ), "fast", [
        { service: "media_player.media_pause", service_data: serviceData },
      ]);
    }
    if (/\b(next|skip|change (the )?song|change (the )?track|switch (the )?song|switch (the )?track|siguiente|salta|cambia la cancion|cambia la canción|cambia el tema)\b/.test(text)) {
      const serviceData = { entity_id: entityId };
      await callHomeAssistantService("media_player", "media_next_track", serviceData, dryRun);
      return result(reply(
        text,
        `I'll skip to the next track on ${mediaTargetName(entityId)}.`,
        `Paso a la siguiente cancion en ${mediaTargetName(entityId)}.`,
      ), "fast", [
        { service: "media_player.media_next_track", service_data: serviceData },
      ]);
    }
    if (/\b(previous|back|last song|last track|anterior|vuelve|cancion anterior|canción anterior|tema anterior)\b/.test(text)) {
      const serviceData = { entity_id: entityId };
      await callHomeAssistantService("media_player", "media_previous_track", serviceData, dryRun);
      return result(reply(
        text,
        `I'll go back to the previous track on ${mediaTargetName(entityId)}.`,
        `Vuelvo a la cancion anterior en ${mediaTargetName(entityId)}.`,
      ), "fast", [
        { service: "media_player.media_previous_track", service_data: serviceData },
      ]);
    }
    const playIntent = /\b(resume|play|continue|start|turn on|put on|music on|manage|recommend|surprise|select|selection|choose|pick|reanuda|sigue|continua|pon|poner|enciende|prende|reproduce|maneja|gestiona|recomienda|seleccion|selecciona|elige|escoge|sorprendeme|sorpréndeme)\b/.test(text);
    const directResume = /\b(resume|continue|music on|reanuda|sigue|continua)\b/.test(text);
    const genericMusicRequest =
      /\b(play|put on|start|pon|poner|reproduce)\s+(some\s+|the\s+|la\s+)?(music|musica|station|stations|radio|emisora|emisoras)\b/.test(text) ||
      isVagueMusicChangeRequest(text) ||
      /\b(manage|recommend|surprise|select|selection|choose|pick|change music|change the music|switch music|maneja|gestiona|recomienda|seleccion|selecciona|elige|escoge|sorprendeme|sorpréndeme|cambia la musica|cambia la música)\b/.test(text) ||
      /\b(music|musica)\s+(on|please|por favor)?\b/.test(text);
    const selectionSuggestionRequest = /\b(select|selection|choose|pick|recommend|seleccion|selecciona|elige|escoge|recomienda)\b/.test(text);
    const moodMusicRequest = (
      /\b(chill|relax|relaxing|focus|concentrate|work|study|ambient|lofi|lo fi|jazz|upbeat|party|dance|calm|dinner|cooking|cleaning|party|suave|tranqui|tranquilo|tranquila|relajante|concentracion|trabajar|estudiar|ambiente|animada|fiesta|cena|cocinar|limpiar)\b/.test(text) ||
      /\b(for|para)\b/.test(text)
    ) && /\b(play|put on|start|music|musica|pon|poner|reproduce)\b/.test(text);
    if (playIntent || moodMusicRequest || genericMusicRequest) {
      const playlists = await getSonosPlaylists(entityId).catch(() => []);
      const namedPlaylist = directPlaylistFromRequest(playlists, text);
      if (namedPlaylist) {
        clearPendingMusicConfirmation();
        const action = playlistAction(entityId, namedPlaylist);
        await callHomeAssistantService("media_player", "play_media", action.service_data, dryRun);
        if (!dryRun) rememberMusicChoice(entityId, namedPlaylist);
        return result(reply(
          text,
          `I'll play ${namedPlaylist.title} on ${mediaTargetName(entityId)}.`,
          `Pongo ${namedPlaylist.title} en ${mediaTargetName(entityId)}.`,
        ), "fast", [action], {
          planner: "music_named_playlist",
        });
      }

      if ((moodMusicRequest || selectionSuggestionRequest) && !directResume) {
        const playlist = await playlistForMood(text, entityId) || await recommendedPlaylist(text, entityId);
        if (playlist) {
          setPendingMusicConfirmation(entityId, playlist, userText);
          return result(
            reply(text, `I'd pick ${playlist.title}. Want me to play it?`, `Yo pondria ${playlist.title}. Quieres que la ponga?`),
            "fast",
            [],
            {
              needs_followup: true,
              intent: "music_playlist_confirmation",
              suggested_playlist: playlist.title,
              planner: "music_mood_suggestion",
            },
          );
        }
      }

      if (genericMusicRequest && (isVagueMusicChangeRequest(text) || isDirectMusicChangeRequest(text)) && !directResume) {
        const playlist = await recommendedPlaylist(text, entityId);
        if (playlist) {
          const action = playlistAction(entityId, playlist);
          await callHomeAssistantService("media_player", "play_media", action.service_data, dryRun);
          if (!dryRun) rememberMusicChoice(entityId, playlist);
          return result(reply(
            text,
            `I'll play ${playlist.title} on ${mediaTargetName(entityId)}.`,
            `Pongo ${playlist.title} en ${mediaTargetName(entityId)}.`,
          ), "fast", [action], {
            planner: "music_recommendation",
          });
        }
      }

      const plan = await planMusicRequest(text, entityId);
      if (plan?.decision === "play_playlist" && plan.playlist) {
        const action = playlistAction(entityId, plan.playlist);
        await callHomeAssistantService("media_player", "play_media", action.service_data, dryRun);
        if (!dryRun) rememberMusicChoice(entityId, plan.playlist);
        return result(reply(
          text,
          `I'll play ${plan.playlist.title} on ${mediaTargetName(entityId)}.`,
          `Pongo ${plan.playlist.title} en ${mediaTargetName(entityId)}.`,
        ), "fast", [action], {
          planner: "music_llm",
        });
      }
      if (plan?.decision === "resume") {
        const serviceData = { entity_id: entityId };
        await callHomeAssistantService("media_player", "media_play", serviceData, dryRun);
        return result(reply(
          text,
          `I'll resume ${mediaTargetName(entityId)}.`,
          `Reanudo ${mediaTargetName(entityId)}.`,
        ), "fast", [
          { service: "media_player.media_play", service_data: serviceData },
        ], { planner: "music_llm" });
      }
      if (plan?.decision === "ask") {
        if (genericMusicRequest || isExploratoryMusicRequest(text)) {
          const playlist = await recommendedPlaylist(text, entityId);
          if (playlist) {
            const action = playlistAction(entityId, playlist);
            await callHomeAssistantService("media_player", "play_media", action.service_data, dryRun);
            if (!dryRun) rememberMusicChoice(entityId, playlist);
            return result(reply(
              text,
              `I'll play ${playlist.title} on ${mediaTargetName(entityId)}.`,
              `Pongo ${playlist.title} en ${mediaTargetName(entityId)}.`,
            ), "fast", [action], {
              planner: "music_recommendation",
            });
          }
        }
        return result(
          plan.spoken_response || reply(text, "What do you feel like listening to?", "Que te apetece escuchar?"),
          "fast",
          [],
          { needs_followup: true, intent: "music_selection", planner: "music_llm" },
        );
      }

      const fallbackNamedPlaylist = await playlistByName(text, entityId);
      const playlist =
        fallbackNamedPlaylist ||
        (moodMusicRequest ? await playlistForMood(text, entityId) : null) ||
        (genericMusicRequest ? await recommendedPlaylist(text, entityId) : null);
      if (playlist) {
        const action = playlistAction(entityId, playlist);
        await callHomeAssistantService("media_player", "play_media", action.service_data, dryRun);
        if (!dryRun) rememberMusicChoice(entityId, playlist);
        return result(reply(
          text,
          `I'll play ${playlist.title} on ${mediaTargetName(entityId)}.`,
          `Pongo ${playlist.title} en ${mediaTargetName(entityId)}.`,
        ), "fast", [action], {
          planner: "music_fallback",
        });
      }

      const playback = await getMediaPlaybackContext(entityId);
      if (directResume || playback.state === "paused" || playback.state === "playing" || playback.recent) {
        const serviceData = { entity_id: entityId };
        await callHomeAssistantService("media_player", "media_play", serviceData, dryRun);
        return result(reply(
          text,
          `I'll resume ${mediaTargetName(entityId)}.`,
          `Reanudo ${mediaTargetName(entityId)}.`,
        ), "fast", [
          { service: "media_player.media_play", service_data: serviceData },
        ]);
      }
      if (genericMusicRequest) {
        const playlist = await recommendedPlaylist(text, entityId);
        if (playlist) {
          const action = playlistAction(entityId, playlist);
          await callHomeAssistantService("media_player", "play_media", action.service_data, dryRun);
          if (!dryRun) rememberMusicChoice(entityId, playlist);
          return result(reply(
            text,
            `I'll play ${playlist.title} on ${mediaTargetName(entityId)}.`,
            `Pongo ${playlist.title} en ${mediaTargetName(entityId)}.`,
          ), "fast", [action], {
            planner: "music_recommendation",
          });
        }
      }
      const serviceData = { entity_id: entityId };
      await callHomeAssistantService("media_player", "media_play", serviceData, dryRun);
      return result(reply(
        text,
        `I'll resume ${mediaTargetName(entityId)}.`,
        `Reanudo ${mediaTargetName(entityId)}.`,
      ), "fast", [
        { service: "media_player.media_play", service_data: serviceData },
      ]);
    }
    if (/\b(volume up|louder|raise volume|sube el volumen|mas volumen)\b/.test(text)) {
      const serviceData = { entity_id: entityId };
      await callHomeAssistantService("media_player", "volume_up", serviceData, dryRun);
      return result(reply(
        text,
        `I'll turn ${mediaTargetName(entityId)} volume up.`,
        `Subo el volumen de ${mediaTargetName(entityId)}.`,
      ), "fast", [
        { service: "media_player.volume_up", service_data: serviceData },
      ]);
    }
    if (/\b(volume down|quieter|lower volume|baja el volumen|menos volumen)\b/.test(text)) {
      const serviceData = { entity_id: entityId };
      await callHomeAssistantService("media_player", "volume_down", serviceData, dryRun);
      return result(reply(
        text,
        `I'll turn ${mediaTargetName(entityId)} volume down.`,
        `Bajo el volumen de ${mediaTargetName(entityId)}.`,
      ), "fast", [
        { service: "media_player.volume_down", service_data: serviceData },
      ]);
    }
    if (/\b(volume|volumen|percent|por ciento|level|nivel|%)\b/.test(text)) {
      const volumeLevel = parsePercent(text);
      if (volumeLevel !== null) {
        const serviceData = { entity_id: entityId, volume_level: volumeLevel };
        await callHomeAssistantService("media_player", "volume_set", serviceData, dryRun);
        return result(reply(
          text,
          `I'll set ${mediaTargetName(entityId)} volume to ${Math.round(volumeLevel * 100)}%.`,
          `Pongo el volumen de ${mediaTargetName(entityId)} al ${Math.round(volumeLevel * 100)}%.`,
        ), "fast", [
          { service: "media_player.volume_set", service_data: serviceData },
        ]);
      }
    }
  }

  if (/\b(tv|television|watch tv|ver la tele|ver tv|tele)\b/.test(text)) {
    if (/\boff\b|\bstop\b|\bturn off\b|\bapaga\b|\bapagar\b|\bdesactiva\b|\bdesactivar\b|\bcierra\b|\bcerrar\b|\bstop watching\b|\btermina\b/.test(text)) {
      const serviceData = { entity_id: "script.turn_tv_off" };
      await callHomeAssistantService("script", "turn_on", serviceData, dryRun);
      return result(reply(text, "TV off.", "Tele apagada."), "fast", [
        { service: "script.turn_on", service_data: serviceData },
      ]);
    }
    if (/\bon\b|\bwatch\b|\bturn on\b|\benciende\b|\bencender\b|\bver\b|\bpon\b|\bponer\b|\bstart\b/.test(text)) {
      const serviceData = { entity_id: "script.turn_tv_on" };
      await callHomeAssistantService("script", "turn_on", serviceData, dryRun);
      return result(reply(text, "TV ready.", "Tele lista."), "fast", [
        { service: "script.turn_on", service_data: serviceData },
      ]);
    }
  }

  if (/\b(screen|projection screen|projector screen|pantalla|pantalla del proyector)\b/.test(text)) {
    if (/\b(down|lower|open|deploy|drop|baja|bajar|abre|abrir|despliega|desplegar)\b/.test(text)) {
      const action = scriptAction("script.screen_down_2");
      await runScriptActions([action], dryRun);
      return result(reply(text, "Screen down.", "Pantalla abajo."), "fast", [action]);
    }
    if (/\b(up|raise|close|retract|lift|sube|subir|cierra|cerrar|recoge|recoger)\b/.test(text)) {
      const action = scriptAction("script.screen_up_5");
      await runScriptActions([action], dryRun);
      return result(reply(text, "Screen up.", "Pantalla arriba."), "fast", [action]);
    }
  }

  if (/\b(tray|projector tray|bandeja|bandeja del proyector)\b/.test(text)) {
    if (/\b(down|lower|open|deploy|baja|bajar|abre|abrir|despliega|desplegar)\b/.test(text)) {
      const action = scriptAction("script.tray_down");
      await runScriptActions([action], dryRun);
      return result(reply(text, "Tray down.", "Bandeja abajo."), "fast", [action]);
    }
    if (/\b(up|raise|close|retract|sube|subir|cierra|cerrar|recoge|recoger)\b/.test(text)) {
      const action = scriptAction("script.tray_up");
      await runScriptActions([action], dryRun);
      return result(reply(text, "Tray up.", "Bandeja arriba."), "fast", [action]);
    }
  }

  if (/\b(projector|proyector|cinema|cine|movie mode|film mode|projection|project)\b/.test(text)) {
    if (!/\boff\b|\bstop\b|\bturn off\b|\bapaga\b|\bapagar\b|\bdesactiva\b|\bdesactivar\b|\bcierra\b|\bcerrar\b/.test(text)) {
      const actions = [
        scriptAction("script.screen_down_2"),
        scriptAction("script.tray_down"),
        scriptAction("script.projector_on"),
      ];
      await runScriptActionSteps([
        { action: actions[0], delay_after_ms: 1800 },
        { action: actions[1], delay_after_ms: 1200 },
        { action: actions[2] },
      ], dryRun);
      return result(reply(text, "Projector ready.", "Proyector listo."), "fast", actions);
    }
    if (/\boff\b|\bstop\b|\bturn off\b|\bapaga\b|\bapagar\b|\bdesactiva\b|\bdesactivar\b|\bcierra\b|\bcerrar\b/.test(text)) {
      const actions = [
        scriptAction("script.turn_projector_off"),
        scriptAction("script.screen_up_5"),
        scriptAction("script.tray_up"),
      ];
      await runScriptActionSteps([
        { action: actions[0], delay_after_ms: 3200 },
        { action: actions[1], delay_after_ms: 1800 },
        { action: actions[2] },
      ], dryRun);
      return result(reply(text, "Projector off.", "Proyector apagado."), "fast", actions);
    }
  }

  return null;
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON");
    return JSON.parse(match[0]);
  }
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("Invalid model plan");
  if (!Array.isArray(plan.actions)) plan.actions = [];
  if (typeof plan.spoken_response !== "string" || !plan.spoken_response.trim()) {
    plan.spoken_response = "Done.";
  }

  for (const action of plan.actions) {
    if (!action || typeof action !== "object") throw new Error("Invalid action");
    if (typeof action.domain !== "string" || typeof action.service !== "string") {
      throw new Error("Action requires domain and service");
    }
    if (!action.service_data || typeof action.service_data !== "object") {
      action.service_data = {};
    }
    const entityId = action.service_data.entity_id;
    if (Array.isArray(entityId)) {
      for (const id of entityId) {
        if (!safeEntity(id)) throw new Error(`Blocked entity: ${id}`);
      }
    } else if (entityId && !safeEntity(entityId)) {
      throw new Error(`Blocked entity: ${entityId}`);
    }
  }

  return plan;
}

async function askOpenRouter(userText) {
  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    return {
      spoken_response: "I need the OpenRouter key before I can reason about that.",
      actions: [],
    };
  }

  let inventoryText = "";
  try {
    const inventory = await buildInventory();
    inventoryText = inventory
      .map((entity) => `- ${entity.entity_id}: ${entity.name} (${entity.state})`)
      .join("\n");
  } catch (error) {
    log("Inventory unavailable for OpenRouter prompt", { error: error.message });
    inventoryText = "Live inventory unavailable.";
  }

  const system = [
    "You are Jarvis, a practical assistant for one apartment.",
    "Classify the user's request and return only JSON.",
    "Primary priority: manage the home automation experience quickly and correctly.",
    "For home requests, use Home Assistant service calls when actions are safe and clear.",
    "For fuzzy home requests, infer the likely desired apartment experience from the available entities and context.",
    "If a physical movement command is genuinely ambiguous or could cause the wrong device to move, ask a short clarification with no actions.",
    "For non-home questions or tasks, answer helpfully in spoken_response with no actions.",
    "You may answer general questions, brainstorm, explain, translate, summarize, and help manage simple tasks conversationally.",
    "Jarvis has a simple local task list for saved tasks, but no timed notification scheduler yet. Do not claim a timed reminder will fire unless an action explicitly schedules one.",
    "Never use blocked entities.",
    "Answer in the same language as the user. If the user speaks Spanish, use natural Spanish.",
    "Keep spoken_response concise by default, unless the user clearly asks for detail.",
    "For binary successful non-media actions such as lights, TV, projector, screen, tray, or awning, spoken_response should be a quick acknowledgement under four words.",
    "For music or media changes, spoken_response must confirm the concrete action and target, never just say sure. Examples: I'll play Soft Jazz on Sonos. I'll pause Sonos. I'll set Sonos volume to 20%.",
    "For open-ended music requests, let the music router recommend a fresh Sonos favorite instead of asking, unless the request is unsafe or impossible.",
    HOME_CONTEXT,
    "Live inventory:",
    inventoryText,
    "Return this exact JSON shape:",
    '{"spoken_response":"short natural sentence","actions":[{"domain":"light","service":"turn_on","service_data":{"entity_id":["light.example"]}}]}',
  ].join("\n");

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://jarvis.local",
      "X-Title": "Jarvis Home Router",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter returned ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "";
  return validatePlan(extractJson(content));
}

async function executePlan(plan, dryRun) {
  const actions = [];
  for (const action of plan.actions) {
    await callHomeAssistantService(action.domain, action.service, action.service_data, dryRun);
    actions.push({
      service: `${action.domain}.${action.service}`,
      service_data: action.service_data,
    });
  }
  return actions;
}

async function executeHomeCommand(homeCommand, dryRun) {
  const fast = await fastPath(homeCommand, dryRun);
  if (fast) return fast;

  const plan = validatePlan(await askOpenRouter(homeCommand));
  const actions = await executePlan(plan, dryRun);
  return result(plan.spoken_response, "openrouter", actions, {
    model: OPENROUTER_MODEL,
  });
}

async function askHermes(userText) {
  const apiKey = getHermesApiKey();
  if (!apiKey) throw new Error("Hermes API key is not configured");

  const system = [
    "You are Jarvis, Santi's voice assistant.",
    "You have access to Hermes' broader context and should answer general questions and help with tasks naturally.",
    "Primary priority: create and manage a good home automation experience when the user asks for anything about the apartment, lights, shade, music, media, TV, projector, climate, ambience, routines, or comfort.",
    "If the user wants a home automation action, do not claim it is done yourself. Put the natural-language action to execute in home_command.",
    "home_command must be plain natural language only, never code, never JSON inside the string, never tool names, never entity IDs.",
    "Good home_command examples: \"set the living room lights to warm white at 70 percent\", \"open the awning\", \"pause Sonos\".",
    "For safe ambience requests, prefer choosing a reasonable action over asking. Example: reading or relaxing means warm living-room lights at a comfortable medium brightness.",
    "Ask a clarification only for risky physical movement or when multiple very different devices could be affected.",
    "If no home automation action is needed, leave home_command empty and answer directly.",
    "Answer in the user's language. Keep spoken_response concise unless the user asks for detail.",
    "For binary successful non-media home actions, use a quick acknowledgement under four words.",
    "For music or media changes, do not say only sure or done. Confirm the concrete action and target, such as: I'll play Soft Jazz on Sonos, I'll pause Sonos, or I'll set Sonos volume to 20%.",
    "For open-ended music requests, route to home_command so the music router can recommend a fresh Sonos favorite. Resume only if the user clearly says resume or continue.",
    "Return only JSON with this shape: {\"spoken_response\":\"short answer\",\"home_command\":\"optional natural-language home command\"}.",
    HOME_CONTEXT,
  ].join("\n");

  const response = await fetch(`${HERMES_API_URL.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HERMES_MODEL,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Hermes returned ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`);
  }

  const content = payload.choices?.[0]?.message?.content || "";
  let decision;
  try {
    decision = extractJson(content);
  } catch {
    decision = { spoken_response: content, home_command: "" };
  }
  return {
    spoken_response: String(decision.spoken_response || "").trim() || "Done.",
    home_command: String(decision.home_command || "").trim(),
  };
}

async function askHermesCoherence(userText, context = "") {
  const apiKey = getHermesApiKey();
  if (!apiKey) throw new Error("Hermes API key is not configured");

  const system = [
    "You are Jarvis' wake-word coherence gate.",
    "Decide whether a transcript captured immediately after 'Hey Jarvis' is likely an intentional request to Jarvis.",
    "Accept clear home/media commands, terse commands, follow-up-style commands, and general assistant requests.",
    "Accept examples: change the music, play something else, stop the music, turn off the lights, open the awning, what's the weather, remind me to buy milk.",
    "Reject wake-word-only text, random background speech, song lyrics, TV dialogue, fragments without a request, and self-echo from Jarvis.",
    "If uncertain but the transcript contains a plausible command verb plus a home/media/general-assistant target, accept it.",
    "Return only JSON: {\"coherent\":true|false,\"confidence\":\"low|medium|high\",\"intent\":\"short label\",\"reason\":\"short reason\"}.",
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(300, Number(process.env.JARVIS_COHERENCE_HERMES_TIMEOUT_MS || "1200")),
  );

  try {
    const response = await fetch(`${HERMES_API_URL.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: HERMES_MODEL,
        stream: false,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              context ? `Context: ${context}` : "",
              `Transcript: ${String(userText || "").trim()}`,
            ].filter(Boolean).join("\n"),
          },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Hermes returned ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`);
    }

    const decision = extractJson(payload.choices?.[0]?.message?.content || "");
    return {
      coherent: Boolean(decision.coherent),
      confidence: String(decision.confidence || "low"),
      intent: String(decision.intent || ""),
      reason: String(decision.reason || ""),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function realtimeSessionConfig() {
  const instructions = [
    "You are Jarvis, a warm, concise voice assistant for this apartment.",
    "Your first priority is managing the home automation experience: lights, shade, media, TV, projector, climate, and ambience.",
    "You can also answer general questions and help with simple conversational tasks when the request is not about the home.",
    "Jarvis has a simple local task list for saved tasks, but no timed notification scheduler yet. Do not claim a timed reminder will fire unless the tool confirms it.",
    "When the user wants a home action, call the control_home tool instead of merely saying you will do it.",
    "If the user asks whether you are connected to this computer, the laptop, the Mac, the Pi, or asks about connection status, call control_home with that question.",
    "For simple commands, call control_home immediately.",
    "For fuzzy home requests, infer a reasonable home experience and call control_home.",
    "For unrelated requests, answer naturally without calling control_home.",
    "Keep spoken replies brief. For binary successful non-media home actions, use a quick acknowledgement under four words. For music or media changes, confirm the concrete action and target; never answer only sure.",
    "Open-ended music requests should be routed to home_command so the music router can recommend a fresh Sonos favorite. Resume only when the user clearly says resume or continue.",
    "After a successful binary control_home call, do not offer extra help, add a follow-up question, or say phrases like 'if you need anything else' or 'let me know'.",
    "Do not mention JSON, APIs, tools, entities, or implementation details.",
    HOME_CONTEXT,
  ].join("\n");

  return {
    type: "realtime",
    model: OPENAI_REALTIME_MODEL,
    instructions,
    audio: {
      output: {
        voice: OPENAI_REALTIME_VOICE,
      },
    },
    tools: [
      {
        type: "function",
        name: "control_home",
        description:
          "Route a home automation or local connection-status request to the local Jarvis router. Use this for lights, shade, media, TV, projector, ambience, apartment scenes, and whether Jarvis is connected to this computer or the Pi.",
        parameters: {
          type: "object",
          properties: {
            utterance: {
              type: "string",
              description: "The user's home-related request in natural language.",
            },
            intent: {
              type: "string",
              description: "Short intent label such as lights_on, open_awning, movie_mode, or fuzzy_home.",
            },
            room: {
              type: "string",
              description: "Room or area if known, such as living_room, terrace, bedroom, or unknown.",
            },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
          },
          required: ["utterance"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: "auto",
  };
}

async function createRealtimeClientSecret() {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(OPENAI_CLIENT_SECRET_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "jarvis-local-laptop",
    },
    body: JSON.stringify({
      session: realtimeSessionConfig(),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OpenAI Realtime token request returned ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function routeCommand(userText, options = {}) {
  const dryRun = Boolean(options.dry_run);
  const startedAt = Date.now();
  const text = stripWakePrefix(userText);
  if (!text) throw new Error("Missing text");

  const fast = await fastPath(text, dryRun);
  if (fast) {
    return { ...fast, latency_ms: Date.now() - startedAt };
  }

  if ((process.env.JARVIS_BRAIN || "hermes") === "hermes") {
    try {
      const hermes = await askHermes(text);
      if (hermes.home_command) {
        const home = await executeHomeCommand(hermes.home_command, dryRun);
        return result(routedSpokenResponse(text, hermes.spoken_response, home), "hermes", home.actions, {
          latency_ms: Date.now() - startedAt,
          hermes_home_command: hermes.home_command,
          home_route: home.route,
          model: HERMES_MODEL,
        });
      }
      return result(hermes.spoken_response, "hermes", [], {
        latency_ms: Date.now() - startedAt,
        model: HERMES_MODEL,
      });
    } catch (error) {
      log("Hermes routing failed; falling back to OpenRouter", { error: error.message });
    }
  }

  const plan = validatePlan(await askOpenRouter(text));
  const actions = await executePlan(plan, dryRun);
  return result(plan.spoken_response, "openrouter", actions, {
    latency_ms: Date.now() - startedAt,
    model: OPENROUTER_MODEL,
  });
}

function renderConsole() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis Laptop Voice</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #101214;
      --panel: #191d21;
      --text: #f4f0e8;
      --muted: #9ba3aa;
      --line: #2b3137;
      --accent: #4cc9a8;
      --danger: #ff6b6b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      display: grid;
      place-items: center;
      padding: 28px;
    }
    main {
      width: min(760px, 100%);
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 24px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 18px;
    }
    h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: 0; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 14px;
      white-space: nowrap;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--muted);
    }
    .dot.live { background: var(--accent); box-shadow: 0 0 0 5px rgba(76, 201, 168, 0.15); }
    .dot.err { background: var(--danger); }
    .controls {
      display: flex;
      gap: 12px;
      margin: 22px 0;
      flex-wrap: wrap;
      align-items: center;
    }
    button {
      appearance: none;
      border: 1px solid var(--line);
      background: #242a30;
      color: var(--text);
      border-radius: 8px;
      min-height: 44px;
      padding: 0 16px;
      font-size: 15px;
      cursor: pointer;
    }
    button.primary { background: var(--accent); color: #06110e; border-color: var(--accent); font-weight: 650; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    select {
      border: 1px solid var(--line);
      background: #242a30;
      color: var(--text);
      border-radius: 8px;
      min-height: 40px;
      padding: 0 10px;
      font: inherit;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #12161a;
      padding: 14px;
      margin: 14px 0;
    }
    .panel h2 {
      margin: 0 0 8px;
      font-size: 15px;
      font-weight: 650;
    }
    .panel p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }
    .transcript {
      min-height: 96px;
      max-height: 180px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #0d0f11;
      padding: 12px;
      color: #d9e2e8;
      font-size: 14px;
      line-height: 1.45;
    }
    .transcript div + div { margin-top: 8px; }
    .label {
      color: var(--muted);
      font-size: 13px;
    }
    textarea {
      width: 100%;
      min-height: 96px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #0d0f11;
      color: var(--text);
      padding: 12px;
      font: inherit;
      margin-bottom: 12px;
    }
    pre {
      margin: 0;
      min-height: 220px;
      max-height: 360px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #0d0f11;
      color: #d9e2e8;
      padding: 14px;
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Jarvis Laptop Voice</h1>
      <div class="status"><span id="dot" class="dot"></span><span id="status">Idle</span></div>
    </header>
    <div class="controls">
      <button id="start" class="primary">Start hands-free laptop voice</button>
      <button id="wake">Arm wake mode</button>
      <button id="stop" disabled>Stop</button>
      <button id="ping">Test router</button>
      <button id="selectSonos">Select Pi AirPlay</button>
      <label class="status">Mic source
        <select id="micSource">
          <option value="mac">Mac default mic</option>
          <option value="pi">Pi Assist mic</option>
        </select>
      </label>
      <label class="status">Realtime voice output
        <select id="audioOutput">
          <option value="__sonos_auto__">Pi AirPlay if available</option>
          <option value="__pi_stream__" selected>Pi network stream</option>
          <option value="">Mac system output</option>
        </select>
      </label>
      <label class="status">HA fallback voice
        <select id="speechOutput">
          <option value="sonos">Sonos</option>
          <option value="pi">Pi speaker</option>
          <option value="mac">Laptop</option>
        </select>
      </label>
      <label class="status">Sonos reply volume
        <select id="sonosVolume">
          <option value="0.10">10%</option>
          <option value="0.15">15%</option>
          <option value="0.20">20%</option>
          <option value="0.25">25%</option>
          <option value="0.30">30%</option>
          <option value="0.35">35%</option>
          <option value="0.40">40%</option>
          <option value="0.45">45%</option>
          <option value="0.50">50%</option>
          <option value="0.60">60%</option>
        </select>
      </label>
      <label class="status">Listening volume
        <select id="listeningVolume">
          <option value="0.00">0%</option>
          <option value="0.01">1%</option>
          <option value="0.02">2%</option>
          <option value="0.03">3%</option>
          <option value="0.04">4%</option>
          <option value="0.05">5%</option>
          <option value="0.08">8%</option>
          <option value="0.10">10%</option>
          <option value="0.15">15%</option>
          <option value="0.20">20%</option>
        </select>
      </label>
    </div>
    <section class="panel">
      <h2>Instructions</h2>
      <p>Choose the mic source, then say "Hey Jarvis" and speak naturally in English or Spanish. Mac source uses the local listener/browser microphone. Pi source selects the Home Assistant Assist satellite configured for the Pi microphone. Realtime voice output defaults to the Pi AirPlay speaker when macOS can select it; otherwise use macOS Sound to set the Mac system output to Jarvis Pi Speaker.</p>
    </section>
    <section class="panel">
      <h2>Live Transcription</h2>
      <div id="transcript" class="transcript"><div class="label">Waiting for wake word...</div></div>
    </section>
    <textarea id="text" placeholder="Type a command here while we test voice, e.g. make the living room cozy for a movie"></textarea>
    <div class="controls">
      <button id="send">Send text command</button>
      <label class="status"><input id="dryRun" type="checkbox" checked /> Dry run</label>
    </div>
    <pre id="log"></pre>
  </main>
  <script>
    const dot = document.getElementById("dot");
    const statusEl = document.getElementById("status");
    const logEl = document.getElementById("log");
    const startBtn = document.getElementById("start");
    const wakeBtn = document.getElementById("wake");
    const stopBtn = document.getElementById("stop");
    const pingBtn = document.getElementById("ping");
    const selectSonosBtn = document.getElementById("selectSonos");
    const sendBtn = document.getElementById("send");
    const textEl = document.getElementById("text");
    const dryRunEl = document.getElementById("dryRun");
    const micSourceEl = document.getElementById("micSource");
    const audioOutputEl = document.getElementById("audioOutput");
    const speechOutputEl = document.getElementById("speechOutput");
    const sonosVolumeEl = document.getElementById("sonosVolume");
    const listeningVolumeEl = document.getElementById("listeningVolume");
    const transcriptEl = document.getElementById("transcript");

    let pc = null;
    let dc = null;
    let mediaStream = null;
    let remoteAudio = null;
    let remoteOutputStream = null;
    let piAudioContext = null;
    let piAudioSource = null;
    let piAudioProcessor = null;
    let piAudioSilentGain = null;
    let piAudioUploadChain = Promise.resolve();
    let wakeArmed = false;
    let commandTimer = null;
    let echoGuardTimer = null;
    let responseActive = false;
    let lastAssistantText = "";
    let sonosOriginalVolume = null;
    let sonosRestoreVolumeOverride = null;
    let lastVoiceLightCue = "";
    let lastVoiceLightCueAt = 0;
    let voiceLightChain = Promise.resolve();
    const handledToolCalls = new Set();
    const followupWindowMs = 8000;

    function log(message, data) {
      const line = data === undefined ? message : message + " " + JSON.stringify(data);
      logEl.textContent += "[" + new Date().toLocaleTimeString() + "] " + line + "\\n";
      logEl.scrollTop = logEl.scrollHeight;
    }

    function addTranscript(kind, text) {
      const item = document.createElement("div");
      item.innerHTML = "<span class='label'>" + kind + "</span> " + String(text || "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
      if (transcriptEl.querySelector(".label")?.textContent === "Waiting for wake word...") {
        transcriptEl.textContent = "";
      }
      transcriptEl.appendChild(item);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function setStatus(text, mode) {
      statusEl.textContent = text;
      dot.className = "dot" + (mode ? " " + mode : "");
      updateVoiceLightCue(text);
    }

    function updateVoiceLightCue(statusText) {
      const status = String(statusText || "").toLowerCase();
      let cue = "";
      if (/hearing|listening|follow-up listening/.test(status)) cue = "listening";
      else if (/thinking|echo guard/.test(status)) cue = "thinking";
      else if (/speaking|finishing reply/.test(status)) cue = "speaking";
      else if (/wake armed|idle|error/.test(status)) cue = "restore";
      if (!cue) return;

      const now = Date.now();
      if (cue === lastVoiceLightCue && now - lastVoiceLightCueAt < 500) return;
      lastVoiceLightCue = cue;
      lastVoiceLightCueAt = now;

      if (cue === "restore") {
        queueVoiceLightRequest("/voice-light-restore");
        return;
      }
      queueVoiceLightRequest("/voice-light-cue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: cue }),
      }, cue);
    }

    function queueVoiceLightRequest(path, options = { method: "POST" }, cue = "") {
      voiceLightChain = voiceLightChain
        .catch(() => {})
        .then(() => fetch(path, options))
        .then((res) => {
          if (!res.ok) throw new Error(path + " returned " + res.status);
        })
        .catch((error) => log("light cue failed", { error: error.message, cue }));
    }

    function setMicEnabled(enabled) {
      if (!mediaStream) return;
      for (const track of mediaStream.getAudioTracks()) {
        track.enabled = enabled;
      }
    }

    function preferredAudioOutputDeviceId() {
      if (!audioOutputEl) return "";
      if (audioOutputEl.value === "__pi_stream__") return "";
      if (audioOutputEl.value !== "__sonos_auto__") return audioOutputEl.value;
      const preferred = [...audioOutputEl.options].find((option) => option.dataset.preferredSonos === "true");
      return preferred?.value || "";
    }

    function currentAudioOutputLabel() {
      if (!audioOutputEl) return "Mac system output";
      if (audioOutputEl.value === "__pi_stream__") return "Pi network stream";
      if (audioOutputEl.value === "__sonos_auto__") {
        const preferred = [...audioOutputEl.options].find((option) => option.dataset.preferredSonos === "true");
        return preferred?.textContent ? "Pi AirPlay: " + preferred.textContent : "Mac system output";
      }
      return audioOutputEl.selectedOptions[0]?.textContent || "Mac system output";
    }

    async function applyAudioOutputDevice() {
      if (audioOutputEl?.value === "__pi_stream__") {
        if (remoteAudio) remoteAudio.muted = true;
        if (remoteOutputStream) await startPiAudioRelay(remoteOutputStream);
        log("voice output set", { device: "Pi network stream" });
        return;
      }
      await stopPiAudioRelay();
      if (remoteAudio) remoteAudio.muted = false;
      if (!remoteAudio || !audioOutputEl || !("setSinkId" in remoteAudio)) return;
      try {
        await remoteAudio.setSinkId(preferredAudioOutputDeviceId());
        log("voice output set", { device: currentAudioOutputLabel() });
      } catch (error) {
        log("voice output failed", { error: error.message });
      }
    }

    async function refreshAudioOutputs() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const selected = localStorage.getItem("jarvisAudioOutput") || audioOutputEl.value || "__pi_stream__";
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((device) => device.kind === "audiooutput");
      audioOutputEl.textContent = "";
      const auto = document.createElement("option");
      auto.value = "__sonos_auto__";
      auto.textContent = "Pi AirPlay if available";
      audioOutputEl.appendChild(auto);
      const piStream = document.createElement("option");
      piStream.value = "__pi_stream__";
      piStream.textContent = "Pi network stream";
      audioOutputEl.appendChild(piStream);
      const system = document.createElement("option");
      system.value = "";
      system.textContent = "Mac system output";
      audioOutputEl.appendChild(system);
      for (const device of outputs) {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || "Audio output";
        if (/jarvis pi speaker|sonos|airplay/i.test(option.textContent)) option.dataset.preferredSonos = "true";
        audioOutputEl.appendChild(option);
      }
      if ([...audioOutputEl.options].some((option) => option.value === selected)) {
        audioOutputEl.value = selected;
      } else {
        audioOutputEl.value = "__pi_stream__";
      }
      const hasSonos = outputs.some((device) => /jarvis pi speaker|sonos|airplay/i.test(device.label || ""));
      if (!hasSonos) log("voice output note", { message: "Pi AirPlay is not listed as a browser audio output. Select Jarvis Pi Speaker in macOS Sound; Jarvis will use Mac system output." });
      if (remoteAudio) await applyAudioOutputDevice();
    }

    async function startPiAudioRelay(stream) {
      if (piAudioProcessor || !stream) return;
      piAudioContext = new AudioContext();
      await fetch("/pi-audio-stream/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_rate: piAudioContext.sampleRate }),
      });
      piAudioUploadChain = Promise.resolve();
      piAudioSource = piAudioContext.createMediaStreamSource(stream);
      piAudioProcessor = piAudioContext.createScriptProcessor(4096, 1, 1);
      piAudioSilentGain = piAudioContext.createGain();
      piAudioSilentGain.gain.value = 0;
      piAudioProcessor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i += 1) {
          const sample = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        piAudioUploadChain = piAudioUploadChain
          .then(() => fetch("/pi-audio-stream/chunk", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: pcm.buffer,
          }))
          .catch((error) => log("pi audio upload failed", { error: error.message }));
      };
      piAudioSource.connect(piAudioProcessor);
      piAudioProcessor.connect(piAudioSilentGain);
      piAudioSilentGain.connect(piAudioContext.destination);
      log("pi audio relay started");
    }

    async function stopPiAudioRelay() {
      if (piAudioProcessor) {
        try { piAudioProcessor.disconnect(); } catch {}
        piAudioProcessor.onaudioprocess = null;
        piAudioProcessor = null;
      }
      if (piAudioSource) {
        try { piAudioSource.disconnect(); } catch {}
        piAudioSource = null;
      }
      if (piAudioSilentGain) {
        try { piAudioSilentGain.disconnect(); } catch {}
        piAudioSilentGain = null;
      }
      if (piAudioContext) {
        try { await piAudioContext.close(); } catch {}
        piAudioContext = null;
      }
      await piAudioUploadChain.catch(() => {});
      await fetch("/pi-audio-stream/stop", { method: "POST" }).catch(() => {});
    }

    async function selectSonosAirPlay() {
      try {
        const res = await fetch("/select-sonos-airplay", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Could not select Pi AirPlay");
        log("pi airplay selected", data);
        addTranscript("Settings", "Mac audio output selected: Pi AirPlay");
        return true;
      } catch (error) {
        log("pi airplay selection failed", { error: error.message });
        addTranscript("Settings", "Could not auto-select Pi AirPlay. Use macOS Sound if needed.");
        return false;
      }
    }

    async function duckSonosForListening() {
      if (sonosOriginalVolume !== null) return;
      try {
        const res = await fetch("/sonos-duck", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Sonos duck failed");
        sonosOriginalVolume = data.original_volume;
        log("sonos ducked", data);
      } catch (error) {
        log("sonos duck failed", { error: error.message });
      }
    }

    async function restoreSonosAfterListening() {
      if (sonosOriginalVolume === null) return;
      const originalVolume = sonosRestoreVolumeOverride === "__skip__" ? null : (sonosRestoreVolumeOverride ?? sonosOriginalVolume);
      sonosOriginalVolume = null;
      sonosRestoreVolumeOverride = null;
      if (originalVolume === null) {
        log("sonos restore skipped; volume command handled");
        return;
      }
      try {
        const res = await fetch("/sonos-restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ volume: originalVolume }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Sonos restore failed");
        log("sonos restored", data);
      } catch (error) {
        log("sonos restore failed", { error: error.message });
      }
    }

    function actionServiceName(action) {
      const service = action?.service;
      const domain = action?.domain;
      if (service) {
        const serviceText = String(service);
        if (serviceText.includes(".") || !domain) return serviceText;
        return domain + "." + serviceText;
      }
      if (domain && action?.service_name) return domain + "." + action.service_name;
      return "";
    }

    function actionEntityIds(action) {
      const entityId = action?.service_data?.entity_id;
      if (Array.isArray(entityId)) return entityId.map(String);
      if (entityId) return [String(entityId)];
      return [];
    }

    function sonosRestoreTargetFromActions(actions) {
      if (!Array.isArray(actions)) return undefined;
      for (const action of actions) {
        const service = actionServiceName(action);
        if (!["media_player.volume_set", "media_player.volume_up", "media_player.volume_down", "media_player.volume_mute"].includes(service)) continue;
        const entities = actionEntityIds(action);
        if (entities.length && !entities.includes("media_player.sonos")) continue;
        if (service === "media_player.volume_set") {
          const volume = Number(action?.service_data?.volume_level);
          if (Number.isFinite(volume) && volume >= 0 && volume <= 1) return volume;
        }
        return "__skip__";
      }
      return undefined;
    }

    function closeListeningWindow(reason) {
      if (!wakeArmed || !pc || responseActive) return;
      setMicEnabled(false);
      setStatus("Wake armed", "live");
      if (commandTimer) clearTimeout(commandTimer);
      commandTimer = null;
      restoreSonosAfterListening();
      if (reason) log(reason);
    }

    function clearEchoGuard() {
      if (echoGuardTimer) clearTimeout(echoGuardTimer);
      echoGuardTimer = null;
    }

    function scheduleListeningClose(ms, reason) {
      if (commandTimer) clearTimeout(commandTimer);
      commandTimer = setTimeout(() => closeListeningWindow(reason), ms);
    }

    function playFollowupReadyTone() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.16);
        setTimeout(() => ctx.close().catch(() => {}), 300);
      } catch (error) {
        log("follow-up tone failed", { error: error.message });
      }
    }

    function echoGuardDelayMs() {
      return audioOutputEl?.value === "__pi_stream__" ? 2500 : 1200;
    }

    function assistantPlaybackTailMs() {
      if (audioOutputEl?.value !== "__pi_stream__") return 250;
      const words = lastAssistantText.trim().split(/\s+/).filter(Boolean).length;
      return Math.min(7000, Math.max(3200, words * 360 + 1600));
    }

    function shouldOpenFollowup() {
      const text = lastAssistantText.trim();
      if (!text) return audioOutputEl?.value !== "__pi_stream__";
      if (/[?¿]\s*$/.test(text)) return true;
      return /\b(which|what|where|when|who|how|do you|would you|can you|should i|quieres|quiero que|cu[aá]l|qu[eé]|d[oó]nde|cu[aá]ndo|c[oó]mo)\b/i.test(text);
    }

    function openFollowupAfterEchoGuard() {
      clearEchoGuard();
      setMicEnabled(false);
      const tail = assistantPlaybackTailMs();
      if (!shouldOpenFollowup()) {
        setStatus("Finishing reply", "live");
        echoGuardTimer = setTimeout(() => {
          echoGuardTimer = null;
          closeListeningWindow("follow-up skipped; assistant did not ask a question");
        }, tail);
        log("speaker tail before close", { ms: tail });
        return;
      }
      setStatus("Echo guard", "live");
      const delay = tail + echoGuardDelayMs();
      echoGuardTimer = setTimeout(() => {
        echoGuardTimer = null;
        if (!wakeArmed || !pc || responseActive) return;
        setMicEnabled(true);
        setStatus("Follow-up listening", "live");
        playFollowupReadyTone();
        scheduleListeningClose(followupWindowMs, "follow-up window closed");
        log("follow-up listening opened", { echo_guard_ms: delay, speaker_tail_ms: tail });
      }, delay);
      log("echo guard started", { ms: delay, speaker_tail_ms: tail });
    }

    async function enableWakeCommandWindow() {
      if (!pc || !wakeArmed) {
        log("wake ignored", { reason: "Start hands-free laptop voice first" });
        return;
      }
      await duckSonosForListening();
      setMicEnabled(true);
      setStatus("Listening", "live");
      scheduleListeningClose(15000, "wake command window closed");
      log("wake command window open");
    }

    async function callRouter(text, dryRun = false) {
      const res = await fetch("/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, dry_run: dryRun, source: "laptop-console" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Router command failed");
      return data;
    }

    function parseToolArgs(value) {
      if (!value) return {};
      if (typeof value === "object") return value;
      try { return JSON.parse(value); } catch { return { utterance: String(value) }; }
    }

    async function handleToolCall(event) {
      const item = event.item || event;
      const name = item.name || event.name;
      const callId = item.call_id || event.call_id;
      const args = parseToolArgs(item.arguments || event.arguments);
      if (name !== "control_home" || !callId) return false;
      if (handledToolCalls.has(callId)) return true;
      handledToolCalls.add(callId);

      const utterance = [args.utterance || args.command || "", args.intent || ""].filter(Boolean).join(" ");
      log("tool_call control_home", args);
      let output;
      try {
        output = await callRouter(utterance, false);
      } catch (error) {
        output = { ok: false, error: error.message };
      }
      if (output.ok) {
        const restoreTarget = sonosRestoreTargetFromActions(output.actions);
        if (restoreTarget !== undefined) {
          sonosRestoreVolumeOverride = restoreTarget;
          log("sonos restore target updated", { restore_target: restoreTarget });
        }
      }

      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      }));
      const ack = String(output.spoken_response || "Done.").trim();
      const createFollowup = () => dc.send(JSON.stringify({
        type: "response.create",
        response: {
          max_output_tokens: 64,
          instructions: output.ok
            ? "Say only these exact words, then stop: " + JSON.stringify(ack) + ". No other words. Do not say 'if you need anything else' or 'let me know'."
            : "Briefly tell the user the home action failed.",
        },
      }));
      if (responseActive) {
        const onDone = (message) => {
          try {
            const doneEvent = JSON.parse(message.data);
            if (doneEvent.type !== "response.done") return;
            dc.removeEventListener("message", onDone);
            createFollowup();
          } catch {}
        };
        dc.addEventListener("message", onDone);
      } else {
        createFollowup();
      }
      return true;
    }

    function handleRealtimeEvent(event) {
      if (event.type === "response.output_audio_transcript.delta" && event.delta) {
        if (wakeArmed && !lastAssistantText.trim()) setStatus("Speaking", "live");
        lastAssistantText += event.delta;
        return;
      }
      if (event.type === "response.output_audio_transcript.done" && event.transcript) {
        lastAssistantText = event.transcript;
        return;
      }
      if (event.type === "response.output_text.delta" && event.delta) return;
      if (event.type === "response.created") {
        responseActive = true;
        lastAssistantText = "";
        clearEchoGuard();
        if (commandTimer) clearTimeout(commandTimer);
        commandTimer = null;
        if (wakeArmed) {
          setMicEnabled(false);
          setStatus("Thinking", "live");
        }
      }
      if (event.type === "input_audio_buffer.speech_started") {
        if (responseActive || echoGuardTimer) return;
        if (commandTimer) clearTimeout(commandTimer);
        commandTimer = null;
        if (wakeArmed) setStatus("Hearing you", "live");
      }
      if (event.type === "input_audio_buffer.speech_stopped") {
        if (wakeArmed) setStatus("Thinking", "live");
      }
      if (event.type === "response.output_item.done" || event.type === "response.function_call_arguments.done") {
        handleToolCall(event).catch((error) => log("tool error", { error: error.message }));
      }
      if (event.type === "conversation.item.input_audio_transcription.completed") {
        log("heard", { transcript: event.transcript });
      }
      if (event.type === "response.done") {
        responseActive = false;
        log("response done");
        if (wakeArmed) {
          openFollowupAfterEchoGuard();
        }
      }
      if (event.type === "error") {
        log("realtime error", event.error || event);
      }
    }

    function connectWakeEvents() {
      const events = new EventSource("/events");
      events.addEventListener("wake", () => {
        log("wake event received");
        addTranscript("Wake", "Hey Jarvis detected");
        enableWakeCommandWindow();
      });
      events.addEventListener("transcript", (event) => {
        const data = JSON.parse(event.data);
        addTranscript("Heard", data.text || "");
        log("wake transcript", data);
      });
      events.addEventListener("response", (event) => {
        const data = JSON.parse(event.data);
        addTranscript("Jarvis", data.text || "");
        log("wake response", data);
      });
      events.addEventListener("wake-error", (event) => {
        const data = JSON.parse(event.data);
        addTranscript("Error", data.error || "Unknown error");
        log("wake error", data);
      });
      events.onerror = () => {
        log("wake event stream reconnecting");
      };
    }

    async function loadSettings() {
      const res = await fetch("/settings");
      const data = await res.json();
      if (data.ok) {
        micSourceEl.value = data.mic_source || "mac";
        speechOutputEl.value = data.speech_output || "sonos";
        sonosVolumeEl.value = Number(data.speech_volume).toFixed(2);
        listeningVolumeEl.value = Number(data.listening_volume).toFixed(2);
      }
    }

    async function startVoice(options = {}) {
      if (micSourceEl.value === "pi") {
        setStatus("Pi mic selected", "live");
        addTranscript("Settings", "Pi Assist mic is selected. Use the Pi/HA Assist wake path; laptop realtime mic is not started.");
        log("voice start skipped", { mic_source: "pi", pi_assist_satellite: "assist_satellite.assist_microphone" });
        return;
      }
      setStatus("Starting", "");
      startBtn.disabled = true;
      wakeBtn.disabled = true;
      try {
        if (!options.skipAirPlaySelect && audioOutputEl.value === "__sonos_auto__") {
          await selectSonosAirPlay();
        }
        const tokenRes = await fetch("/realtime-token", { method: "POST" });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error || "Could not create realtime token");
        const ephemeralKey = tokenData.value || tokenData.client_secret?.value;
        if (!ephemeralKey) throw new Error("Realtime token response did not include a client secret");

        pc = new RTCPeerConnection();
        remoteAudio = document.createElement("audio");
        remoteAudio.autoplay = true;
        pc.ontrack = (event) => {
          remoteOutputStream = event.streams[0];
          remoteAudio.srcObject = event.streams[0];
          applyAudioOutputDevice();
        };

        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        await refreshAudioOutputs();
        wakeArmed = options.armed !== false;
        if (wakeArmed) setMicEnabled(false);
        pc.addTrack(mediaStream.getAudioTracks()[0]);
        dc = pc.createDataChannel("oai-events");
        dc.onopen = () => {
          setStatus(wakeArmed ? "Wake armed" : "Listening", "live");
          stopBtn.disabled = false;
          log(wakeArmed ? "wake mode armed" : "voice session ready");
        };
        dc.onmessage = (message) => {
          try {
            handleRealtimeEvent(JSON.parse(message.data));
          } catch (error) {
            log("event parse error", { error: error.message });
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: offer.sdp,
          headers: {
            "Authorization": "Bearer " + ephemeralKey,
            "Content-Type": "application/sdp",
          },
        });
        if (!sdpRes.ok) throw new Error("Realtime SDP failed: " + await sdpRes.text());
        await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
      } catch (error) {
        setStatus("Error", "err");
        startBtn.disabled = false;
        wakeBtn.disabled = false;
        wakeArmed = false;
        log("start failed", { error: error.message });
      }
    }

    function stopVoice() {
      if (dc) dc.close();
      if (pc) pc.close();
      if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
      stopPiAudioRelay();
      restoreSonosAfterListening();
      dc = null;
      pc = null;
      mediaStream = null;
      remoteOutputStream = null;
      wakeArmed = false;
      if (commandTimer) clearTimeout(commandTimer);
      clearEchoGuard();
      commandTimer = null;
      startBtn.disabled = false;
      wakeBtn.disabled = false;
      stopBtn.disabled = true;
      setStatus("Idle", "");
      log("voice session stopped");
    }

    startBtn.addEventListener("click", () => startVoice({ armed: true }));
    wakeBtn.addEventListener("click", () => startVoice({ armed: true }));
    stopBtn.addEventListener("click", stopVoice);
    pingBtn.addEventListener("click", async () => {
      const res = await fetch("/health");
      log("health", await res.json());
    });
    selectSonosBtn.addEventListener("click", () => selectSonosAirPlay());
    micSourceEl.addEventListener("change", async () => {
      const res = await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mic_source: micSourceEl.value }),
      });
      const data = await res.json();
      log("settings", data);
      const label = micSourceEl.value === "pi" ? "Pi Assist mic" : "Mac default mic";
      addTranscript("Settings", "Mic source set to " + label);
      setStatus(label, micSourceEl.value === "pi" ? "live" : "");
    });
    audioOutputEl.addEventListener("change", async () => {
      localStorage.setItem("jarvisAudioOutput", audioOutputEl.value);
      await applyAudioOutputDevice();
      addTranscript("Settings", "Realtime voice output set to " + currentAudioOutputLabel());
    });
    speechOutputEl.addEventListener("change", async () => {
      const res = await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speech_output: speechOutputEl.value }),
      });
      const data = await res.json();
      log("settings", data);
      const label = speechOutputEl.value === "sonos" ? "Sonos" : speechOutputEl.value === "pi" ? "Pi speaker" : "Laptop";
      addTranscript("Settings", "HA fallback voice set to " + label);
    });
    sonosVolumeEl.addEventListener("change", async () => {
      const res = await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speech_volume: Number(sonosVolumeEl.value) }),
      });
      const data = await res.json();
      log("settings", data);
      addTranscript("Settings", "Sonos reply volume set to " + Math.round(Number(sonosVolumeEl.value) * 100) + "%");
    });
    listeningVolumeEl.addEventListener("change", async () => {
      const res = await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listening_volume: Number(listeningVolumeEl.value) }),
      });
      const data = await res.json();
      log("settings", data);
      addTranscript("Settings", "Listening volume set to " + Math.round(Number(listeningVolumeEl.value) * 100) + "%");
    });
    sendBtn.addEventListener("click", async () => {
      const text = textEl.value.trim();
      if (!text) return;
      try {
        const data = await callRouter(text, dryRunEl.checked);
        log("router", data);
      } catch (error) {
        log("router error", { error: error.message });
      }
    });
    loadSettings().catch((error) => log("settings error", { error: error.message }));
    connectWakeEvents();
  </script>
</body>
</html>`;
}

async function handleCommand(req, res) {
  const body = await readBody(req);
  const payload = body ? JSON.parse(body) : {};
  const text = payload.text || payload.utterance || payload.command || "";
  const response = await routeCommand(text, {
    dry_run: Boolean(payload.dry_run),
    source: payload.source || "http",
  });
  if (!payload.dry_run) rememberSonosRestoreTarget(response);
  log("Handled command", {
    text,
    route: response.route,
    actions: response.actions?.length || 0,
    latency_ms: response.latency_ms,
  });
  json(res, 200, response);
}

async function handleCoherence(req, res) {
  const body = await readBody(req);
  const payload = body ? JSON.parse(body) : {};
  const text = payload.text || payload.transcript || payload.utterance || "";
  const startedAt = Date.now();
  if (!String(text || "").trim()) {
    json(res, 200, {
      ok: true,
      coherent: false,
      confidence: "high",
      intent: "empty",
      reason: "empty transcript",
      source: "router",
      latency_ms: Date.now() - startedAt,
    });
    return;
  }

  const decision = await askHermesCoherence(text, payload.context || "");
  log("Coherence checked", {
    text,
    coherent: decision.coherent,
    confidence: decision.confidence,
    intent: decision.intent,
    latency_ms: Date.now() - startedAt,
  });
  json(res, 200, {
    ok: true,
    ...decision,
    source: "hermes",
    latency_ms: Date.now() - startedAt,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      html(res, renderConsole());
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        service: "jarvis-router",
        openrouter_configured: Boolean(getOpenRouterKey()),
        openai_realtime_configured: Boolean(getOpenAIKey()),
        realtime_model: OPENAI_REALTIME_MODEL,
        ha_url: HA_URL,
        connection_status: currentConnectionStatus(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/connection-status") {
      json(res, 200, currentConnectionStatus());
      return;
    }

    if (req.method === "POST" && url.pathname === "/pi-connection-state") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      json(res, 200, await handlePiConnectionState(payload));
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      sendEvent(res, "ready", { ok: true });
      eventClients.add(res);
      req.on("close", () => eventClients.delete(res));
      return;
    }

    if (req.method === "GET" && url.pathname === "/settings") {
      json(res, 200, settingsPayload());
      return;
    }

    if (req.method === "POST" && url.pathname === "/settings") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      let changed = false;

      if (Object.prototype.hasOwnProperty.call(payload, "speech_volume")) {
        const volume = Number(payload.speech_volume);
        if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
          json(res, 400, { ok: false, error: "speech_volume must be between 0 and 1" });
          return;
        }
        updateEnvValue("JARVIS_SPEECH_VOLUME", volume.toFixed(2));
        changed = true;
      }

      if (Object.prototype.hasOwnProperty.call(payload, "speech_output")) {
        const output = String(payload.speech_output || "");
        if (!["sonos", "pi", "mac"].includes(output)) {
          json(res, 400, { ok: false, error: "speech_output must be sonos, pi, or mac" });
          return;
        }
        updateEnvValue("JARVIS_SPEECH_OUTPUT", output);
        changed = true;
      }

      if (Object.prototype.hasOwnProperty.call(payload, "mic_source")) {
        const source = String(payload.mic_source || "").toLowerCase();
        if (!["mac", "pi"].includes(source)) {
          json(res, 400, { ok: false, error: "mic_source must be mac or pi" });
          return;
        }
        updateEnvValue("JARVIS_MIC_SOURCE", source);
        changed = true;
      }

      if (Object.prototype.hasOwnProperty.call(payload, "listening_volume")) {
        const volume = Number(payload.listening_volume);
        if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
          json(res, 400, { ok: false, error: "listening_volume must be between 0 and 1" });
          return;
        }
        updateEnvValue("JARVIS_LISTENING_VOLUME", volume.toFixed(2));
        changed = true;
      }

      if (!changed) {
        json(res, 400, { ok: false, error: "No supported settings provided" });
        return;
      }

      broadcastEvent("settings", settingsPayload());
      json(res, 200, settingsPayload());
      return;
    }

    if (req.method === "POST" && url.pathname === "/voice-light-cue") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const mode = String(payload.mode || "thinking");
      if (!["listening", "thinking", "speaking"].includes(mode)) {
        json(res, 400, { ok: false, error: "mode must be listening, thinking, or speaking" });
        return;
      }
      await applyVoiceLightCue(mode);
      json(res, 200, { ok: true, mode });
      return;
    }

    if (req.method === "POST" && url.pathname === "/voice-light-restore") {
      await restoreVoiceLightCue();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/voice-light-clear") {
      clearVoiceLightCue();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/sonos-duck") {
      recentSonosRestoreTarget = null;
      recentSonosRestoreTargetAt = 0;
      const entityId = process.env.JARVIS_SPEECH_MEDIA_PLAYER || "media_player.sonos";
      const originalVolume = await getMediaPlayerVolume(entityId);
      const listeningVolume = getListeningVolume();
      await callHomeAssistantService("media_player", "volume_set", {
        entity_id: entityId,
        volume_level: listeningVolume,
      });
      json(res, 200, {
        ok: true,
        media_player: entityId,
        original_volume: originalVolume,
        listening_volume: listeningVolume,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/sonos-restore") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const guardedTarget = consumeRecentSonosRestoreTarget();
      if (guardedTarget === "__skip__") {
        json(res, 200, {
          ok: true,
          skipped: true,
          reason: "recent Sonos volume command handled",
        });
        return;
      }
      const volume = Number(guardedTarget ?? payload.volume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        json(res, 400, { ok: false, error: "volume must be between 0 and 1" });
        return;
      }
      const entityId = process.env.JARVIS_SPEECH_MEDIA_PLAYER || "media_player.sonos";
      await callHomeAssistantService("media_player", "volume_set", {
        entity_id: entityId,
        volume_level: volume,
      });
      json(res, 200, {
        ok: true,
        media_player: entityId,
        restored_volume: volume,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/pi-audio-stream/start") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const sampleRate = Number(payload.sample_rate || payload.sampleRate || 48000);
      startPiAudioStream({ sampleRate });
      json(res, 200, { ok: true, host: PI_SSH_HOST, sample_rate: sampleRate });
      return;
    }

    if (req.method === "POST" && url.pathname === "/pi-audio-stream/chunk") {
      const chunk = await readBuffer(req);
      if (!piAudioProcess || !piAudioProcess.stdin.writable) {
        json(res, 409, { ok: false, error: "Pi audio stream is not active" });
        return;
      }
      piAudioBytes += chunk.length;
      piAudioProcess.stdin.write(chunk);
      json(res, 200, { ok: true, bytes: chunk.length });
      return;
    }

    if (req.method === "POST" && url.pathname === "/pi-audio-stream/stop") {
      stopPiAudioStream();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/select-sonos-airplay") {
      const output = await selectSonosAirPlay();
      json(res, 200, { ok: true, output });
      return;
    }

    if (req.method === "POST" && url.pathname === "/pi-speaker-test") {
      await announceOnPiSpeaker("Jarvis Pi speaker test from the laptop.", false);
      json(res, 200, { ok: true, entity_id: PI_ASSIST_SATELLITE });
      return;
    }

    if (req.method === "POST" && url.pathname === "/wake") {
      broadcastEvent("wake", { source: "local-wake", at: new Date().toISOString() });
      json(res, 200, { ok: true, clients: eventClients.size });
      return;
    }

    if (req.method === "POST" && url.pathname === "/notify") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const event = String(payload.event || "");
      const allowed = new Set(["transcript", "response", "wake-error"]);
      if (!allowed.has(event)) {
        json(res, 400, { ok: false, error: "Unsupported event" });
        return;
      }
      broadcastEvent(event, payload.data || {});
      json(res, 200, { ok: true, clients: eventClients.size });
      return;
    }

    if (req.method === "POST" && url.pathname === "/realtime-token") {
      json(res, 200, await createRealtimeClientSecret());
      return;
    }

    if (req.method === "GET" && url.pathname === "/realtime-session-config") {
      json(res, 200, { ok: true, session: realtimeSessionConfig() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/coherence") {
      await handleCoherence(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/command") {
      await handleCommand(req, res);
      return;
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    log("Request failed", { error: error.message });
    json(res, 500, { ok: false, error: error.message });
  }
});

connectionState.router_started_at = new Date().toISOString();
saveConnectionState();

server.listen(PORT, HOST, () => {
  log("Jarvis router listening", {
    host: HOST,
    port: PORT,
    openrouter_configured: Boolean(getOpenRouterKey()),
  });
  startLaptopHeartbeat();
});
