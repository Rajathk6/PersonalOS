import type { ModelProvider } from "@personalos/contracts";
import { extractJson } from "./planner.js";
import { z } from "zod";

export interface ChatTool {
  name: string;
  description: string;
  inputSchema: unknown;
  /** Compact arg spec for the prompt, e.g. "url, text" — full schemas are too big. */
  argsHint: string;
}

export interface ChatStep {
  thought: string;
  action: { tool: string; input?: unknown } | { answer: string } | { askUser: string };
  observation?: string;
}

export interface ChatOutcome {
  answer: string;
  steps: ChatStep[];
  approvals: string[];
  toolCalls: number;
}

const ActionSchema = z.union([
  z.object({ tool: z.string().min(1), input: z.unknown() }),
  // OpenAI-style: {"tool": "...", "args": {...}} — stronger models reach for
  // this habit, and refusing it wastes a whole step.
  z.object({ tool: z.string().min(1), args: z.unknown() }),
  z.object({ name: z.string().min(1), arguments: z.unknown() }),
  z.object({ answer: z.string().min(1) }),
  z.object({ askUser: z.string().min(1) }),
  // A bare tool call at the top level.
  z.object({ tool: z.string().min(1), thought: z.string().optional() }),
]);

function normalizeAction(action: unknown): { tool: string; input: unknown } | { answer: string } | { askUser: string } | null {
  const parsed = ActionSchema.safeParse(action);
  if (!parsed.success) return null;
  const a = parsed.data as Record<string, unknown>;
  if (typeof a["answer"] === "string") return { answer: a["answer"] };
  if (typeof a["askUser"] === "string") return { askUser: a["askUser"] };
  const tool = a["tool"] ?? a["name"];
  if (typeof tool !== "string") return null;
  const input = a["input"] ?? a["args"] ?? a["arguments"] ?? {};
  return { tool, input };
}

