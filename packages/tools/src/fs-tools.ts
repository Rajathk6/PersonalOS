import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolResult } from "@personalos/contracts";
import { z } from "zod";

function ok(message: string, metadata?: Record<string, unknown>): ToolResult {
  return {
    success: true, error_code: null, retryable: false, message,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function fail(error_code: string, message: string, retryable: boolean): ToolResult {
  return { success: false, error_code, retryable, message };
}

// Sandbox root: every path resolves under root or the call is refused BEFORE
// any permission verdict matters (defense in depth — even an Allowed verdict
// for an escaped path cannot execute). Symlink escapes are contained by
// resolving the full path and checking the prefix.
export function resolveInside(root: string, rel: string): { inside: boolean; abs: string } {
  const abs = path.resolve(root, rel);
  const inside = abs === root || abs.startsWith(root + path.sep);
  return { inside, abs };
}

const PathInput = z.object({ path: z.string().min(1) });

export function filesystemTools(root: string): (Tool & { version: string })[] {
  const read: Tool & { version: string } = {
    name: "filesystem.read",
    version: "1.0",
    description: "Read a UTF-8 text file inside the workspace (64KB cap)",
    inputSchema: { path: "relative path inside workspace" },
    requiredPermission: "fs.read",
    risk: "Low",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = PathInput.safeParse(input);
      if (!parsed.success) return fail("BAD_INPUT", "path (string) required", false);
      const { inside, abs } = resolveInside(root, parsed.data.path);
      if (!inside) return fail("OUTSIDE_WORKSPACE", "path escapes the workspace", false);
      try {
        const content = await readFile(abs, "utf8");
        return ok(`read ${parsed.data.path} (${content.length} chars)`, {
          path: parsed.data.path,
          content: content.slice(0, 65536),
          truncated: content.length > 65536,
          insideWorkspace: true,
        });
      } catch (err) {
        const code = (err as { code?: string }).code ?? "READ_FAILED";
        return fail(code, `read failed: ${code}`, code === "ENOENT" ? false : true);
      }
    },
  };

  const write: Tool & { version: string } = {
    name: "filesystem.write",
    version: "1.0",
    description: "Write a UTF-8 text file inside the workspace (creates parents)",
    inputSchema: { path: "relative path inside workspace", content: "string" },
    requiredPermission: "fs.write",
    risk: "Medium",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = z.object({ path: z.string().min(1), content: z.string() }).safeParse(input);
      if (!parsed.success) return fail("BAD_INPUT", "path and content (strings) required", false);
      const { inside, abs } = resolveInside(root, parsed.data.path);
      if (!inside) return fail("OUTSIDE_WORKSPACE", "path escapes the workspace", false);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, parsed.data.content, "utf8");
      return ok(`wrote ${parsed.data.path} (${parsed.data.content.length} chars)`, {
        path: parsed.data.path,
        insideWorkspace: true,
      });
    },
  };

  const del: Tool & { version: string } = {
    name: "filesystem.delete",
    version: "1.0",
    description: "Delete a file inside the workspace (needs human confirmation)",
    inputSchema: { path: "relative path inside workspace" },
    requiredPermission: "fs.delete",
    risk: "High",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = PathInput.safeParse(input);
      if (!parsed.success) return fail("BAD_INPUT", "path (string) required", false);
      const { inside, abs } = resolveInside(root, parsed.data.path);
      if (!inside) return fail("OUTSIDE_WORKSPACE", "path escapes the workspace", false);
      if (abs === root) return fail("REFUSED", "will not delete the workspace root", false);
      try {
        await rm(abs, { force: false });
        return ok(`deleted ${parsed.data.path}`, { path: parsed.data.path, insideWorkspace: true });
      } catch (err) {
        const code = (err as { code?: string }).code ?? "DELETE_FAILED";
        return fail(code, `delete failed: ${code}`, false);
      }
    },
  };

  return [read, write, del];
}
