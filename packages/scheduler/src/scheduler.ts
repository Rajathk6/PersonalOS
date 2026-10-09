import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ScheduleSpecSchema, isDue, missedPeriods } from "./schedule.js";

const JobPayloadSchema = z.object({
  taskType: z.string().min(1),
  taskInput: z.unknown(),
});

export interface SchedulerOptions {
  pollMs: number;
  enqueue: (task: { type: string; input: unknown; priority: number }) => Promise<{ id: string }>;
  onError?: (err: unknown, jobName: string | null) => void;
}

// Time/event trigger owner (ARCHITECTURE §2): creates tasks, never runs them.
// Crash barrier included like the worker — a poisoned job row must not kill
// the loop; the error surfaces via onError and the next tick continues.
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private ticking = false;

  constructor(
    private readonly db: PrismaClient,
    private readonly opts: SchedulerOptions,
  ) {}

  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.opts.pollMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  // Single covering run per due job (ADR-010): an outage produces ONE task
  // carrying { missedPeriods } context, never one task per missed period.
  // The checkpoint jumps to now, not to next-after-last — time already passed
  // is not replayed.
  private async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date();
      const jobs = await this.db.scheduledJob.findMany({ where: { enabled: true } });
      for (const job of jobs) {
        try {
          await this.fireIfDue(job.name, job.schedule, job.payload, job.lastCheckpoint, now);
        } catch (err) {
          this.opts.onError?.(err, job.name);
        }
      }
    } catch (err) {
      this.opts.onError?.(err, null);
    } finally {
      this.ticking = false;
    }
  }

  private async fireIfDue(
    name: string,
    scheduleRaw: string,
    payloadRaw: unknown,
    lastCheckpoint: Date | null,
    now: Date,
  ): Promise<void> {
    let spec: z.infer<typeof ScheduleSpecSchema>;
    try {
      spec = ScheduleSpecSchema.parse(JSON.parse(scheduleRaw) as unknown);
    } catch {
      // Poisoned schedule: disable the job loudly instead of spinning on it.
      await this.db.scheduledJob.update({ where: { name }, data: { enabled: false } });
      throw new Error(`job ${name} has an invalid schedule; disabled`);
    }
    const payload = JobPayloadSchema.parse(payloadRaw);
    if (!isDue(spec, lastCheckpoint, now)) return;
    const missed = missedPeriods(spec, lastCheckpoint, now);
    const input =
      missed > 0 && typeof payload.taskInput === "object" && payload.taskInput !== null
        ? { ...(payload.taskInput as Record<string, unknown>), _catchup: { missedPeriods: missed } }
        : payload.taskInput;
    const created = await this.opts.enqueue({ type: payload.taskType, input, priority: 0 });
    await this.db.scheduledJob.update({
      where: { name },
      data: {
        lastCheckpoint: now,
        lastTaskId: created.id,
        // One-shots fire exactly once: staying enabled would refire every tick.
        ...(spec.kind === "once" ? { enabled: false } : {}),
      },
    });
  }
}
