import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Filenames we look for, in priority order within a single directory. */
export const CONTEXT_FILENAMES = ["AGENTS.md", "CLAUDE.md", "AGENT.md"] as const;

/** Soft cap so one huge AGENTS.md cannot blow the whole context window. */
export const MAX_CONTEXT_CHARS = 32_000;

export type ContextFile = {
  /** Absolute path */
  path: string;
  /** Path relative to cwd when possible */
  displayPath: string;
  /** Basename (AGENTS.md / CLAUDE.md / …) */
  name: string;
  content: string;
  chars: number;
};

export type LoadContextOptions = {
  cwd: string;
  /**
   * Walk from cwd toward filesystem root collecting files.
   * Default true — nested packages can have their own AGENTS.md;
   * nearer files are listed *after* outer ones so they win when read top-to-bottom
   * by the model as “more specific”.
   */
  walkUp?: boolean;
  /** Stop walking at this directory (inclusive). Default: git root or cwd. */
  stopAt?: string;
  maxChars?: number;
  /** Disable discovery entirely. */
  disabled?: boolean;
};

/**
 * Discover project instruction files (AGENTS.md convention).
 *
 * Walk order: outermost → cwd (so the closest file is last / most specific).
 * Within one directory only the first matching name is taken (AGENTS.md wins).
 */
export function loadContextFiles(opts: LoadContextOptions): ContextFile[] {
  if (opts.disabled) return [];

  const cwd = path.resolve(opts.cwd);
  const maxChars = opts.maxChars ?? MAX_CONTEXT_CHARS;
  const walkUp = opts.walkUp !== false;
  const stopAt = path.resolve(opts.stopAt ?? findStopDir(cwd));

  const dirs = walkUp ? collectDirs(cwd, stopAt) : [cwd];
  // dirs are cwd → parent → … → stop; reverse so root/outer first
  dirs.reverse();

  const found: ContextFile[] = [];
  let used = 0;

  for (const dir of dirs) {
    for (const name of CONTEXT_FILENAMES) {
      const full = path.join(dir, name);
      if (!existsSync(full) || !statSync(full).isFile()) continue;

      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      content = content.replace(/\r\n/g, "\n").trim();
      if (!content) break; // empty file — still stop other names in this dir

      const remaining = maxChars - used;
      if (remaining <= 0) return found;

      let clipped = content;
      let truncated = false;
      if (clipped.length > remaining) {
        clipped = clipped.slice(0, remaining) + "\n\n…[truncated by mini-pi context budget]";
        truncated = true;
      }

      found.push({
        path: full,
        displayPath: relDisplay(cwd, full),
        name,
        content: clipped,
        chars: clipped.length,
      });
      used += clipped.length;

      if (truncated) return found;
      break; // one context file per directory
    }
  }

  return found;
}

/**
 * Format files into a block appended to the system prompt.
 */
export function formatContextBlock(files: ContextFile[]): string {
  if (files.length === 0) return "";
  const parts = files.map((f) => {
    return `### ${f.displayPath}\n\n${f.content}`;
  });
  return (
    "\n\n# Project instructions\n" +
    "The following files were found in the workspace. Follow them when relevant.\n\n" +
    parts.join("\n\n---\n\n")
  );
}

/** cwd → parent → … → stopAt (or filesystem root), nearest first. */
function collectDirs(cwd: string, stopAt: string): string[] {
  const out: string[] = [];
  let dir = path.resolve(cwd);
  const stop = path.resolve(stopAt);
  const root = path.parse(dir).root;

  while (out.length < 32) {
    out.push(dir);
    if (dir === stop || dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

/** Prefer git root; else cwd. */
export function findStopDir(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

function relDisplay(cwd: string, full: string): string {
  const rel = path.relative(cwd, full);
  if (!rel || rel.startsWith("..")) return full;
  return rel;
}
