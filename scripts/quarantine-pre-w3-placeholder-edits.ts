/**
 * W3 Step 3.1b (2026-05-01) — quarantine pre-W3 placeholder
 * recommended_edits.
 *
 * Background:
 *   Step 3.1 hardened the validator + generator so no future
 *   placeholder copy can reach the queue, and added an architecture
 *   invariant scanning .data for active rows containing placeholder
 *   phrases. The invariant carried a temporary 4-ID allowlist for
 *   the Los Altos add_faq rows that operator-accepted before the
 *   hardening. Those rows still render as `accepted` in the
 *   /recommendations queue + /today implementation queue, putting
 *   "Q: ...\n\nA: Draft answer (operator: rewrite). Anchor on:
 *   <descriptors>" copy in front of the operator. That is operator-
 *   visible trust damage.
 *
 *   This script forward-only quarantines the 4 rows: flips
 *   implementation_status `accepted` → `dismissed` and stamps
 *   not_found_reason = "invalid_placeholder_pre_w3" so /changes,
 *   /recommendations, and /today stop rendering them. It also
 *   archives any matching changelog entries (none present in the
 *   local imported-changes.json at the time of writing, but the
 *   script handles them robustly).
 *
 *   The script is intentionally surgical:
 *     - Preserves the sibling H2 row in the same rec
 *       (create_cluster_page:geo:Los Altos__add_h2_section__h2[new]:c75a1120a6aa)
 *       byte-for-byte. Fingerprint captured pre + verified post.
 *     - Preserves the rec-level recommendation_response row
 *       byte-for-byte (deleting it would erase the operator's
 *       acceptance trail).
 *     - Touches NO other recommendation, edit, changelog row, or
 *       store.
 *
 * Modes:
 *   `--dry-run` (default): preflight + plan + exit 0. No writes.
 *   `--execute`: preflight + plan + mutate .data + dual-write to
 *                Supabase + postflight verification.
 *
 * Idempotency:
 *   - Preflight aborts if a target row is already in `dismissed`
 *     state (re-run after a successful execution is a safe no-op
 *     via the abort path; rerun with --execute returns exit code 1
 *     after printing the already-quarantined IDs).
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
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/quarantine-pre-w3-placeholder-edits.ts
 *
 *   # actually mutate:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/quarantine-pre-w3-placeholder-edits.ts --execute
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Hardcoded targets — the entire surface this script can mutate ──

const REC_ID = "create_cluster_page:geo:Los Altos";

/**
 * The 4 placeholder add_faq rows. Each id encodes
 * `${rec_id}__${action_type}__${target_element_key}` per the
 * deterministic-id contract in mapSpecificEditToRow.
 */
const TARGET_IDS = [
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:d1b049c63d8a",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:f2dcb7022c42",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:93a207d063c1",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:ff677f6f3ded",
] as const;

/**
 * Sibling H2 row under the same rec. NEVER MUTATED — preserved
 * byte-for-byte to keep the rec's acceptance trail intact for the
 * non-placeholder edits.
 */
const SIBLING_H2_EDIT_ID =
  "create_cluster_page:geo:Los Altos__add_h2_section__h2[new]:c75a1120a6aa";

const QUARANTINE_REASON = "invalid_placeholder_pre_w3";

// ── env.local loader (mirrors archive-faq-test-pollution.ts) ──

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

function deepFingerprint(obj: unknown): string {
  function stableStringify(v: unknown): string {
    if (v === null || v === undefined) return JSON.stringify(v);
    if (Array.isArray(v)) {
      return "[" + v.map(stableStringify).join(",") + "]";
    }
    if (typeof v === "object") {
      const keys = Object.keys(v as Record<string, unknown>).sort();
      const parts = keys.map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          stableStringify((v as Record<string, unknown>)[k]),
      );
      return "{" + parts.join(",") + "}";
    }
    return JSON.stringify(v);
  }
  return createHash("sha256").update(stableStringify(obj)).digest("hex");
}

