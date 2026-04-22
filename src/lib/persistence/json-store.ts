/**
 * On-disk JSON store + in-process cache for `.data/*.json`.
 *
 * **Role today:** Source of truth on disk when `DATA_SOURCE=file`, and the
 * write-through / dual-write target when `DATA_SOURCE=supabase`. Route reads
 * go through `SeedDataRepository` — app code should not call `readStore` for
 * route-critical entities except inside repository backends, writers, CLI, or
 * `storage/canonical-store.ts` (Profound pipeline only).
 *
 * - Synchronous read on first access (cached in-process thereafter)
 * - Atomic writes via temp-file + rename
 * - Serialized writes per store name to prevent corruption
 */

import "server-only";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), ".data");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(name: string): string {
  return join(DATA_DIR, `${name}.json`);
}

const cache = new Map<string, unknown[]>();
const writeLocks = new Map<string, Promise<void>>();

/**
 * Read a named store. Returns cached array on subsequent calls.
 * If no file exists, returns a copy of `fallback` (default: []).
 * The returned array IS the cache — mutations to it are visible
 * to all subsequent `readStore` calls for the same name.
 */
export function readStore<T>(name: string, fallback?: T[]): T[] {
  if (cache.has(name)) return cache.get(name) as T[];

  ensureDataDir();
  const path = filePath(name);

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      const data = JSON.parse(raw) as T[];
      cache.set(name, data);
      return data;
    } catch {
      // Corrupted file — fall through to defaults
    }
  }

  const initial = fallback ? [...fallback] : [];
  cache.set(name, initial);
  return initial as T[];
}

/**
 * Persist a named store to disk. Uses atomic write (temp → rename).
 * Serialized per name so concurrent calls don't corrupt.
 */
export async function writeStore<T>(name: string, data: T[]): Promise<void> {
  const prev = writeLocks.get(name) ?? Promise.resolve();
  const next = prev.then(() => atomicWrite(name, data));
  writeLocks.set(name, next.catch(() => {}));
  await next;
}

async function atomicWrite(name: string, data: unknown[]): Promise<void> {
  // Phase 3.5A (2026-04-22): Vercel's lambda FS is read-only; `mkdirSync`
  // on `.data/` throws EROFS. Update the in-process cache only and skip disk.
  // Supabase dual-write is called by the store modules AFTER writeStore, so
  // persistent state still lands in the DB. Stores that aren't yet
  // dual-written no-op on hosted — matches the "expected broken" guardrail.
  if (process.env.VERCEL === "1") {
    cache.set(name, data);
    return;
  }

  ensureDataDir();
  const path = filePath(name);

  // Guard: don't overwrite a non-empty import-runs file with an empty array.
  // This prevents the module-cache startup race where readStore("import-runs")
  // returns [] (before the file is populated), then writeStore flushes the
  // empty cache. Scoped to import-runs specifically to avoid blocking
  // legitimate empty-store writes in other modules.
  if (data.length === 0 && name === "import-runs" && existsSync(path)) {
    try {
      const existing = JSON.parse(readFileSync(path, "utf-8"));
      if (Array.isArray(existing) && existing.length > 0) {
        cache.set(name, existing);
        return;
      }
    } catch {
      // Corrupted file — OK to overwrite
    }
  }

  const tmp = path + ".tmp";
  const json = JSON.stringify(data, null, 2);
  writeFileSync(tmp, json, "utf-8");
  renameSync(tmp, path);
  cache.set(name, data);
}
