import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_CONNECTIONS = 500;
const MAX_WAITING = 200;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMITS = { signaling: 120, chat: 12, control: 8 } as const;
const HEARTBEAT_INTERVAL_MS = 30_000;

type RateCategory = keyof typeof RATE_LIMITS;
type RateWindow = { startedAt: number; count: number };

const configuredOrigins = new Set(
  (process.env.SIDEQUEST_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .flatMap((origin) => {
      try {
        return [new URL(origin).origin];
      } catch {
        return [];
      }
    }),
);

function isAllowedOrigin(origin: string | undefined) {
  if (!origin || origin === "null") return false;
  try {
    const url = new URL(origin);
    if (configuredOrigins.has(url.origin)) return true;
    if (process.env.NODE_ENV === "production") return false;
    if (!(["http:", "https:"].includes(url.protocol)) || url.port !== "4173") return false;
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
    const octets = url.hostname.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
    return octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMatchId(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
}

function isSessionDescription(value: unknown, type: "offer" | "answer") {
  return isRecord(value) && value.type === type &&
    typeof value.sdp === "string" && value.sdp.length > 0 && value.sdp.length <= 48 * 1024;
}

function isIceCandidate(value: unknown) {
  if (!isRecord(value) || typeof value.candidate !== "string" || value.candidate.length > 4096) return false;
  if (value.sdpMid !== undefined && value.sdpMid !== null && (typeof value.sdpMid !== "string" || value.sdpMid.length > 128)) return false;
  if (value.sdpMLineIndex !== undefined && value.sdpMLineIndex !== null && (!Number.isInteger(value.sdpMLineIndex) || (value.sdpMLineIndex as number) < 0)) return false;
  return value.usernameFragment === undefined || value.usernameFragment === null ||
    (typeof value.usernameFragment === "string" && value.usernameFragment.length <= 256);
}

const app = express();
app.use(express.json());
const serverDirectory = dirname(fileURLToPath(import.meta.url));
const frontendDirectory = resolve(serverDirectory, "../dist");
const frontendIndex = resolve(frontendDirectory, "index.html");
const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({
  server: httpServer,
  path: "/ws",
  maxPayload: MAX_PAYLOAD_BYTES,
  verifyClient: ({ origin }, done) => {
    if (isAllowedOrigin(origin)) done(true);
    else done(false, 403, "Forbidden");
  },
});
const waiting: WebSocket[] = [];
const partnerOf = new Map<WebSocket, WebSocket>();
const usernameOf = new Map<WebSocket, string>();
const matchIdOf = new Map<WebSocket, string>();
const chatIdsOf = new Map<WebSocket, Set<string>>();
const rateWindowsOf = new Map<WebSocket, Map<RateCategory, RateWindow>>();
const aliveSockets = new WeakSet<WebSocket>();
const reports: { username: string; reason: string }[] = [];

app.get("/health", (_request, response) =>
  response.status(200).json({ ok: true }),
);
const reportHandler: express.RequestHandler = (request, response) => {
  const { username, reason } = request.body as {
    username?: string;
    reason?: string;
  };
  if (!username || !reason) return response.status(400).json({ ok: false });
  reports.push({ username, reason });
  return response.json({ ok: true });
};
app.post(["/report", "/api/report"], reportHandler);

app.use(express.static(frontendDirectory, { index: false }));
app.use((request, response, next) => {
  const path = request.path;
  const reservedPath = path === "/ws" || path.startsWith("/ws/") ||
    path === "/health" || path.startsWith("/health/") ||
    path === "/report" || path.startsWith("/report/") ||
    path === "/api" || path.startsWith("/api/") ||
    path === "/assets" || path.startsWith("/assets/");
  if (request.method !== "GET" || reservedPath) return next();
  return response.sendFile(frontendIndex);
});

const send = (socket: WebSocket, type: string, payload?: unknown) => {
  if (socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({ type, payload }));
      return true;
    } catch {
      return false;
    }
  }
  return false;
};

const sendSignal = (socket: WebSocket, type: string, matchId: string, payload: unknown) => {
  if (socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify({ type, matchId, payload }));
    return true;
  } catch {
    return false;
  }
};

