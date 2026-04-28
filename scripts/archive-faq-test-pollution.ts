/**
 * Phase 6A.1 (2026-04-28) — archive Whole Home Remodel FAQ test pollution.
 *
 * Background:
 *   The Recommendation Lifecycle OS positive-control test on 2026-04-27
 *   accepted three edits under rec
 *     create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)
 *   targeting `/services/whole-home-remodel`. Only the H2 was actually
 *   implemented on Ritz; the two FAQ edits were accepted-only and never
 *   shipped. The match engine correctly verified the H2 (live_at +
 *   live_snapshot_id stamped) and correctly did NOT match the FAQ pair.
 *
 *   This script archives the two unimplemented FAQ rows so they stop
 *   appearing in /changes alongside real verified-live work, while
 *   preserving the H2 row entirely (it is the lifecycle OS positive
 *   control). It also dismisses the FAQ recommended_edits rows so the
 *   /recommendations surface (once Phase 6A.5 ships lifecycle pills)
 *   reflects the operator's untrack decision.
 *
 * What this script does NOT touch:
 *   - The H2 changelog entry `cl-mogzw78nv8pu54` and its `live_at`,
 *     `live_snapshot_id`, `live_match_*`, `live_element_key` fields.
 *   - The H2 recommended_edits row.
 *   - The rec-level recommendation_responses row (rec-level keying:
 *     deleting it would erase H2's acceptance trail since the H2 lives
 *     under the same rec).
 *   - Any other recommendation, edit, or changelog row.
 *
 * Modes:
 *   `--dry-run` (default): preflight + plan + exit 0. No writes.
 *   `--execute`: preflight + plan + mutate .data + dual-write to Supabase
 *                + postflight verification.
 *
 * Idempotency:
 *   - Preflight aborts if the FAQ rows already look archived/dismissed,
 *     so a re-run after a successful execution is a no-op safely.
 *   - All writes are replace-by-id (recommended_edits) or in-place
 *     mutation of the changelog array (imported-changes).
 *
 * Required env (loaded from .env.local if present):
 *   BEACON_TENANT_ID                  e.g. tenant-ritz-founder
 *   BEACON_TENANT_SLUG                e.g. ritz-builders
 *   DUAL_WRITE                        "true" to dual-write to Supabase
 *   NEXT_PUBLIC_SUPABASE_URL          required when DUAL_WRITE=true
 *   SUPABASE_SERVICE_ROLE_KEY         required when DUAL_WRITE=true
 *
 * Run:
 *   # dry-run (default; safe to run anywhere):
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/archive-faq-test-pollution.ts
 *
 *   # actually mutate:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/archive-faq-test-pollution.ts --execute
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Hardcoded targets (the entire surface this script can mutate) ──

const REC_ID =
  "create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)";

/** H2 — the verified-live positive control. NEVER MUTATED. */
const H2_CHANGELOG_ID = "cl-mogzw78nv8pu54";
const H2_RECOMMENDED_EDIT_ID =
  "create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)__add_h2_section__h2[new]:a1b2c3d4e5f6g7h8";

/** FAQ Q — accepted only; archive + dismiss. */
const FAQ_Q_CHANGELOG_ID = "cl-mogzw78n87lkhq";
const FAQ_Q_RECOMMENDED_EDIT_ID =
  "create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)__add_faq__faq_question[new]:b1c2d3e4f5g6h7i8";

/** FAQ A — accepted only; archive + dismiss. */
const FAQ_A_CHANGELOG_ID = "cl-mogzw78n5j9e7u";
const FAQ_A_RECOMMENDED_EDIT_ID =
  "create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)__add_faq__faq_answer[new]:c1d2e3f4g5h6i7j8";

const ARCHIVED_REASON = "test_pollution:faq_never_implemented";

// ── env.local loader (mirrors run-scheduled-scan.ts) ──

function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

// ── helpers ──

function fingerprint(obj: unknown): string {
  // Stable, sort-key JSON for byte-equivalent comparison even if the
  // file's pretty-printed key order changes.
  return createHash("sha256")
    .update(JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort()))
    .digest("hex")
    .slice(0, 16);
}

