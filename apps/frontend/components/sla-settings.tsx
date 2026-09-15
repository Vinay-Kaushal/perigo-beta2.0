"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarOff, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Priority, SlaBusinessHours, SlaSettings } from "@/lib/types";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { InlineAlert, Skeleton } from "@/components/ui/feedback";
import { PriorityLabel } from "@/components/tickets/badges";
import { cn, durationLabel } from "@/lib/utils";

const WEEKDAYS = [
  { day: 1, short: "Mon", long: "Monday" },
  { day: 2, short: "Tue", long: "Tuesday" },
  { day: 3, short: "Wed", long: "Wednesday" },
  { day: 4, short: "Thu", long: "Thursday" },
  { day: 5, short: "Fri", long: "Friday" },
  { day: 6, short: "Sat", long: "Saturday" },
  { day: 0, short: "Sun", long: "Sunday" },
];

/** Browsers' ICU data still lists some zones under their legacy names; show the current IANA names instead. */
const MODERN_ZONE_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Godthab": "America/Nuuk",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
};

const FALLBACK_ZONES = ["America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];

function isSupportedZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function timezoneOptions(current: string, supported?: string[]) {
  let zones = supported;
  if (!zones) {
    try {
      zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    } catch {
      /* older browsers */
    }
  }
  const named = (zones?.length ? zones : FALLBACK_ZONES).map((z) => {
    const modern = MODERN_ZONE_NAMES[z];
    return modern && isSupportedZone(modern) ? modern : z;
  });
  return [...new Set(["UTC", current, ...named.sort()])];
}

/** Hours with up to two decimals, as typed into the policy table. */
const toHours = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);
const toMinutes = (hours: string) => Math.round(Number(hours) * 60);

type PolicyDraft = Record<Priority, { firstResponse: string; resolution: string }>;

function draftFrom(data: SlaSettings): PolicyDraft {
  return Object.fromEntries(
    data.policies.map((p) => [p.priority, { firstResponse: toHours(p.firstResponseMinutes), resolution: toHours(p.resolutionMinutes) }])
  ) as PolicyDraft;
}

