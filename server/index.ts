import express from "express";
import { createServer } from "node:http";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const port = Number(process.env.PORT || 8788);
const maxMessageBytes = 16 * 1024;
const signalingWindowMs = 10_000;
const maxSignalsPerWindow = 120;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
  next();
});
const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({
  server: httpServer,
  maxPayload: maxMessageBytes,
});
const waiting: WebSocket[] = [];
const partnerOf = new Map<WebSocket, WebSocket>();
const usernameOf = new Map<WebSocket, string>();
const socketAlive = new WeakMap<WebSocket, boolean>();
const signalTimes = new WeakMap<WebSocket, number[]>();

app.get("/health", (_request, response) =>
  response.json({
    ok: true,
    waiting: waiting.length,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  }),
);

const distPath = resolve(process.cwd(), "dist");
const htmlEntry = resolve(distPath, "index.html");

// Production deployments can serve the built PWA and its signaling server from
// the same HTTPS origin. During development, Vite continues to serve the UI.
app.use(express.static(distPath));
app.get(/^(?!\/health$).+$/, (request, response, next) => {
  const pathname = request.path.replace(/^\/+/, "");
  const candidate = resolve(distPath, pathname);
  if (pathname && existsSync(candidate) && statSync(candidate).isFile()) {
    return response.sendFile(candidate);
  }
  return response.sendFile(htmlEntry);
});

const send = (socket: WebSocket, type: string, payload?: unknown) => {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type, payload }));
};

const removeFromQueue = (socket: WebSocket) => {
  const index = waiting.indexOf(socket);
  if (index >= 0) waiting.splice(index, 1);
};

const addToQueue = (socket: WebSocket) => {
  if (socket.readyState === WebSocket.OPEN && !waiting.includes(socket))
    waiting.push(socket);
};

const takeWaitingSocket = (socket: WebSocket) => {
  let partner = waiting.shift();
  while (
    partner &&
    (partner === socket || partner.readyState !== WebSocket.OPEN || partnerOf.has(partner))
  ) {
    partner = waiting.shift();
  }
  return partner;
};

const isRateLimited = (socket: WebSocket) => {
  const now = Date.now();
  const recent = (signalTimes.get(socket) || []).filter(
    (time) => now - time < signalingWindowMs,
  );
  recent.push(now);
  signalTimes.set(socket, recent);
  return recent.length > maxSignalsPerWindow;
};

const sanitizeUsername = (username?: string) =>
  username
    ?.split("")
    .filter((character) => character >= " " && character !== "\x7F")
    .join("")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32) || "Guest";

webSocketServer.on("connection", (socket) => {
  socketAlive.set(socket, true);
  socket.on("pong", () => socketAlive.set(socket, true));
  socket.on("message", (raw) => {
    if (isRateLimited(socket)) {
      send(socket, "error", { message: "Too many requests. Please slow down." });
      return;
    }
    let message: { type: string; username?: string; payload?: unknown };
    try {
      message = JSON.parse(raw.toString()) as typeof message;
    } catch {
      send(socket, "error", { message: "Invalid message." });
      return;
    }
    if (!message || typeof message.type !== "string") {
      send(socket, "error", { message: "Invalid message." });
      return;
    }
    if (![
      "join",
      "leave",
      "skip",
      "offer",
      "answer",
      "candidate",
      "chat",
    ].includes(message.type)) {
      send(socket, "error", { message: "Unsupported message." });
      return;
    }
    if (message.type === "join" && !partnerOf.has(socket)) {
      usernameOf.set(socket, sanitizeUsername(message.username));
      const partner = takeWaitingSocket(socket);
      if (!partner) addToQueue(socket);
      else {
        partnerOf.set(socket, partner);
        partnerOf.set(partner, socket);
        send(socket, "matched", {
          initiator: true,
          otherUsername: usernameOf.get(partner) || "Guest",
        });
        send(partner, "matched", {
          initiator: false,
          otherUsername: usernameOf.get(socket) || "Guest",
        });
      }
    }
    if (message.type === "leave") disconnect(socket);
    if (message.type === "skip") {
      disconnect(socket, true);
      addToQueue(socket);
    }
    if (["offer", "answer", "candidate", "chat"].includes(message.type)) {
      if (
        message.type === "chat" &&
        (!message.payload ||
          typeof message.payload !== "object" ||
          typeof (message.payload as { id?: unknown }).id !== "string" ||
          typeof (message.payload as { text?: unknown }).text !== "string" ||
          !(message.payload as { text: string }).text.trim() ||
          (message.payload as { text: string }).text.length > 300)
      ) {
        return;
      }
      const partner = partnerOf.get(socket);
      if (partner) {
        const payload =
          message.type === "chat"
            ? {
                id: (message.payload as { id: string }).id,
                text: (message.payload as { text: string }).text.trim(),
              }
            : message.payload;
        send(partner, message.type, payload);
      }
    }
  });
  socket.on("close", () => disconnect(socket));
});

const heartbeat = setInterval(() => {
  webSocketServer.clients.forEach((socket) => {
    if (!socketAlive.get(socket)) {
      socket.terminate();
      return;
    }
    socketAlive.set(socket, false);
    socket.ping();
  });
}, 30_000);

httpServer.on("close", () => clearInterval(heartbeat));

function disconnect(socket: WebSocket, keepUsername = false) {
  removeFromQueue(socket);
  const partner = partnerOf.get(socket);
  if (partner) {
    partnerOf.delete(socket);
    partnerOf.delete(partner);
    send(partner, "partner-left");
  }
  if (!keepUsername) usernameOf.delete(socket);
}

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Sidequest signaling server on http://0.0.0.0:${port}`);
});
