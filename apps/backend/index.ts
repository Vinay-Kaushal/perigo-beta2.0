import "dotenv/config";
import { createApp } from "./app";
import { env } from "./lib/env";
import { prisma } from "./lib/prisma";
import { closeRedis } from "./lib/redis";
import { startEmailWorker, stopEmailWorker } from "./services/emailQueue";

const { PORT, EMAIL_WORKER } = env();
const server = createApp().listen(PORT, () => {
  console.log(`backend listening on :${PORT}`);
});
// Runs in every API instance; Redis claims make sure each email is sent once.
if (EMAIL_WORKER === "on") startEmailWorker();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, draining connections…`);
  const force = setTimeout(() => process.exit(1), 10_000);
  stopEmailWorker();
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
    clearTimeout(force);
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
