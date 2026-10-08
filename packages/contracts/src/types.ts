// Frozen contracts from docs/INTERFACES.md. STABLE changes need an ADR;
// DRAFT may change pre-Phase 1. Types only — no validation, I/O, or policy.

/** STABLE */
export type TaskState =
  | "created" | "queued" | "running" | "done" | "failed" | "cancelled" | "waiting_for_network";

/** STABLE */
export interface Task {
  id: string;
  type: string; // capability-namespaced, e.g. "expense.record"
  capability?: string; state: TaskState;
  input: unknown; // validated per type at the boundary, never assumed here
  output?: unknown;
  error?: { code: string; retryable: boolean; message: string };
  priority: number; notBefore?: string; // ISO datetime, delayed start
  retryCount: number; maxRetries: number;
  lease?: { workerId: string; expiresAt: string } | null;
  requiredCapabilities: string[]; // worker matching, never node identity
  idempotencyKey?: string; lastCheckpoint?: unknown; // semantic catch-up resume point
  createdAt: string; updatedAt: string;
}
// Allowed: created→queued→running→done|failed|cancelled; running→queued (retry, retryCount+1);
// any→cancelled; running|queued→waiting_for_network→queued. Terminal: done/failed/cancelled.

/** STABLE */
export interface WorkflowStep {
  workflowId: string; stepId: string; seq: number;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  input: unknown; output?: unknown; checkpoint?: unknown;
  retryCount: number; workerId?: string; startedAt?: string; endedAt?: string;
  error?: { code: string; retryable: boolean; message: string };
}

/** DRAFT */
export interface ModelMetadata {
  id: string; provider: string; contextTokens: number;
  modalities: string[]; toolCalling: boolean; structuredOutput: boolean;
  reasoning: boolean; latencyClass: string; costClass: string;
  availability: "local" | "cloud"; hwReqs?: string;
}

/** STABLE */
export interface ModelRequest {
  modelId?: string; messages: { role: string; content: string }[];
  tools?: unknown[]; schema?: unknown; maxTokens?: number;
}

/** STABLE */
export interface ModelResponse {
  text: string; toolCalls?: { name: string; args: unknown }[]; usage?: unknown;
}

/** STABLE */
export interface ModelProvider {
  id: string; metadata: ModelMetadata;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/** STABLE */
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

/** STABLE */
export interface Tool {
  name: string; description: string;
  inputSchema: unknown; // validated by the executor, never trusted raw
  requiredPermission: string; risk: RiskLevel; // e.g. "fs.write", "email.send"
  execute(input: unknown): Promise<ToolResult>;
}

/** STABLE */
export interface ToolResult {
  success: boolean; error_code: string | null; // e.g. "ENOENT", "TIMEOUT", "DENIED"
  retryable: boolean; message: string; // human-readable, no secrets
  metadata?: Record<string, unknown>;
}

/** DRAFT */
export type CapabilityState =
  | "DISCOVERED" | "VALIDATING" | "INSTALLED" | "ENABLED" | "DISABLED" | "UPDATED" | "REMOVED";

/** DRAFT */
export interface CapabilityManifest {
  name: string; version: string;
  actions: string[]; entities: string[]; workflows: string[];
  tools: string[]; permissions: string[]; storageMigrations?: string[];
  ui?: unknown; automations?: unknown; compat: { runtime: string; models?: string[] };
}

/** STABLE */
export type PermissionVerdict = "Allowed" | "Confirm" | "Denied";

/** STABLE */
export interface PermissionRequest {
  tool: string; risk: RiskLevel; capability?: string;
  argsSummary: unknown; actor: "worker" | "user" | "scheduler";
}

/** DRAFT — boundary envelope for evaluate(); the verdict values stay STABLE. */
export interface PermissionResult {
  verdict: PermissionVerdict; reason?: string; // human-readable, no secrets
}

/** STABLE */
export interface PermissionEngine {
  evaluate(req: PermissionRequest): Promise<PermissionVerdict>;
}
// Allow/ask defaults live in NORTH_STAR §Permissions; this package carries no policy.

/** STABLE */
export interface WorkerRegistration {
  id: string; capabilities: string[]; // e.g. ["local_llm","coding"] — never hostnames
  auth: string; endpoint?: string;
}

/** STABLE */
export interface WorkerHeartbeat {
  workerId: string; at: string; load?: number; activeTaskIds: string[];
}
// Offline if no heartbeat within timeout → leases reclaimable. No hard-coded identity.

/** STABLE */
export interface Queue {
  enqueue(task: Pick<Task, "type" | "input" | "priority"> & Partial<Task>): Promise<Task>;
  dequeue(worker: WorkerRegistration): Promise<Task | null>; // SKIP LOCKED + capability match + lease
  complete(taskId: string, output: unknown): Promise<void>;
  fail(taskId: string, error: NonNullable<Task["error"]>): Promise<void>; // retry→queued | terminal→failed
  parkWaitingForNetwork(taskId: string, checkpoint?: unknown): Promise<void>;
}

/** STABLE — bundle-local alias; INTERFACES.md names this interface Queue. */
export type QueueOps = Queue;

/** STABLE */
export interface PersonalOSEvent {
  channel: string; id: string; at: string; // channel is one of ARCHITECTURE.md §6
  actor?: string; taskId?: string; payload: Record<string, unknown>; // IDs + refs only, no large blobs
}

/** STABLE — bundle-local alias; INTERFACES.md names this envelope PersonalOSEvent. */
export type EventEnvelope = PersonalOSEvent;

/** DRAFT */
export type MemoryType = "working" | "episodic" | "semantic" | "user" | "procedural" | "task";

/** DRAFT */
export interface MemoryRecord {
  id: string; type: MemoryType; content: unknown; // structured where possible
  relevance: number; importance: number; confidence: number; freshness: string; // ISO datetime
  sourceTaskId?: string; expiresAt?: string;
}
// Rules: relevance/importance gate, freshness+confidence decay, structured facts
// stay relational, vector-index only where semantic search helps.
