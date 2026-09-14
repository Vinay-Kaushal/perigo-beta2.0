-- At most one live invitation (sent or awaiting approval) per email per organisation.
-- Kept in its own migration: Postgres can't use enum values added earlier in the same transaction.
CREATE UNIQUE INDEX "Invitation_active_email_key"
  ON "Invitation" ("organisationId", lower("email"))
  WHERE "status" IN ('PENDING', 'AWAITING_APPROVAL');
