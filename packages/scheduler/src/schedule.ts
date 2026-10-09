import { z } from "zod";

// Phase 5 schedule shapes. Deliberately small: one-shot times and fixed
// intervals cover reminders/monitors; cron expressions wait until a real
// calendar need appears (a cron parser is a dependency + a bug farm).
export const ScheduleSpecSchema = z.union([
  z.object({ kind: z.literal("once"), at: z.string().datetime({ offset: true }) }),
  z.object({
    kind: z.literal("every"),
    seconds: z.number().int().min(15),
    from: z.string().datetime({ offset: true }).optional(),
  }),
]);

export type ScheduleSpec = z.infer<typeof ScheduleSpecSchema>;

// Next fire time AFTER a reference point. Pure (no now() inside) so tests and
// catch-up math share one implementation. `after` = lastCheckpoint (or job
// creation for new jobs); null fires immediately (new recurring job).
export function nextDue(spec: ScheduleSpec, after: Date | null, now: Date): Date | null {
  if (spec.kind === "once") {
    const at = new Date(spec.at);
    return at.getTime() <= now.getTime() ? at : null;
  }
  if (after === null) {
    return spec.from ? new Date(spec.from) : now;
  }
  return new Date(after.getTime() + spec.seconds * 1000);
}

export function isDue(spec: ScheduleSpec, after: Date | null, now: Date): boolean {
  const next = nextDue(spec, after, now);
  return next !== null && next.getTime() <= now.getTime();
}

// How many periods were skipped during an outage. Drives the single covering
// run's detail note — never a replay loop.
export function missedPeriods(spec: ScheduleSpec, after: Date | null, now: Date): number {
  if (spec.kind !== "every" || after === null) return 0;
  const gap = now.getTime() - after.getTime();
  return Math.max(0, Math.floor(gap / (spec.seconds * 1000)) - 1);
}
