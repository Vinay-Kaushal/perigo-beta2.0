import Redis from "ioredis";
import { env } from "./env";

let client: Redis | null = null;

/** Shared connection for commands + publishing (subscribers need their own connection). */
export function redis(): Redis {
  if (!client) {
    client = new Redis(env().REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    client.on("error", (err) => console.error("[redis]", err.message));
  }
  return client;
}

export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}
