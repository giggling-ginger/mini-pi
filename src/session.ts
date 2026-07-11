import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/** First line of every session file. */
export type SessionMeta = {
  type: "meta";
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  /** First user prompt, truncated — for listing. */
  title?: string;
  model?: string;
  provider?: string;
};

export type SessionMessageLine = {
  type: "message";
  ts: string;
  message: ChatCompletionMessageParam;
};

export type SessionLine = SessionMeta | SessionMessageLine;

export type SessionInfo = {
  id: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  title: string;
  messageCount: number;
  mtimeMs: number;
};

export function defaultSessionDir(cwd: string): string {
  return path.join(cwd, ".mini-pi", "sessions");
}

export function newSessionId(): string {
  const t = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const r = randomBytes(3).toString("hex");
  return `${t}_${r}`;
}

/**
 * Append-only JSONL session store (Pi-inspired, simplified).
 *
 * File layout:
 *   {"type":"meta", ...}
 *   {"type":"message","ts":"...","message":{role,content,...}}
 *   ...
 */
export class Session {
  readonly id: string;
  readonly path: string;
  private meta: SessionMeta;
  private messages: ChatCompletionMessageParam[] = [];

  private constructor(filePath: string, meta: SessionMeta, messages: ChatCompletionMessageParam[]) {
    this.path = filePath;
    this.id = meta.id;
    this.meta = meta;
    this.messages = messages;
  }

  get history(): ChatCompletionMessageParam[] {
    return this.messages.slice();
  }

  get title(): string {
    return this.meta.title ?? "(untitled)";
  }

  static create(opts: {
    sessionDir: string;
    cwd: string;
    model?: string;
    provider?: string;
    id?: string;
  }): Session {
    mkdirSync(opts.sessionDir, { recursive: true });
    const id = opts.id ?? newSessionId();
    const filePath = path.join(opts.sessionDir, `${id}.jsonl`);
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      type: "meta",
      id,
      createdAt: now,
      updatedAt: now,
      cwd: opts.cwd,
      model: opts.model,
      provider: opts.provider,
    };
    writeFileSync(filePath, JSON.stringify(meta) + "\n", "utf8");
    return new Session(filePath, meta, []);
  }

  static load(filePath: string): Session {
    const resolved = resolveSessionPath(filePath);
    if (!existsSync(resolved)) {
      throw new Error(`Session not found: ${filePath}`);
    }
    const lines = readFileSync(resolved, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    let meta: SessionMeta | null = null;
    const messages: ChatCompletionMessageParam[] = [];

    for (const line of lines) {
      let obj: SessionLine;
      try {
        obj = JSON.parse(line) as SessionLine;
      } catch {
        continue;
      }
      if (obj.type === "meta") {
        meta = obj;
      } else if (obj.type === "message") {
        messages.push(obj.message);
      }
    }

    if (!meta) {
      throw new Error(`Invalid session file (no meta): ${resolved}`);
    }
    return new Session(resolved, meta, messages);
  }

  /**
   * Agent returns the full non-system history after a turn.
   * Append any new tail messages to the JSONL file.
   */
  syncFromHistory(history: ChatCompletionMessageParam[]): void {
    const next = history.filter((m) => m.role !== "system");
    const prevLen = this.messages.length;

    if (next.length < prevLen) {
      this.rewriteAll(next);
    } else {
      const toAppend = next.slice(prevLen);
      for (const message of toAppend) {
        this.writeMessageLine(message);
      }
      this.messages = next;
      if (toAppend.length > 0) {
        this.meta.updatedAt = new Date().toISOString();
        this.rewriteMetaKeepingMessages();
      }
    }

    if (!this.meta.title) {
      const firstUser = next.find((m) => m.role === "user");
      if (firstUser && typeof firstUser.content === "string") {
        this.meta.title = truncateTitle(firstUser.content);
        this.rewriteMetaKeepingMessages();
      }
    }
  }

  private writeMessageLine(message: ChatCompletionMessageParam): void {
    if (message.role === "system") return;
    const line: SessionMessageLine = {
      type: "message",
      ts: new Date().toISOString(),
      message,
    };
    appendFileSync(this.path, JSON.stringify(line) + "\n", "utf8");
  }

  /** Full rewrite of meta + messages. */
  private rewriteAll(messages: ChatCompletionMessageParam[]): void {
    this.meta.updatedAt = new Date().toISOString();
    const clean = messages.filter((m) => m.role !== "system");
    const parts = [JSON.stringify(this.meta)];
    for (const message of clean) {
      parts.push(
        JSON.stringify({
          type: "message",
          ts: new Date().toISOString(),
          message,
        } satisfies SessionMessageLine),
      );
    }
    writeFileSync(this.path, parts.join("\n") + "\n", "utf8");
    this.messages = clean;
  }

  /** Update meta line only; keep existing message lines as-is. */
  private rewriteMetaKeepingMessages(): void {
    this.meta.updatedAt = new Date().toISOString();
    const parts = [JSON.stringify(this.meta)];
    try {
      const raw = readFileSync(this.path, "utf8").split("\n").filter(Boolean);
      for (const line of raw) {
        const obj = JSON.parse(line) as SessionLine;
        if (obj.type === "message") parts.push(line);
      }
      writeFileSync(this.path, parts.join("\n") + "\n", "utf8");
    } catch {
      this.rewriteAll(this.messages);
    }
  }
}

