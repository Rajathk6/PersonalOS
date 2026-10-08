import pino from "pino";
import { config } from "./config.js";

// Pretty transport is dev-only so production logs stay JSON-parseable.
export const logger: pino.Logger = pino({
  level: config.logLevel,
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

export function child(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