const hasOnlyKeys = (message: Record<string, unknown>, keys: string[]) =>
  Object.keys(message).every((key) => keys.includes(key));

const allowMessage = (socket: WebSocket, category: RateCategory) => {
  const now = Date.now();
  let windows = rateWindowsOf.get(socket);
  if (!windows) {
    windows = new Map();
    rateWindowsOf.set(socket, windows);
  }
  let window = windows.get(category);
  if (!window || now - window.startedAt >= RATE_WINDOW_MS) {
    window = { startedAt: now, count: 0 };
    windows.set(category, window);
  }
  window.count += 1;
  return window.count <= RATE_LIMITS[category];
};

const rejectProtocol = (socket: WebSocket, code = 1008) => {
  if (socket.readyState === WebSocket.OPEN) socket.close(code, "Invalid request");
};

const removeFromQueue = (socket: WebSocket) => {
  const index = waiting.indexOf(socket);
  if (index >= 0) waiting.splice(index, 1);
};

const addToQueue = (socket: WebSocket) => {
  if (socket.readyState === WebSocket.OPEN && !waiting.includes(socket) && waiting.length < MAX_WAITING)
    waiting.push(socket);
};

const takeWaitingSocket = () => {
  while (waiting.length) {
    const candidate = waiting.shift() as WebSocket;
    if (
      candidate.readyState === WebSocket.OPEN &&
      !partnerOf.has(candidate)
    ) return candidate;
    usernameOf.delete(candidate);
  }
  return undefined;
};

webSocketServer.on("connection", (socket) => {
  socket.on("error", () => disconnect(socket));
  if (webSocketServer.clients.size > MAX_CONNECTIONS) {
    socket.close(1013, "Server busy");
    return;
  }

  aliveSockets.add(socket);
  socket.on("pong", () => aliveSockets.add(socket));
  socket.on("message", (raw, isBinary) => {
    if (isBinary) {
      rejectProtocol(socket, 1003);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      rejectProtocol(socket, 1007);
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      rejectProtocol(socket);
      return;
    }
    const message = parsed;
    const type = message.type as string;
    if (!["join", "leave", "skip", "offer", "answer", "candidate", "chat"].includes(type)) {
      rejectProtocol(socket);
      return;
    }
    const category: RateCategory = type === "chat" ? "chat" :
      ["offer", "answer", "candidate"].includes(type) ? "signaling" : "control";
    if (!allowMessage(socket, category)) {
      socket.close(1008, "Rate limit exceeded");
      return;
    }

    if (type === "join") {
      if (!hasOnlyKeys(message, ["type", "username"]) ||
        (message.username !== undefined && (typeof message.username !== "string" || message.username.length > 64))) {
        rejectProtocol(socket);
        return;
      }
      if (partnerOf.has(socket) || waiting.includes(socket)) return;
      usernameOf.set(socket, typeof message.username === "string" ? message.username.slice(0, 32).trim() || "Guest" : "Guest");
      const partner = takeWaitingSocket();
      if (!partner) {
        if (waiting.length >= MAX_WAITING) {
          usernameOf.delete(socket);
          socket.close(1013, "Lobby full");
          return;
        }
        addToQueue(socket);
      } else {
        const matchId = randomUUID();
        const chatIds = new Set<string>();
        partnerOf.set(socket, partner);
        partnerOf.set(partner, socket);
        matchIdOf.set(socket, matchId);
        matchIdOf.set(partner, matchId);
        chatIdsOf.set(socket, chatIds);
        chatIdsOf.set(partner, chatIds);
        send(socket, "matched", { initiator: true, otherUsername: usernameOf.get(partner) || "Guest", matchId });
        send(partner, "matched", { initiator: false, otherUsername: usernameOf.get(socket) || "Guest", matchId });
      }
      return;
    }

    if (type === "leave") {
      if (!hasOnlyKeys(message, ["type"])) {
        rejectProtocol(socket);
        return;
      }
      disconnect(socket);
      return;
    }

    if (type === "skip") {
      if (!hasOnlyKeys(message, ["type"])) {
        rejectProtocol(socket);
        return;
      }
      if (!usernameOf.has(socket)) return;
      disconnect(socket, true);
      if (waiting.length >= MAX_WAITING) {
        send(socket, "server-busy");
        disconnect(socket);
        socket.close(1013, "Lobby full");
      } else addToQueue(socket);
      return;
    }

    if (type === "chat") {
      if (!hasOnlyKeys(message, ["type", "payload"])) {
        rejectProtocol(socket);
        return;
      }
      const partner = partnerOf.get(socket);
      const matchId = matchIdOf.get(socket);
      const payload = message.payload;
      if (!isRecord(payload) || !hasOnlyKeys(payload, ["id", "matchId", "text"])) {
        rejectProtocol(socket);
        return;
      }
      const id = isRecord(payload) && typeof payload.id === "string" ? payload.id : "";
      if (!partner || !matchId || payload.matchId !== matchId) return;
      if (!id || id.length > 64 || typeof payload.text !== "string") {
        send(socket, "chat-error", { id, matchId });
        return;
      }
      const text = payload.text.trim();
      if (!text || text.length > 300) {
        send(socket, "chat-error", { id, matchId });
        return;
      }
      const seenIds = chatIdsOf.get(socket);
      if (!seenIds) return;
      if (seenIds.has(id)) {
        send(socket, "chat-ack", { id, matchId });
        return;
      }
      if (!send(partner, "chat", { id, matchId, text })) {
        send(socket, "chat-error", { id, matchId });
        disconnect(socket);
        return;
      }
      seenIds.add(id);
      if (seenIds.size > 1000) {
        const oldestId = seenIds.values().next().value;
        if (oldestId) seenIds.delete(oldestId);
      }
      send(socket, "chat-ack", { id, matchId });
      return;
    }

    if (type === "offer" || type === "answer" || type === "candidate") {
      if (!hasOnlyKeys(message, ["type", "matchId", "payload"]) || !isMatchId(message.matchId)) {
        rejectProtocol(socket);
        return;
      }
      const partner = partnerOf.get(socket);
      const matchId = matchIdOf.get(socket);
      const validPayload = type === "offer" || type === "answer"
        ? isSessionDescription(message.payload, type)
        : isIceCandidate(message.payload);
      if (!validPayload) {
        rejectProtocol(socket);
        return;
      }
      if (!partner || !matchId || message.matchId !== matchId) return;
      if (!sendSignal(partner, type, matchId, message.payload)) disconnect(socket);
    }
  });
  socket.on("close", () => disconnect(socket));
});

