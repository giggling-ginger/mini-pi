/**
 * Compaction smoke tests — no LLM required (localOnly).
 * Run: npx tsx src/compact.test.ts
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  estimateTokens,
  localSummary,
  maybeCompact,
  splitOldRecent,
} from "./compact.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function user(content: string): ChatCompletionMessageParam {
  return { role: "user", content };
}
function assistant(content: string): ChatCompletionMessageParam {
  return { role: "assistant", content };
}

// Build a long-ish history
const history: ChatCompletionMessageParam[] = [];
for (let i = 0; i < 20; i++) {
  history.push(user(`Task step ${i}: please do something with file_${i}.ts and explain`));
  history.push(
    assistant(
      `I edited file_${i}.ts and ran tests. Details: ${"x".repeat(200)}`,
    ),
  );
}

const before = estimateTokens(history);
assert(before > 100, `expected substantial tokens, got ${before}`);

const { old, recent } = splitOldRecent(history, 500);
assert(old.length > 0, "old non-empty");
assert(recent.length > 0, "recent non-empty");
assert(old.length + recent.length === history.length, "partition");
assert(recent[0].role === "user", "recent starts at user");

const summary = localSummary(old);
assert(summary.includes("User:"), "local summary has users");
assert(summary.includes("Assistant:"), "local summary has assistants");

const result = await maybeCompact(null, "dummy", history, {
  force: true,
  localOnly: true,
  keepRecent: 500,
});
assert(result.compacted, "should compact");
assert(result.afterTokens < result.beforeTokens, "smaller after");
assert(result.history.length < history.length, "fewer messages");
assert(
  typeof result.history[0].content === "string" &&
    result.history[0].content.includes("Conversation summary"),
  "summary user message",
);
assert(result.history[1].role === "assistant", "ack assistant");

// Under threshold — no compact
const small = [user("hi"), assistant("hello")];
const skip = await maybeCompact(null, "dummy", small, {
  threshold: 50_000,
  localOnly: true,
});
assert(!skip.compacted, "under threshold");

// Session-style rewrite path: compacted history is valid message list
for (const m of result.history) {
  assert(m.role === "user" || m.role === "assistant" || m.role === "tool", "role ok");
}

console.log("All compact smoke tests passed.");
console.log(
  `  demo: ~${result.beforeTokens} → ~${result.afterTokens} tok, folded ${result.foldedCount}`,
);
