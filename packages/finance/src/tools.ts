import type { Tool, ToolResult } from "@personalos/contracts";
import { z } from "zod";
import type { FinanceStore } from "./store.js";
import { formatINR } from "./store.js";

const MoneyInput = z.object({
  account: z.string().min(1),
  amountPaise: z.number().int().positive(),
  category: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

// Capability tools: the ONLY way anyone (handlers, future planner, API)
// touches money. Recording is Automatic (analysis-grade, reversible);
// movement of money doesn't exist yet — when it does, it defaults Confirm.
export function financeTools(store: FinanceStore): (Tool & { version: string })[] {
  const recordExpense: Tool & { version: string } = {
    name: "finance.record_expense",
    version: "1.0",
    description: "Record an expense against an account (amount in paise)",
    inputSchema: { account: "account name", amountPaise: "positive integer paise", category: "?", note: "?" },
    requiredPermission: "finance.write",
    risk: "Low",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = MoneyInput.safeParse(input);
      if (!parsed.success) {
        return { success: false, error_code: "BAD_INPUT", retryable: false, message: "account + positive amountPaise required" };
      }
      try {
        const { balancePaise } = await store.record("expense", parsed.data);
        return {
          success: true, error_code: null, retryable: false,
          message: `recorded ${formatINR(parsed.data.amountPaise)} expense; balance ${formatINR(balancePaise)}`,
          metadata: { balancePaise },
        };
      } catch (err) {
        return { success: false, error_code: "RECORD_FAILED", retryable: false, message: err instanceof Error ? err.message : "record failed" };
      }
    },
  };

  const recordIncome: Tool & { version: string } = {
    name: "finance.record_income",
    version: "1.0",
    description: "Record income against an account (amount in paise)",
    inputSchema: { account: "account name", amountPaise: "positive integer paise", category: "?", note: "?" },
    requiredPermission: "finance.write",
    risk: "Low",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = MoneyInput.safeParse(input);
      if (!parsed.success) {
        return { success: false, error_code: "BAD_INPUT", retryable: false, message: "account + positive amountPaise required" };
      }
      try {
        const { balancePaise } = await store.record("income", parsed.data);
        return {
          success: true, error_code: null, retryable: false,
          message: `recorded ${formatINR(parsed.data.amountPaise)} income; balance ${formatINR(balancePaise)}`,
          metadata: { balancePaise },
        };
      } catch (err) {
        return { success: false, error_code: "RECORD_FAILED", retryable: false, message: err instanceof Error ? err.message : "record failed" };
      }
    },
  };

  const summary: Tool & { version: string } = {
    name: "finance.summary",
    version: "1.0",
    description: "Deterministic balances, net worth, and month spend (paise)",
    inputSchema: {},
    requiredPermission: "finance.read",
    risk: "Low",
    execute: async (): Promise<ToolResult> => {
      const s = await store.summary();
      const lines = s.accounts.map((a) => `${a.account}: ${formatINR(a.balancePaise)}`).join(", ");
      return {
        success: true, error_code: null, retryable: false,
        message: `net worth ${formatINR(s.netWorthPaise)}; month spend ${formatINR(s.monthSpendPaise)} (${lines})`,
        metadata: { summary: s },
      };
    },
  };

  return [recordExpense, recordIncome, summary];
}
