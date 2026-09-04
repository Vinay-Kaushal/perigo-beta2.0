import "dotenv/config";
import { createServer } from "http";
import { WebSocketServer, type WebSocket } from "ws";

import { verifyToken } from "./auth";
import { joinBoard, leaveBoard, leaveAllBoards, broadcast, colorForUser, type ClientSocket } from "./rooms";
import { startBackendEventSubscriber } from "./subscriber";
import type { ClientMessage } from "./types";

const port = Number(process.env.WS_PORT ?? 4001);

const httpServer = createServer((_req, res) => {
  // Plain health check for load balancers / container orchestration.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://internal");
  const token = url.searchParams.get("token");
  const user = verifyToken(token);

  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, user);
  });
});

wss.on("connection", (ws: WebSocket, user: ClientSocket["user"]) => {
  const client: ClientSocket = { ws, user, boards: new Set() };
  console.log(`socket connected: ${user.userId}`);

  ws.on("message", async (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // silently drop malformed frames
    }

    switch (message.type) {
      case "board:join":
        await joinBoard(client, message.boardId);
        break;

      case "board:leave":
        leaveBoard(client, message.boardId);
        break;

      case "presence:cursor":
        // Unthrottled server-side by design — throttle on the client
        // (e.g. 20-30 emits/sec) instead, or a busy board will get noisy.
        if (client.boards.has(message.boardId)) {
          broadcast(
            message.boardId,
            {
              type: "presence:cursor",
              boardId: message.boardId,
              userId: client.user.userId,
              name: client.user.name,
              color: colorForUser(client.user.userId),
              x: message.x,
              y: message.y,
            },
            client
          );
        }
        break;

      case "task:typing":
        if (client.boards.has(message.boardId)) {
          broadcast(
            message.boardId,
            {
              type: "task:typing",
              boardId: message.boardId,
              taskId: message.taskId,
              userId: client.user.userId,
              isTyping: message.isTyping,
            },
            client
          );
        }
        break;
    }
  });

  ws.on("close", () => leaveAllBoards(client));
  ws.on("error", () => leaveAllBoards(client));
});

startBackendEventSubscriber();

httpServer.listen(port, () => {
  console.log(`websocket server listening on :${port}`);
});
