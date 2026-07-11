# mini-pi

> **Learning project.** A minimal coding-agent harness written to understand how tools like [Pi](https://pi.dev) work.  
> **Not** a production agent. **Not** affiliated with [earendil-works/pi](https://github.com/earendil-works/pi).  
> APIs and behavior may break; the agent can run shell commands and modify files — use only in trusted workspaces.

A **minimal Pi-inspired coding agent** for learning how agent harnesses work.

**讲解网页：**

- 总览：[docs/index.html](./docs/index.html) · [Pages](https://giggling-ginger.github.io/mini-pi/)
- **Streaming 原理**：[docs/streaming.html](./docs/streaming.html) · [Pages](https://giggling-ginger.github.io/mini-pi/streaming.html)

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

## REPL commands

| Command  | Action              |
|----------|----------------------|
| `/exit`  | Quit                 |
| `/reset` | Clear chat history   |
| `/help`  | Show help            |

## Streaming

Default **on**. Tokens print as they arrive; tool-call JSON is assembled from deltas before any tool runs.

```bash
npm run dev -- -p "写个 hello.ts"              # stream
npm run dev -- --no-stream -p "写个 hello.ts"  # wait for full reply
```

How it works (wire diagram + interactive demo): **[docs/streaming.html](./docs/streaming.html)**.

## What this intentionally does **not** have

- Session files / resume
- Permissions / sandbox
- Extensions / skills / MCP
- Subagents / plan mode
- Rich TUI

Add those later if you want — starting minimal is the point.

## Next steps (if you extend it)

1. **Session JSONL** — save messages to disk, `--continue`
2. **AGENTS.md** — inject project instructions into system prompt
3. **Extensions** — load extra tools from `~/.mini-pi/extensions/`
4. **Context compaction** — summarize old turns when near context limit

## License

MIT
