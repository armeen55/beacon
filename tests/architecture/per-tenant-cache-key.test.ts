/**
 * 2026-06-11 (night shift) — PER-TENANT CACHE-KEY RATCHET.
 *
 * Companion to `tenant-scoped-reads.test.ts`, which polices the
 * `getRepository().getX()` *call shape*. That ratchet is structurally
 * BLIND to a second isolation bug: a module-global mutable cache that
 * hydrates from a TENANT_SCOPED store but is keyed by NOTHING. In a warm
 * multi-tenant process the FIRST tenant pins its rows for every later
 * tenant; the ambient per-tenant *disk* routing masks it (correct on a
 * cold process, first-tenant's data on a warm one), so no behavioral test
 * caught it either. Six such leaks were found + fixed on 2026-06-11
 * (brief-generation, visibility-observation-explicit, answer-snapshots,
 * frontier-compiler, competitor-evidence, canonical-store) — see
 * `docs/AUDIT_50_MULTI_TENANT_FIXES.md` §I.
 *
 * INVARIANT: any module that declares a process-global `_state` cache
 * (`let _state` / `const _state =`, this codebase's universal store-cache
 * idiom) AND reads from a store (`readStore(...)` / `getRepository()`)
 * MUST be tenant-aware — it must reference `currentTenantId` (the
 * sanctioned fix keys a `Map<string, …>` by it). The ONLY exceptions are
 * genuinely GLOBAL stores (no tenant_id on rows), listed + justified in
 * the allowlist below.
 *
 * To satisfy this test for a NEW store: key the cache by tenant
 *   const _byTenant = new Map<string, T[]>();
 *   const ensureLoaded = cache(async () => {
 *     const id = await currentTenantId();
 *     const hit = _byTenant.get(id); if (hit) return hit;
 *     const loaded = await readStore(...); _byTenant.set(id, loaded); return loaded;
 *   });
 * — never a single module-global `_state`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * Allowlisted module-global `_state` store caches. Each entry must name
 * WHY it is exempt — one of two reasons:
 *   (a) GLOBAL store (operator-shared, NO tenant_id on rows) — a single
 *       process cache is correct; there is no tenant to key by.
 *   (b) KNOWN DAYLIGHT DEBT — a tenant-scoped cache deliberately deferred
 *       (large blast radius), already tracked in the sibling
 *       `tenant-scoped-reads.test.ts` allowlist. Burn down, never grow.
 */
const ALLOWLIST = new Set<string>([
  // (a) GLOBAL: prompt-library is classified GLOBAL in
  // store-classification.ts — an operator-shared corpus with no tenant_id
  // column. A single process cache is correct; there is no tenant to key by.
  "domains/prompts/prompt-library.ts",
  // (b) seed-data.server.ts — BURNED DOWN 2026-06-12. Refactored from one
  // process-global `_state` (read via the non-tenant-filtered base
  // getRepository()) to a per-tenant `_stateByTenant` Map keyed by
  // currentTenantId, reading through getRepository().forTenant(tenantId).
  // No longer a tenant-blind cache → allowlist entry removed. (The cron
  // proof run had bled the founder's 289-entry changelog into every
  // tenant; see proof-engine + this refactor.)
]);

/**
 * A SECOND, related footgun: a module-global tenant POINTER
 * (`let _<x>Tenant: string | null`) that sync code reads to pick a slot
 * in a per-tenant Map. The data is per-tenant (never pinned), but the
 * pointer is shared — if a sync consumer runs without first warming the
 * pointer for the active tenant, it reads whatever tenant warmed last.
 */
// The final pointer exception was removed on 2026-07-12: attribution
// candidates now select registry/topic-index Maps by explicit tenantId.
const POINTER_ALLOWLIST = new Set<string>();

function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("per-tenant cache-key ratchet — no tenant-blind module-global store cache", () => {
  it("every module with a `_state` store cache is tenant-aware or an allowlisted GLOBAL store", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const raw = readFileSync(file, "utf8");
      const src = stripComments(raw);
      const rel = file.slice(SRC.length + 1);

      const hasStateCache = /^(let|const)\s+_state\b/m.test(src);
      if (!hasStateCache) continue;
      const readsStore = /\breadStore\s*[<(]/.test(src) || /getRepository\s*\(/.test(src);
      if (!readsStore) continue; // a pure in-memory _state, not a store cache
      const tenantAware = /currentTenantId/.test(src);
      if (tenantAware) continue; // keyed by tenant — the sanctioned fix
      if (ALLOWLIST.has(rel)) continue; // verified GLOBAL store

      offenders.push(
        `${rel}: module-global \`_state\` cache over a store, not keyed by currentTenantId ` +
          `(per-tenant Map, or allowlist if the store is GLOBAL)`,
      );
    }
    expect(
      offenders,
      `Tenant-blind module-global store cache(s) — first tenant leaks to all in a warm process:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("allowlist has no STALE entries (each file exists + still holds a `_state` store cache)", () => {
    const stale: string[] = [];
    for (const rel of ALLOWLIST) {
      let src = "";
      try {
        src = stripComments(readFileSync(join(SRC, rel), "utf8"));
      } catch {
        stale.push(`${rel} (file gone — remove from allowlist)`);
        continue;
      }
      const hasStateCache = /^(let|const)\s+_state\b/m.test(src);
      const readsStore = /\breadStore\s*[<(]/.test(src) || /getRepository\s*\(/.test(src);
      if (!hasStateCache || !readsStore) {
        stale.push(`${rel} (no longer a _state store cache — remove from allowlist)`);
      }
    }
    expect(stale, `Stale allowlist entries:\n${stale.join("\n")}`).toEqual([]);
  });
});

describe("per-tenant pointer ratchet — no tenant-blind process-global tenant pointer", () => {
  // A module-level `let _<x>Tenant: string | null` that sync code reads to
  // index a per-tenant Map. Safe ONLY if every sync consumer is preceded by
  // a same-tenant warm; otherwise a warm process serves the last-warmed
  // tenant's slot to a different tenant. New instances must be allowlisted
  // with a justification + a tracked fix.
  const POINTER_DECL = /^\s*let\s+_[a-zA-Z]*[Tt]enant\b[^=\n]*:\s*string\s*\|\s*null/m;

  it("no NEW process-global tenant pointer (the candidates.ts sync-resolver footgun)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = stripComments(readFileSync(file, "utf8"));
      const rel = file.slice(SRC.length + 1);
      if (!POINTER_DECL.test(src)) continue;
      if (POINTER_ALLOWLIST.has(rel)) continue;
      offenders.push(
        `${rel}: process-global tenant pointer — a sync consumer running without a same-tenant ` +
          `warm reads the last-warmed tenant's slot. Warm-before-use, thread tenantId, or allowlist with a tracked fix.`,
      );
    }
    expect(
      offenders,
      `NEW process-global tenant pointer(s) — cross-tenant footgun:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("pointer allowlist has no STALE entries (each file exists + still declares the pointer)", () => {
    const stale: string[] = [];
    for (const rel of POINTER_ALLOWLIST) {
      let src = "";
      try {
        src = stripComments(readFileSync(join(SRC, rel), "utf8"));
      } catch {
        stale.push(`${rel} (file gone — remove from pointer allowlist)`);
        continue;
      }
      if (!POINTER_DECL.test(src)) {
        stale.push(`${rel} (no longer declares a tenant pointer — remove from pointer allowlist)`);
      }
    }
    expect(stale, `Stale pointer-allowlist entries:\n${stale.join("\n")}`).toEqual([]);
  });
});