const heartbeat = setInterval(() => {
  for (const socket of webSocketServer.clients) {
    if (!aliveSockets.has(socket)) {
      disconnect(socket);
      socket.terminate();
      continue;
    }
    aliveSockets.delete(socket);
    try {
      socket.ping();
    } catch {
      disconnect(socket);
      socket.terminate();
    }
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeat.unref();

function disconnect(socket: WebSocket, keepUsername = false) {
  removeFromQueue(socket);
  if (!keepUsername) rateWindowsOf.delete(socket);
  const partner = partnerOf.get(socket);
  if (partner) {
    partnerOf.delete(socket);
    partnerOf.delete(partner);
    matchIdOf.delete(socket);
    matchIdOf.delete(partner);
    chatIdsOf.delete(socket);
    chatIdsOf.delete(partner);
    send(partner, "partner-left");
  }
  matchIdOf.delete(socket);
  chatIdsOf.delete(socket);
  if (!keepUsername) usernameOf.delete(socket);
}

const isProduction = process.env.NODE_ENV === "production";
const configuredPort = process.env.PORT === undefined
  ? isProduction ? undefined : 8787
  : Number(process.env.PORT);
if (configuredPort === undefined) {
  throw new Error("PORT must be set when running in production");
}
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
const host = process.env.HOST?.trim() || "0.0.0.0";

httpServer.listen(configuredPort, host, () => {
  const address = httpServer.address();
  const port = address && typeof address === "object" ? address.port : configuredPort;
  console.log(`Sidequest signaling server listening on ${host}:${port}`);
});
