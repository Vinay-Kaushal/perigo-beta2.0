import { z } from "zod";

/**
 * Validated once, on first use, so a misconfigured deploy fails loudly at
 * boot instead of at the first request that happens to read a missing var.
 * Tests set process.env before importing the app, which is why this is lazy.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_TTL: z.string().default("7d"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  // Session cookie. Frontend and API must be same-site (e.g. app.example.com + api.example.com);
  // set COOKIE_DOMAIN=.example.com there so the Next.js middleware can see the session.
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  // Attachments are stored on local disk (mount a volume in production) under random keys.
  UPLOAD_DIR: z.string().default("./uploads"),
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  ATTACHMENTS_PER_TICKET_MAX: z.coerce.number().int().positive().default(50),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  RESEND_API_KEY: z.string().optional(),
  // smtp://user:pass@host:587 or smtps://user:pass@host:465 — used when set (takes precedence over Resend).
  SMTP_URL: z.string().optional(),
  // Public URL of this API, used for one-click unsubscribe links in emails.
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  // Notification emails for a user are batched for this long, then sent as one email (0 = next worker tick).
  EMAIL_BATCH_WINDOW_SEC: z.coerce.number().int().min(0).default(60),
  EMAIL_WORKER: z.enum(["on", "off"]).default("on"),
  EMAIL_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  MAIL_FROM: z.string().default("perigo <no-reply@perigo.local>"),
  // Number of reverse proxies in front of the API — needed for a correct req.ip.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // Anonymous traffic per IP / minute. Signed-in traffic is limited per user instead, so a whole
  // office behind one NAT or VPN address doesn't share a single budget.
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_USER_MAX: z.coerce.number().int().positive().default(1200), // per user / minute
  RATE_LIMIT_BAD_AUTH_MAX: z.coerce.number().int().positive().default(120), // invalid/revoked credentials per IP / minute
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10), // per IP+email / 15 min
  RATE_LIMIT_SIGNUP_MAX: z.coerce.number().int().positive().default(20), // per IP / hour
  RATE_LIMIT_TOKEN_MAX: z.coerce.number().int().positive().default(30), // invite/verification lookups per IP / minute
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
