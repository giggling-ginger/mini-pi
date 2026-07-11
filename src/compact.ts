import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/** Rough token estimate: ~4 chars per token for English/code mix. */
export function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += messageChars(m);
  }
  return Math.ceil(chars / 4);
}

export function messageChars(m: ChatCompletionMessageParam): number {
  let n = 0;
  if (typeof m.content === "string") n += m.content.length;
  else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part && typeof part === "object" && "text" in part) {
        n += String((part as { text?: string }).text ?? "").length;
      }
    }
  }
  if ("tool_calls" in m && m.tool_calls) {
    for (const tc of m.tool_calls) {
      n += tc.function?.name?.length ?? 0;
      n += tc.function?.arguments?.length ?? 0;
      n += 24;
    }
  }
  if ("tool_call_id" in m && m.tool_call_id) n += m.tool_call_id.length;
  n += 8; // role overhead
  return n;
}

export type CompactOptions = {
  /** Trigger when estimated tokens >= this (default 8000). */
  threshold?: number;
  /** Keep roughly this many tokens of *recent* messages (default 3000). */
  keepRecent?: number;
  /** Force compaction even under threshold. */
  force?: boolean;
  /** If true, use extractive local summary (no API). For tests / offline. */
  localOnly?: boolean;
};

export type CompactResult = {
  history: ChatCompletionMessageParam[];
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
  /** How many messages were folded into the summary. */
  foldedCount: number;
  summaryPreview: string;
};

const SUMMARY_PREFIX = "[Conversation summary — earlier turns compacted]\n";

/**
 * If history is over threshold, fold older turns into a short summary message
 * pair and keep the recent tail intact.
 *
 * Tool-call sequences are kept contiguous: the split prefers a `user` boundary.
 */
export async function maybeCompact(
  client: OpenAI | null,
  model: string,
  history: ChatCompletionMessageParam[],
  opts: CompactOptions = {},
): Promise<CompactResult> {
  const threshold = opts.threshold ?? 8000;
  const keepRecent = opts.keepRecent ?? 3000;
  const msgs = history.filter((m) => m.role !== "system");
  const beforeTokens = estimateTokens(msgs);

  if (!opts.force && beforeTokens < threshold) {
    return {
      history: msgs,
      compacted: false,
      beforeTokens,
      afterTokens: beforeTokens,
      foldedCount: 0,
      summaryPreview: "",
    };
  }

  const { old, recent } = splitOldRecent(msgs, keepRecent);
  if (old.length < 2) {
    // Nothing useful to fold
    return {
      history: msgs,
      compacted: false,
      beforeTokens,
      afterTokens: beforeTokens,
      foldedCount: 0,
      summaryPreview: "",
    };
  }

  const summary =
    opts.localOnly || !client
      ? localSummary(old)
      : await llmSummary(client, model, old);

  const preview = summary.slice(0, 200).replace(/\s+/g, " ");
  const folded: ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: SUMMARY_PREFIX + summary,
    },
    {
      role: "assistant",
      content:
        "Understood. I have the summarized context and will continue from there.",
    },
    ...recent,
  ];

  return {
    history: folded,
    compacted: true,
    beforeTokens,
    afterTokens: estimateTokens(folded),
    foldedCount: old.length,
    summaryPreview: preview,
  };
}

/**
 * Split so `recent` keeps ~keepRecent tokens from the end, starting at a
 * user message when possible (avoids orphan tool results).
 */
export function splitOldRecent(
  messages: ChatCompletionMessageParam[],
  keepRecentTokens: number,
): { old: ChatCompletionMessageParam[]; recent: ChatCompletionMessageParam[] } {
  if (messages.length === 0) return { old: [], recent: [] };

  let tokenBudget = 0;
  let idx = messages.length; // recent starts at idx

  for (let i = messages.length - 1; i >= 0; i--) {
    const t = Math.ceil(messageChars(messages[i]) / 4);
    if (tokenBudget + t > keepRecentTokens && idx < messages.length) {
      break;
    }
    tokenBudget += t;
    idx = i;
  }

  // Slide idx forward to a user message so we don't start mid tool chain
  while (idx < messages.length && messages[idx].role !== "user") {
    idx++;
  }
  // If everything is "recent", fold at least the first half when forcing
  if (idx === 0) {
    idx = Math.max(1, Math.floor(messages.length / 2));
    while (idx < messages.length && messages[idx].role !== "user") {
      idx++;
    }
    if (idx >= messages.length) {
      return { old: messages, recent: [] };
    }
  }

  return {
    old: messages.slice(0, idx),
    recent: messages.slice(idx),
  };
}

/** Cheap extractive summary for tests / offline. */
export function localSummary(messages: ChatCompletionMessageParam[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") {
      lines.push(`- User: ${clip(m.content, 160)}`);
    } else if (m.role === "assistant") {
      const bits: string[] = [];
      if (typeof m.content === "string" && m.content.trim()) {
        bits.push(clip(m.content, 120));
      }
      if ("tool_calls" in m && m.tool_calls?.length) {
        const names = m.tool_calls.map((t) => t.function.name).join(", ");
        bits.push(`tools=[${names}]`);
      }
      if (bits.length) lines.push(`- Assistant: ${bits.join(" · ")}`);
    } else if (m.role === "tool" && typeof m.content === "string") {
      lines.push(`- Tool result: ${clip(m.content, 100)}`);
    }
  }
  if (lines.length === 0) return "(no textual content in compacted region)";
  return lines.join("\n");
}

async function llmSummary(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
): Promise<string> {
  const transcript = messages
    .map((m) => {
      if (m.role === "user") return `User: ${contentStr(m)}`;
      if (m.role === "assistant") {
        let s = `Assistant: ${contentStr(m)}`;
        if ("tool_calls" in m && m.tool_calls?.length) {
          s +=
            "\n  tool_calls: " +
            m.tool_calls
              .map((t) => `${t.function.name}(${clip(t.function.arguments, 80)})`)
              .join("; ");
        }
        return s;
      }
      if (m.role === "tool") return `Tool: ${clip(contentStr(m), 200)}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You compress coding-agent transcripts into a concise bullet summary. " +
          "Keep: goals, decisions, files touched, commands run, errors, current state. " +
          "Drop chatter. Max ~400 words. No tools. Plain text bullets.",
      },
      {
        role: "user",
        content: `Summarize this transcript for a coding agent that will continue the work:\n\n${clip(transcript, 24_000)}`,
      },
    ],
    // no tools — pure summarization
  });

  const text = response.choices[0]?.message?.content?.trim();
  if (!text) return localSummary(messages);
  return text;
}

function contentStr(m: ChatCompletionMessageParam): string {
  if (typeof m.content === "string") return m.content;
  return "";
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : one.slice(0, max - 1) + "…";
}

export function isSummaryMessage(m: ChatCompletionMessageParam): boolean {
  return (
    m.role === "user" &&
    typeof m.content === "string" &&
    m.content.startsWith(SUMMARY_PREFIX)
  );
}
