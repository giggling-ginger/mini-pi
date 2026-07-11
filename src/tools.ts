import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

const execFileAsync = promisify(execFile);

const MAX_READ_CHARS = 100_000;
const MAX_BASH_CHARS = 50_000;
const BASH_TIMEOUT_MS = 60_000;

export type ToolResult = {
  ok: boolean;
  output: string;
};

export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a file. Returns contents with line numbers.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relative to workspace or absolute",
          },
          offset: {
            type: "integer",
            description: "1-based start line (optional)",
          },
          limit: {
            type: "integer",
            description: "Max number of lines to return (optional)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write",
      description:
        "Create or overwrite a file with the given content. Creates parent dirs.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to write" },
          content: { type: "string", description: "Full file content" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit",
      description:
        "Replace an exact string in a file. old_string must match exactly once unless replace_all is true.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to edit" },
          old_string: {
            type: "string",
            description: "Exact text to find",
          },
          new_string: {
            type: "string",
            description: "Replacement text",
          },
          replace_all: {
            type: "boolean",
            description: "Replace every occurrence (default false)",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command in the workspace. Returns stdout and stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          timeout_ms: {
            type: "integer",
            description: "Timeout in ms (default 60000)",
          },
        },
        required: ["command"],
      },
    },
  },
];

function resolvePath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return (
    text.slice(0, max) +
    `\n\n...[truncated, ${text.length - max} more chars]`
  );
}

async function toolRead(
  cwd: string,
  args: { path: string; offset?: number; limit?: number },
): Promise<ToolResult> {
  try {
    const full = resolvePath(cwd, args.path);
    const raw = await fs.readFile(full, "utf8");
    const lines = raw.split("\n");
    const offset = Math.max(1, args.offset ?? 1);
    const limit = args.limit ?? lines.length;
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = slice
      .map((line, i) => `${String(offset + i).padStart(6)}|${line}`)
      .join("\n");
    return { ok: true, output: truncate(numbered, MAX_READ_CHARS) };
  } catch (err) {
    return { ok: false, output: errorMessage(err) };
  }
}

async function toolWrite(
  cwd: string,
  args: { path: string; content: string },
): Promise<ToolResult> {
  try {
    const full = resolvePath(cwd, args.path);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, args.content, "utf8");
    return {
      ok: true,
      output: `Wrote ${args.content.length} chars to ${full}`,
    };
  } catch (err) {
    return { ok: false, output: errorMessage(err) };
  }
}

async function toolEdit(
  cwd: string,
  args: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  },
): Promise<ToolResult> {
  try {
    const full = resolvePath(cwd, args.path);
    const content = await fs.readFile(full, "utf8");
    const occurrences = content.split(args.old_string).length - 1;

    if (occurrences === 0) {
      return {
        ok: false,
        output: "old_string not found in file. Read the file and retry with exact text.",
      };
    }
    if (!args.replace_all && occurrences > 1) {
      return {
        ok: false,
        output: `old_string matched ${occurrences} times. Provide more context or set replace_all=true.`,
      };
    }

    const next = args.replace_all
      ? content.split(args.old_string).join(args.new_string)
      : content.replace(args.old_string, args.new_string);

    await fs.writeFile(full, next, "utf8");
    return {
      ok: true,
      output: `Edited ${full} (${args.replace_all ? occurrences : 1} replacement(s))`,
    };
  } catch (err) {
    return { ok: false, output: errorMessage(err) };
  }
}

async function toolBash(
  cwd: string,
  args: { command: string; timeout_ms?: number },
): Promise<ToolResult> {
  try {
    const timeout = args.timeout_ms ?? BASH_TIMEOUT_MS;
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", args.command], {
      cwd,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });
    const out = [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)";
    return { ok: true, output: truncate(out, MAX_BASH_CHARS) };
  } catch (err: unknown) {
    // execFile puts partial output on the error object when non-zero exit
    const e = err as {
      message?: string;
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    if (e.killed) {
      return { ok: false, output: `Command timed out after ${args.timeout_ms ?? BASH_TIMEOUT_MS}ms` };
    }
    const parts = [
      e.stdout,
      e.stderr,
      e.message,
      e.code !== undefined ? `exit code: ${e.code}` : undefined,
    ].filter(Boolean);
    return {
      ok: false,
      output: truncate(parts.join("\n").trim() || "bash failed", MAX_BASH_CHARS),
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function executeTool(
  cwd: string,
  name: string,
  rawArgs: string,
): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    return { ok: false, output: `Invalid JSON arguments: ${rawArgs}` };
  }

  switch (name) {
    case "read":
      return toolRead(cwd, args as { path: string; offset?: number; limit?: number });
    case "write":
      return toolWrite(cwd, args as { path: string; content: string });
    case "edit":
      return toolEdit(
        cwd,
        args as {
          path: string;
          old_string: string;
          new_string: string;
          replace_all?: boolean;
        },
      );
    case "bash":
      return toolBash(cwd, args as { command: string; timeout_ms?: number });
    default:
      return { ok: false, output: `Unknown tool: ${name}` };
  }
}
