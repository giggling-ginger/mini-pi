import OpenAI from "openai";

export type LlmConfig = {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
};

/**
 * OpenAI-compatible endpoints only.
 *
 * Important: ChatGPT Plus / Codex / SuperGrok *subscriptions* are NOT API keys.
 * - SuperGrok → grok.com chat (≠ console.x.ai API)
 * - Codex CLI → ChatGPT OAuth (≠ platform.openai.com API)
 *
 * For mini-pi you need an actual HTTP API (OpenAI / OpenRouter / Ollama / …).
 *
 * Env (pick one path):
 *   PROVIDER=openai|openrouter|ollama|xai   (optional auto-detect)
 *   OPENAI_API_KEY + optional OPENAI_BASE_URL + MODEL
 *   OPENROUTER_API_KEY + MODEL
 *   OLLAMA_HOST (default http://127.0.0.1:11434) + MODEL
 *   XAI_API_KEY + MODEL
 */
export function loadLlmConfig(): LlmConfig {
  const explicit = (process.env.PROVIDER || "").toLowerCase().trim();

  if (explicit === "ollama" || (!explicit && wantsOllama())) {
    return ollamaConfig();
  }
  if (explicit === "openrouter" || process.env.OPENROUTER_API_KEY) {
    return openrouterConfig();
  }
  if (explicit === "xai" || process.env.XAI_API_KEY) {
    return xaiConfig();
  }
  if (explicit === "openai" || process.env.OPENAI_API_KEY) {
    return openaiConfig();
  }

  // Custom base URL without naming a provider
  if (process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY) {
    return openaiConfig();
  }

  throw new Error(missingKeyHelp());
}

function wantsOllama(): boolean {
  return Boolean(process.env.OLLAMA_HOST || process.env.OLLAMA_API_BASE);
}

function ollamaConfig(): LlmConfig {
  const host = (
    process.env.OLLAMA_HOST ||
    process.env.OLLAMA_API_BASE ||
    "http://127.0.0.1:11434"
  ).replace(/\/$/, "");
  const baseURL = host.endsWith("/v1") ? host : `${host}/v1`;
  return {
    provider: "ollama",
    // Ollama ignores the key but the OpenAI SDK requires a non-empty string
    apiKey: process.env.OLLAMA_API_KEY || "ollama",
    baseURL,
    model: process.env.MODEL || "llama3.2",
  };
}

function openrouterConfig(): LlmConfig {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("PROVIDER=openrouter requires OPENROUTER_API_KEY");
  }
  return {
    provider: "openrouter",
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    model: process.env.MODEL || "openai/gpt-4o-mini",
  };
}

function xaiConfig(): LlmConfig {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("PROVIDER=xai requires XAI_API_KEY from https://console.x.ai");
  }
  return {
    provider: "xai",
    apiKey,
    baseURL: process.env.XAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.x.ai/v1",
    model: process.env.MODEL || "grok-4.5",
  };
}

function openaiConfig(): LlmConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("PROVIDER=openai requires OPENAI_API_KEY from https://platform.openai.com/api-keys");
  }
  return {
    provider: "openai",
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.MODEL || "gpt-4o-mini",
  };
}

function missingKeyHelp(): string {
  return [
    "No API key found — mini-pi needs an OpenAI-compatible HTTP API.",
    "",
    "Subscriptions alone are not enough:",
    "  • SuperGrok  → chat on grok.com, not XAI_API_KEY",
    "  • Codex / ChatGPT Plus → Codex CLI OAuth, not OPENAI_API_KEY",
    "",
    "Ways to run mini-pi for learning:",
    "  1) Free / local  — install Ollama, then:",
    "       export PROVIDER=ollama",
    "       export MODEL=llama3.2   # or qwen2.5-coder, etc.",
    "       ollama pull llama3.2",
    "",
    "  2) OpenRouter   — https://openrouter.ai/keys",
    "       export OPENROUTER_API_KEY=sk-or-...",
    "       export MODEL=openai/gpt-4o-mini",
    "",
    "  3) OpenAI API   — https://platform.openai.com/api-keys",
    "       (separate from ChatGPT/Codex subscription; pay-per-token)",
    "       export OPENAI_API_KEY=sk-...",
    "       export MODEL=gpt-4o-mini",
    "",
    "  4) xAI API      — https://console.x.ai  (≠ SuperGrok sub)",
    "       export XAI_API_KEY=xai-...",
    "",
    "Or set PROVIDER=openai|openrouter|ollama|xai explicitly.",
    "See .env.example",
  ].join("\n");
}

export function createClient(config: LlmConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders:
      config.provider === "openrouter"
        ? {
            "HTTP-Referer": "https://github.com/giggling-ginger/mini-pi",
            "X-Title": "mini-pi",
          }
        : undefined,
  });
}
