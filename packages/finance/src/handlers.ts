import type { Task } from "@personalos/contracts";
import type { TaskHandler } from "@personalos/core";
import type { ToolExecutor } from "@personalos/tools";

// Task types are thin shells over capability tools: permission evaluation,
// audit, and recording all happen inside the executor. The handler only maps
// task input to tool input and returns the tool's message as output.
export function financeHandlers(executor: ToolExecutor): Map<string, TaskHandler> {
  const run = (tool: string): TaskHandler => async (task: Task) => {
    const result = await executor.execute(tool, task.input, "worker", { taskId: task.id, capability: "finance" });
    if (!result.success) {
      throw Object.assign(new Error(result.message), { code: result.error_code ?? "FINANCE_FAILED" });
    }
    return { message: result.message, balancePaise: (result.metadata as { balancePaise?: number } | undefined)?.balancePaise };
  };
  return new Map([
    ["finance.record_expense", run("finance.record_expense")],
    ["finance.record_income", run("finance.record_income")],
  ]);
}
