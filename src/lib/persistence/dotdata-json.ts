/**
 * Raw disk read for `.data/{name}.json` (no json-store cache).
 *
 * **Allowed call sites:** `file-backend` / `supabase-backend` (supplementary blobs),
 * plus the two documented exceptions: `universe-read.ts` when `DATA_SOURCE=file`
 * (pin metadata), and `topics/page.tsx` server action (fresh read at mutation time).
 * Elsewhere prefer `getRepository()` or domain store modules.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

/** Read `.data/{baseName}.json` synchronously; returns null if missing or invalid. */
export function readDotDataJson<T>(baseName: string): T | null {
  try {
    const p = join(process.cwd(), ".data", `${baseName}.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Write `.data/{baseName}.json` atomically (temp → rename). */
export function writeDotDataJson<T>(baseName: string, data: T): void {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, `${baseName}.json`);
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, p);
}
