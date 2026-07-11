#!/usr/bin/env node
/**
 * mini-pi — minimal Pi-like coding agent CLI
 *
 * Usage:
 *   mini-pi                        # interactive REPL (new session)
 *   mini-pi "list ts files"        # single-shot (saved to session)
 *   mini-pi --continue             # resume latest session
 *   mini-pi --resume               # pick a session
 *   mini-pi --session <id|path>    # open specific session
 *   mini-pi --no-session -p "..."  # ephemeral
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runAgent, type AgentEvent } from "./agent.js";
import { loadDotEnv } from "./env.js";
import { createClient, loadLlmConfig } from "./llm.js";
import { loadContextFiles } from "./context-files.js";
import {
  Session,
  defaultSessionDir,
  latestSession,
  listSessions,
  resolveSessionPath,
  type SessionInfo,
} from "./session.js";

loadDotEnv();

const HELP = `
mini-pi — minimal coding agent (read / write / edit / bash)

Usage:
  mini-pi [options] [prompt...]

Options:
  -p, --print            Single-shot: run prompt and exit
  --no-stream            Disable token streaming
  -h, --help             Show help
  --cwd DIR              Working directory (default: current)

Sessions (saved under .mini-pi/sessions/ as JSONL):
  --continue             Resume the most recent session
  --resume, -r           List sessions and pick one (or use latest if only one)
  --session <id|path>    Open a session by id, partial id, or file path
  --session-dir <dir>    Session directory (default: <cwd>/.mini-pi/sessions)
  --no-session           Do not load or save a session (ephemeral)
  --list-sessions        Print sessions and exit

Project instructions:
  --no-context-files     Do not load AGENTS.md / CLAUDE.md into system prompt
  -nc                    Short for --no-context-files

REPL commands:
  /exit /quit    Quit
  /reset         New empty session file (keeps old file on disk)
  /session       Show current session path + id
  /context       Show loaded AGENTS.md (etc.) paths
  /help          This help

Examples:
  mini-pi -p "create hello.ts"
  mini-pi --continue "now add a test"
  mini-pi --resume
  mini-pi --session 2026-07-11
  mini-pi --no-session -p "ephemeral task"
  mini-pi -nc -p "ignore AGENTS.md this run"
`.trim();

type Args = {
  help: boolean;
  print: boolean;
  stream: boolean;
  cwd: string;
  prompt: string;
  continueSession: boolean;
  resume: boolean;
  session?: string;
  sessionDir?: string;
  noSession: boolean;
  listSessions: boolean;
  noContextFiles: boolean;
};

function parseArgs(argv: string[]): Args {
  let print = false;
  let stream = true;
  let cwd = process.cwd();
  let continueSession = false;
  let resume = false;
  let session: string | undefined;
  let sessionDir: string | undefined;
  let noSession = false;
  let listSessionsFlag = false;
  let noContextFiles = false;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      return {
        help: true,
        print: false,
        stream: true,
        cwd,
        prompt: "",
        continueSession: false,
        resume: false,
        noSession: false,
        listSessions: false,
        noContextFiles: false,
      };
    }
    if (a === "-p" || a === "--print") {
      print = true;
      continue;
    }
    if (a === "--no-stream") {
      stream = false;
      continue;
    }
    if (a === "--cwd") {
      cwd = argv[++i] ?? cwd;
      continue;
    }
    // Pi-style: -c means continue. cwd uses --cwd only.
    if (a === "-c") {
      continueSession = true;
      continue;
    }
    if (a === "--continue") {
      continueSession = true;
      continue;
    }
    if (a === "--resume" || a === "-r") {
      resume = true;
      continue;
    }
    if (a === "--session") {
      session = argv[++i];
      continue;
    }
    if (a === "--session-dir") {
      sessionDir = argv[++i];
      continue;
    }
    if (a === "--no-session") {
      noSession = true;
      continue;
    }
    if (a === "--list-sessions") {
      listSessionsFlag = true;
      continue;
    }
    if (a === "--no-context-files" || a === "-nc") {
      noContextFiles = true;
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    }
    rest.push(a);
  }

  return {
    help: false,
    print,
    stream,
    cwd,
    prompt: rest.join(" ").trim(),
    continueSession,
    resume,
    session,
    sessionDir,
    noSession,
    listSessions: listSessionsFlag,
    noContextFiles,
  };
}

function createEventPrinter() {
  let inTextStream = false;

  return function formatEvent(event: AgentEvent): void {
    switch (event.type) {
      case "text_delta":
        inTextStream = true;
        process.stdout.write(event.text);
        break;

      case "text":
        if (inTextStream) {
          if (!event.text.endsWith("\n")) process.stdout.write("\n");
          inTextStream = false;
        }
        break;

      case "tool_call_delta":
        break;

      case "tool_call": {
        if (inTextStream) {
          process.stdout.write("\n");
          inTextStream = false;
        }
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
        break;
    }
  };
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => "  " + l)
    .join("\n");
}

function formatSessionList(sessions: SessionInfo[]): string {
  if (sessions.length === 0) return "(no sessions yet)";
  return sessions
    .map((s, i) => {
      const when = s.updatedAt ? s.updatedAt.slice(0, 19).replace("T", " ") : "?";
      return (
        `  [${i + 1}] ${s.id}\n` +
        `      ${when}  msgs=${s.messageCount}  ${s.title}`
      );
    })
    .join("\n");
}

async function pickSession(
  sessions: SessionInfo[],
  rl: readline.Interface,
): Promise<SessionInfo | null> {
  if (sessions.length === 0) {
    console.log("No sessions found.");
    return null;
  }
  if (sessions.length === 1) {
    console.log(`Only one session — using ${sessions[0].id}`);
    return sessions[0];
  }
  console.log("Sessions (most recent first):\n");
  console.log(formatSessionList(sessions));
  console.log();
  const answer = (await rl.question("Pick number (or empty to cancel): ")).trim();
  if (!answer) return null;
  const n = Number(answer);
  if (!Number.isInteger(n) || n < 1 || n > sessions.length) {
    console.error("Invalid selection.");
    return null;
  }
  return sessions[n - 1];
}

async function openSession(args: Args, config: { model: string; provider: string }): Promise<Session | null> {
  if (args.noSession) return null;

  const sessionDir = args.sessionDir
    ? path.resolve(args.sessionDir)
    : defaultSessionDir(args.cwd);

  if (args.session) {
    const p = resolveSessionPath(args.session, sessionDir);
    return Session.load(p);
  }

  if (args.continueSession) {
    const latest = latestSession(sessionDir);
    if (!latest) {
      console.error(`No session to continue in ${sessionDir}`);
      console.error("Starting a new session instead.");
      return Session.create({
        sessionDir,
        cwd: args.cwd,
        model: config.model,
        provider: config.provider,
      });
    }
    return Session.load(latest.path);
  }

  if (args.resume) {
    const sessions = listSessions(sessionDir);
    const rl = readline.createInterface({ input, output, terminal: true });
    try {
      const picked = await pickSession(sessions, rl);
      if (!picked) {
        process.exit(0);
      }
      return Session.load(picked.path);
    } finally {
      rl.close();
    }
  }

  // Default: brand-new session for this run
  return Session.create({
    sessionDir,
    cwd: args.cwd,
    model: config.model,
    provider: config.provider,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const sessionDir = args.sessionDir
    ? path.resolve(args.sessionDir)
    : defaultSessionDir(args.cwd);

  if (args.listSessions) {
    console.log(`Sessions in ${sessionDir}\n`);
    console.log(formatSessionList(listSessions(sessionDir)));
    return;
  }

  const config = loadLlmConfig();
  const client = createClient(config);
  const cwd = args.cwd;

  const contextFiles = loadContextFiles({
    cwd,
    disabled: args.noContextFiles,
  });

  let session = await openSession(args, {
    model: config.model,
    provider: config.provider,
  });

  const sessionLabel = session
    ? `session=${session.id}`
    : "session=off";

  console.error(
    `mini-pi  provider=${config.provider}  model=${config.model}  stream=${args.stream}  ${sessionLabel}  cwd=${cwd}`,
  );
  if (session) {
    console.error(`  file ${session.path}`);
    if (session.history.length > 0) {
      console.error(`  resumed ${session.history.length} messages · ${session.title}`);
    }
  }
  if (args.noContextFiles) {
    console.error(`  context-files off`);
  } else if (contextFiles.length > 0) {
    const names = contextFiles.map((f) => f.displayPath).join(", ");
    console.error(`  context ${contextFiles.length} file(s): ${names}`);
  } else {
    console.error(`  context none (no AGENTS.md / CLAUDE.md found)`);
  }

  const agentOpts = {
    client,
    model: config.model,
    cwd,
    stream: args.stream,
    loadContextFiles: !args.noContextFiles,
    onEvent: createEventPrinter(),
  };

  let history: ChatCompletionMessageParam[] = session?.history ?? [];

  async function runTurn(prompt: string): Promise<void> {
    const opts = { ...agentOpts, onEvent: createEventPrinter() };
    history = await runAgent(opts, prompt, history);
    session?.syncFromHistory(history);
  }

  // Single-shot
  if (args.print || args.prompt) {
    if (!args.prompt) {
      console.error("No prompt provided.");
      process.exit(1);
    }
    await runTurn(args.prompt);
    return;
  }

  // Interactive REPL
  const rl = readline.createInterface({ input, output, terminal: true });

  console.log(
    "Type a task (empty or /exit to quit).\n" +
      "Sessions · AGENTS.md auto-loaded  ·  /session  /context  /reset  /help\n",
  );

  while (true) {
    let line: string;
    try {
      line = (await rl.question("\x1b[1myou>\x1b[0m ")).trim();
    } catch {
      break;
    }

    if (!line || line === "/exit" || line === "/quit") break;

    if (line === "/reset") {
      if (args.noSession) {
        history = [];
        console.log("(history cleared, no session file)");
      } else {
        session = Session.create({
          sessionDir,
          cwd: args.cwd,
          model: config.model,
          provider: config.provider,
        });
        history = [];
        console.log(`(new session ${session.id})`);
        console.error(`  file ${session.path}`);
      }
      continue;
    }

    if (line === "/session") {
      if (!session) {
        console.log("session: off (--no-session)");
      } else {
        console.log(`id:    ${session.id}`);
        console.log(`file:  ${session.path}`);
        console.log(`title: ${session.title}`);
        console.log(`msgs:  ${history.length}`);
      }
      continue;
    }

    if (line === "/context") {
      if (args.noContextFiles) {
        console.log("context-files: off (-nc / --no-context-files)");
      } else if (contextFiles.length === 0) {
        console.log("No AGENTS.md / CLAUDE.md found from cwd up to git root.");
      } else {
        for (const f of contextFiles) {
          console.log(`${f.displayPath}  (${f.chars} chars)`);
        }
      }
      continue;
    }

    if (line === "/help") {
      console.log(HELP);
      continue;
    }

    try {
      await runTurn(line);
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
    }
    console.log();
  }

  rl.close();
  if (session) {
    console.error(`\nsession saved: ${session.path}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
