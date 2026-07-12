# mini-pi

> **Learning project.** A minimal coding-agent harness written to understand how tools like [Pi](https://pi.dev) work.  
> **Not** a production agent. **Not** affiliated with [earendil-works/pi](https://github.com/earendil-works/pi).  
> APIs and behavior may break; the agent can run shell commands and modify files — use only in trusted workspaces.

A **minimal Pi-inspired coding agent** for learning how agent harnesses work.

**Walkthrough docs (中文 / English):**

| Topic | 中文 | English | GitHub Pages |
|-------|------|---------|--------------|
| Overview | [docs/index.html](./docs/index.html) | [docs/en/index.html](./docs/en/index.html) | [ZH](https://giggling-ginger.github.io/mini-pi/) · [EN](https://giggling-ginger.github.io/mini-pi/en/) |
| Streaming | [streaming.html](./docs/streaming.html) | [en/streaming.html](./docs/en/streaming.html) | [ZH](https://giggling-ginger.github.io/mini-pi/streaming.html) · [EN](https://giggling-ginger.github.io/mini-pi/en/streaming.html) |
| Sessions | [sessions.html](./docs/sessions.html) | [en/sessions.html](./docs/en/sessions.html) | [ZH](https://giggling-ginger.github.io/mini-pi/sessions.html) · [EN](https://giggling-ginger.github.io/mini-pi/en/sessions.html) |
| AGENTS.md | [agents.html](./docs/agents.html) | [en/agents.html](./docs/en/agents.html) | [ZH](https://giggling-ginger.github.io/mini-pi/agents.html) · [EN](https://giggling-ginger.github.io/mini-pi/en/agents.html) |
| Compaction | [compact.html](./docs/compact.html) | [en/compact.html](./docs/en/compact.html) | [ZH](https://giggling-ginger.github.io/mini-pi/compact.html) · [EN](https://giggling-ginger.github.io/mini-pi/en/compact.html) |

Philosophy (inspired by [Pi](https://pi.dev)):

- Tiny system prompt
- Only four tools: `read`, `write`, `edit`, `bash`
- Model + tools + loop = coding agent
- No plan mode, no MCP, no subagents, no fancy TUI (yet)

## Quick start

```bash
cd mini-pi
npm install
```

You need an **OpenAI-compatible HTTP API**. Chat subscriptions alone are not enough:

| You have | Works with mini-pi? | What to do |
|----------|---------------------|------------|
| **SuperGrok** | No (that's grok.com chat) | xAI API is separate at [console.x.ai](https://console.x.ai) |
| **Codex / ChatGPT Plus** | No (that's OAuth for Codex CLI) | Keep using `codex` for real work; or buy OpenAI **platform** API key |
| **Ollama** (local) | Yes | Free — best for learning the harness |
| **OpenRouter / OpenAI API / xAI API** | Yes | Set the matching env var |

### Recommended: OpenRouter free models

1. Create a free key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Configure:

```bash
cp .env.example .env
# edit .env — paste OPENROUTER_API_KEY=sk-or-v1-...
```

Default model is `openrouter/free` (auto-routes among free models that support tools).

```bash
npm run dev -- -p "Create a file hello.ts that prints hello"
npm run dev   # interactive
```

Pin a free coding model if you want:

```bash
# in .env
MODEL=qwen/qwen3-coder:free
# MODEL=poolside/laguna-xs-2.1:free
# MODEL=openai/gpt-oss-120b:free
```

Free tier has rate limits; if a model is busy, try another `:free` id from [openrouter.ai/models](https://openrouter.ai/models?q=free).

### Other providers

```bash
# Ollama (local, free)
export PROVIDER=ollama
export MODEL=llama3.2

# OpenAI platform API (≠ ChatGPT subscription billing)
export OPENAI_API_KEY=sk-...
export MODEL=gpt-4o-mini

# xAI API (≠ SuperGrok)
export XAI_API_KEY=xai-...
export MODEL=grok-4.5
```

See [`.env.example`](./.env.example).

## Architecture

```
src/
  index.ts    CLI (REPL + single-shot)
  agent.ts    Agent loop: model ↔ tools
  tools.ts    read / write / edit / bash
  llm.ts      OpenAI-compatible client (OpenAI / OpenRouter / Ollama / xAI)
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

## Sessions

Conversations are saved as **JSONL** under `.mini-pi/sessions/` (gitignored).

```bash
# new session (default)
npm run dev -- -p "create hello.ts"

# continue last session with a follow-up
npm run dev -- --continue -p "now add a test"
# short flag: -c

# pick a session interactively
npm run dev -- --resume

# open by id / partial id / path
npm run dev -- --session 2026-07-11

# list
npm run dev -- --list-sessions

# don't save
npm run dev -- --no-session -p "ephemeral"
```

Each file starts with a `meta` line, then one JSON object per message (`user` / `assistant` / `tool`). Reload reconstructs the same `messages[]` the agent loop uses.

How it works (JSONL growth demo + continue flow): **[docs/sessions.html](./docs/sessions.html)**.

| REPL     | Action                                      |
|----------|---------------------------------------------|
| `/session` | Show id + path                            |
| `/context` | Show loaded AGENTS.md paths               |
| `/reset`   | Start a **new** session file (old kept)   |
| `/exit`    | Quit                                      |
| `/help`    | Help                                      |

## AGENTS.md

Project instructions are loaded from `AGENTS.md` (or `CLAUDE.md` / `AGENT.md`) from `cwd` up to the git root, and **appended to the system prompt** each turn.

```bash
# default: load context files
npm run dev -- -p "run typecheck the way this repo likes"

# skip for one run
npm run dev -- -nc -p "same task without AGENTS.md"
```

How discovery + injection works: **[docs/agents.html](./docs/agents.html)**.

## Compaction

When estimated history tokens exceed a threshold (default ~8000), older turns are folded into a summary pair; recent messages stay verbatim.

```bash
npm run dev -- --compact-threshold 4000
# REPL:
#   /tokens
#   /compact
npm run dev -- --no-compact   # disable
```

How it works: **[docs/compact.html](./docs/compact.html)**.

## Streaming

Default **on**. Tokens print as they arrive; tool-call JSON is assembled from deltas before any tool runs.

```bash
npm run dev -- -p "写个 hello.ts"              # stream
npm run dev -- --no-stream -p "写个 hello.ts"  # wait for full reply
```

How it works (wire diagram + interactive demo): **[docs/streaming.html](./docs/streaming.html)**.

## What this intentionally does **not** have

- Permissions / sandbox
- Extensions / skills / MCP
- Subagents / plan mode
- Rich TUI
- Session trees / branch (Pi has these; we keep a linear JSONL)

## Next steps (if you extend it)

1. **Extensions** — load extra tools from `~/.mini-pi/extensions/`
2. **Session branch/tree** — fork a session like Pi
3. **Better token counting** — real tokenizer instead of chars/4

## License

MIT
