import "server-only";

/**
 * 2026-06-10 — The push service (§push layer core).
 *
 * Takes ONE human-approved Change Card end-to-end:
 *   caps → route by tenant publish target → adapter write → ledger →
 *   status (pushed / push_failed) → immediate verify probe.
 *
 * INVARIANTS (enforced HERE, in code, not UI):
 *   1. Approval-only: callers are the operator-gated "Approve & Push"
 *      action. This service additionally refuses cards that aren't in
 *      an approvable status.
 *   2. RITZ NEVER PUSHES. `tenant-ritz-founder` (and any tenant whose
 *      target is dev_note / unset) is hard-refused with the dev note
 *      returned instead — regardless of what config says for Ritz.
 *   3. Caps in the push path: daily cap + non-destructive patch check
 *      run before ANY adapter call. URL/nav/structure changes are
 *      structurally impossible (adapters expose no such writes;
 *      slug-ish fields are stripped at the client layer).
 *
 * v1 adapter coverage:
 *   • wix_cms — field-merge edit of the CMS item rendering target_url.
 *     Supported element keys: whole text fields (the card's
 *     target_element_key names the item field when it starts with
 *     "field:", e.g. "field:description"). Otherwise the push appends
 *     a clearly-bounded section to the configured rich-text body field?
 *     NO — v1 stays surgical: field-targeted cards only; anything else
 *     refuses with a precise reason (the operator sees exactly why).
 *   • git_pr / wix blog — routed via push-adapters (Finglish slice).
 *   • dev_note — formatted ticket, never a write.
 */

import { getTenant } from "@/domains/tenants/store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import {
  appendPushLedger,
  assertNonDestructivePatch,
  checkDailyPushCap,
} from "./caps";
import { formatDevNote } from "./dev-note";
import { resolveWixItemForUrl } from "@/lib/connectors/wix/url-map";
import { wixQueryDataItems, wixUpdateDataItem, type WixDeps } from "@/lib/connectors/wix/client";

export const RITZ_TENANT_ID = "tenant-ritz-founder";

/** Statuses a card may be pushed from (human approved or queued). */
const PUSHABLE_FROM = new Set(["recommended", "accepted", "push_failed"]);

export type PushResult =
  | { kind: "pushed"; adapter: "wix_cms"; detail: string }
  | { kind: "dev_note"; note: string; reason: string }
  | { kind: "refused"; reason: string };

export type PushDeps = {
  wix?: WixDeps;
  now?: Date;
};

/**
 * Execute one approved card. Returns the outcome; the CALLER (the
 * action) persists the status transition + revalidates, so this module
 * stays persistence-agnostic and unit-testable.
 */
