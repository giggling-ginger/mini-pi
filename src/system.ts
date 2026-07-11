import {
  formatContextBlock,
  loadContextFiles,
  type ContextFile,
  type LoadContextOptions,
} from "./context-files.js";

/**
 * Keep the base system prompt tiny — same philosophy as Pi.
 * Project-specific rules come from AGENTS.md (and friends), not from us hardcoding them.
 */
export function buildBaseSystemPrompt(cwd: string): string {
  return `You are a coding agent in a terminal. Work in: ${cwd}

You have four tools: read, write, edit, bash.
- Prefer edit over rewrite for existing files.
- Use bash for shell commands (ls, git, tests, etc.).
- Be concise. Solve the task; don't narrate unless asked.
- After tools finish, give a short summary of what you did.
- If project instructions are provided below, follow them.`;
}

export type SystemPromptResult = {
  prompt: string;
  contextFiles: ContextFile[];
};

export function buildSystemPrompt(
  cwd: string,
  contextOpts?: Partial<LoadContextOptions>,
): SystemPromptResult {
  const contextFiles = loadContextFiles({
    cwd,
    disabled: contextOpts?.disabled,
    walkUp: contextOpts?.walkUp,
    stopAt: contextOpts?.stopAt,
    maxChars: contextOpts?.maxChars,
  });

  const prompt = buildBaseSystemPrompt(cwd) + formatContextBlock(contextFiles);
  return { prompt, contextFiles };
}
