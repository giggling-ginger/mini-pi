import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { executeTool, toolDefinitions } from "./tools.js";
import { buildSystemPrompt } from "./system.js";

export type AgentOptions = {
  client: OpenAI;
  model: string;
  cwd: string;
  maxTurns?: number;
  /** Called for each assistant text chunk / tool event (for CLI logging). */
  onEvent?: (event: AgentEvent) => void;
};

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_result"; name: string; ok: boolean; output: string }
  | { type: "turn"; turn: number };

/**
 * Classic tool loop (Pi-style core):
 *   user → model → [tool_calls → execute → tool results] → model → ...
 * until the model stops requesting tools.
 */
export async function runAgent(
  options: AgentOptions,
  userMessage: string,
  history: ChatCompletionMessageParam[] = [],
): Promise<ChatCompletionMessageParam[]> {
  const { client, model, cwd, maxTurns = 30, onEvent } = options;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(cwd) },
    ...history.filter((m) => m.role !== "system"),
    { role: "user", content: userMessage },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    onEvent?.({ type: "turn", turn: turn + 1 });

    const response = await client.chat.completions.create({
      model,
      messages,
      tools: toolDefinitions,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("Empty response from model");
    }

    const msg = choice.message;
    messages.push({
      role: "assistant",
      content: msg.content,
      tool_calls: msg.tool_calls,
    });

    if (msg.content) {
      onEvent?.({ type: "text", text: msg.content });
    }

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // Model finished without more tools
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
