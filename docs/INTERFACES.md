# PersonalOS Interfaces — Frozen Contracts

Conventions: TypeScript, Zod-validated at API/registry edges, Prisma models mirror `Task`/`WorkflowStep`/queue columns. Stability per interface: **STABLE** (change needs ADR) or **DRAFT** (may change pre-Phase 1).

## Task + state machine — STABLE

```typescript
type TaskState =
  | 'created' | 'queued' | 'running'
  | 'done' | 'failed' | 'cancelled'
  | 'waiting_for_network'; // STABLE

interface Task { // STABLE
  id: string;
  type: string;               // e.g. 'expense.record' — capability-namespaced
  capability?: string;
  state: TaskState;
  input: unknown;             // Zod-validated per type
  output?: unknown;
  error?: { code: string; retryable: boolean; message: string };
  priority: number;
  notBefore?: string;         // ISO datetime, delayed start
  retryCount: number;
  maxRetries: number;
  lease?: { workerId: string; expiresAt: string } | null;
  requiredCapabilities: string[]; // worker matching, never node identity
  idempotencyKey?: string;
  lastCheckpoint?: unknown;   // semantic catch-up resume point
  createdAt: string; updatedAt: string;
}
// Allowed: created→queued→running→done|failed|cancelled;
// running→queued (retry, retryCount+1); any→cancelled;
// running|queued→waiting_for_network→queued (on network.available).
// Terminal: done/failed (retries exhausted)/cancelled. No other edges.
```

## Workflow step persistence — STABLE

```typescript
interface WorkflowStep { // STABLE
  workflowId: string; stepId: string; seq: number;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  input: unknown; output?: unknown; checkpoint?: unknown;
  retryCount: number; workerId?: string;
  startedAt?: string; endedAt?: string;
  error?: { code: string; retryable: boolean; message: string };
}
```

## ModelProvider + request/response/metadata — STABLE (interface), DRAFT (metadata fields)

```typescript
interface ModelMetadata { // DRAFT
  id: string; provider: string; contextTokens: number;
  modalities: string[]; toolCalling: boolean; structuredOutput: boolean;
  reasoning: boolean; latencyClass: string; costClass: string;
  availability: 'local' | 'cloud'; hwReqs?: string;
}
interface ModelRequest { // STABLE
  modelId?: string; messages: { role: string; content: string }[];
  tools?: unknown[]; schema?: unknown; maxTokens?: number;
}
interface ModelResponse { // STABLE
  text: string; toolCalls?: { name: string; args: unknown }[]; usage?: unknown;
}
interface ModelProvider { // STABLE
  id: string;
  metadata: ModelMetadata;
  generate(request: ModelRequest): Promise<ModelResponse>;
}
```

## Tool + ToolResult — STABLE

```typescript
type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical'; // STABLE
interface Tool { // STABLE
  name: string; description: string;
  inputSchema: unknown;             // Zod/JSON-schema
  requiredPermission: string;       // e.g. 'fs.write', 'email.send'
  risk: RiskLevel;
  execute(input: unknown): Promise<ToolResult>;
}
interface ToolResult { // STABLE
  success: boolean;
  error_code: string | null;        // machine-readable, e.g. 'ENOENT', 'TIMEOUT', 'DENIED'
  retryable: boolean;
  message: string;                  // human-readable, no secrets
  metadata?: Record<string, unknown>;
}
```

## Capability manifest + lifecycle — DRAFT

```typescript
type CapabilityState = // DRAFT
  | 'DISCOVERED' | 'VALIDATING' | 'INSTALLED'
  | 'ENABLED' | 'DISABLED' | 'UPDATED' | 'REMOVED';
interface CapabilityManifest { // DRAFT
  name: string; version: string;
  actions: string[]; entities: string[]; workflows: string[];
  tools: string[]; permissions: string[];
  storageMigrations?: string[]; ui?: unknown; automations?: unknown;
  compat: { runtime: string; models?: string[] };
}
```

## PermissionEngine — STABLE

```typescript
type PermissionVerdict = 'Allowed' | 'Confirm' | 'Denied'; // STABLE
interface PermissionRequest { // STABLE
  tool: string; risk: RiskLevel; capability?: string;
  argsSummary: unknown; actor: 'worker' | 'user' | 'scheduler';
}
interface PermissionEngine { // STABLE
  evaluate(req: PermissionRequest): Promise<PermissionVerdict>;
}
// Defaults: auto (search, read permitted data, PersonalOS-file create/modify/delete-low-risk,
// draft email, financial analysis); ask (user-file modify/delete, mass delete, destructive shell,
// install/sysconfig/shutdown, SEND email, money movement, purchases, account changes).
```

## Worker registration / heartbeat — STABLE

```typescript
interface WorkerRegistration { // STABLE
  id: string; capabilities: string[]; // e.g. ['local_llm','coding'] — never hostnames
  auth: string; endpoint?: string;
}
interface WorkerHeartbeat { // STABLE
  workerId: string; at: string; load?: number; activeTaskIds: string[];
}
// Offline if no heartbeat within timeout → leases reclaimable. No hard-coded identity.
```

## Queue — STABLE

```typescript
interface Queue { // STABLE
  enqueue(task: Pick<Task,'type'|'input'|'priority'> & Partial<Task>): Promise<Task>;
  dequeue(worker: WorkerRegistration): Promise<Task | null>; // SKIP LOCKED + capability match + lease
  complete(taskId: string, output: unknown): Promise<void>;
  fail(taskId: string, error: NonNullable<Task['error']>): Promise<void>; // retry→queued | terminal→failed
  parkWaitingForNetwork(taskId: string, checkpoint?: unknown): Promise<void>;
}
```

## Event envelope — STABLE

```typescript
interface PersonalOSEvent { // STABLE
  channel: string;             // one of ARCHITECTURE.md §6
  id: string; at: string;
  actor?: string; taskId?: string;
  payload: Record<string, unknown>; // IDs + refs only, no large blobs
}
```

## Memory records — DRAFT

```typescript
type MemoryType = // DRAFT
  | 'working' | 'episodic' | 'semantic' | 'user' | 'procedural' | 'task';
interface MemoryRecord { // DRAFT
  id: string; type: MemoryType;
  content: unknown;                 // structured where possible
  relevance: number; importance: number;
  confidence: number; freshness: string; // ISO datetime
  sourceTaskId?: string; expiresAt?: string;
}
// Rules: relevance/importance gate, freshness+confidence decay,
// structured facts stay relational, vector-index only where semantic search helps.
```
