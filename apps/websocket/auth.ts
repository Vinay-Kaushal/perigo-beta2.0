import jwt from "jsonwebtoken";
import type { AuthedUser } from "./types";

/**
 * Raw `ws` has no connection-time auth middleware like socket.io, so the
 * token travels as a query param on the upgrade URL:
 *   wss://ws.example.com/?token=<the same bearer JWT used against the REST API>
 * Same JWT_SECRET as apps/backend — a token issued by /auth/login there
 * authenticates the socket here too, no separate handshake.
 */
export function verifyToken(token: string | null): AuthedUser | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      sub: string;
      email: string;
      name?: string;
    };
    return { userId: decoded.sub, email: decoded.email, name: decoded.name ?? decoded.email };
  } catch {
    return null;
  }
}
