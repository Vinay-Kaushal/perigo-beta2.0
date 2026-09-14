import type { NextFunction, Request, Response } from "express";
import { redis } from "../lib/redis";

interface RateLimitOptions {
  name: string;
  windowSec: number;
  max: () => number;
  key?: (req: Request) => string;
  /** Return true to bypass this limiter for a request (it's limited elsewhere). */
  skip?: (req: Request) => boolean;
}

/** Requests carrying a bearer token or session cookie are limited per user after authentication instead. */
export function hasCredentials(req: Request) {
  return req.headers.authorization?.startsWith("Bearer ") === true || /(?:^|;\s*)perigo_session=/.test(req.headers.cookie ?? "");
}

/**
 * Counts one event against a fixed window and reports whether the limit is exceeded.
 * Fails open (returns false) if Redis is unreachable.
 */
export async function hitLimit(name: string, identity: string, windowSec: number, limit: number) {
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const redisKey = `rl:${name}:${identity}:${window}`;
  try {
    const results = await redis().multi().incr(redisKey).expire(redisKey, windowSec + 1).exec();
    return Number(results?.[0]?.[1] ?? 0) > limit;
  } catch (err) {
    console.error(`[rateLimit:${name}] limiter unavailable, allowing request`, err);
    return false;
  }
}

/**
 * Fixed-window limiter backed by Redis, so limits hold across every API
 * instance. Fails open if Redis is unreachable — an outage of the limiter
 * shouldn't take the whole API down with it.
 */
export function rateLimit({ name, windowSec, max, key, skip }: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (skip?.(req)) return next();
    const identity = key ? key(req) : req.ip ?? "unknown";
    const window = Math.floor(Date.now() / 1000 / windowSec);
    const redisKey = `rl:${name}:${identity}:${window}`;
    const limit = max();

    try {
      const results = await redis().multi().incr(redisKey).expire(redisKey, windowSec + 1).exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      const resetSec = (window + 1) * windowSec - Math.floor(Date.now() / 1000);

      res.setHeader("RateLimit-Limit", String(limit));
      res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - count)));
      res.setHeader("RateLimit-Reset", String(resetSec));

      if (count > limit) {
        res.setHeader("Retry-After", String(resetSec));
        return res.status(429).json({ error: "Too many requests, please try again later", code: "RATE_LIMITED" });
      }
    } catch (err) {
      console.error(`[rateLimit:${name}] limiter unavailable, allowing request`, err);
    }
    next();
  };
}
