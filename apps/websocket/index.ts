import "dotenv/config";
import { createWsServer } from "./server";

const port = Number(process.env.WS_PORT ?? 4001);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const allowedOrigins = (process.env.WS_ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && allowedOrigins.length === 0) {
  throw new Error("WS_ALLOWED_ORIGINS must be set in production");
}

const server = await createWsServer({ port, redisUrl, allowedOrigins });
console.log(`websocket server listening on :${server.port}`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
