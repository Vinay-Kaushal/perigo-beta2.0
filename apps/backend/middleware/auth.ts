import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

/**
 * Assumes you already have some auth issuing service (NextAuth on the
 * frontend, a dedicated auth service, whatever) that hands out a JWT
 * containing at least `sub` (userId). This backend just verifies it.
 *
 * JWT_SECRET must be the SAME secret the websocket service uses to verify
 * sockets, so both services trust the same tokens.
 */
export interface AuthedRequest extends Request {
  user: { id: string; email: string };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      sub: string;
      email: string;
    };
    (req as AuthedRequest).user = { id: decoded.sub, email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
