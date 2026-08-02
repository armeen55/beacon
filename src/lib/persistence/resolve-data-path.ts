/**
 * Sprint 7 Phase 7.8b-2-a (2026-04-25) — shared `.data` path resolution
 * for the runtime persistence layer.
 *
 * Two consumers:
 *   - `dotdata-json.ts` (Phase 7.8b-1): supplementary blob reads/writes.
 *   - `json-store.ts`   (Phase 7.8b-2-b): in-process-cached array stores.
 *
 * Both classify stores via `store-classification.classifyStore()` and
 * route reads/writes to the per-tenant / singleton / global / flat
 * destination accordingly. This shared module keeps the dispatch in
 * one place — drift between the two helpers is structurally
 * impossible.
 *
 * Cache-key contract (for json-store's in-process Map):
 *   - per-tenant / singleton: `${name}::tenant:${slug}`
 *   - global                : `${name}::global`
 *   - unknown               : `${name}::flat`
 *
 * The cache key is included in `ResolvedPath` even though dotdata-json
 * doesn't cache — keeping the shape stable lets json-store reuse the
 * resolution without a parallel implementation.
 *
 * Module-level path constants are computed at call time (via getter
 * functions, not import-time constants) so tests can `process.chdir()`
 * into a tmpdir and have routing follow.
 */

import { join } from "node:path";

import { getDataDir } from "@/lib/tenant";
import { currentTenantSlug, slugForTenantId } from "@/lib/tenant-context";

import { classifyStore, type StoreScope } from "./store-classification";

const rootDataDir = (): string => join(process.cwd(), ".data");
const globalDir = (): string => join(rootDataDir(), "global");

type ResolvedPath = {
  /** Where the store sits in the four-way classification. */
  scope: StoreScope;
  /** Directory the routed file lives in (for ensureDir / mkdir). */
  routedDir: string;
  /** Absolute path to the routed `.json` file. */
  routedPath: string;
  /** Absolute path to the flat `.data/{name}.json` (used by the
   *  Phase 7.8b read-only fallback). */
  flatPath: string;
  /** In-process cache key. See module docstring for the four shapes. */
  cacheKey: string;
};

/**
 * Resolve the routing for a `.data` store name.
 *
 *   - per-tenant array store    → `.data/tenants/{slug}/{name}.json`
 *   - per-tenant singleton      → `.data/tenants/{slug}/{name}.json`
 *   - global                    → `.data/global/{name}.json`
 *   - unknown                   → `.data/{name}.json` (flat — bridge
 *                                  for stores not yet classified;
 *                                  Phase 7.8d will fail loud here.)
 *
 * Pure resolution — no disk I/O, no fallback decision (callers decide
 * routed vs flat based on `existsSync`). Uses `currentTenantSlug` (ambient) for
 * per-tenant + singleton scopes, UNLESS the caller passes an explicit tenantId
 * (P2-f, 2026-07-10 visual audit): a background write outside the render's
 * request scope (e.g. next/server's after()) should resolve the SAME tenant its
 * caller already threaded through explicitly, never re-resolve ambiently.
 */
export async function resolveDataPath(baseName: string, explicitTenantId?: string): Promise<ResolvedPath> {
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
      cacheKey: `${baseName}::global`,
    };
  }

  if (scope === "per-tenant" || scope === "singleton") {
    const slug = explicitTenantId != null ? await slugForTenantId(explicitTenantId) : await currentTenantSlug();
    const tenantDir = getDataDir(slug);
    return {
      scope,
      routedDir: tenantDir,
      routedPath: join(tenantDir, `${baseName}.json`),
      flatPath,
      cacheKey: `${baseName}::tenant:${slug}`,
    };
  }

  // Unknown — an unclassified store name. The runtime read/write helpers
  // (readStore/writeStore in json-store.ts, readDotDataJson/writeDotDataJson in
  // dotdata-json.ts) all THROW on `scope === "unknown"` before they ever touch
  // this flat shape, so this branch is not reachable through them. It is kept
  // only so `resolveDataPath` stays a pure resolver. Log loudly (finding E,
  // 2026-07-18) so that ANY direct/future caller that forgets the scope guard
  // still gets an unmissable signal instead of silently binding to a
  // tenant-blind flat path (`${name}::flat`) — the exact shape that caused the
  // original cross-tenant leak class.
  console.error(
    `[resolve-data-path] unknown store '${baseName}' resolved to a tenant-BLIND flat path. ` +
      `Add it to TENANT_SCOPED_STORES, SINGLETON_STORES, or GLOBAL_STORES in ` +
      `src/lib/persistence/store-classification.ts. Runtime read/write helpers throw on this.`,
  );
  return {
    scope,
    routedDir: root,
    routedPath: flatPath,
    flatPath,
    cacheKey: `${baseName}::flat`,
  };
}
