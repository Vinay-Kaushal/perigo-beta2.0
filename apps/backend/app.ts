import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./lib/env";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestContext } from "./middleware/requestContext";
import { hasCredentials, rateLimit } from "./middleware/rateLimit";
import { privateRouter, publicRouter } from "./routes";

export function createApp() {
  const config = env();
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);

  app.use(requestContext);
  // A JSON API never renders HTML, so the strictest CSP costs nothing.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" },
    })
  );

  const allowedOrigins = config.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
      credentials: true, // the browser session is an httpOnly cookie
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id", "X-CSRF-Protection"],
      exposedHeaders: ["X-Request-Id", "RateLimit-Remaining", "Retry-After"],
      maxAge: 600,
    })
  );

  app.use(express.json({ limit: "256kb" }));

  // Responses carry private data — never let shared caches keep them.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/ready", async (_req, res) => {
    try {
      await Promise.all([prisma.$queryRaw`SELECT 1`, redis().ping()]);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Per-IP limit for anonymous traffic; credentialed requests are limited per user in routes/index.ts,
  // and failed credentials are counted per IP in requireAuth.
  app.use(rateLimit({ name: "global", windowSec: 60, max: () => config.RATE_LIMIT_GLOBAL_MAX, skip: hasCredentials }));

  app.use(publicRouter);
  app.use(privateRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
