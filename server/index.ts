import express from "express";
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
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type, payload }));
};

const removeFromQueue = (socket: WebSocket) => {
  const index = waiting.indexOf(socket);
  if (index >= 0) waiting.splice(index, 1);
};

const addToQueue = (socket: WebSocket) => {
  if (!waiting.includes(socket)) waiting.push(socket);
};

webSocketServer.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as {
      type: string;
      username?: string;
      payload?: unknown;
    };
    if (message.type === "join" && !partnerOf.has(socket)) {
      usernameOf.set(socket, message.username?.slice(0, 32) || "Guest");
      const partner = waiting.shift();
      if (!partner || partner === socket) addToQueue(socket);
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
      const partner = partnerOf.get(socket);
      if (partner) send(partner, message.type, message.payload);
    }
  });
  socket.on("close", () => disconnect(socket));
});

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

httpServer.listen(8787, () =>
  console.log("Sidequest signaling server on http://localhost:8787"),
);
