/**
 * Local evaluation persistence layer.
 * Reads/writes JSON files in `.data/` directory.
 * NOT the long-term production architecture — meant for local eval runs.
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
  ensureDataDir();
  const path = filePath(name);
  const tmp = path + ".tmp";
  const json = JSON.stringify(data, null, 2);
  writeFileSync(tmp, json, "utf-8");
  renameSync(tmp, path);
}
