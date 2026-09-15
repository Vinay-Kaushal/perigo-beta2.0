import { prisma } from "../lib/prisma";
import type { BusinessSchedule } from "../domain/businessHours";
import { resolvePolicies, type SlaContext } from "../domain/sla";

export async function loadSlaContext(organisationId: string): Promise<SlaContext> {
  const org = await prisma.organisation.findUniqueOrThrow({
    where: { id: organisationId },
    select: {
      timezone: true,
      businessHoursEnabled: true,
      businessDays: true,
      businessStart: true,
      businessEnd: true,
      slaPolicies: true,
      holidays: { select: { date: true } },
    },
  });
  const schedule: BusinessSchedule = {
    enabled: org.businessHoursEnabled,
    timezone: org.timezone,
    days: org.businessDays,
    start: org.businessStart,
    end: org.businessEnd,
    holidays: org.holidays.map((h) => h.date),
  };
  return { schedule, policies: resolvePolicies(org.slaPolicies) };
}
