import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

type Db = PrismaClient | Prisma.TransactionClient;

const RecordSchema = z.object({
  account: z.string().min(1),
  amountPaise: z.number().int().positive(),
  currency: z.string().default("INR"),
  category: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

export type RecordInput = z.input<typeof RecordSchema>;

export interface AccountSummary {
  account: string;
  balancePaise: number;
  currency: string;
}

export interface FinanceSummary {
  accounts: AccountSummary[];
  netWorthPaise: number;
  monthSpendPaise: number;
  month: string;
}

// Money math is integer-only and lives HERE (spec §29): the LLM explains
// these numbers, it never computes them. Paise in, paise out, no floats.
export class FinanceStore {
  constructor(private readonly db: Db) {}

  async createAccount(name: string, type = "cash"): Promise<{ id: string; name: string }> {
    const row = await this.db.account.create({ data: { name, type } });
    return { id: row.id, name: row.name };
  }

  async record(kind: "expense" | "income", raw: RecordInput): Promise<{ id: string; balancePaise: number }> {
    const input = RecordSchema.parse(raw);
    const account = await this.db.account.findFirst({ where: { name: input.account } });
    if (account === null) throw new Error(`unknown account ${input.account}`);
    const row = await this.db.transaction.create({
      data: {
        accountId: account.id,
        kind,
        amountPaise: input.amountPaise,
        currency: input.currency,
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}),
      },
    });
    return { id: row.id, balancePaise: await this.balance(account.id) };
  }

  async balance(accountId: string, db: Db = this.db): Promise<number> {
    const rows = await db.transaction.findMany({ where: { accountId }, select: { kind: true, amountPaise: true } });
    return rows.reduce((sum, r) => sum + (r.kind === "income" ? r.amountPaise : -r.amountPaise), 0);
  }

  async summary(now: Date = new Date()): Promise<FinanceSummary> {
    const accounts = await this.db.account.findMany({ orderBy: { name: "asc" } });
    const balances = await Promise.all(
      accounts.map(async (a) => ({
        account: a.name,
        balancePaise: await this.balance(a.id),
        currency: a.currency,
      })),
    );
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const spent = await this.db.transaction.aggregate({
      where: { kind: "expense", occurredAt: { gte: monthStart } },
      _sum: { amountPaise: true },
    });
    return {
      accounts: balances,
      netWorthPaise: balances.reduce((s, b) => s + b.balancePaise, 0),
      monthSpendPaise: spent._sum.amountPaise ?? 0,
      month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    };
  }
}

export function formatINR(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  return `${sign}₹${rupees}.${String(p).padStart(2, "0")}`;
}
