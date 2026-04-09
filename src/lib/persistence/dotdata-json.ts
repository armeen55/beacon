import { existsSync, readFileSync } from "node:fs";
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
