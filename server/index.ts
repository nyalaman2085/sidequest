import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const app = express();
app.use(express.json());
app.use((_request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  next();
});
const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({ server: httpServer });
const waiting: WebSocket[] = [];
const partnerOf = new Map<WebSocket, WebSocket>();
const usernameOf = new Map<WebSocket, string>();
const matchIdOf = new Map<WebSocket, string>();
const chatIdsOf = new Map<WebSocket, Set<string>>();
const reports: { username: string; reason: string }[] = [];

app.get("/health", (_request, response) =>
  response.json({ ok: true, waiting: waiting.length }),
);
app.post("/report", (request, response) => {
  const { username, reason } = request.body as {
    username?: string;
    reason?: string;
  };
  if (!username || !reason) return response.status(400).json({ ok: false });
  reports.push({ username, reason });
  return response.json({ ok: true });
});

const send = (socket: WebSocket, type: string, payload?: unknown) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
    return true;
  }
  return false;
};

const removeFromQueue = (socket: WebSocket) => {
  const index = waiting.indexOf(socket);
  if (index >= 0) waiting.splice(index, 1);
};

const addToQueue = (socket: WebSocket) => {
  if (socket.readyState === WebSocket.OPEN && !waiting.includes(socket))
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
  socket.on("message", (raw) => {
    let message: {
      type?: unknown;
      username?: string;
      payload?: unknown;
    };
    try {
      message = JSON.parse(raw.toString()) as typeof message;
    } catch {
      socket.close(1007, "Invalid message");
      return;
    }
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      socket.close(1007, "Invalid message");
      return;
    }
    if (message.type === "join") {
      if (partnerOf.has(socket) || waiting.includes(socket)) return;
      usernameOf.set(
        socket,
        typeof message.username === "string"
          ? message.username.slice(0, 32) || "Guest"
          : "Guest",
      );
      const partner = takeWaitingSocket();
      if (!partner) addToQueue(socket);
      else {
        const matchId = randomUUID();
        const chatIds = new Set<string>();
        partnerOf.set(socket, partner);
        partnerOf.set(partner, socket);
        matchIdOf.set(socket, matchId);
        matchIdOf.set(partner, matchId);
        chatIdsOf.set(socket, chatIds);
        chatIdsOf.set(partner, chatIds);
        send(socket, "matched", {
          initiator: true,
          otherUsername: usernameOf.get(partner) || "Guest",
          matchId,
        });
        send(partner, "matched", {
          initiator: false,
          otherUsername: usernameOf.get(socket) || "Guest",
          matchId,
        });
      }
    }
    if (message.type === "leave") disconnect(socket);
    if (message.type === "skip") {
      if (!usernameOf.has(socket)) return;
      disconnect(socket, true);
      addToQueue(socket);
    }
    if (message.type === "chat") {
      const partner = partnerOf.get(socket);
      const matchId = matchIdOf.get(socket);
      const payload = message.payload as {
        id?: unknown;
        matchId?: unknown;
        text?: unknown;
      } | null;
      const id = payload && typeof payload.id === "string" ? payload.id : "";
      if (!partner || !matchId || payload?.matchId !== matchId) return;
      if (!id || id.length > 64 || typeof payload?.text !== "string") {
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
    if (["offer", "answer", "candidate"].includes(message.type)) {
      const partner = partnerOf.get(socket);
      if (partner) send(partner, message.type, message.payload);
    }
  });
  socket.on("close", () => disconnect(socket));
  socket.on("error", () => disconnect(socket));
});

function disconnect(socket: WebSocket, keepUsername = false) {
  removeFromQueue(socket);
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

httpServer.listen(8787, () =>
  console.log("Sidequest signaling server on http://localhost:8787"),
);
