import OpenAI from "openai";

export type LlmConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

/**
 * Prefer xAI (SpaceXAI). Fall back to OpenAI-compatible env vars.
 */
export function loadLlmConfig(): LlmConfig {
  const apiKey =
    process.env.XAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing API key. Set XAI_API_KEY (recommended) or OPENAI_API_KEY.\n" +
        "See .env.example",
    );
  }

  const baseURL =
    process.env.XAI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    (process.env.XAI_API_KEY
      ? "https://api.x.ai/v1"
      : "https://api.openai.com/v1");

  const model =
    process.env.MODEL ||
    (process.env.XAI_API_KEY || baseURL.includes("x.ai")
      ? "grok-4.5"
      : "gpt-4o");

  return { apiKey, baseURL, model };
}

export function createClient(config: LlmConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}
