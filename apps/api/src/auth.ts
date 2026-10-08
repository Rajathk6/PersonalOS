import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

export function auth(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/health") {
    next();
    return;
  }
  const header = req.headers.authorization;
  // TODO: constant-time compare once a timing-safe helper is available.
  if (header !== `Bearer ${config.apiToken}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
