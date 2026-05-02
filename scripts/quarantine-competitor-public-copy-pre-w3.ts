/**
 * W3 Step 3.5b.A (2026-05-02) — quarantine pre-W3 competitor-public-
 * copy leaks in recommended_edits.
 *
 * Background:
 *   Step 3.4 + Step 3.5 hardened the LLM provider + UI, but the queue
 *   still carries one operator-accepted edit whose `proposed_text` /
 *   `display_label` contains a competitor's name in visitor-readable
 *   copy:
 *
 *     create_cluster_page:geo:Los Altos__add_h2_section__h2[new]:c75a1120a6aa
 *     proposed_text  = "Why teams choose us over De Mattei Construction"
 *     display_label  = `H2 heading (new): "Why teams choose us over De Mattei Construction"`
 *
 *   This row predates the W3 hardening; the validator's competitor-
 *   public-copy gate would reject it on regenerate, but it sits in
 *   the queue right now and renders to the operator. Per founder
 *   direction (2026-05-02): "Competitor names are fine in evidence.
 *   They are not fine in proposed public copy unless you explicitly
 *   approve comparison pages later."
 *
 *   Forward-only quarantine: flip status → "dismissed",
 *   not_found_reason → "invalid_competitor_public_copy_pre_w3".
 *   Preserves history; UI filters dismissed rows.
 *
 *   The script is intentionally narrow: it targets ONE id (the
 *   De Mattei row) to avoid false-positive alias matches like
 *   "Bay" (stripped from "Bay Builders") matching "Bay Area"
 *   geographic references in unrelated rows. Future leaks should
 *   be added to TARGET_IDS deliberately.
 *
 * Modes:
 *   `--dry-run` (default): preflight + plan + exit 0. No writes.
 *   `--execute`: preflight + plan + mutate .data + dual-write to
 *                Supabase + postflight verification.
 *
 * Idempotency:
 *   - Preflight aborts if the target row is already dismissed.
 *   - All writes are replace-by-id.
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
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/quarantine-competitor-public-copy-pre-w3.ts
 *
 *   # actually mutate:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/quarantine-competitor-public-copy-pre-w3.ts --execute
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET_IDS = [
  // Operator-flagged 2026-05-02: H2 proposes "Why teams choose us
  // over De Mattei Construction" — competitor name in public copy.
  "create_cluster_page:geo:Los Altos__add_h2_section__h2[new]:c75a1120a6aa",
] as const;

const QUARANTINE_REASON = "invalid_competitor_public_copy_pre_w3";

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

import type { RecommendedEditRow } from "../src/domains/recommendations/recommended-edits-persistence";

async function main() {
  const args = new Set(process.argv.slice(2));
  const isExecute = args.has("--execute");
  const mode = isExecute ? "EXECUTE" : "DRY-RUN";
  console.log(`[quarantine-competitor-public-copy] mode=${mode}`);

  const tenantId = process.env.BEACON_TENANT_ID?.trim();
  if (!tenantId) {
    console.error("[quarantine-competitor-public-copy] BEACON_TENANT_ID is required");
    process.exit(1);
  }

  if (isExecute && process.env.DUAL_WRITE !== "true") {
    console.warn(
      "[quarantine-competitor-public-copy] DUAL_WRITE != 'true' — Supabase will NOT be updated.",
    );
  }

  const {
    readRecommendedEditsLocal,
    persistRecommendedEditsLocal,
  } = await import(
    "../src/domains/recommendations/recommended-edits-persistence"
  );
  const { syncRecommendedEdits } = await import(
    "../src/lib/persistence/dual-write"
  );

  const allEdits = await readRecommendedEditsLocal();
  console.log(
    `[quarantine-competitor-public-copy] loaded recommended_edits=${allEdits.length}`,
  );

  // Locate targets + preflight.
  const targets: RecommendedEditRow[] = [];
  const issues: string[] = [];
  for (const id of TARGET_IDS) {
    const row = allEdits.find((e) => e.id === id);
    if (!row) {
      issues.push(`target ${id} not found`);
      continue;
    }
    if (row.implementation_status === "dismissed") {
      issues.push(
        `${id} already dismissed (reason=${row.not_found_reason ?? "(none)"})`,
      );
      continue;
    }
    if (row.live_at) {
      issues.push(
        `${id} has live_at=${row.live_at} — implementation-verified; aborting to avoid losing the live signal`,
      );
      continue;
    }
    targets.push(row);
  }

  if (issues.length > 0) {
    console.error(
      "[quarantine-competitor-public-copy] preflight issues:",
    );
    for (const m of issues) console.error("  - " + m);
    if (targets.length === 0) {
      console.log(
        "[quarantine-competitor-public-copy] no targets to mutate; exit 0",
      );
      process.exit(0);
    }
  }

  // Plan.
  const nowIso = new Date().toISOString();
  const dismissed: RecommendedEditRow[] = targets.map((row) => ({
    ...row,
    implementation_status: "dismissed",
    not_found_reason: QUARANTINE_REASON,
    updated_at: nowIso,
  }));

  console.log(
    "[quarantine-competitor-public-copy] PLANNED MUTATIONS:",
  );
  for (const row of targets) {
    console.log(
      JSON.stringify(
        {
          id: row.id,
          before: {
            implementation_status: row.implementation_status ?? "(undef)",
            not_found_reason: row.not_found_reason ?? null,
          },
          after: {
            implementation_status: "dismissed",
            not_found_reason: QUARANTINE_REASON,
            updated_at: nowIso,
          },
          proposed_text_excerpt: (row.proposed_text ?? "").slice(0, 120),
        },
        null,
        2,
      ),
    );
  }

  if (!isExecute) {
    console.log(
      "[quarantine-competitor-public-copy] DRY-RUN complete. Re-run with --execute to apply.",
    );
    process.exit(0);
  }

  // Execute.
  console.log("[quarantine-competitor-public-copy] executing…");

  // Capture pre-state fingerprints for postflight (any row NOT in targets
  // must remain byte-identical).
  const preFingerprintsByOtherId = new Map<string, string>();
  for (const row of allEdits) {
    if (TARGET_IDS.includes(row.id as (typeof TARGET_IDS)[number])) continue;
    preFingerprintsByOtherId.set(row.id, deepFingerprint(row));
  }

  await persistRecommendedEditsLocal(dismissed);
  console.log(
    "[quarantine-competitor-public-copy] wrote .data recommended-edits.json",
  );

  if (process.env.DUAL_WRITE === "true") {
    await syncRecommendedEdits(dismissed, tenantId);
    console.log(
      `[quarantine-competitor-public-copy] dual-wrote ${dismissed.length} row(s) to Supabase`,
    );
  }

  // Postflight.
  console.log("[quarantine-competitor-public-copy] postflight verification…");
  const postEdits = await readRecommendedEditsLocal();
  let allOk = true;
  for (const id of TARGET_IDS) {
    const row = postEdits.find((e) => e.id === id);
    const ok =
      row?.implementation_status === "dismissed" &&
      row?.not_found_reason === QUARANTINE_REASON;
    console.log(
      `  [${ok ? "OK" : "FAIL"}] ${id} — status=${row?.implementation_status ?? "(missing)"} reason=${row?.not_found_reason ?? "(missing)"}`,
    );
    if (!ok) allOk = false;
  }
  // Confirm no other rows changed.
  for (const row of postEdits) {
    if (TARGET_IDS.includes(row.id as (typeof TARGET_IDS)[number])) continue;
    const pre = preFingerprintsByOtherId.get(row.id);
    if (!pre) continue;
    const post = deepFingerprint(row);
    if (post !== pre) {
      console.error(
        `  [FAIL] non-target row ${row.id} changed (pre=${pre.slice(0, 16)} post=${post.slice(0, 16)})`,
      );
      allOk = false;
    }
  }
  if (!allOk) {
    console.error(
      "[quarantine-competitor-public-copy] POSTFLIGHT FAILURE",
    );
    process.exit(2);
  }
  console.log(
    "[quarantine-competitor-public-copy] EXECUTE complete. Competitor-leak rows dismissed; non-target rows byte-identical.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(
    "[quarantine-competitor-public-copy] uncaught error:",
    err,
  );
  process.exit(2);
});
