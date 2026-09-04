-- Add credential storage to User so the backend can actually issue JWTs.
-- Backfilled to '' for any pre-existing rows (dev/seed data only — there's
-- no real user data yet at this stage of the project); new rows always set
-- it at creation time via /auth/register.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP DEFAULT;