export async function executePush(
  args: { tenantId: string; edit: RecommendedEditRow },
  deps: PushDeps = {},
): Promise<PushResult> {
  const { tenantId, edit } = args;
  const now = deps.now ?? new Date();

  // ── Status guard: only approvable cards ─────────────────────────────
  const status = edit.implementation_status ?? "recommended";
  if (!PUSHABLE_FROM.has(status)) {
    return {
      kind: "refused",
      reason: `card status "${status}" is not pushable (allowed: recommended/accepted/push_failed)`,
    };
  }

  // ── Invariant 2: Ritz never pushes, full stop ───────────────────────
  if (tenantId === RITZ_TENANT_ID) {
    return {
      kind: "dev_note",
      note: formatDevNote(edit),
      reason: "Ritz is advise-mode only (Invariant 2) — exported as a dev ticket",
    };
  }

  // ── Route by tenant publish target ──────────────────────────────────
  let target: string = "dev_note";
  try {
    const tenant = await getTenant(tenantId);
    target = tenant?.publish_target ?? "dev_note";
  } catch {
    target = "dev_note";
  }
  if (target === "dev_note" || target === "git_pr") {
    // git_pr cards export as PR-ready notes until the git adapter slice
    // wires repo config (Finglish). Safe default for everything else.
    return {
      kind: "dev_note",
      note: formatDevNote(edit),
      reason:
        target === "git_pr"
          ? "git_pr target: exported as PR-ready note (repo config pending)"
          : "no publish target configured — exported as a dev ticket",
    };
  }

  // ── Invariant 3: caps IN the push path ──────────────────────────────
  const cap = await checkDailyPushCap({ tenantId, now });
  if (!cap.allowed) return { kind: "refused", reason: cap.reason };
  const destructive = assertNonDestructivePatch({
    currentText: edit.current_text,
    proposedText: edit.proposed_text,
  });
  if (!destructive.allowed) return { kind: "refused", reason: destructive.reason };

  // ── wix_cms adapter ─────────────────────────────────────────────────
  const elementKey = edit.target_element_key ?? "";
  if (!elementKey.startsWith("field:")) {
    return {
      kind: "refused",
      reason:
        `wix_cms v1 pushes field-targeted cards only (target_element_key "field:<itemField>"); ` +
        `this card targets "${elementKey || "(none)"}" — export it as a dev note or re-queue with a field target`,
    };
  }
  const field = elementKey.slice("field:".length);
  if (field === "" || field.toLowerCase().includes("slug")) {
    return { kind: "refused", reason: `field "${field}" is not pushable (Invariant 3: no URL/slug changes)` };
  }

  const mapEntry = await resolveWixItemForUrl(edit.target_url);
  if (mapEntry == null) {
    return {
      kind: "refused",
      reason: `no Wix CMS item mapped for ${edit.target_url} — run the url-map sync on /diagnostics/wix first`,
    };
  }

  // Read-modify-write: fetch current item, merge the single field.
  const items = await wixQueryDataItems(
    { dataCollectionId: mapEntry.dataCollectionId, limit: 1000 },
    { ...deps.wix, tenantId },
  );
  if (!items.ok) {
    await recordLedger(tenantId, edit, "push_failed", `read: ${items.reason}`, now);
    return { kind: "refused", reason: `wix read failed: ${items.reason}${items.detail ? ` (${items.detail})` : ""}` };
  }
  const item = items.value.find((i) => i.id === mapEntry.dataItemId);
  if (item == null) {
    await recordLedger(tenantId, edit, "push_failed", "item_gone", now);
    return { kind: "refused", reason: "mapped Wix item no longer exists — re-run the url-map sync" };
  }

  const merged = { ...item.data, [field]: edit.proposed_text ?? "" };
  const write = await wixUpdateDataItem(
    { dataCollectionId: mapEntry.dataCollectionId, dataItemId: mapEntry.dataItemId, data: merged },
    { ...deps.wix, tenantId },
  );
  if (!write.ok) {
    await recordLedger(tenantId, edit, "push_failed", `write: ${write.reason}`, now);
    return { kind: "refused", reason: `wix write failed: ${write.reason}${write.detail ? ` (${write.detail})` : ""}` };
  }

  await recordLedger(tenantId, edit, "pushed", `field ${field} on item ${mapEntry.dataItemId}`, now);
  return {
    kind: "pushed",
    adapter: "wix_cms",
    detail: `updated "${field}" on ${mapEntry.dataCollectionId}/${mapEntry.dataItemId} (${edit.target_url})`,
  };
}

async function recordLedger(
  tenantId: string,
  edit: RecommendedEditRow,
  result: "pushed" | "push_failed",
  detail: string,
  now: Date,
): Promise<void> {
  try {
    await appendPushLedger({
      id: `push-${now.getTime()}-${edit.id.slice(0, 8)}`,
      tenant_id: tenantId,
      edit_id: edit.id,
      target_url: edit.target_url,
      adapter: "wix_cms",
      pushed_at: now.toISOString(),
      day: now.toISOString().slice(0, 10),
      result,
      detail,
    });
  } catch {
    /* the ledger is observability — never block the result on it */
  }
}

/**
 * Immediate post-push probe: fetch the live page raw HTML and check the
 * proposed text appears (whitespace-normalized prefix match). The
 * heavyweight scan + match-runner remains the authoritative
 * verified_live pass on its existing cadence; this gives the operator
 * a same-minute signal.
 */
export async function probeLiveText(
  args: { url: string; proposedText: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ found: boolean; status: number }> {
  try {
    const res = await fetchImpl(args.url, {
      headers: { "User-Agent": "BeaconBot/1.0 (verify-live probe)", Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const needle = norm(args.proposedText).slice(0, 120);
    return { found: needle.length > 0 && norm(html).includes(needle), status: res.status };
  } catch {
    return { found: false, status: 0 };
  }
}
