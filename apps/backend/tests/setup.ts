/**
 * Preloaded before every test file (see bunfig.toml). Points the app at
 * throwaway Postgres/Redis instances and fixes the knobs that make tests
 * fast and deterministic. Must run before anything imports db/client.
 */
const testDb = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5434/perigo_test";
const testRedis = process.env.TEST_REDIS_URL ?? "redis://localhost:6381";

if (!/test/i.test(testDb)) {
  throw new Error(`Refusing to run tests against a database whose name doesn't contain "test": ${testDb}`);
}

import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

Object.assign(process.env, {
  UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), "perigo-uploads-")),
  ATTACHMENT_MAX_BYTES: String(64 * 1024),
  ATTACHMENTS_PER_TICKET_MAX: "5",
  NODE_ENV: "test",
  DATABASE_URL: testDb,
  REDIS_URL: testRedis,
  JWT_SECRET: "test-secret-that-is-definitely-at-least-32-chars",
  JWT_TTL: "1h",
  BCRYPT_ROUNDS: "4",
  CORS_ORIGIN: "http://localhost:3000",
  FRONTEND_URL: "http://localhost:3000",
  RATE_LIMIT_GLOBAL_MAX: "100000",
  RATE_LIMIT_SIGNUP_MAX: "100000",
  RATE_LIMIT_AUTH_MAX: "25",
  RATE_LIMIT_TOKEN_MAX: "100000",
  RATE_LIMIT_USER_MAX: "100000",
  RATE_LIMIT_BAD_AUTH_MAX: "60",
  GOOGLE_CLIENT_ID: "",
});
delete process.env.RESEND_API_KEY;
