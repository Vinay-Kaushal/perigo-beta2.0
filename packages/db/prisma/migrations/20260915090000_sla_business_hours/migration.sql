-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "businessDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
ADD COLUMN     "businessEnd" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "businessHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "businessStart" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "responseDueAt" TIMESTAMP(3),
ADD COLUMN     "slaPausedAt" TIMESTAMP(3),
ADD COLUMN     "slaPausedMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "priority" "TaskPriority" NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgHoliday" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_organisationId_priority_key" ON "SlaPolicy"("organisationId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "OrgHoliday_organisationId_date_key" ON "OrgHoliday"("organisationId", "date");

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgHoliday" ADD CONSTRAINT "OrgHoliday_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tickets already on hold start their pause now (no retroactive extra time).
UPDATE "Ticket" SET "slaPausedAt" = CURRENT_TIMESTAMP WHERE "status" = 'ON_HOLD';