type AssertResult = { ok: true } | { ok: false; reason: string };

import type { ChangelogEntry } from "../src/domains/changelog/types";
import type { RecommendedEditRow } from "../src/domains/recommendations/recommended-edits-persistence";

// ── main ──

async function main() {
  const args = new Set(process.argv.slice(2));
  const isExecute = args.has("--execute");
  const mode = isExecute ? "EXECUTE" : "DRY-RUN";

  console.log(`[quarantine-pre-w3] mode=${mode}`);

  const tenantId = process.env.BEACON_TENANT_ID?.trim();
  const tenantSlug = process.env.BEACON_TENANT_SLUG?.trim();
  if (!tenantId) {
    console.error("[quarantine-pre-w3] BEACON_TENANT_ID is required");
    process.exit(1);
  }
  if (!tenantSlug) {
    console.error("[quarantine-pre-w3] BEACON_TENANT_SLUG is required");
    process.exit(1);
  }

  if (isExecute) {
    if (process.env.DUAL_WRITE !== "true") {
      console.warn(
        "[quarantine-pre-w3] DUAL_WRITE != 'true' — Supabase will NOT be updated. .data writes will still proceed.",
      );
    } else {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      if (!url || !key) {
        console.error(
          "[quarantine-pre-w3] DUAL_WRITE=true but NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Aborting before any mutation.",
        );
        process.exit(1);
      }
    }
  }

  // Lazy imports (env must be set first).
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

  // Read all stores.
  const allChangelog =
    (await readDotDataJson<ChangelogEntry[]>("imported-changes")) ?? [];
  const allEdits = await readRecommendedEditsLocal();
  const allResponses =
    (await readDotDataJson<
      Array<{ recId: string; status: string; respondedAt: string }>
    >("recommendation-responses")) ?? [];

  console.log(`[quarantine-pre-w3] loaded:`, {
    changelogEntries: allChangelog.length,
    recommendedEdits: allEdits.length,
    recommendationResponses: allResponses.length,
  });

  // Locate target rows + sibling + rec response.
  const targets: RecommendedEditRow[] = [];
  for (const id of TARGET_IDS) {
    const row = allEdits.find((e) => e.id === id);
    if (!row) {
      console.error(
        `[quarantine-pre-w3] target recommended_edit ${id} not found`,
      );
      process.exit(1);
    }
    targets.push(row);
  }
  const siblingH2 = allEdits.find((e) => e.id === SIBLING_H2_EDIT_ID);
  if (!siblingH2) {
    console.error(
      `[quarantine-pre-w3] sibling H2 ${SIBLING_H2_EDIT_ID} not found — aborting (rec acceptance trail integrity)`,
    );
    process.exit(1);
  }
  const recResponse = allResponses.find((r) => r.recId === REC_ID);
  if (!recResponse) {
    console.error(
      `[quarantine-pre-w3] recommendation_response ${REC_ID} not found — aborting (would orphan rec acceptance trail)`,
    );
    process.exit(1);
  }

  // Preflight: every target must currently be `accepted` (forward-only
  // contract). If any is already `dismissed` we abort with an
  // explicit "already quarantined" message so re-runs surface as a
  // no-op.
  const checks: AssertResult[] = [];
  for (const row of targets) {
    if (row.implementation_status === "dismissed") {
      checks.push({
        ok: false,
        reason: `${row.id} already dismissed (status=${row.implementation_status}, not_found_reason=${row.not_found_reason ?? "(none)"}). Re-run is a no-op; no further action needed.`,
      });
      continue;
    }
    if (row.implementation_status !== "accepted") {
      checks.push({
        ok: false,
        reason: `${row.id} status=${row.implementation_status ?? "(undef)"} — expected "accepted" for the quarantine flip. Aborting to avoid touching a row in an unexpected state.`,
      });
      continue;
    }
    if (row.live_at) {
      checks.push({
        ok: false,
        reason: `${row.id} has live_at=${row.live_at} — this row was implementation-verified. The quarantine path would lose that signal. Aborting.`,
      });
      continue;
    }
    checks.push({ ok: true });
  }
  const failures = checks.filter((c) => !c.ok) as Array<{
    ok: false;
    reason: string;
  }>;
  if (failures.length > 0) {
    console.error(
      "[quarantine-pre-w3] PREFLIGHT FAILED — aborting before any mutation:",
    );
    for (const f of failures) console.error("  - " + f.reason);
    process.exit(1);
  }
  console.log("[quarantine-pre-w3] preflight: OK");

  // Sibling + rec-response fingerprints (postflight byte-equivalence).
  const siblingFp = deepFingerprint(siblingH2);
  const recResponseFp = deepFingerprint(recResponse);
  console.log(
    `[quarantine-pre-w3] sibling H2 fp=${siblingFp.slice(0, 16)} rec response fp=${recResponseFp.slice(0, 16)}`,
  );

  // Find matching changelog rows (best-effort — local file may have
  // zero matches; production Supabase may have N).
  const matchingChangelog: ChangelogEntry[] = [];
  for (const row of targets) {
    const matches = allChangelog.filter(
      (c) =>
        c.source_rec_id === row.rec_id &&
        c.action_type === row.action_type &&
        c.target_element_key === row.target_element_key &&
        !c.archived,
    );
    matchingChangelog.push(...matches);
  }

  // Plan.
  const nowIso = new Date().toISOString();
  const dismissedEdits: RecommendedEditRow[] = targets.map((row) => ({
    ...row,
    implementation_status: "dismissed",
    not_found_reason: QUARANTINE_REASON,
    updated_at: nowIso,
  }));
  const archivedChangelog: ChangelogEntry[] = matchingChangelog.map((c) => ({
    ...c,
    archived: true,
    archived_reason: QUARANTINE_REASON,
    archived_at: nowIso,
  }));

  console.log("[quarantine-pre-w3] PLANNED MUTATIONS:");
  console.log(
    JSON.stringify(
      {
        recommended_edits_dismiss: dismissedEdits.map((e, i) => ({
          id: e.id,
          before: {
            implementation_status: targets[i].implementation_status ?? "(undef)",
            not_found_reason: targets[i].not_found_reason ?? null,
          },
          after: {
            implementation_status: "dismissed",
            not_found_reason: QUARANTINE_REASON,
            updated_at: nowIso,
          },
        })),
        changelog_archive: archivedChangelog.map((c, i) => ({
          id: c.id,
          before: {
            archived: matchingChangelog[i].archived ?? false,
            archived_reason: matchingChangelog[i].archived_reason ?? null,
          },
          after: {
            archived: true,
            archived_reason: QUARANTINE_REASON,
            archived_at: nowIso,
          },
        })),
      },
      null,
      2,
    ),
  );

  if (!isExecute) {
    console.log(
      "[quarantine-pre-w3] DRY-RUN complete. Re-run with --execute to apply mutations.",
    );
    process.exit(0);
  }

  // EXECUTE.
  console.log("[quarantine-pre-w3] executing mutations…");

  // 1. recommended_edits: replace-by-id.
  await persistRecommendedEditsLocal(dismissedEdits);
  console.log("[quarantine-pre-w3] wrote .data recommended-edits.json");

  // 2. changelog: write whole array back with matched entries replaced.
  if (archivedChangelog.length > 0) {
    const archiveById = new Map(archivedChangelog.map((c) => [c.id, c] as const));
    const nextChangelog = allChangelog.map((c) =>
      archiveById.has(c.id) ? archiveById.get(c.id)! : c,
    );
    await writeDotDataJson("imported-changes", nextChangelog);
    console.log(
      `[quarantine-pre-w3] wrote .data imported-changes.json (${archivedChangelog.length} archived)`,
    );
  } else {
    console.log(
      "[quarantine-pre-w3] no local changelog rows match — skipped imported-changes write",
    );
  }

  // 3. Supabase dual-write.
  if (process.env.DUAL_WRITE === "true") {
    await syncRecommendedEdits(dismissedEdits, tenantId);
    console.log(
      `[quarantine-pre-w3] dual-wrote ${dismissedEdits.length} recommended_edits to Supabase`,
    );
    if (archivedChangelog.length > 0) {
      await syncChangelogEntries(archivedChangelog, tenantId);
      console.log(
        `[quarantine-pre-w3] dual-wrote ${archivedChangelog.length} archived changelog rows to Supabase`,
      );
    }
  } else {
    console.warn(
      "[quarantine-pre-w3] DUAL_WRITE != 'true' — Supabase NOT updated",
    );
  }

  // POSTFLIGHT verification.
  console.log("[quarantine-pre-w3] postflight verification…");

  const postEdits = await readRecommendedEditsLocal();
  const postChangelog =
    (await readDotDataJson<ChangelogEntry[]>("imported-changes")) ?? [];
  const postResponses =
    (await readDotDataJson<
      Array<{ recId: string; status: string; respondedAt: string }>
    >("recommendation-responses")) ?? [];

  const postChecks: Array<{ name: string; ok: boolean; detail: string }> = [];

  for (const id of TARGET_IDS) {
    const row = postEdits.find((e) => e.id === id);
    postChecks.push({
      name: `${id} status=dismissed`,
      ok: row?.implementation_status === "dismissed",
      detail: `status=${row?.implementation_status ?? "(missing)"}`,
    });
    postChecks.push({
      name: `${id} not_found_reason=${QUARANTINE_REASON}`,
      ok: row?.not_found_reason === QUARANTINE_REASON,
      detail: `not_found_reason=${row?.not_found_reason ?? "(missing)"}`,
    });
  }

  const postSibling = postEdits.find((e) => e.id === SIBLING_H2_EDIT_ID);
  if (!postSibling) {
    postChecks.push({
      name: "sibling H2 still present",
      ok: false,
      detail: "row missing — rec acceptance trail broken",
    });
  } else {
    const fp = deepFingerprint(postSibling);
    postChecks.push({
      name: "sibling H2 byte-equivalent",
      ok: fp === siblingFp,
      detail: `pre=${siblingFp.slice(0, 16)} post=${fp.slice(0, 16)}`,
    });
  }

  const postRecResponse = postResponses.find((r) => r.recId === REC_ID);
  if (!postRecResponse) {
    postChecks.push({
      name: "rec response still present",
      ok: false,
      detail: "row missing",
    });
  } else {
    const fp = deepFingerprint(postRecResponse);
    postChecks.push({
      name: "rec response byte-equivalent",
      ok: fp === recResponseFp,
      detail: `pre=${recResponseFp.slice(0, 16)} post=${fp.slice(0, 16)}`,
    });
  }

  for (const archived of archivedChangelog) {
    const post = postChangelog.find((c) => c.id === archived.id);
    postChecks.push({
      name: `changelog ${archived.id} archived=true`,
      ok: post?.archived === true,
      detail: `archived=${post?.archived ?? "(missing)"}`,
    });
  }

  for (const check of postChecks) {
    const sym = check.ok ? "OK" : "FAIL";
    console.log(`[quarantine-pre-w3] [${sym}] ${check.name}: ${check.detail}`);
  }
  const anyFailed = postChecks.some((c) => !c.ok);
  if (anyFailed) {
    console.error(
      "[quarantine-pre-w3] POSTFLIGHT FAILURE — investigate immediately",
    );
    process.exit(2);
  }

  console.log(
    "[quarantine-pre-w3] EXECUTE complete. 4 placeholder rows quarantined; sibling H2 + rec response preserved.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[quarantine-pre-w3] uncaught error:", err);
  process.exit(2);
});
