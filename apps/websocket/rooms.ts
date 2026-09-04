import type { WebSocket } from "ws";
import { prisma } from "db/client";
import type { AuthedUser, ServerMessage } from "./types";

export interface ClientSocket {
  ws: WebSocket;
  user: AuthedUser;
  /** boardIds this socket has successfully joined. */
  boards: Set<string>;
}

const PRESENCE_COLORS = [
  "#F87171", "#FB923C", "#FBBF24", "#4ADE80",
  "#22D3EE", "#818CF8", "#C084FC", "#F472B6",
];

export function colorForUser(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

// boardId -> sockets currently in that room. In-memory, single-process —
// see README for the note on scaling this to multiple ws instances.
const rooms = new Map<string, Set<ClientSocket>>();

export function send(client: ClientSocket, message: ServerMessage) {
  if (client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

export function broadcast(boardId: string, message: ServerMessage, exclude?: ClientSocket) {
  const room = rooms.get(boardId);
  if (!room) return;
  for (const client of room) {
    if (client !== exclude) send(client, message);
  }
}

export async function isBoardMember(userId: string, boardId: string): Promise<boolean> {
  const board = await prisma.board.findUnique({ where: { id: boardId } });
  if (!board) return false;

  const orgMembership = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId: board.organisationId } },
  });
  if (!orgMembership) return false;
  if (orgMembership.role !== "MEMBER") return true; // OWNER/ADMIN implicitly have access

  const boardMembership = await prisma.boardMember.findUnique({
    where: { boardId_organisationMemberId: { boardId, organisationMemberId: orgMembership.id } },
  });
  return Boolean(boardMembership);
}

function rosterFor(boardId: string) {
  const room = rooms.get(boardId);
  const seen = new Map<string, { userId: string; name: string; color: string }>();
  if (room) {
    for (const client of room) {
      seen.set(client.user.userId, {
        userId: client.user.userId,
        name: client.user.name,
        color: colorForUser(client.user.userId),
      });
    }
  }
  return [...seen.values()];
}

function syncPresence(boardId: string) {
  broadcast(boardId, { type: "presence:sync", boardId, users: rosterFor(boardId) });
}

export async function joinBoard(client: ClientSocket, boardId: string) {
  const allowed = await isBoardMember(client.user.userId, boardId);
  if (!allowed) {
    send(client, { type: "board:join_denied", boardId, reason: "Not a member of this board" });
    return;
  }

  if (!rooms.has(boardId)) rooms.set(boardId, new Set());
  rooms.get(boardId)!.add(client);
  client.boards.add(boardId);

  send(client, { type: "board:joined", boardId });
  syncPresence(boardId);
}

export function leaveBoard(client: ClientSocket, boardId: string) {
  rooms.get(boardId)?.delete(client);
  client.boards.delete(boardId);
  broadcast(boardId, { type: "presence:left", boardId, userId: client.user.userId });
  syncPresence(boardId);
}

/** Called on socket close — leaves every room the socket was still in. */
export function leaveAllBoards(client: ClientSocket) {
  for (const boardId of [...client.boards]) {
    leaveBoard(client, boardId);
  }
}
