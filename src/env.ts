import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load KEY=VALUE pairs from a .env file into process.env (does not override).
 * Tiny helper — no dotenv dependency.
 */
export function loadDotEnv(filePath?: string): void {
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const candidates = [
    filePath,
    path.join(process.cwd(), ".env"),
    path.join(pkgRoot, ".env"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    return;
  }
}
