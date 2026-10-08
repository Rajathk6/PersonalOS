import { PrismaClient } from "@prisma/client";

// One client per process. Core never imports apps/* for config — the database
// URL is injected, so workers/APIs/schedulers can each own startup.
let client: PrismaClient | null = null;

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}

export function getPrisma(): PrismaClient {
  if (client !== null) return client;
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set; export it or pass a client explicitly");
  }
  client = createPrisma(url);
  return client;
}
