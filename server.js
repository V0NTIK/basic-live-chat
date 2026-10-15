import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const ROOM_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const NAME_MAX = 32;
const MESSAGE_MAX = 1000;
const PAGE_SIZE = 100;
const POLL_MS = 1000;

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max);
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

async function readJson(req, limit = 16_384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

export class MemoryStore {
  constructor() {
    this.messages = [];
  }

  async list(room, limit = PAGE_SIZE) {
    return this.messages.filter((item) => item.room === room).slice(-limit);
  }

  async create({ room, displayName, body, clientId }) {
    const message = {
      id: randomUUID(),
      room,
      display_name: displayName,
      body,
      client_id: clientId,
      created_at: new Date().toISOString(),
    };
    this.messages.push(message);
    return message;
  }
}

export class SupabaseStore {
  constructor(url, serviceKey) {
    this.baseUrl = `${url.replace(/\/$/, "")}/rest/v1/messages`;
    this.headers = {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    };
  }

  async request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...options.headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase ${response.status}: ${detail.slice(0, 300)}`);
    }
    return response.status === 204 ? null : response.json();
  }

  async list(room, limit = PAGE_SIZE) {
    const params = new URLSearchParams({
      select: "id,room,display_name,body,client_id,created_at",
      room: `eq.${room}`,
      order: "created_at.asc",
      limit: String(limit),
    });
    return this.request(`${this.baseUrl}?${params}`);
  }

  async create({ room, displayName, body, clientId }) {
    const rows = await this.request(this.baseUrl, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ room, display_name: displayName, body, client_id: clientId }),
    });
    return rows[0];
  }
}

function createRateLimiter({ max = 10, windowMs = 60_000 } = {}) {
  const entries = new Map();
  return (key) => {
    const now = Date.now();
    const current = entries.get(key);
    if (!current || current.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= max;
  };
}

export function createChatServer({ store, pollMs = POLL_MS, logger = console } = {}) {
  if (!store) throw new Error("A message store is required.");

  const rooms = new Map();
  const allowMessage = createRateLimiter();

  function roomState(room) {
    if (!rooms.has(room)) {
      rooms.set(room, { clients: new Set(), seen: new Set(), timer: null, polling: false });
    }
    return rooms.get(room);
  }

  function sendEvent(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(room, message) {
    const state = roomState(room);
    if (state.seen.has(message.id)) return;
    state.seen.add(message.id);
    if (state.seen.size > 500) state.seen.delete(state.seen.values().next().value);
    for (const client of state.clients) sendEvent(client, "message", message);
  }

  async function pollRoom(room) {
    const state = roomState(room);
    if (state.polling || state.clients.size === 0) return;
    state.polling = true;
    try {
      const messages = await store.list(room, PAGE_SIZE);
      for (const message of messages) broadcast(room, message);
    } catch (error) {
      logger.error("Room poll failed", { room, error: error.message });
    } finally {
      state.polling = false;
    }
  }

  function startPolling(room) {
    const state = roomState(room);
    if (state.timer) return;
    pollRoom(room);
    state.timer = setInterval(() => pollRoom(room), pollMs);
    state.timer.unref?.();
  }

  function stopPollingIfEmpty(room) {
    const state = rooms.get(room);
    if (!state || state.clients.size > 0) return;
    clearInterval(state.timer);
    rooms.delete(room);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const headers = corsHeaders();

    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      return res.end();
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, service: "basic-live-chat" }, headers);
      }

      if (req.method === "GET" && url.pathname === "/api/messages") {
        const room = url.searchParams.get("room") || "";
        if (!ROOM_RE.test(room)) return json(res, 400, { error: "Invalid room." }, headers);
        return json(res, 200, { messages: await store.list(room, PAGE_SIZE) }, headers);
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        const room = url.searchParams.get("room") || "";
        if (!ROOM_RE.test(room)) return json(res, 400, { error: "Invalid room." }, headers);
        res.writeHead(200, {
          ...headers,
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.write("retry: 2000\n\n");
        sendEvent(res, "ready", { room });
        const state = roomState(room);
        state.clients.add(res);
        startPolling(room);
        const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 25_000);
        keepAlive.unref?.();
        req.on("close", () => {
          clearInterval(keepAlive);
          state.clients.delete(res);
          stopPollingIfEmpty(room);
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/messages") {
        const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString().split(",")[0].trim();
        if (!allowMessage(ip)) return json(res, 429, { error: "Too many messages. Try again shortly." }, headers);
        const input = await readJson(req);
        const room = cleanText(input.room, 64);
        const displayName = cleanText(input.displayName, NAME_MAX);
        const body = cleanText(input.body, MESSAGE_MAX);
        const clientId = cleanText(input.clientId, 64) || null;
        if (!ROOM_RE.test(room)) return json(res, 400, { error: "Room must use letters, numbers, _ or -." }, headers);
        if (!displayName) return json(res, 400, { error: "Display name is required." }, headers);
        if (!body) return json(res, 400, { error: "Message is required." }, headers);
        const message = await store.create({ room, displayName, body, clientId });
        broadcast(room, message);
        return json(res, 201, { message }, headers);
      }

      return json(res, 404, { error: "Not found." }, headers);
    } catch (error) {
      logger.error("Request failed", { path: url.pathname, error: error.message });
      return json(res, error.status || 500, { error: error.status ? error.message : "Server error." }, headers);
    }
  });

  return server;
}

function storeFromEnvironment() {
  if (process.env.CHAT_STORE === "memory") return new MemoryStore();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  return new SupabaseStore(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 10000);
  const server = createChatServer({ store: storeFromEnvironment() });
  server.listen(port, "0.0.0.0", () => console.log(`Chat API listening on 0.0.0.0:${port}`));
}
