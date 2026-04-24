/**
 * Manual on-demand recommendation-pipeline diagnostic (read-only).
 *
 * Runs the exact same pipeline /recommendations uses (matrix → generate →
 * buildPageInventory → resolvePageIntent) against LIVE Supabase data.
 * Prints a debug table per target cluster so you can see why the resolver
 * chose Create / Strengthen / Expand / Review.
 *
 * Use this when:
 *   - /recommendations shows surprising or wrong actions on hosted
 *   - Suspect inventory truncation (Supabase row caps), scoring bugs,
 *     snapshot join issues, or cluster-label mismatches
 *
 * Reads only. No writes. No LLM. Does not run as part of CI or deploys.
 *
 * Usage:
 *   DATA_SOURCE=supabase npx tsx --require ./scripts/mock-server-only.cjs scripts/diag-recommendations.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── .env.local loader ──
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const k = trimmed.slice(0, eq);
      const v = trimmed.slice(eq + 1);
      process.env[k] ??= v;
    }
  }
}
// Force supabase reads for the repository layer
process.env.DATA_SOURCE = "supabase";

import { getSupabaseAdmin } from "../src/lib/persistence/supabase";
import { buildPromptDecisionMatrix } from "../src/domains/prompts/decision-matrix";
import { generateRecommendations } from "../src/domains/recommendations/generate";
import {
  resolvePageIntent,
} from "../src/domains/recommendations/resolve-page-intent";
import {
  buildPageInventory,
  matchClusterToInventory,
} from "../src/domains/recommendations/page-inventory";
import type { TrackedPrompt } from "../src/domains/tracked-prompts/types";
import type { TrackedEntity } from "../src/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "../src/domains/prompt-answer-observations/types";
import type { PageEntity, PageSnapshot } from "../src/domains/pages/types";
import { NATIVE_REGIME_START } from "../src/domains/product/url-citation-history";

const TARGET_CLUSTERS = [
  "Luxury Home Builder Bay Area",
  "Custom Home Builder Bay Area",
  "Los Altos",
  "Palo Alto",
  "Atherton",
  "Cupertino",
  "Whole Home Renovation Builders",
  "Already Have Architectural Plans",
  "Build on My Lot",
  "Design-Build",
];

const EXPECTED_URLS = [
  "/luxury-home-builder-bay-area",
  "/custom-home-builder-bay-area",
  "/locations/los-altos",
  "/locations/palo-alto",
  "/locations/atherton",
  "/locations/cupertino-custom-home-builder",
  "/services/whole-home-remodel",
  "/services/build-on-your-lot",
  "/services/architect-provided-plans",
  "/services/design-build",
];

async function pageAll<T>(table: string, opts?: { orderBy?: string }): Promise<T[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = sb.from(table).select("*").range(from, from + PAGE - 1);
    if (opts?.orderBy) q = q.order(opts.orderBy, { ascending: false });
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function normHost(u: string): string {
  try {
    return new URL(u).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normPath(u: string): string {
  try {
    const p = new URL(u).pathname;
    return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  } catch {
    return "";
  }
}

async function main() {
  console.log("── Phase 2.5-DIAG: recommendation pipeline against live Supabase ──\n");
  console.log(`NATIVE_REGIME_START = ${NATIVE_REGIME_START}\n`);

  // ── Load data ──
  console.log("Loading from Supabase…");
  const [prompts, entities, observations, pages, allSnapshots] = await Promise.all([
    pageAll<TrackedPrompt>("tracked_prompts"),
    pageAll<TrackedEntity>("tracked_entities"),
    pageAll<PromptAnswerObservation>("prompt_answer_observations"),
    pageAll<PageEntity>("pages"),
    pageAll<PageSnapshot>("page_snapshots", { orderBy: "fetched_at" }),
  ]);

  // dedupe snapshots by page_id (keep latest) — same as supabase-backend.ts
  const seenPageIds = new Set<string>();
  const snapshots: PageSnapshot[] = [];
  for (const s of allSnapshots) {
    if (seenPageIds.has(s.page_id)) continue;
    seenPageIds.add(s.page_id);
    snapshots.push(s);
  }

  console.log(
    `  prompts=${prompts.length}  entities=${entities.length}  observations=${observations.length}`,
  );
  console.log(
    `  pages=${pages.length}  page_snapshots=${allSnapshots.length} → ${snapshots.length} latest per page`,
  );

  // ── Owned entity sanity ──
  const ownedEntities = entities.filter((e) => e.is_owned === true);
  console.log("\n── Owned tracked_entities ──");
  for (const e of ownedEntities) {
    console.log(`  ${e.name}  domain=${e.domain}  is_active=${e.is_active}`);
  }

  // ── Build inventory ──
  const inventory = buildPageInventory({
    pages,
    snapshots,
    activeEntities: entities,
  });
  console.log(`\n── Page inventory size: ${inventory.length} entries ──`);

  // Verify 10 expected URLs are in inventory
  console.log("\n── Expected URL presence in buildPageInventory ──");
  for (const expected of EXPECTED_URLS) {
    const match = inventory.find((e) => normPath(e.url) === expected);
    if (match) {
      console.log(
        `  ✓ ${expected}  (title=${match.title ?? "NULL"}, h1=${match.h1 ? "set" : "NULL"}, h2s=${match.h2s.length}, routeType=${match.routeType}, geo=${match.detectedGeo ?? "-"}, svc=${match.detectedService ?? "-"})`,
      );
    } else {
      console.log(`  ✗ ${expected}  — NOT IN INVENTORY`);
    }
  }

  // Emerald Hills
  {
    const eh = inventory.find((e) => e.url.endsWith("/locations/emerald-hills"));
    if (eh) {
      console.log(
        `  (extra) /locations/emerald-hills  title=${eh.title ?? "NULL"}, routeType=${eh.routeType}, geo=${eh.detectedGeo ?? "-"}`,
      );
    }
  }

  // ── Build matrix + candidates ──
  const matrix = buildPromptDecisionMatrix({
    prompts,
    observations,
    activeEntities: entities,
    now: new Date(),
  });
  const candidates = generateRecommendations({
    matrix,
    activeEntities: entities,
    trackedPrompts: prompts,
  });
  console.log(`\n── generateRecommendations: ${candidates.length} candidates ──`);

  // Resolve
  const resolved = resolvePageIntent({
    candidates,
    observations,
    activeEntities: entities,
    pageInventory: inventory,
  });

  // ── Per-cluster debug table ──
  const ownedHosts = new Set(
    ownedEntities.map((e) => (e.domain ?? "").toLowerCase().replace(/^www\./, "")).filter(Boolean),
  );

  function isOwnedUrl(rawUrl: string): boolean {
    const h = normHost(rawUrl);
    if (!h) return false;
    if (ownedHosts.has(h)) return true;
    for (const owned of ownedHosts) if (h.endsWith(`.${owned}`)) return true;
    return false;
  }

  for (const target of TARGET_CLUSTERS) {
    console.log(`\n══════════════ ${target} ══════════════`);
    const matches = resolved.filter(
      (r) =>
        (r.clusterLabel ?? r.title ?? "")
          .toLowerCase()
          .includes(target.toLowerCase()),
    );
    if (matches.length === 0) {
      console.log("  (no candidate found matching this label)");
      continue;
    }
    for (const c of matches.slice(0, 3)) {
      const label = c.clusterLabel ?? c.title ?? "";
      const kind = c.clusterKind;
      const affected = c.affectedPromptIds;
      const affectedSet = new Set(affected);

      // Count observations on this cluster, and owned-URL citations
      let obsInCluster = 0;
      let obsPostNative = 0;
      let obsWithOwnedCitation = 0;
      const ownedCitesByUrl = new Map<string, number>();
      for (const o of observations) {
        if (!affectedSet.has(o.prompt_id)) continue;
        obsInCluster += 1;
        if (o.observed_at.slice(0, 10) < NATIVE_REGIME_START) continue;
        obsPostNative += 1;
        let ownedHit = false;
        const seenInObs = new Set<string>();
        for (const u of o.citation_urls ?? []) {
          if (!u || !isOwnedUrl(u)) continue;
          const canon = normHost(u) + normPath(u);
          if (seenInObs.has(canon)) continue;
          seenInObs.add(canon);
          ownedCitesByUrl.set(canon, (ownedCitesByUrl.get(canon) ?? 0) + 1);
          ownedHit = true;
        }
        if (ownedHit) obsWithOwnedCitation += 1;
      }

      console.log(`  clusterLabel:  ${label}`);
      console.log(`  clusterKind:   ${kind}`);
      console.log(`  candidate.type:${c.type}  title="${c.title}"`);
      console.log(
        `  affectedPrompts=${affected.length}  obsInCluster=${obsInCluster}  obsPostNative=${obsPostNative}  obsWithOwnedCitation=${obsWithOwnedCitation}`,
      );
      if (ownedCitesByUrl.size > 0) {
        const top = [...ownedCitesByUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        console.log(`  owned URL citation counts (top 5):`);
        for (const [u, n] of top) {
          console.log(`     ${n}× ${u}   (share=${((n / obsPostNative) * 100).toFixed(1)}%)`);
        }
      } else {
        console.log(`  owned URL citation counts: (none)`);
      }

      // Layer 2 — run matchClusterToInventory manually with the same label
      const layer2 = matchClusterToInventory({
        label,
        kind,
        inventory,
        topN: 10,
      });
      console.log(`  ── matchClusterToInventory top 10 ──`);
      for (const m of layer2) {
        console.log(
          `    score=${m.score.toFixed(3)}  ${m.url}  routeType=${m.entry.routeType}  geo=${m.entry.detectedGeo ?? "-"}  svc=${m.entry.detectedService ?? "-"}${m.isBundled ? "  [BUNDLED]" : ""}`,
        );
        for (const r of m.reasons) console.log(`        • ${r}`);
      }

      // Final resolution
      const res = c.resolution;
      console.log(`  ── final resolver output ──`);
      console.log(`    action:           ${res.action}`);
      console.log(`    motive:           ${res.motive}`);
      console.log(`    tier:             ${res.tier}`);
      console.log(`    confidence:       ${res.confidence}`);
      console.log(`    confidenceReason: ${res.confidenceReason}`);
      console.log(`    reasoning:        ${res.reasoning.slice(0, 200)}`);
      console.log(`    targetUrl:        ${res.targetUrl}`);
      console.log(`    coverage:         ${res.coverage ?? "-"}`);
    }
  }

  // Summary counts
  const byAction = new Map<string, number>();
  for (const r of resolved) byAction.set(r.resolution.action, (byAction.get(r.resolution.action) ?? 0) + 1);
  console.log("\n── resolved.action counts (all candidates) ──");
  for (const [a, n] of [...byAction.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3, " ")} · ${a}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Error:", err);
    process.exit(1);
  },
);
