import type { CapabilityManifest } from "@personalos/contracts";

// First vertical through the capability door. Budgets/loans/assets arrive as
// manifest v1.x additions with their own migrations — never a Core change.
export const financeManifest: CapabilityManifest = {
  name: "finance",
  version: "1.0.0",
  actions: ["account.create", "expense.record", "income.record", "summary"],
  entities: ["account", "transaction"],
  workflows: [],
  tools: ["finance.record_expense", "finance.record_income", "finance.summary"],
  permissions: ["finance.read", "finance.write"],
  compat: { runtime: "personalos/0" },
};