export function SlaSettingsCard({ orgId }: { orgId: string }) {
  const { data, mutate, error } = useApi<SlaSettings>(`/organisations/${orgId}/sla`);
  const [hours, setHours] = useState<SlaBusinessHours | null>(null);
  const [policies, setPolicies] = useState<PolicyDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [holiday, setHoliday] = useState({ date: "", name: "" });
  const [addingHoliday, setAddingHoliday] = useState(false);

  useEffect(() => {
    if (data) {
      setHours(data.businessHours);
      setPolicies(draftFrom(data));
    }
  }, [data]);

  const zones = useMemo(() => timezoneOptions(hours?.timezone ?? "UTC"), [hours?.timezone]);

  if (error) {
    return (
      <Card>
        <CardHeader title="SLA & business hours" />
        <div className="p-4">
          <InlineAlert tone="danger">{errorMessage(error, "Couldn't load SLA settings")}</InlineAlert>
        </div>
      </Card>
    );
  }

  if (!data || !hours || !policies) {
    return (
      <Card>
        <CardHeader title="SLA & business hours" />
        <div className="p-4">
          <Skeleton className="h-48" />
        </div>
      </Card>
    );
  }

  const changedPolicies = data.policies.filter((p) => {
    const d = policies[p.priority];
    return toMinutes(d.firstResponse) !== p.firstResponseMinutes || toMinutes(d.resolution) !== p.resolutionMinutes;
  });
  const hoursChanged = JSON.stringify(hours) !== JSON.stringify(data.businessHours);
  const dirty = hoursChanged || changedPolicies.length > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!hours || !policies) return;
    setSaving(true);
    try {
      const updated = await api.put<SlaSettings>(`/organisations/${orgId}/sla`, {
        ...(hoursChanged ? { businessHours: hours } : {}),
        ...(changedPolicies.length
          ? {
              policies: changedPolicies.map((p) => ({
                priority: p.priority,
                firstResponseMinutes: toMinutes(policies[p.priority].firstResponse),
                resolutionMinutes: toMinutes(policies[p.priority].resolution),
              })),
            }
          : {}),
      });
      await mutate(updated, { revalidate: false });
      toast.success("SLA settings saved", { description: "New targets apply to tickets created or re-prioritised from now on." });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function resetPolicy(priority: Priority) {
    try {
      await mutate(await api.put<SlaSettings>(`/organisations/${orgId}/sla`, { resetPolicies: [priority] }), { revalidate: false });
      toast.success("Restored the default target");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function addHoliday(e: React.FormEvent) {
    e.preventDefault();
    setAddingHoliday(true);
    try {
      await api.post(`/organisations/${orgId}/sla/holidays`, holiday);
      setHoliday({ date: "", name: "" });
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAddingHoliday(false);
    }
  }

  async function removeHoliday(id: string) {
    try {
      await api.delete(`/organisations/${orgId}/sla/holidays/${id}`);
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const toggleDay = (day: number) =>
    setHours({ ...hours, days: hours.days.includes(day) ? hours.days.filter((d) => d !== day) : [...hours.days, day].sort() });

  return (
    <Card id="sla" className="scroll-mt-6">
      <CardHeader
        title="SLA & business hours"
        description="Targets are set when a ticket is raised or re-prioritised. The clock stops while a ticket is on hold, and resumes with the time added back."
      />
      <form onSubmit={save}>
        <section className="space-y-4 p-4" aria-labelledby="sla-hours-heading">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 id="sla-hours-heading" className="text-[13px] font-medium text-ink">
                Count only business hours
              </h3>
              <p className="text-xs text-ink-muted">When off, SLAs run around the clock. When on, nights, non-working days and holidays don&apos;t count.</p>
            </div>
            <Switch checked={hours.enabled} onCheckedChange={(enabled) => setHours({ ...hours, enabled })} label="Count only business hours" />
          </div>

          {hours.enabled && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Timezone" htmlFor="sla-tz" className="sm:col-span-3">
                <Select id="sla-tz" value={hours.timezone} onChange={(e) => setHours({ ...hours, timezone: e.target.value })}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <fieldset className="space-y-1.5 sm:col-span-3">
                <legend className="text-[13px] font-medium text-ink">Working days</legend>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((w) => {
                    const on = hours.days.includes(w.day);
                    return (
                      <button
                        key={w.day}
                        type="button"
                        aria-pressed={on}
                        aria-label={w.long}
                        onClick={() => toggleDay(w.day)}
                        className={cn(
                          "h-8 min-w-[3rem] rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                          on ? "border-accent bg-accent/10 text-accent" : "border-border text-ink-muted hover:bg-surface-hover"
                        )}
                      >
                        {w.short}
                      </button>
                    );
                  })}
                </div>
                {hours.days.length === 0 && <p className="text-xs text-danger">Choose at least one working day.</p>}
              </fieldset>
              <Field label="Opens" htmlFor="sla-start">
                <Input id="sla-start" type="time" required value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} />
              </Field>
              <Field label="Closes" htmlFor="sla-end" error={hours.end <= hours.start ? "Must be after opening time" : null}>
                <Input id="sla-end" type="time" required value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} />
              </Field>
            </div>
          )}
        </section>

        <section className="border-t border-border" aria-labelledby="sla-policies-heading">
          <h3 id="sla-policies-heading" className="px-4 pt-4 text-[13px] font-medium text-ink">
            Targets by priority <span className="font-normal text-ink-faint">(hours{hours.enabled ? " of business time" : ""})</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead className="text-2xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-2 py-2.5 font-medium">First response</th>
                  <th className="px-2 py-2.5 font-medium">Resolution</th>
                  <th className="w-24 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border border-t border-border">
                {data.policies.map((p) => {
                  const d = policies[p.priority];
                  const set = (key: "firstResponse" | "resolution", value: string) => setPolicies({ ...policies, [p.priority]: { ...d, [key]: value } });
                  return (
                    <tr key={p.priority}>
                      <td className="px-4 py-2.5">
                        <PriorityLabel priority={p.priority} />
                        {p.isDefault && <span className="ml-2 text-2xs text-ink-faint">Default</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        <Input
                          type="number"
                          min={0.25}
                          step={0.25}
                          required
                          className="h-8 w-28"
                          aria-label={`${p.priority.toLowerCase()} first response hours`}
                          value={d.firstResponse}
                          onChange={(e) => set("firstResponse", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <Input
                          type="number"
                          min={0.25}
                          step={0.25}
                          required
                          className="h-8 w-28"
                          aria-label={`${p.priority.toLowerCase()} resolution hours`}
                          value={d.resolution}
                          onChange={(e) => set("resolution", e.target.value)}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {!p.isDefault && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => resetPolicy(p.priority)}
                            title={`Default: ${durationLabel(p.defaults.firstResponseMinutes)} / ${durationLabel(p.defaults.resolutionMinutes)}`}
                          >
                            <RotateCcw size={13} /> Reset
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            {dirty && <span className="text-xs text-ink-faint">Unsaved changes</span>}
            <Button type="submit" loading={saving} disabled={!dirty}>
              Save SLA settings
            </Button>
          </div>
        </section>
      </form>

      <section className="border-t border-border p-4" aria-labelledby="sla-holidays-heading">
        <h3 id="sla-holidays-heading" className="text-[13px] font-medium text-ink">
          Holidays
        </h3>
        <p className="mb-3 text-xs text-ink-muted">
          {hours.enabled ? "Holidays are skipped like non-working days." : "Holidays only apply when business hours are on."}
        </p>
        {data.holidays.length > 0 ? (
          <ul className="mb-3 divide-y divide-border rounded-md border border-border">
            {data.holidays.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="tabular w-24 font-mono text-xs text-ink-muted">{h.date}</span>
                <span className="flex-1 truncate text-ink">{h.name}</span>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${h.name}`} onClick={() => removeHoliday(h.id)}>
                  <Trash2 size={13} />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 flex items-center gap-2 text-xs text-ink-faint">
            <CalendarOff size={14} /> No holidays yet
          </p>
        )}
        <form onSubmit={addHoliday} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Date" htmlFor="holiday-date">
            <Input id="holiday-date" type="date" required value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} />
          </Field>
          <Field label="Name" htmlFor="holiday-name" className="flex-1">
            <Input id="holiday-name" required maxLength={80} placeholder="e.g. New Year's Day" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} />
          </Field>
          <Button type="submit" variant="secondary" loading={addingHoliday}>
            Add holiday
          </Button>
        </form>
      </section>
    </Card>
  );
}