// The orchestrator loop (spec §4, NORTH_STAR "feel simple"): one conversation,
// many capabilities. The model reasons in small ReAct steps — think, act
// through ONE tool, read the result, repeat — instead of filling forms.
// Weak-model discipline: tiny prompts, strict JSON, max 6 steps, tool results
// truncated. Confirm-gated tools return approvalIds; the loop NEVER approves
// on the user's behalf — it stops and asks inside the chat.
export async function runChatLoop(opts: {
  model: ModelProvider;
  modelId: string;
  goal: string;
  history: { role: string; content: string }[];
  tools: ChatTool[];
  execute: (tool: string, input: unknown) => Promise<{
    success: boolean;
    message: string;
    approvalId?: string;
    needsApproval?: boolean;
  }>;
  maxSteps?: number;
  budgetMs?: number;
}): Promise<ChatOutcome> {
  const maxSteps = opts.maxSteps ?? 3;
  // Wall-clock budget for the whole turn. Free-tier models queue, so a turn
  // must never wander for minutes: when the budget runs out we answer with
  // what we already know instead of hanging.
  const budgetMs = opts.budgetMs ?? 30000;
  const startedAt = Date.now();
  const steps: ChatStep[] = [];
  const approvals: string[] = [];
  // Names + a COMPACT arg spec. Full JSON schemas tripled the prompt (and
  // OOM'd the small local model); one short line per tool is enough for the
  // model to call it correctly.
  const catalog = opts.tools.map((t) => `- ${t.name}(${t.argsHint}) — ${t.description}`).join("\n");
  const history = opts.history
    .slice(-4)
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n");

  for (let i = 0; i < maxSteps; i++) {
    if (Date.now() - startedAt > budgetMs) {
      return {
        answer: lastUsefulAnswer(steps),
        steps,
        approvals,
        toolCalls: steps.filter((s) => "tool" in s.action).length,
      };
    }
    const transcript = steps
      .slice(-2)
      .map((s, n) => `step${n + 1} thought: ${s.thought}\nstep${n + 1} result: ${s.observation ?? "(none)"}`)
      .join("\n");
    const res = await opts.model.generate({
      modelId: opts.modelId,
      maxTokens: 300,
      messages: [
        {
          role: "system",
          content: `You are PersonalOS, a personal assistant that DOES things with tools. Reply with ONLY this JSON, no other words:
{"thought":"...","action":{"tool":"...","input":{...}}}
Or finish: {"thought":"...","action":{"answer":"..."}}
Or ask the user: {"thought":"...","action":{"askUser":"..."}}
TOOLS:
${catalog}
RULES:
- If the message needs no tool (greetings, thanks, questions you can answer), reply with {"thought":"...","action":{"answer":"..."}} IMMEDIATELY. Never call a tool just to look busy.
- Call ONE tool per step. Use the exact arg names shown above.
- A link in the message: read it with page.read(url) before answering about it.
- Chain results: use ids/outputs from earlier steps.
- "answer" ends the turn with the final message to the user. "askUser" only when truly blocked.
Prior conversation:
${history || "(none)"}
So far this turn:
${transcript || "(first step)"}
User goal: ${opts.goal}`,
        },
      ],
    });
    const candidate = extractJson(res.text);
    if (candidate === null) {
      steps.push({ thought: "(unparseable reply)", action: { answer: "" }, observation: "model reply had no JSON" });
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(candidate) as unknown;
    } catch {
      steps.push({ thought: "(invalid JSON)", action: { answer: "" }, observation: `rejected: ${candidate.slice(0, 200)}` });
      continue;
    }
    const rawRecord = (raw ?? {}) as Record<string, unknown>;
    const stepThought = typeof rawRecord["thought"] === "string" ? rawRecord["thought"] : "";
    const action = normalizeAction(rawRecord["action"] ?? raw);
    if (action === null) {
      steps.push({
        thought: stepThought || "(invalid step)",
        action: { answer: "" },
        observation: `rejected: ${candidate.slice(0, 200)}`,
      });
      continue;
    }
    const step = { thought: stepThought || "(no thought)", action } as ChatStep;
    if ("answer" in action) {
      const finalAnswer = action.answer.trim() === ""
        ? (step.thought.trim() === "" ? "Done." : step.thought)
        : action.answer;
      steps.push({ ...step, observation: "(final)" });
      return { answer: finalAnswer, steps, approvals, toolCalls: steps.filter((s) => "tool" in s.action).length };
    }
    if ("askUser" in action) {
      steps.push({ ...step, observation: "(waiting on user)" });
      return { answer: action.askUser, steps, approvals, toolCalls: steps.filter((s) => "tool" in s.action).length };
    }
    // Tool call: unknown tools and denials become observations, never crashes.
    // Approval-gated tools park: the turn ends WITH the question to the user.
    const known = opts.tools.some((t) => t.name === action.tool);
    if (!known) {
      steps.push({ ...step, observation: `unknown tool ${action.tool}; available: ${opts.tools.map((t) => t.name).join(", ")}` });
      continue;
    }
    const result = await opts.execute(action.tool, action.input);
    if (result.needsApproval && result.approvalId) {
      approvals.push(result.approvalId);
      steps.push({ ...step, observation: `needs human approval (${result.approvalId})` });
      return {
        answer: `I need your approval to continue: ${result.message}. Approve it and tell me to go on.`,
        steps,
        approvals,
        toolCalls: steps.filter((s) => "tool" in s.action).length,
      };
    }
    steps.push({ ...step, observation: `${result.success ? "ok" : "FAILED"}: ${result.message.slice(0, 500)}` });
    if (!result.success && steps.filter((s) => (s.observation ?? "").startsWith("FAILED")).length >= 2) {
      return { answer: `I tried but kept failing: ${result.message}. Tell me how to proceed.`, steps, approvals, toolCalls: steps.filter((s) => "tool" in s.action).length };
    }
  }
  return {
    answer: lastUsefulAnswer(steps),
    steps,
    approvals,
    toolCalls: steps.filter((s) => "tool" in s.action).length,
  };
}

// When the loop ends without a final answer, the last tool result is still
// worth saying out loud. "I ran out of steps" is a dead end for the user;
// the actual finding is the answer.
function lastUsefulAnswer(steps: ChatStep[]): string {
  const withObservation = [...steps].reverse().find((s) => {
    const o = s.observation ?? "";
    return o !== "" && o !== "(final)" && o !== "(waiting on user)" && !o.startsWith("rejected");
  });
  const obs = withObservation?.observation ?? "";
  if (obs === "") return "I couldn't finish that in time — try a simpler version of the request.";
  return `Here's what I found: ${obs.slice(0, 900)}`;
}
