// Runtime mirror of types.ts for boundary validation. Every object is strict
// so renamed fields fail loudly instead of being silently dropped. (No z.infer
// cross-checks: exactOptionalPropertyTypes makes optional inference diverge
// from the hand-written interfaces; conformance is asserted in schemas.test.ts.)
import { z } from "zod";

export const TaskStateSchema = z.enum([
  "created", "queued", "running", "done", "failed", "cancelled", "waiting_for_network",
]);

const isoDateTime = z.string().datetime({ offset: true });
const TaskErrorSchema = z.object({
  code: z.string().min(1), retryable: z.boolean(), message: z.string(),
}).strict();
const TaskLeaseSchema = z.object({
  workerId: z.string().min(1), expiresAt: isoDateTime,
}).strict();

export const TaskSchema = z.object({
  id: z.string().min(1), type: z.string().min(1), capability: z.string().min(1).optional(),
  state: TaskStateSchema, input: z.unknown(), output: z.unknown().optional(),
  error: TaskErrorSchema.optional(), priority: z.number(), // sign belongs to the scheduler
  notBefore: isoDateTime.optional(), retryCount: z.number().int().min(0),
  maxRetries: z.number().int().min(0), lease: TaskLeaseSchema.nullable().optional(),
  requiredCapabilities: z.array(z.string().min(1)),
  idempotencyKey: z.string().min(1).optional(), lastCheckpoint: z.unknown().optional(),
  createdAt: isoDateTime, updatedAt: isoDateTime,
}).strict();

const WorkflowStatusSchema = z.enum(["pending", "running", "done", "failed", "skipped"]);

export const WorkflowStepSchema = z.object({
  workflowId: z.string().min(1), stepId: z.string().min(1), seq: z.number().int().min(0),
  status: WorkflowStatusSchema, input: z.unknown(), output: z.unknown().optional(),
  checkpoint: z.unknown().optional(), retryCount: z.number().int().min(0),
  workerId: z.string().min(1).optional(), startedAt: isoDateTime.optional(),
  endedAt: isoDateTime.optional(), error: TaskErrorSchema.optional(),
}).strict();

export const ModelRequestSchema = z.object({
  modelId: z.string().min(1).optional(),
  messages: z.array(z.object({ role: z.string().min(1), content: z.string() }).strict()),
  tools: z.array(z.unknown()).optional(), schema: z.unknown().optional(),
  maxTokens: z.number().int().positive().optional(),
}).strict();

export const ModelResponseSchema = z.object({
  text: z.string(),
  toolCalls: z.array(z.object({ name: z.string().min(1), args: z.unknown() }).strict()).optional(),
  usage: z.unknown().optional(),
}).strict();

export const ToolResultSchema = z.object({
  success: z.boolean(), error_code: z.string().min(1).nullable(), retryable: z.boolean(),
  message: z.string(), metadata: z.record(z.unknown()).optional(),
}).strict();

export const CapabilityStateSchema = z.enum([
  "DISCOVERED", "VALIDATING", "INSTALLED", "ENABLED", "DISABLED", "UPDATED", "REMOVED",
]);

export const CapabilityManifestSchema = z.object({
  name: z.string().min(1), version: z.string().min(1),
  actions: z.array(z.string().min(1)), entities: z.array(z.string().min(1)),
  workflows: z.array(z.string().min(1)), tools: z.array(z.string().min(1)),
  permissions: z.array(z.string().min(1)), storageMigrations: z.array(z.string().min(1)).optional(),
  ui: z.unknown().optional(), automations: z.unknown().optional(),
  compat: z.object({
    runtime: z.string().min(1), models: z.array(z.string().min(1)).optional(),
  }).strict(),
}).strict();

export const RiskLevelSchema = z.enum(["Low", "Medium", "High", "Critical"]);
export const PermissionVerdictSchema = z.enum(["Allowed", "Confirm", "Denied"]);

export const PermissionRequestSchema = z.object({
  tool: z.string().min(1), risk: RiskLevelSchema, capability: z.string().min(1).optional(),
  argsSummary: z.unknown(), actor: z.enum(["worker", "user", "scheduler"]),
}).strict();

export const PermissionResultSchema = z.object({
  verdict: PermissionVerdictSchema, reason: z.string().optional(),
}).strict();

export const WorkerRegistrationSchema = z.object({
  id: z.string().min(1), capabilities: z.array(z.string().min(1)),
  auth: z.string().min(1), endpoint: z.string().min(1).optional(),
}).strict();

export const PersonalOSEventSchema = z.object({
  channel: z.string().min(1), id: z.string().min(1), at: isoDateTime,
  actor: z.string().min(1).optional(), taskId: z.string().min(1).optional(),
  payload: z.record(z.unknown()), // IDs + refs only, no large blobs
}).strict();

/** Bundle-local alias; INTERFACES.md names this envelope PersonalOSEvent. */
export const EventEnvelopeSchema = PersonalOSEventSchema;

export const MemoryTypeSchema = z.enum([
  "working", "episodic", "semantic", "user", "procedural", "task",
]);

export const MemoryRecordSchema = z.object({
  id: z.string().min(1), type: MemoryTypeSchema, content: z.unknown(),
  relevance: z.number(), importance: z.number(), confidence: z.number(), // gates belong to Memory Store
  freshness: isoDateTime, sourceTaskId: z.string().min(1).optional(),
  expiresAt: isoDateTime.optional(),
}).strict();