function deepFingerprint(obj: unknown): string {
  // Recursive stable stringify for objects (sorts keys at every level).
  function stableStringify(v: unknown): string {
    if (v === null || v === undefined) return JSON.stringify(v);
    if (Array.isArray(v)) {
      return "[" + v.map(stableStringify).join(",") + "]";
    }
    if (typeof v === "object") {
      const keys = Object.keys(v as Record<string, unknown>).sort();
      const parts = keys.map(
        (k) =>
          JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k]),
      );
      return "{" + parts.join(",") + "}";
    }
    return JSON.stringify(v);
  }
  return createHash("sha256").update(stableStringify(obj)).digest("hex");
}

type AssertResult = { ok: true } | { ok: false; reason: string };

function assertH2Verified(
  changelog: ChangelogEntry,
  edit: RecommendedEditRow,
): AssertResult {
  if (changelog.id !== H2_CHANGELOG_ID) {
    return { ok: false, reason: `H2 changelog id mismatch: ${changelog.id}` };
  }
  if (!changelog.live_at) {
    return {
      ok: false,
      reason: `H2 changelog ${changelog.id} missing live_at`,
    };
  }
  if (changelog.archived) {
    return {
      ok: false,
      reason: `H2 changelog ${changelog.id} is already archived (cleanup would orphan the verified-live row)`,
    };
  }
  if (edit.id !== H2_RECOMMENDED_EDIT_ID) {
    return { ok: false, reason: `H2 edit id mismatch: ${edit.id}` };
  }
  if (edit.implementation_status !== "verified_live") {
    return {
      ok: false,
      reason: `H2 edit ${edit.id} status=${String(edit.implementation_status)} (expected verified_live)`,
    };
  }
  if (!edit.live_at) {
    return { ok: false, reason: `H2 edit ${edit.id} missing live_at` };
  }
  if (edit.live_match_confidence !== "high") {
    return {
      ok: false,
      reason: `H2 edit ${edit.id} live_match_confidence=${String(edit.live_match_confidence)} (expected high)`,
    };
  }
  return { ok: true };
}

function assertFaqAccepted(
  label: string,
  changelogId: string,
  editId: string,
  changelog: ChangelogEntry,
  edit: RecommendedEditRow,
): AssertResult {
  if (changelog.id !== changelogId) {
    return {
      ok: false,
      reason: `${label} changelog id mismatch: ${changelog.id}`,
    };
  }
  if (changelog.live_at) {
    return {
      ok: false,
      reason: `${label} changelog ${changelog.id} has live_at=${changelog.live_at} (expected null/absent — would mean it WAS implemented)`,
    };
  }
  if (changelog.archived) {
    return {
      ok: false,
      reason: `${label} changelog ${changelog.id} already archived — re-run is a no-op (idempotency guard)`,
    };
  }
  if (edit.id !== editId) {
    return {
      ok: false,
      reason: `${label} edit id mismatch: ${edit.id}`,
    };
  }
  if (edit.implementation_status !== "accepted") {
    return {
      ok: false,
      reason: `${label} edit ${edit.id} status=${String(edit.implementation_status)} (expected accepted)`,
    };
  }
  if (edit.live_at) {
    return {
      ok: false,
      reason: `${label} edit ${edit.id} has live_at=${edit.live_at} (expected null — would mean it WAS implemented)`,
    };
  }
  return { ok: true };
}

// ── types (re-imported below to keep top-level small) ──

import type { ChangelogEntry } from "../src/domains/changelog/types";
import type { RecommendedEditRow } from "../src/domains/recommendations/recommended-edits-persistence";

// ── main ──

