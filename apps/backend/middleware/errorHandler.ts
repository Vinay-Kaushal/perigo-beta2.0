import type { NextFunction, Request, Response } from "express";
import { Prisma } from "db/client";
import { ZodError } from "zod";
import { HttpError } from "../lib/http";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Route not found", code: "NOT_FOUND" });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", code: "VALIDATION_FAILED", issues: err.flatten() });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "A record with these details already exists", code: "CONFLICT" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Record not found", code: "NOT_FOUND" });
    }
    if (err.code === "P2003") {
      return res.status(409).json({ error: "This record is still referenced by other data", code: "CONFLICT" });
    }
  }

  // body-parser errors (malformed JSON, oversized payloads) carry a status.
  const status = (err as { status?: number; type?: string })?.status;
  if (status === 400 || status === 413) {
    return res.status(status).json({
      error: status === 413 ? "Payload too large" : "Malformed request body",
      code: status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
    });
  }

  console.error(`[error] request=${req.id ?? "-"} ${req.method} ${req.originalUrl}`, err);
  // Never leak internals (stack traces, SQL) to the client.
  return res.status(500).json({ error: "Internal server error", code: "INTERNAL", requestId: req.id });
}
