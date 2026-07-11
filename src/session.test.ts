/**
 * Session smoke test — no LLM required.
 * Run: npx tsx src/session.test.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Session, listSessions, latestSession } from "./session.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(path.join(os.tmpdir(), "mini-pi-sess-"));
const cwd = "/tmp/project";

try {
  const s1 = Session.create({
    sessionDir: dir,
    cwd,
    model: "test-model",
    provider: "test",
  });
  assert(s1.history.length === 0, "empty at start");

  s1.syncFromHistory([
    { role: "user", content: "create hello.ts please" },
    {
      role: "assistant",
      content: "ok",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "write", arguments: '{"path":"hello.ts"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "Wrote file" },
    { role: "assistant", content: "done" },
  ]);

  assert(s1.history.length === 4, `expected 4 msgs, got ${s1.history.length}`);
  assert(s1.title.startsWith("create hello"), `title=${s1.title}`);

  // reload
  const s2 = Session.load(s1.path);
  assert(s2.history.length === 4, "reload message count");
  assert(s2.history[0].role === "user", "first is user");
  assert(s2.history[2].role === "tool", "tool message preserved");
  assert(s2.id === s1.id, "same id");

  // second turn append
  s2.syncFromHistory([
    ...s2.history,
    { role: "user", content: "add a test" },
    { role: "assistant", content: "added" },
  ]);
  assert(s2.history.length === 6, "appended two more");

  const s3 = Session.load(s2.path);
  assert(s3.history.length === 6, "reload after append");

  // another session + latest
  const sOther = Session.create({ sessionDir: dir, cwd, model: "x", provider: "y" });
  sOther.syncFromHistory([{ role: "user", content: "newer" }]);

  const list = listSessions(dir);
  assert(list.length === 2, `list len ${list.length}`);
  const latest = latestSession(dir);
  assert(latest?.id === sOther.id, "latest should be newest");

  console.log("All session smoke tests passed.");
  console.log("  sample file:", s1.path);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
