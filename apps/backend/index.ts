import "dotenv/config";
import { createApp } from "./app";
import { env } from "./lib/env";
import { prisma } from "./lib/prisma";
import { closeRedis } from "./lib/redis";

const { PORT } = env();
const server = createApp().listen(PORT, () => {
  console.log(`backend listening on :${PORT}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, draining connections…`);
  const force = setTimeout(() => process.exit(1), 10_000);
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
    clearTimeout(force);
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
