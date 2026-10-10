import type { ModelProvider } from "@personalos/contracts";
import { extractJson } from "./planner.js";
import { z } from "zod";

export interface ChatTool {
  name: string;
  description: string;
  inputSchema: unknown;
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
  z.object({ answer: z.string().min(1) }),
  z.object({ askUser: z.string().min(1) }),
]);

const StepSchema = z.object({ thought: z.string().min(1).max(1000), action: ActionSchema });

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
}): Promise<ChatOutcome> {
  const maxSteps = opts.maxSteps ?? 6;
  const steps: ChatStep[] = [];
  const approvals: string[] = [];
  // Names + one-liners only: full input schemas would triple the prompt and
  // OOM this laptop's CPU inference. Wrong inputs come back as observations
  // (BAD_INPUT) and the loop self-corrects — cheaper than a giant prompt.
  const catalog = opts.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  const history = opts.history
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
    .join("\n");

  for (let i = 0; i < maxSteps; i++) {
    const transcript = steps
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
Rules: one tool per step. Chain results (use ids/outputs from earlier steps). "answer" ends the turn with the final message to the user. "askUser" only when truly blocked. Prior conversation:
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
      break;
    }
    let step: z.infer<typeof StepSchema>;
    try {
      step = StepSchema.parse(JSON.parse(candidate) as unknown);
    } catch {
      steps.push({ thought: "(invalid step)", action: { answer: "" }, observation: `rejected: ${candidate.slice(0, 200)}` });
      break;
    }
    const action = step.action;
    if ("answer" in action) {
      steps.push({ ...step, observation: "(final)" });
      return { answer: action.answer, steps, approvals, toolCalls: steps.filter((s) => "tool" in s.action).length };
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
  return { answer: "I ran out of steps before finishing — tell me to continue or simplify.", steps, approvals, toolCalls: steps.filter((s) => "tool" in s.action).length };
}
