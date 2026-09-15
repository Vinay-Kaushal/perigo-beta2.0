import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { badRequest, conflict, notFound, param } from "../lib/http";
import { publishOrgEvent } from "../lib/eventBus";
import { getMembership } from "../middleware/access";
import { audit } from "../services/audit";
import { loadSlaContext } from "../services/sla";
import { assertSchedule, isValidTimezone } from "../domain/businessHours";
import { DEFAULT_SLA, PRIORITIES } from "../domain/sla";

async function serialise(organisationId: string) {
  const [ctx, holidays, customised] = await Promise.all([
    loadSlaContext(organisationId),
    prisma.orgHoliday.findMany({ where: { organisationId }, orderBy: { date: "asc" }, select: { id: true, date: true, name: true } }),
    prisma.slaPolicy.findMany({ where: { organisationId }, select: { priority: true } }),
  ]);
  const custom = new Set(customised.map((p) => p.priority));
  return {
    businessHours: {
      enabled: ctx.schedule.enabled,
      timezone: ctx.schedule.timezone,
      days: ctx.schedule.days,
      start: ctx.schedule.start,
      end: ctx.schedule.end,
    },
    holidays,
    policies: PRIORITIES.map((priority) => ({
      priority,
      ...ctx.policies[priority],
      isDefault: !custom.has(priority),
      defaults: DEFAULT_SLA[priority],
    })),
  };
}

export async function getSla(req: Request, res: Response) {
  res.json(await serialise(getMembership(req).organisationId));
}

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:MM");
const minutes = z.number().int().min(5, "At least 5 minutes").max(60 * 24 * 365, "At most a year");

const updateSchema = z
  .object({
    businessHours: z
      .object({
        enabled: z.boolean(),
        timezone: z.string().max(64).refine(isValidTimezone, "Unknown timezone"),
        days: z.array(z.number().int().min(0).max(6)).max(7),
        start: clock,
        end: clock,
      })
      .optional(),
    policies: z
      .array(
        z
          .object({ priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]), firstResponseMinutes: minutes, resolutionMinutes: minutes })
          .refine((p) => p.firstResponseMinutes <= p.resolutionMinutes, { message: "First response can't be later than resolution", path: ["firstResponseMinutes"] })
      )
      .max(4)
      .optional(),
    resetPolicies: z.array(z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"])).max(4).optional(),
  })
  .refine((b) => b.businessHours || b.policies?.length || b.resetPolicies?.length, "Nothing to update");

/**
 * Changes apply to tickets created (or re-prioritised, or resumed from hold)
 * afterwards; existing targets aren't rewritten retroactively.
 */
export async function updateSla(req: Request, res: Response) {
  const membership = getMembership(req);
  const orgId = membership.organisationId;
  const body = updateSchema.parse(req.body);

  if (body.businessHours) {
    const days = [...new Set(body.businessHours.days)].sort();
    try {
      assertSchedule({ ...body.businessHours, days, holidays: [] });
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : "Invalid business hours");
    }
    await prisma.organisation.update({
      where: { id: orgId },
      data: {
        businessHoursEnabled: body.businessHours.enabled,
        timezone: body.businessHours.timezone,
        businessDays: days,
        businessStart: body.businessHours.start,
        businessEnd: body.businessHours.end,
      },
    });
  }

  await prisma.$transaction([
    ...(body.policies ?? []).map((p) =>
      prisma.slaPolicy.upsert({
        where: { organisationId_priority: { organisationId: orgId, priority: p.priority } },
        update: { firstResponseMinutes: p.firstResponseMinutes, resolutionMinutes: p.resolutionMinutes },
        create: { organisationId: orgId, ...p },
      })
    ),
    ...(body.resetPolicies?.length ? [prisma.slaPolicy.deleteMany({ where: { organisationId: orgId, priority: { in: body.resetPolicies } } })] : []),
  ]);

  await audit(req, { organisationId: orgId, action: "sla.updated", metadata: body as Record<string, unknown> });
  await publishOrgEvent(orgId, "ORG_UPDATED", req.user!.id, { id: orgId });
  res.json(await serialise(orgId));
}

const holidaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a real date"),
  name: z.string().trim().min(1).max(80),
});

export async function addHoliday(req: Request, res: Response) {
  const orgId = getMembership(req).organisationId;
  const body = holidaySchema.parse(req.body);
  if ((await prisma.orgHoliday.count({ where: { organisationId: orgId } })) >= 200) throw conflict("An organisation can have at most 200 holidays");
  const holiday = await prisma.orgHoliday.create({ data: { organisationId: orgId, ...body }, select: { id: true, date: true, name: true } });
  await audit(req, { organisationId: orgId, action: "sla.holiday_added", metadata: body });
  res.status(201).json(holiday);
}

export async function deleteHoliday(req: Request, res: Response) {
  const orgId = getMembership(req).organisationId;
  const result = await prisma.orgHoliday.deleteMany({ where: { id: param(req, "holidayId"), organisationId: orgId } });
  if (result.count === 0) throw notFound("Holiday not found");
  await audit(req, { organisationId: orgId, action: "sla.holiday_removed", targetId: param(req, "holidayId") });
  res.status(204).send();
}
