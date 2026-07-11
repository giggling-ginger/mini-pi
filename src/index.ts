#!/usr/bin/env node
/**
 * mini-pi — minimal Pi-like coding agent CLI
 *
 * Usage:
 *   mini-pi                        # interactive REPL
 *   mini-pi "list ts files"        # single-shot
 *   mini-pi -p "..."               # print mode (same as single-shot)
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runAgent, type AgentEvent } from "./agent.js";
import { createClient, loadLlmConfig } from "./llm.js";

const HELP = `
mini-pi — minimal coding agent (read / write / edit / bash)

Usage:
  mini-pi [options] [prompt...]

Options:
  -p, --print     Single-shot: run prompt and exit
  -h, --help      Show help
  -c, --cwd DIR   Working directory (default: current)

Env (need a real API — SuperGrok/Codex sub is not enough):
  PROVIDER           openai | openrouter | ollama | xai
  MODEL              model id
  OPENAI_API_KEY     platform.openai.com key (≠ ChatGPT sub)
  OPENROUTER_API_KEY openrouter.ai
  OLLAMA_HOST        default http://127.0.0.1:11434
  XAI_API_KEY        console.x.ai (≠ SuperGrok)

Examples:
  PROVIDER=ollama MODEL=llama3.2 mini-pi -p "List files"
  mini-pi "List files in src/"
  mini-pi                 # interactive
`.trim();

function parseArgs(argv: string[]) {
  let print = false;
  let cwd = process.cwd();
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true as const };
    if (a === "-p" || a === "--print") {
      print = true;
      continue;
    }
    if (a === "-c" || a === "--cwd") {
      cwd = argv[++i] ?? cwd;
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    }
    rest.push(a);
  }

  return { help: false as const, print, cwd, prompt: rest.join(" ").trim() };
}

function formatEvent(event: AgentEvent): void {
  switch (event.type) {
    case "text":
      process.stdout.write(event.text);
      if (!event.text.endsWith("\n")) process.stdout.write("\n");
      break;
    case "tool_call": {
      let preview = event.args;
      try {
        preview = JSON.stringify(JSON.parse(event.args));
      } catch {
        /* keep raw */
      }
      if (preview.length > 200) preview = preview.slice(0, 200) + "…";
      console.log(`\x1b[36m→ ${event.name}\x1b[0m ${preview}`);
      break;
    }
    case "tool_result": {
      const color = event.ok ? "\x1b[32m" : "\x1b[31m";
      const lines = event.output.split("\n");
      const head =
        lines.length > 12
          ? lines.slice(0, 12).join("\n") + `\n… (${lines.length - 12} more lines)`
          : event.output;
      console.log(`${color}← ${event.name}\x1b[0m\n${indent(head)}`);
      break;
    }
    case "turn":
      // quiet by default
      break;
  }
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => "  " + l)
    .join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const config = loadLlmConfig();
  const client = createClient(config);
  const cwd = args.cwd;

  console.error(
    `mini-pi  provider=${config.provider}  model=${config.model}  cwd=${cwd}`,
  );

  const agentOpts = {
    client,
    model: config.model,
    cwd,
    onEvent: formatEvent,
  };

  // Single-shot
  if (args.print || args.prompt) {
    if (!args.prompt) {
      console.error("No prompt provided.");
      process.exit(1);
    }
    await runAgent(agentOpts, args.prompt);
    return;
  }

  // Interactive REPL
  const rl = readline.createInterface({ input, output, terminal: true });
  let history: ChatCompletionMessageParam[] = [];

  console.log("Type a task (empty or /exit to quit, /reset to clear history).\n");

  while (true) {
    let line: string;
    try {
      line = (await rl.question("\x1b[1myou>\x1b[0m ")).trim();
    } catch {
      break;
    }

    if (!line || line === "/exit" || line === "/quit") break;
    if (line === "/reset") {
      history = [];
      console.log("(history cleared)");
      continue;
    }
    if (line === "/help") {
      console.log(HELP);
      continue;
    }

    try {
      history = await runAgent(agentOpts, line, history);
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
    }
    console.log();
  }

  rl.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
