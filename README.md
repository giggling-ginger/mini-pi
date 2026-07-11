# mini-pi

> **Learning project.** A minimal coding-agent harness written to understand how tools like [Pi](https://pi.dev) work.  
> **Not** a production agent. **Not** affiliated with [earendil-works/pi](https://github.com/earendil-works/pi).  
> APIs and behavior may break; the agent can run shell commands and modify files — use only in trusted workspaces.

A **minimal Pi-inspired coding agent** for learning how agent harnesses work.

Philosophy (inspired by [Pi](https://pi.dev)):

- Tiny system prompt
- Only four tools: `read`, `write`, `edit`, `bash`
- Model + tools + loop = coding agent
- No plan mode, no MCP, no subagents, no fancy TUI (yet)

## Quick start

```bash
cd mini-pi
npm install

# Use xAI (recommended)
export XAI_API_KEY=xai-...

# Single-shot
npm run dev -- -p "Create a file hello.ts that prints hello"

# Interactive
npm run dev
```

Or any OpenAI-compatible API:

```bash
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1   # optional
export MODEL=gpt-4o
npm run dev -- -p "List files"
```

## Architecture

```
src/
  index.ts    CLI (REPL + single-shot)
  agent.ts    Agent loop: model ↔ tools
  tools.ts    read / write / edit / bash
  llm.ts      OpenAI-compatible client (default: xAI)
  system.ts   Tiny system prompt
```

### The loop

```
user message
    ↓
model (with tool schemas)
    ↓
tool_calls? ──yes──→ execute tools → append results → model again
    │
   no
    ↓
final assistant text
```

This is the entire core of almost every coding agent.

## Tools

| Tool  | What it does                                      |
|-------|---------------------------------------------------|
| read  | Read file with line numbers                       |
| write | Create/overwrite file                             |
| edit  | Exact string replace (like Pi / Claude Code)      |
| bash  | Run shell command in workspace                    |

## REPL commands

| Command  | Action              |
|----------|----------------------|
| `/exit`  | Quit                 |
| `/reset` | Clear chat history   |
| `/help`  | Show help            |

## What this intentionally does **not** have

- Session files / resume
- Streaming tokens
- Permissions / sandbox
- Extensions / skills / MCP
- Subagents / plan mode
- Rich TUI

Add those later if you want — starting minimal is the point.

## Next steps (if you extend it)

1. **Streaming** — `stream: true` on chat completions
2. **Session JSONL** — save messages to disk, `--continue`
3. **AGENTS.md** — inject project instructions into system prompt
4. **Extensions** — load extra tools from `~/.mini-pi/extensions/`
5. **Context compaction** — summarize old turns when near context limit

## License

MIT
