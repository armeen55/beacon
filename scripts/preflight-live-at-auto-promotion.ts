/**
 * preflight-live-at-auto-promotion — Trust Sprint Mini-Phase T7.2.
 *
 * Read-only dry-run. For each `recommended_edits` row whose
 * `implementation_status` is acceptance-tier (accepted / needs_review /
 * wrong_page / partially_implemented / verified_live*) and whose
 * `live_at` is null, this script reports whether a matching element
 * exists in the current `page_element_inventory` — i.e., whether the
 * Phase 3 match runner WOULD stamp `live_at` if the operator flipped
 * `BEACON_LIFECYCLE_ENABLED=1`.
 *
 * No flag flip. No mutation. No scan trigger. No paid APIs.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/preflight-live-at-auto-promotion.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
}

import { readRecommendedEditsLocal } from "../src/domains/recommendations/recommended-edits-persistence";
import type { RecommendedEditRow } from "../src/domains/recommendations/recommended-edits-persistence";
import { normalizeUrl } from "../src/lib/url/normalize";

const REPO_ROOT = resolve(__dirname, "..");
const TENANT_SLUG = process.env.BEACON_TENANT_SLUG ?? "ritz-builders";
const INVENTORY_PATH = join(
  REPO_ROOT,
  ".data",
  "tenants",
  TENANT_SLUG,
  "page-element-inventory.json",
);

type InventoryRow = {
  id: string;
  page_id: string;
  url: string;
  element_type: string;
  element_key: string;
  element_text?: string;
  display_label?: string;
};

const ACCEPTANCE_TIER_STATUSES = new Set([
  "accepted",
  "needs_review",
  "wrong_page",
  "partially_implemented",
  "verified_live",
  "verified_live_modified",
]);

async function main(): Promise<void> {
  console.log("preflight-live-at-auto-promotion — Trust Sprint T7.2");
  console.log("Read-only. No flag flip. No mutation. No paid APIs.\n");

  const recs = await readRecommendedEditsLocal();
  if (!existsSync(INVENTORY_PATH)) {
    console.warn(`Page element inventory not found at ${INVENTORY_PATH}.`);
    console.warn("Match-engine dry-run requires page_element_inventory rows.");
    console.warn("Vercel-only env: page_element_inventory is in Supabase.");
    console.warn("Aborting dry-run; preflight complete.");
    process.exit(0);
  }
  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf-8")) as InventoryRow[];
  console.log(`recommended_edits:        ${recs.length}`);
  console.log(`page_element_inventory:   ${inventory.length}`);

  // Index inventory by (path, element_key) — match-engine's primary key.
  const byPathKey = new Map<string, InventoryRow>();
  for (const inv of inventory) {
    const path = normalizeUrl(inv.url) ?? "";
    if (!path) continue;
    byPathKey.set(`${path}::${inv.element_key}`, inv);
  }

  // Candidates = acceptance-tier rows with null live_at.
  const candidates = recs.filter((r) => {
    const status = r.implementation_status ?? "recommended";
    return ACCEPTANCE_TIER_STATUSES.has(status) && !r.live_at;
  });
  console.log(`acceptance-tier rows with null live_at: ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log("No acceptance-tier rows with null live_at. Either nothing to promote, or every row already has live_at stamped (operator-override path).");
    process.exit(0);
  }

  type Probe = {
    rec_id: string;
    edit_id: string;
    target_url: string;
    target_path: string;
    target_element_key: string | null;
    status: string;
    inventory_match_exact: boolean;
    inventory_match_path_only: number;
    note: string;
  };
  const probes: Probe[] = [];
  for (const r of candidates) {
    const path = normalizeUrl(r.target_url) ?? "";
    const key = r.target_element_key ?? "";
    const exact = key ? Boolean(byPathKey.get(`${path}::${key}`)) : false;
    const pathOnly = inventory.filter((inv) => (normalizeUrl(inv.url) ?? "") === path).length;
    probes.push({
      rec_id: r.rec_id,
      edit_id: r.id,
      target_url: r.target_url,
      target_path: path,
      target_element_key: r.target_element_key ?? null,
      status: r.implementation_status ?? "recommended",
      inventory_match_exact: exact,
      inventory_match_path_only: pathOnly,
      note: exact
        ? "would auto-promote (exact element_key match in current inventory)"
        : pathOnly === 0
          ? "no inventory rows for this URL — would NOT auto-promote (URL has never been crawled OR target_url differs from inventory.url shape)"
          : "URL has inventory rows but no exact element_key match — engine may classify as 'modified' or 'wrong_page' under Phase 3 logic; needs operator review",
    });
  }

  console.log("PROBES:\n");
  for (const p of probes) {
    console.log(`  edit ${p.edit_id.slice(-30)}`);
    console.log(`    rec_id:       ${p.rec_id}`);
    console.log(`    status:       ${p.status}`);
    console.log(`    target_url:   ${p.target_url}`);
    console.log(`    path:         ${p.target_path}`);
    console.log(`    element_key:  ${p.target_element_key ?? "(none)"}`);
    console.log(`    exact match:  ${p.inventory_match_exact}`);
    console.log(`    path matches: ${p.inventory_match_path_only}`);
    console.log(`    → ${p.note}\n`);
  }

  const wouldAutoPromote = probes.filter((p) => p.inventory_match_exact).length;
  const noInventory = probes.filter((p) => p.inventory_match_path_only === 0).length;
  const ambiguous = probes.length - wouldAutoPromote - noInventory;

  console.log("Headline auto-promotion potential:");
  console.log(`  rows that would auto-promote (exact match):     ${wouldAutoPromote}`);
  console.log(`  rows blocked by missing inventory:              ${noInventory}`);
  console.log(`  rows ambiguous (path exists, key differs):      ${ambiguous}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("preflight-live-at-auto-promotion crashed:", err);
  process.exit(2);
});