function truncateTitle(s: string, max = 60): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : one.slice(0, max - 1) + "…";
}

/** Accept absolute path, relative path, or bare session id. */
export function resolveSessionPath(idOrPath: string, sessionDir?: string): string {
  if (idOrPath.endsWith(".jsonl") || idOrPath.includes("/") || idOrPath.includes("\\")) {
    return path.resolve(idOrPath);
  }
  if (sessionDir) {
    const candidate = path.join(sessionDir, `${idOrPath}.jsonl`);
    if (existsSync(candidate)) return candidate;
    // partial id match
    const matches = listSessionFiles(sessionDir).filter((f) =>
      path.basename(f, ".jsonl").includes(idOrPath),
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous session id "${idOrPath}", matches:\n` +
          matches.map((m) => "  " + path.basename(m, ".jsonl")).join("\n"),
      );
    }
  }
  return path.resolve(idOrPath.endsWith(".jsonl") ? idOrPath : `${idOrPath}.jsonl`);
}

function listSessionFiles(sessionDir: string): string[] {
  if (!existsSync(sessionDir)) return [];
  return readdirSync(sessionDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(sessionDir, f));
}

export function listSessions(sessionDir: string): SessionInfo[] {
  const files = listSessionFiles(sessionDir);
  const infos: SessionInfo[] = [];

  for (const filePath of files) {
    try {
      const st = statSync(filePath);
      const session = Session.load(filePath);
      const metaLine = readFileSync(filePath, "utf8").split("\n").find(Boolean);
      const meta = metaLine ? (JSON.parse(metaLine) as SessionMeta) : null;
      infos.push({
        id: session.id,
        path: filePath,
        createdAt: meta?.createdAt ?? "",
        updatedAt: meta?.updatedAt ?? "",
        cwd: meta?.cwd ?? "",
        title: session.title,
        messageCount: session.history.length,
        mtimeMs: st.mtimeMs,
      });
    } catch {
      /* skip corrupt */
    }
  }

  // Prefer meta.updatedAt; fall back to file mtime
  infos.sort((a, b) => {
    const ta = a.updatedAt ? Date.parse(a.updatedAt) : a.mtimeMs;
    const tb = b.updatedAt ? Date.parse(b.updatedAt) : b.mtimeMs;
    return tb - ta;
  });
  return infos;
}

export function latestSession(sessionDir: string): SessionInfo | null {
  const list = listSessions(sessionDir);
  return list[0] ?? null;
}

/** Stable short fingerprint of cwd for display. */
export function cwdTag(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex").slice(0, 6);
}
