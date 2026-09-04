import Redis from "ioredis";
import type { BoardEventPayload } from "./types";
import { broadcast } from "./rooms";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const subscriber = new Redis(REDIS_URL);

/**
 * The backend publishes to `board:<uuid>` after every mutation (see
 * apps/backend/lib/eventBus.ts). Pattern-subscribing once here and fanning
 * each message out to the matching in-memory room is what makes a task
 * move / comment / status change show up live for everyone looking at that
 * board, without polling.
 */
export function startBackendEventSubscriber() {
  subscriber.psubscribe("board:*", (err) => {
    if (err) {
      console.error("Failed to subscribe to board:* channel", err);
      process.exit(1);
    }
    console.log("Subscribed to board:* Redis channel");
  });

  subscriber.on("pmessage", (_pattern, _channel, message) => {
    let payload: BoardEventPayload;
    try {
      payload = JSON.parse(message);
    } catch {
      console.error("Received malformed board event:", message);
      return;
    }

    broadcast(payload.boardId, { type: "board:event", payload });
  });

  return subscriber;
}
