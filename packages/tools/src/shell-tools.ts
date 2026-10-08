import { execFile } from "node:child_process";
import type { Tool, ToolResult } from "@personalos/contracts";
import { z } from "zod";
import { isDestructiveCommand } from "./policy.js";

const ShellInput = z.object({ command: z.string().min(1).max(4000) });

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`.slice(0, 8192);
      if (err && "killed" in err && (err as { killed: boolean }).killed) {
        resolve({ code: 124, out: `${out}\n[timed out after ${timeoutMs}ms]` });
        return;
      }
      resolve({ code: (err as { code?: number })?.code ?? 0, out });
    });
  });
}

export function shellTools(workspaceDir: string): (Tool & { version: string })[] {
  const execute: Tool & { version: string } = {
    name: "shell.execute",
    version: "1.0",
    description: "Run a shell command in the workspace (denylist enforced, 60s cap, policy Confirm by default)",
    inputSchema: { command: "shell command string" },
    requiredPermission: "shell.execute",
    risk: "High",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = ShellInput.safeParse(input);
      if (!parsed.success) {
        return { success: false, error_code: "BAD_INPUT", retryable: false, message: "command (string) required" };
      }
      // Belt and suspenders: the executor's permission verdict gates first,
      // but the tool itself refuses denylisted commands even if misconfigured.
      if (isDestructiveCommand(parsed.data.command)) {
        return { success: false, error_code: "DENIED", retryable: false, message: "refused by destructive-command denylist" };
      }
      // No raw shell: commands run via sh -c in a fixed cwd with no inherited
      // authority beyond the process user. Full sandboxing (containers/users)
      // arrives with Phase 8 multi-node hardening.
      const { code, out } = await run("sh", ["-c", parsed.data.command], workspaceDir, 60000);
      return {
        success: code === 0, error_code: code === 0 ? null : `EXIT_${code}`, retryable: false,
        message: code === 0 ? "command succeeded" : `command exited ${code}`,
        metadata: { output: out },
      };
    },
  };
  return [execute];
}

export function gitTools(repoDir: string): (Tool & { version: string })[] {
  const status: Tool & { version: string } = {
    name: "git.status",
    version: "1.0",
    description: "Read-only git status of the workspace repo",
    inputSchema: {},
    requiredPermission: "git.read",
    risk: "Low",
    execute: async (): Promise<ToolResult> => {
      const { code, out } = await run("git", ["status", "--short", "--branch"], repoDir, 15000);
      return {
        success: code === 0, error_code: code === 0 ? null : "GIT_FAILED", retryable: false,
        message: code === 0 ? "git status ok" : "git status failed",
        metadata: { output: out },
      };
    },
  };
  const log: Tool & { version: string } = {
    name: "git.log",
    version: "1.0",
    description: "Read-only recent commit history (last 10)",
    inputSchema: {},
    requiredPermission: "git.read",
    risk: "Low",
    execute: async (): Promise<ToolResult> => {
      const { code, out } = await run("git", ["log", "--oneline", "-10"], repoDir, 15000);
      return {
        success: code === 0, error_code: code === 0 ? null : "GIT_FAILED", retryable: false,
        message: code === 0 ? "git log ok" : "git log failed",
        metadata: { output: out },
      };
    },
  };
  return [status, log];
}
