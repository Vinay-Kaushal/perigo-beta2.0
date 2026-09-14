import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../lib/env";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Tags each request with an id (honouring a sane upstream X-Request-Id) and logs a one-line summary. */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"];
  req.id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.id);

  if (env().NODE_ENV !== "test") {
    const started = performance.now();
    res.on("finish", () => {
      const ms = (performance.now() - started).toFixed(1);
      // Path only — query strings can carry tokens.
      console.info(`${req.method} ${req.path} ${res.statusCode} ${ms}ms id=${req.id}`);
    });
  }
  next();
}
