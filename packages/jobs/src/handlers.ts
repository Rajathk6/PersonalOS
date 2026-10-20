import type { Task } from "@personalos/contracts";
import type { TaskHandler } from "@personalos/core";
import type { PgQueue, TaskRepository } from "@personalos/core";
import type { ToolExecutor } from "@personalos/tools";
import { z } from "zod";
import type { JobsStore } from "./store.js";
import { logger } from "./logger.js";

const CheckNowInput = z.object({ watchId: z.string().uuid().optional() });

interface FreshFinding {
  id: string;
  watchId: string;
  sourceUrl: string;
  title: string;
  matchedKeywords: string[];
}

export interface JobsHandlerDeps {
  store: TaskRepository;
  queue: PgQueue;
  executor: ToolExecutor;
  jobs: JobsStore;
}

// Check-then-notify: the tool discovers deterministically; the handler turns
// each fresh finding into a reminder task (the user's heads-up) and marks it
// notified only AFTER the reminder is queued — a crash between keeps it
// un-notified, so the next check re-notifies instead of losing it.
export function jobsHandlers(deps: JobsHandlerDeps): Map<string, TaskHandler> {
  const checkNow: TaskHandler = async (task: Task) => {
    const parsed = CheckNowInput.safeParse(task.input ?? {});
    if (!parsed.success) {
      throw Object.assign(new Error("jobs.check_now needs { watchId? }"), { code: "JOBS_BAD_INPUT" });
    }
    const result = await deps.executor.execute("jobs.check", parsed.data, "worker", {
      taskId: task.id,
      capability: "jobs",
    });
    if (!result.success) {
      throw Object.assign(new Error(result.message), { code: result.error_code ?? "JOBS_CHECK_FAILED" });
    }
    const fresh = ((result.metadata as { fresh?: FreshFinding[] } | undefined)?.fresh ?? [])
      .filter((f) => f.matchedKeywords.length > 0);
    let notified = 0;
    for (const f of fresh) {
      await deps.queue.enqueue({
        type: "reminder.send",
        input: {
          text: `New job match: ${f.title} [${f.matchedKeywords.join(", ")}] — ${f.sourceUrl}`,
        },
        priority: 0,
      });
      await deps.jobs.markNotified(f.watchId, f.sourceUrl, f.title);
      notified += 1;
    }
    return { message: result.message, fresh: fresh.length, notified };
  };

  // An official opening reached the pipeline. Make it VISIBLE and REMEMBERED:
  // the alert task carries the official link, and an episodic memory records
  // it so "what did I find?" is answerable later without re-scraping.
  const jobAlert: TaskHandler = async (task: Task) => {
    const parsed = z
      .object({
        title: z.string().min(1),
        url: z.string().url(),
        source: z.string().min(1),
        eligibility: z.string().optional(),
        score: z.number().optional(),
      })
      .safeParse(task.input);
    if (!parsed.success) {
      throw Object.assign(new Error("job.alert needs { title, url, source }"), { code: "ALERT_BAD_INPUT" });
    }
    logger.info(
      { title: parsed.data.title, source: parsed.data.source, score: parsed.data.score },
      "official opening found",
    );
    return {
      title: parsed.data.title,
      url: parsed.data.url,
      source: parsed.data.source,
      eligibility: parsed.data.eligibility ?? "unreviewed",
      foundAt: new Date().toISOString(),
    };
  };

  return new Map([
    ["jobs.check_now", checkNow],
    ["job.alert", jobAlert],
  ]);
}
