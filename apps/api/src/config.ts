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
  // Model wiring (Phase 2): endpoint + default model are config, so a future
  // Pi coordinator or cloud provider needs no code change to take over.
  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
  DEFAULT_MODEL: z.string().min(1).default("qwen2.5:3b"),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  // Cloud fallback (Phase 10): unset = no cloud provider registered, no spend.
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  // Tool sandbox root (Phase 3): filesystem tools cannot escape this dir.
  WORKSPACE_DIR: z.string().min(1).default("workspace"),
  // Scheduler (Phase 5): time/event trigger owner. Same enum-bool pattern as
  // WORKER_ENABLED (Boolean("false") is true, so explicit words only).
  SCHEDULER_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  SCHEDULER_POLL_MS: z.coerce.number().int().positive().default(5000),
  // Multi-node (Phase 8): "id:token,id:token" pairs for HTTP worker auth.
  // Direct-DB workers are gated by DB credentials instead; empty = HTTP
  // worker endpoints refuse everyone (fail closed).
  WORKER_TOKENS: z.string().default(""),
  // Liveness sweep: how often to look for dead workers, and how long a
  // missing heartbeat means offline.
  LIVENESS_SWEEP_S: z.coerce.number().int().positive().default(30),
  OFFLINE_AFTER_S: z.coerce.number().int().positive().default(45),
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
  ollamaUrl: string;
  defaultModel: string;
  modelTimeoutMs: number;
  openRouterKey: string | null;
  openRouterUrl: string;
  workspaceDir: string;
  schedulerEnabled: boolean;
  schedulerPollMs: number;
  workerTokens: Map<string, string>;
  livenessSweepS: number;
  offlineAfterS: number;
  nodeEnv: string;
  isProduction: boolean;
}

function parseWorkerTokens(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of raw.split(",").map((s) => s.trim()).filter((s) => s !== "")) {
    const idx = pair.indexOf(":");
    if (idx <= 0) {
      console.error(`Invalid WORKER_TOKENS entry (want id:token): ${pair}`);
      process.exit(1);
    }
    map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return map;
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
    ollamaUrl: env.OLLAMA_URL,
    defaultModel: env.DEFAULT_MODEL,
    modelTimeoutMs: env.MODEL_TIMEOUT_MS,
    openRouterKey: env.OPENROUTER_API_KEY === "" ? null : env.OPENROUTER_API_KEY,
    openRouterUrl: env.OPENROUTER_URL,
    workspaceDir: env.WORKSPACE_DIR,
    schedulerEnabled: env.SCHEDULER_ENABLED,
    schedulerPollMs: env.SCHEDULER_POLL_MS,
    workerTokens: parseWorkerTokens(env.WORKER_TOKENS),
    livenessSweepS: env.LIVENESS_SWEEP_S,
    offlineAfterS: env.OFFLINE_AFTER_S,
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
  };
}

export const config: Config = loadConfig();
