import type { NextFunction, Request, Response } from "express";
import express from "express";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const version = "0.0.0";
const app = express();

app.use(express.json({ limit: "100kb" }));

app.use((req: Request, _res: Response, next: NextFunction): void => {
  logger.info({ method: req.method, url: req.url }, "request");
  next();
});

app.use(auth);

app.get("/health", (_req: Request, res: Response): void => {
  res.json({
    status: "ok",
    db: "not-wired",
    queue: "not-wired",
    scheduler: "not-wired",
    version,
  });
});

app.use((_req: Request, res: Response): void => {
  res.status(404).json({ error: "not-found" });
});

// Four-arg handler so Express treats it as an error boundary.
app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4 args to route errors here.
  (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "internal-error" });
  },
);

app.listen(config.port, (): void => {
  logger.info({ port: config.port }, "API listening");
});
