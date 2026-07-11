/**
 * Smoke tests for tools — no LLM required.
 * Run: npx tsx src/tools.test.ts
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool } from "./tools.js";

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mini-pi-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

await withTempDir(async (cwd) => {
  // write
  let r = await executeTool(
    cwd,
    "write",
    JSON.stringify({ path: "a.txt", content: "hello\nworld\n" }),
  );
  assert(r.ok, `write failed: ${r.output}`);

  // read
  r = await executeTool(cwd, "read", JSON.stringify({ path: "a.txt" }));
  assert(r.ok, `read failed: ${r.output}`);
  assert(r.output.includes("hello"), "read should contain hello");

  // edit
  r = await executeTool(
    cwd,
    "edit",
    JSON.stringify({
      path: "a.txt",
      old_string: "world",
      new_string: "mini-pi",
    }),
  );
  assert(r.ok, `edit failed: ${r.output}`);

  const text = await fs.readFile(path.join(cwd, "a.txt"), "utf8");
  assert(text === "hello\nmini-pi\n", `unexpected content: ${JSON.stringify(text)}`);

  // bash
  r = await executeTool(
    cwd,
    "bash",
    JSON.stringify({ command: "echo hi && ls a.txt" }),
  );
  assert(r.ok, `bash failed: ${r.output}`);
  assert(r.output.includes("hi"), "bash should print hi");
  assert(r.output.includes("a.txt"), "bash should list a.txt");

  // edit not found
  r = await executeTool(
    cwd,
    "edit",
    JSON.stringify({
      path: "a.txt",
      old_string: "DOES_NOT_EXIST",
      new_string: "x",
    }),
  );
  assert(!r.ok, "edit should fail when old_string missing");

  console.log("All tool smoke tests passed.");
});
