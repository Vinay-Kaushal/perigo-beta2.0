import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Thrown from handlers/services; rendered by errorHandler with the given status. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg, "BAD_REQUEST");
export const forbidden = (msg = "You don't have permission to do that") => new HttpError(403, msg, "FORBIDDEN");
export const notFound = (msg = "Not found") => new HttpError(404, msg, "NOT_FOUND");
export const conflict = (msg: string) => new HttpError(409, msg, "CONFLICT");

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Express 4 doesn't forward rejected promises — route them to the error middleware. */
export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Route params are always strings once matched; this narrows away `undefined`. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw badRequest(`Missing route parameter: ${name}`);
  return value;
}
