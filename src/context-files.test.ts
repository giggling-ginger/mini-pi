/**
 * Context-file discovery smoke tests — no LLM required.
 * Run: npx tsx src/context-files.test.ts
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatContextBlock,
  loadContextFiles,
  MAX_CONTEXT_CHARS,
} from "./context-files.js";
import { buildSystemPrompt } from "./system.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const root = path.join(os.tmpdir(), `mini-pi-ctx-${Date.now()}`);
const nested = path.join(root, "packages", "app");

try {
  mkdirSync(nested, { recursive: true });
  // fake git root
  mkdirSync(path.join(root, ".git"));

  writeFileSync(path.join(root, "AGENTS.md"), "# Root rules\nUse pnpm.\n");
  writeFileSync(
    path.join(nested, "AGENTS.md"),
    "# Package rules\nPrefer vitest.\n",
  );
  // CLAUDE.md next to AGENTS should be ignored in that dir
  writeFileSync(path.join(root, "CLAUDE.md"), "should not load at root");

  const files = loadContextFiles({ cwd: nested, stopAt: root });
  assert(files.length === 2, `expected 2 files, got ${files.length}`);
  assert(files[0].content.includes("pnpm"), "outer first");
  assert(files[1].content.includes("vitest"), "inner last (more specific)");
  assert(files[0].name === "AGENTS.md", "AGENTS wins over CLAUDE at root");

  const block = formatContextBlock(files);
  assert(block.includes("Project instructions"), "block header");
  assert(block.includes("pnpm") && block.includes("vitest"), "both bodies");

  const { prompt, contextFiles } = buildSystemPrompt(nested, { stopAt: root });
  assert(prompt.includes("four tools"), "base prompt");
  assert(prompt.includes("pnpm"), "context injected");
  assert(contextFiles.length === 2, "returned files");

  // disabled
  const empty = loadContextFiles({ cwd: nested, disabled: true });
  assert(empty.length === 0, "disabled");

  // truncation budget
  const big = "x".repeat(MAX_CONTEXT_CHARS + 500);
  writeFileSync(path.join(root, "AGENTS.md"), big);
  const clipped = loadContextFiles({
    cwd: root,
    stopAt: root,
    maxChars: 1000,
  });
  assert(clipped.length === 1, "one file");
  assert(clipped[0].chars <= 1000 + 80, "clipped under budget");
  assert(clipped[0].content.includes("truncated"), "truncation marker");

  console.log("All context-files smoke tests passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
