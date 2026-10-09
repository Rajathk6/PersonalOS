import dotenv from "dotenv";
import path from "node:path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Identity is registered, never hard-coded: override per machine.
  WORKER_ID: z.string().min(1),
  WORKER_CAPABILITIES: z.string().default(""),
  WORKSPACE_DIR: z.string().min(1).default("workspace"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_HEARTBEAT_S: z.coerce.number().int().positive().default(15),
  WORKER_LEASE_S: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export interface WorkerConfig {
  databaseUrl: string;
  workerId: string;
  capabilities: string[];
  workspaceDir: string;
  pollMs: number;
  heartbeatS: number;
  leaseS: number;
  logLevel: string;
}

function load(): WorkerConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid worker config.");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const env = parsed.data;
  return {
    databaseUrl: env.DATABASE_URL,
    workerId: env.WORKER_ID,
    capabilities: env.WORKER_CAPABILITIES.split(",").map((s) => s.trim()).filter((s) => s !== ""),
    workspaceDir: env.WORKSPACE_DIR,
    pollMs: env.WORKER_POLL_MS,
    heartbeatS: env.WORKER_HEARTBEAT_S,
    leaseS: env.WORKER_LEASE_S,
    logLevel: env.LOG_LEVEL,
  };
}

export const workerConfig: WorkerConfig = load();
