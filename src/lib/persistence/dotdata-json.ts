/**
 * Raw disk read for `.data/{name}.json` (no json-store cache).
 *
 * Sprint 7 Phase 7.8b-1 (2026-04-25) — async + tenant-aware + flat
 * fallback. Routes per-tenant / singleton stores to
 * `.data/tenants/{slug}/{name}.json` and global stores to
 * `.data/global/{name}.json`. If the routed file is missing AND a flat
 * `.data/{name}.json` exists, reads return the flat copy with a `warn`
 * log so the operator sees when fallback fires (transitional state
 * between 7.8a runtime conversion and 7.8c migration `--commit`).
 *
 * Writes never fall back to flat — they always go to the routed path.
 *
 * **Allowed call sites:** `file-backend` / `supabase-backend` (supplementary blobs),
 * plus the two documented exceptions: `universe-read.ts` when `DATA_SOURCE=file`
 * (pin metadata), and `topics/page.tsx` server action (fresh read at mutation time).
 * Elsewhere prefer `getRepository()` or domain store modules.
 */
import "server-only";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { log } from "@/lib/logger";
import { getDataDir } from "@/lib/tenant";
import { currentTenantSlug } from "@/lib/tenant-context";
import { classifyStore, type StoreScope } from "./store-classification";

// Phase 7.8b-1 (2026-04-25): computed at call time (not module load)
// so tests can `process.chdir()` into a tmpdir and have routing follow.
const rootDataDir = (): string => join(process.cwd(), ".data");
const globalDir = (): string => join(rootDataDir(), "global");

type ResolvedPath = {
  scope: StoreScope;
  routedDir: string;
  routedPath: string;
  flatPath: string;
};

/**
 * Decide where a given `.data` store lives.
 *
 *   - global stores             → `.data/global/{name}.json`
 *   - per-tenant / singleton    → `.data/tenants/{slug}/{name}.json`
 *   - unknown                   → `.data/{name}.json` (flat — no
 *                                 reclassification yet; treat unknowns
 *                                 as still-flat to keep them readable)
 *
 * Pure resolution. The actual fallback (routed → flat) happens in
 * `readDotDataJson`.
 */
async function resolveDataPath(baseName: string): Promise<ResolvedPath> {
  const scope = classifyStore(baseName);
  const root = rootDataDir();
  const flatPath = join(root, `${baseName}.json`);

  if (scope === "global") {
    const gd = globalDir();
    return {
      scope,
      routedDir: gd,
      routedPath: join(gd, `${baseName}.json`),
      flatPath,
    };
  }

  if (scope === "per-tenant" || scope === "singleton") {
    const slug = await currentTenantSlug();
    const tenantDir = getDataDir(slug);
    return {
      scope,
      routedDir: tenantDir,
      routedPath: join(tenantDir, `${baseName}.json`),
      flatPath,
    };
  }

  // Unknown — keep using flat. Phase 7.8d will move flat → _legacy
  // and fail loud on unknowns; until then, "unknown" stays flat so
  // legacy stores keep working.
  return {
    scope,
    routedDir: root,
    routedPath: flatPath,
    flatPath,
  };
}

/**
 * Read `.data/{name}.json` from the per-tenant or global subdir if
 * available; fall back to flat `.data/{name}.json` (with a warn log)
 * during the Phase 7.8b → 7.8c transition. Returns null if neither
 * exists or the file is malformed.
 */
export async function readDotDataJson<T>(baseName: string): Promise<T | null> {
  try {
    const resolved = await resolveDataPath(baseName);

    if (existsSync(resolved.routedPath)) {
      return JSON.parse(readFileSync(resolved.routedPath, "utf8")) as T;
    }

    // Routed file missing — try the flat fallback.
    if (
      resolved.scope !== "unknown" &&
      resolved.routedPath !== resolved.flatPath &&
      existsSync(resolved.flatPath)
    ) {
      log.warn("[dotdata-json] flat-fallback read", {
        baseName,
        scope: resolved.scope,
        routedPath: resolved.routedPath,
        flatPath: resolved.flatPath,
      });
      return JSON.parse(readFileSync(resolved.flatPath, "utf8")) as T;
    }

    if (resolved.scope === "unknown" && existsSync(resolved.flatPath)) {
      // Unknown stores already resolve to the flat path; this branch
      // catches the case where resolveDataPath returned the flat path
      // and we can read it directly.
      return JSON.parse(readFileSync(resolved.flatPath, "utf8")) as T;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Write `.data/{name}.json` atomically (temp → rename) into the
 * resolved per-tenant or global subdir. Writes NEVER fall back to flat.
 *
 * Phase 3.5A (2026-04-22): Vercel's lambda FS is read-only; skip disk
 * writes on hosted. Callers that need durability must pair this with a
 * Supabase dual-write; stores without dual-write silently no-op on hosted.
 */
export async function writeDotDataJson<T>(
  baseName: string,
  data: T,
): Promise<void> {
  if (process.env.VERCEL === "1") return;

  const resolved = await resolveDataPath(baseName);

  if (!existsSync(resolved.routedDir)) {
    mkdirSync(resolved.routedDir, { recursive: true });
  }
  const tmp = resolved.routedPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, resolved.routedPath);
}
