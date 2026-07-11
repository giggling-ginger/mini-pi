import type OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { maybeCompact, type CompactOptions } from "./compact.js";
import { executeTool, toolDefinitions } from "./tools.js";
import { buildSystemPrompt } from "./system.js";

export type AgentOptions = {
  client: OpenAI;
  model: string;
  cwd: string;
  maxTurns?: number;
  /** Default true — tokens / tool-arg fragments arrive as they generate. */
  stream?: boolean;
  /** Load AGENTS.md / CLAUDE.md into the system prompt (default true). */
  loadContextFiles?: boolean;
  /** Context compaction when history is large (default true). */
  compact?: boolean;
  compactOptions?: CompactOptions;
  /** Called for each assistant text chunk / tool event (for CLI logging). */
  onEvent?: (event: AgentEvent) => void;
};

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_call_delta"; index: number; name?: string; argsDelta?: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_result"; name: string; ok: boolean; output: string }
  | { type: "turn"; turn: number }
  | {
      type: "compact";
      beforeTokens: number;
      afterTokens: number;
      foldedCount: number;
      summaryPreview: string;
    };

type AccumToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/**
 * Classic tool loop (Pi-style core), with optional streaming:
 *   user → model (stream) → assemble tool_calls → execute → … → done
 *
 * Streaming only changes *how* we receive the assistant message.
 * The loop structure is identical to non-streaming.
 */
export async function runAgent(
  options: AgentOptions,
  userMessage: string,
  history: ChatCompletionMessageParam[] = [],
): Promise<ChatCompletionMessageParam[]> {
  const {
    client,
    model,
    cwd,
    maxTurns = 30,
    stream = true,
    loadContextFiles = true,
    compact = true,
    compactOptions,
    onEvent,
  } = options;

  const { prompt: systemPrompt } = buildSystemPrompt(cwd, {
    disabled: !loadContextFiles,
  });

  let hist = history.filter((m) => m.role !== "system");

  if (compact) {
    const result = await maybeCompact(client, model, hist, compactOptions);
    hist = result.history.filter((m) => m.role !== "system");
    if (result.compacted) {
      onEvent?.({
        type: "compact",
        beforeTokens: result.beforeTokens,
        afterTokens: result.afterTokens,
        foldedCount: result.foldedCount,
        summaryPreview: result.summaryPreview,
      });
    }
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system" as const, content: systemPrompt },
    ...hist,
    { role: "user" as const, content: userMessage },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    onEvent?.({ type: "turn", turn: turn + 1 });

    const { content, toolCalls } = stream
      ? await streamCompletion(client, model, messages, onEvent)
      : await onceCompletion(client, model, messages, onEvent);

    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (content) {
      onEvent?.({ type: "text", text: content });
    }

    if (toolCalls.length === 0) {
      return messages.filter((m) => m.role !== "system");
    }

    for (const call of toolCalls) {
      await handleToolCall(cwd, call, messages, onEvent);
    }
  }

  onEvent?.({
    type: "text",
    text: `\n[stopped: reached max turns (${maxTurns})]`,
  });
  return messages.filter((m) => m.role !== "system");
}

/** Non-streaming path (kept for --no-stream / comparison). */
async function onceCompletion(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  onEvent?: (event: AgentEvent) => void,
): Promise<{ content: string; toolCalls: ChatCompletionMessageToolCall[] }> {
  const response = await client.chat.completions.create({
    model,
    messages,
    tools: toolDefinitions,
    tool_choice: "auto",
  });

  const choice = response.choices[0];
  if (!choice) throw new Error("Empty response from model");

  const msg = choice.message;
  const content = msg.content ?? "";
  if (content) {
    // Emulate one big delta so CLI still "prints" something
    onEvent?.({ type: "text_delta", text: content });
  }
  return { content, toolCalls: msg.tool_calls ?? [] };
}

/**
 * Stream one assistant turn.
 *
 * OpenAI-compatible streams send many tiny ChatCompletionChunk objects.
 * Text may contain:
 *   - delta.content          → text token(s)
 *   - delta.tool_calls[i]    → partial id / name / arguments JSON
 *
 * We must *assemble* tool_calls before executeTool — you can't run
 * incomplete JSON args.
 */
async function streamCompletion(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  onEvent?: (event: AgentEvent) => void,
): Promise<{ content: string; toolCalls: ChatCompletionMessageToolCall[] }> {
  const stream = await client.chat.completions.create({
    model,
    messages,
    tools: toolDefinitions,
    tool_choice: "auto",
    stream: true,
  });

  let content = "";
  const tools = new Map<number, AccumToolCall>();

  for await (const chunk of stream) {
    applyChunk(chunk, {
      onContent(delta) {
        content += delta;
        onEvent?.({ type: "text_delta", text: delta });
      },
      onToolDelta(index, partial) {
        let acc = tools.get(index);
        if (!acc) {
          acc = { id: "", name: "", arguments: "" };
          tools.set(index, acc);
        }
        if (partial.id) acc.id = partial.id;
        if (partial.name) {
          acc.name += partial.name;
          onEvent?.({
            type: "tool_call_delta",
            index,
            name: partial.name,
          });
        }
        if (partial.arguments) {
          acc.arguments += partial.arguments;
          onEvent?.({
            type: "tool_call_delta",
            index,
            argsDelta: partial.arguments,
          });
        }
      },
    });
  }

  const toolCalls: ChatCompletionMessageToolCall[] = [...tools.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, t]) => ({
      id: t.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: "function" as const,
      function: {
        name: t.name,
        arguments: t.arguments || "{}",
      },
    }));

  return { content, toolCalls };
}

type ChunkHandlers = {
  onContent: (delta: string) => void;
  onToolDelta: (
    index: number,
    partial: { id?: string; name?: string; arguments?: string },
  ) => void;
};

function applyChunk(chunk: ChatCompletionChunk, h: ChunkHandlers): void {
  const choice = chunk.choices[0];
  if (!choice) return;
  const delta = choice.delta;
  if (!delta) return;

  if (typeof delta.content === "string" && delta.content.length > 0) {
    h.onContent(delta.content);
  }

  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const index = tc.index ?? 0;
      h.onToolDelta(index, {
        id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments,
      });
    }
  }
}

async function handleToolCall(
  cwd: string,
  call: ChatCompletionMessageToolCall,
  messages: ChatCompletionMessageParam[],
  onEvent?: (event: AgentEvent) => void,
): Promise<void> {
  const name = call.function.name;
  const args = call.function.arguments ?? "{}";

  onEvent?.({ type: "tool_call", name, args });

  const result = await executeTool(cwd, name, args);

  onEvent?.({
    type: "tool_result",
    name,
    ok: result.ok,
    output: result.output,
  });

  messages.push({
    role: "tool",
    tool_call_id: call.id,
    content: result.output,
  });
}