async function main() {
  const args = new Set(process.argv.slice(2));
  const isExecute = args.has("--execute");
  const mode = isExecute ? "EXECUTE" : "DRY-RUN";

  console.log(`[archive-faq] mode=${mode}`);

  // Required env (fail-loud)
  const tenantId = process.env.BEACON_TENANT_ID?.trim();
  const tenantSlug = process.env.BEACON_TENANT_SLUG?.trim();
  if (!tenantId) {
    console.error("[archive-faq] BEACON_TENANT_ID is required");
    process.exit(1);
  }
  if (!tenantSlug) {
    console.error("[archive-faq] BEACON_TENANT_SLUG is required");
    process.exit(1);
  }

  if (isExecute) {
    if (process.env.DUAL_WRITE !== "true") {
      console.warn(
        "[archive-faq] DUAL_WRITE != 'true' — Supabase will NOT be updated. .data writes will still proceed.",
      );
    } else {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      if (!url || !key) {
        console.error(
          "[archive-faq] DUAL_WRITE=true but NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Aborting before any mutation.",
        );
        process.exit(1);
      }
    }
  }

  // ── Lazy imports (env must be set first) ──
  const { readDotDataJson, writeDotDataJson } = await import(
    "../src/lib/persistence/dotdata-json"
  );
  const {
    readRecommendedEditsLocal,
    persistRecommendedEditsLocal,
  } = await import(
    "../src/domains/recommendations/recommended-edits-persistence"
  );
  const { syncChangelogEntries, syncRecommendedEdits } = await import(
    "../src/lib/persistence/dual-write"
  );

  // ── Read both stores + the rec-level response we MUST NOT touch ──
  const allChangelog =
    (await readDotDataJson<ChangelogEntry[]>("imported-changes")) ?? [];
  const allEdits = await readRecommendedEditsLocal();
  const allResponses =
    (await readDotDataJson<
      Array<{ recId: string; status: string; respondedAt: string }>
    >("recommendation-responses")) ?? [];

  console.log(`[archive-faq] loaded:`, {
    changelogEntries: allChangelog.length,
    recommendedEdits: allEdits.length,
    recommendationResponses: allResponses.length,
  });

  // ── Locate the 6 target rows ──
  const h2Changelog = allChangelog.find((c) => c.id === H2_CHANGELOG_ID);
  const faqQChangelog = allChangelog.find((c) => c.id === FAQ_Q_CHANGELOG_ID);
  const faqAChangelog = allChangelog.find((c) => c.id === FAQ_A_CHANGELOG_ID);
  const h2Edit = allEdits.find((e) => e.id === H2_RECOMMENDED_EDIT_ID);
  const faqQEdit = allEdits.find((e) => e.id === FAQ_Q_RECOMMENDED_EDIT_ID);
  const faqAEdit = allEdits.find((e) => e.id === FAQ_A_RECOMMENDED_EDIT_ID);
  const recResponse = allResponses.find((r) => r.recId === REC_ID);

  if (!h2Changelog) {
    console.error(`[archive-faq] H2 changelog ${H2_CHANGELOG_ID} not found`);
    process.exit(1);
  }
  if (!faqQChangelog) {
    console.error(
      `[archive-faq] FAQ Q changelog ${FAQ_Q_CHANGELOG_ID} not found`,
    );
    process.exit(1);
  }
  if (!faqAChangelog) {
    console.error(
      `[archive-faq] FAQ A changelog ${FAQ_A_CHANGELOG_ID} not found`,
    );
    process.exit(1);
  }
  if (!h2Edit) {
    console.error(
      `[archive-faq] H2 recommended_edit ${H2_RECOMMENDED_EDIT_ID} not found`,
    );
    process.exit(1);
  }
  if (!faqQEdit) {
    console.error(
      `[archive-faq] FAQ Q recommended_edit ${FAQ_Q_RECOMMENDED_EDIT_ID} not found`,
    );
    process.exit(1);
  }
  if (!faqAEdit) {
    console.error(
      `[archive-faq] FAQ A recommended_edit ${FAQ_A_RECOMMENDED_EDIT_ID} not found`,
    );
    process.exit(1);
  }
  if (!recResponse) {
    console.error(
      `[archive-faq] recommendation_response ${REC_ID} not found — would orphan H2 acceptance trail`,
    );
    process.exit(1);
  }

  // ── PREFLIGHT assertions ──
  const checks: AssertResult[] = [
    assertH2Verified(h2Changelog, h2Edit),
    assertFaqAccepted(
      "FAQ Q",
      FAQ_Q_CHANGELOG_ID,
      FAQ_Q_RECOMMENDED_EDIT_ID,
      faqQChangelog,
      faqQEdit,
    ),
    assertFaqAccepted(
      "FAQ A",
      FAQ_A_CHANGELOG_ID,
      FAQ_A_RECOMMENDED_EDIT_ID,
      faqAChangelog,
      faqAEdit,
    ),
  ];
  const failures = checks.filter((c) => !c.ok) as Array<{
    ok: false;
    reason: string;
  }>;
  if (failures.length > 0) {
    console.error(
      "[archive-faq] PREFLIGHT FAILED — aborting before any mutation:",
    );
    for (const f of failures) console.error("  - " + f.reason);
    process.exit(1);
  }
  console.log("[archive-faq] preflight: OK");

  // ── Capture H2 + rec response fingerprints for postflight comparison ──
  const h2ChangelogFp = deepFingerprint(h2Changelog);
  const h2EditFp = deepFingerprint(h2Edit);
  const recResponseFp = deepFingerprint(recResponse);

  console.log("[archive-faq] H2 + rec response fingerprints captured:", {
    h2Changelog: h2ChangelogFp.slice(0, 16),
    h2Edit: h2EditFp.slice(0, 16),
    recResponse: recResponseFp.slice(0, 16),
  });

  // ── Plan ──
  const nowIso = new Date().toISOString();

  const archivedFaqQ: ChangelogEntry = {
    ...faqQChangelog,
    archived: true,
    archived_reason: ARCHIVED_REASON,
    archived_at: nowIso,
  };
  const archivedFaqA: ChangelogEntry = {
    ...faqAChangelog,
    archived: true,
    archived_reason: ARCHIVED_REASON,
    archived_at: nowIso,
  };
  const dismissedFaqQEdit: RecommendedEditRow = {
    ...faqQEdit,
    implementation_status: "dismissed",
    not_found_reason: ARCHIVED_REASON,
    updated_at: nowIso,
  };
  const dismissedFaqAEdit: RecommendedEditRow = {
    ...faqAEdit,
    implementation_status: "dismissed",
    not_found_reason: ARCHIVED_REASON,
    updated_at: nowIso,
  };

  console.log("[archive-faq] PLANNED MUTATIONS (4 rows):");
  console.log(JSON.stringify(
    {
      changelog_archive: [
        {
          id: archivedFaqQ.id,
          before: { archived: faqQChangelog.archived ?? false, archived_at: faqQChangelog.archived_at ?? null },
          after: { archived: true, archived_reason: ARCHIVED_REASON, archived_at: nowIso },
        },
        {
          id: archivedFaqA.id,
          before: { archived: faqAChangelog.archived ?? false, archived_at: faqAChangelog.archived_at ?? null },
          after: { archived: true, archived_reason: ARCHIVED_REASON, archived_at: nowIso },
        },
      ],
      recommended_edits_dismiss: [
        {
          id: dismissedFaqQEdit.id,
          before: { implementation_status: faqQEdit.implementation_status ?? "(undefined)", not_found_reason: faqQEdit.not_found_reason ?? null },
          after: { implementation_status: "dismissed", not_found_reason: ARCHIVED_REASON, updated_at: nowIso },
        },
        {
          id: dismissedFaqAEdit.id,
          before: { implementation_status: faqAEdit.implementation_status ?? "(undefined)", not_found_reason: faqAEdit.not_found_reason ?? null },
          after: { implementation_status: "dismissed", not_found_reason: ARCHIVED_REASON, updated_at: nowIso },
        },
      ],
    },
    null,
    2,
  ));

  if (!isExecute) {
    console.log(
      "[archive-faq] DRY-RUN complete. Re-run with --execute to apply mutations.",
    );
    process.exit(0);
  }

  // ── EXECUTE ──
  console.log("[archive-faq] executing mutations…");

  // 1. changelog: write whole array back with FAQ entries replaced in place.
  const nextChangelog = allChangelog.map((c) => {
    if (c.id === FAQ_Q_CHANGELOG_ID) return archivedFaqQ;
    if (c.id === FAQ_A_CHANGELOG_ID) return archivedFaqA;
    return c;
  });
  await writeDotDataJson("imported-changes", nextChangelog);
  console.log("[archive-faq] wrote .data imported-changes.json");

  // 2. recommended_edits: replace-by-id for the two FAQ rows.
  await persistRecommendedEditsLocal([dismissedFaqQEdit, dismissedFaqAEdit]);
  console.log("[archive-faq] wrote .data recommended-edits.json");

  // 3. Supabase dual-write (only if DUAL_WRITE=true).
  if (process.env.DUAL_WRITE === "true") {
    await syncChangelogEntries([archivedFaqQ, archivedFaqA], tenantId);
    console.log("[archive-faq] dual-wrote 2 changelog rows to Supabase");
    await syncRecommendedEdits([dismissedFaqQEdit, dismissedFaqAEdit], tenantId);
    console.log("[archive-faq] dual-wrote 2 recommended_edits rows to Supabase");
  } else {
    console.warn("[archive-faq] DUAL_WRITE != 'true' — Supabase NOT updated");
  }

  // ── POSTFLIGHT verification ──
  console.log("[archive-faq] postflight verification…");

  const postChangelog =
    (await readDotDataJson<ChangelogEntry[]>("imported-changes")) ?? [];
  const postEdits = await readRecommendedEditsLocal();
  const postResponses =
    (await readDotDataJson<
      Array<{ recId: string; status: string; respondedAt: string }>
    >("recommendation-responses")) ?? [];

  const postH2Changelog = postChangelog.find((c) => c.id === H2_CHANGELOG_ID);
  const postH2Edit = postEdits.find((e) => e.id === H2_RECOMMENDED_EDIT_ID);
  const postRecResponse = postResponses.find((r) => r.recId === REC_ID);
  const postFaqQChangelog = postChangelog.find(
    (c) => c.id === FAQ_Q_CHANGELOG_ID,
  );
  const postFaqAChangelog = postChangelog.find(
    (c) => c.id === FAQ_A_CHANGELOG_ID,
  );
  const postFaqQEdit = postEdits.find((e) => e.id === FAQ_Q_RECOMMENDED_EDIT_ID);
  const postFaqAEdit = postEdits.find((e) => e.id === FAQ_A_RECOMMENDED_EDIT_ID);

  const postChecks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // H2 byte-equivalent check
  if (!postH2Changelog) {
    postChecks.push({ name: "H2 changelog still present", ok: false, detail: "row missing" });
  } else {
    const fp = deepFingerprint(postH2Changelog);
    postChecks.push({
      name: "H2 changelog byte-equivalent",
      ok: fp === h2ChangelogFp,
      detail: `pre=${h2ChangelogFp.slice(0, 16)} post=${fp.slice(0, 16)}`,
    });
  }
  if (!postH2Edit) {
    postChecks.push({ name: "H2 edit still present", ok: false, detail: "row missing" });
  } else {
    const fp = deepFingerprint(postH2Edit);
    postChecks.push({
      name: "H2 edit byte-equivalent",
      ok: fp === h2EditFp,
      detail: `pre=${h2EditFp.slice(0, 16)} post=${fp.slice(0, 16)}`,
    });
  }

  // rec response unchanged
  if (!postRecResponse) {
    postChecks.push({
      name: "rec response still present",
      ok: false,
      detail: "row missing — H2 acceptance trail broken!",
    });
  } else {
    const fp = deepFingerprint(postRecResponse);
    postChecks.push({
      name: "rec response byte-equivalent",
      ok: fp === recResponseFp,
      detail: `pre=${recResponseFp.slice(0, 16)} post=${fp.slice(0, 16)}`,
    });
  }

  // FAQ archived/dismissed
  postChecks.push({
    name: "FAQ Q changelog archived=true",
    ok: postFaqQChangelog?.archived === true,
    detail: `archived=${postFaqQChangelog?.archived}`,
  });
  postChecks.push({
    name: "FAQ A changelog archived=true",
    ok: postFaqAChangelog?.archived === true,
    detail: `archived=${postFaqAChangelog?.archived}`,
  });
  postChecks.push({
    name: "FAQ Q edit implementation_status=dismissed",
    ok: postFaqQEdit?.implementation_status === "dismissed",
    detail: `status=${postFaqQEdit?.implementation_status}`,
  });
  postChecks.push({
    name: "FAQ A edit implementation_status=dismissed",
    ok: postFaqAEdit?.implementation_status === "dismissed",
    detail: `status=${postFaqAEdit?.implementation_status}`,
  });

  // H2 live_at unchanged
  postChecks.push({
    name: "H2 changelog live_at unchanged",
    ok: postH2Changelog?.live_at === h2Changelog.live_at,
    detail: `pre=${h2Changelog.live_at} post=${postH2Changelog?.live_at}`,
  });
  postChecks.push({
    name: "H2 edit live_at unchanged",
    ok: postH2Edit?.live_at === h2Edit.live_at,
    detail: `pre=${h2Edit.live_at} post=${postH2Edit?.live_at}`,
  });

  for (const check of postChecks) {
    const sym = check.ok ? "OK" : "FAIL";
    console.log(`[archive-faq] [${sym}] ${check.name}: ${check.detail}`);
  }
  const anyFailed = postChecks.some((c) => !c.ok);
  if (anyFailed) {
    console.error("[archive-faq] POSTFLIGHT FAILURE — investigate immediately");
    process.exit(2);
  }

  console.log(
    "[archive-faq] EXECUTE complete. H2 preserved, FAQ rows archived/dismissed.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[archive-faq] uncaught error:", err);
  process.exit(2);
});
