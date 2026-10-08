import dotenv from "dotenv";
import path from "node:path";
import os from "node:os";

// npm -w runs with cwd = apps/api, plain `npm run` uses repo root.
// Load nearest .env first, then fall back to repo-root .env for the rest.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  API_TOKEN: z.string().min(1),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_HEARTBEAT_S: z.coerce.number().int().positive().default(15),
  WORKER_LEASE_S: z.coerce.number().int().positive().default(60),
  // Coercion trap: Boolean("false") is true, so accept explicit words only.
  WORKER_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  // No hard-coded machine identity: default is the host's own hostname.
  WORKER_ID: z.string().default(os.hostname()),
  NODE_ENV: z.string().default("development"),
});

export interface Config {
  port: number;
  databaseUrl: string;
  apiToken: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  workerPollMs: number;
  workerHeartbeatS: number;
  workerLeaseS: number;
  workerEnabled: boolean;
  workerId: string;
  nodeEnv: string;
  isProduction: boolean;
}

function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid config: check required env vars.");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const env = parsed.data;
  return {
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    apiToken: env.API_TOKEN,
    logLevel: env.LOG_LEVEL,
    workerPollMs: env.WORKER_POLL_MS,
    workerHeartbeatS: env.WORKER_HEARTBEAT_S,
    workerLeaseS: env.WORKER_LEASE_S,
    workerEnabled: env.WORKER_ENABLED,
    workerId: env.WORKER_ID,
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
  };
}

export const config: Config = loadConfig();
