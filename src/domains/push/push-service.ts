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
 *
 * ROUTING MAP (audit #33, 2026-06-12) — which Wix surface each card
 * shape writes to, and with what verb:
 *   • "create:<collectionId>"  → CMS collection INSERT
 *       wixInsertDataItem (POST). New page; refuses if the URL already
 *       maps to an item.
 *   • action_type "add_schema" → Wix STORES product seoData
 *       wixGetStoreProduct → wixUpdateProductSeoData (PATCH, seoData
 *       only — renders server-side in <head>, overrides pattern tags).
 *       CMS dynamic pages have NO per-item SEO field (platform design)
 *       → those cards refuse here and stay paste-ready (dashboard
 *       template path documented in CONNECTOR_RESEARCH_2026-06-12.md).
 *   • "field:<itemField>"      → CMS collection item UPDATE
 *       wixQueryDataItems → wixUpdateDataItem (PUT, full-item replace —
 *       hence the read-modify-write merge below; a bare PUT without the
 *       merge would null every other field).
 *   • Blog posts are NOT pushed from here — the Finglish adapter slice
 *       (wixCreateDraftPost → wixPublishDraftPost) routes via
 *       push-adapters under the git_pr/dev_note targets above.
 */

import { getTenant } from "@/domains/tenants/store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import {
  appendPushLedger,
  assertNonDestructivePatch,
  checkDailyPushCap,
} from "./caps";
import { formatDevNote } from "./dev-note";
import { appendPushSnapshot } from "./push-snapshots";
import { resolveWixItemForUrl } from "@/lib/connectors/wix/url-map";
import {
  wixGetStoreProduct,
  wixInsertDataItem,
  wixQueryDataItems,
  wixUpdateDataItem,
  wixUpdateProductSeoData,
  type WixDeps,
  type WixSeoTag,
} from "@/lib/connectors/wix/client";


/** Parse every <script type="application/ld+json">…</script> block out
 *  of a draft. Returns the raw JSON strings (validated as JSON). */
export function extractJsonLdScriptBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      JSON.parse(m[1]!);
      out.push(m[1]!);
    } catch {
      // skip unparseable block
    }
  }
  return out;
}

/** Decoded last path segment of a URL ("" when none). */
export function lastPathSegment(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter((s) => s.length > 0);
    const last = segs[segs.length - 1] ?? "";
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return "";
  }
}

export const RITZ_TENANT_ID = "tenant-ritz-founder";

/** Statuses a card may be pushed from (human approved or queued). */
const PUSHABLE_FROM = new Set(["recommended", "accepted", "push_failed"]);

export type PushResult =
  | { kind: "pushed"; adapter: "wix_cms"; detail: string }
  /** Audit #35 (2026-06-12): dry-run ran EVERY guard + resolution the
   *  real push would (caps, destructive check, item/product lookup,
   *  Wix limits) and stopped before ANY side effect — no snapshot, no
   *  ledger, no adapter write. `detail` says exactly what would land. */
  | { kind: "dry_run"; adapter: "wix_cms"; detail: string }
  | { kind: "dev_note"; note: string; reason: string }
  | { kind: "refused"; reason: string };

export type PushDeps = {
  wix?: WixDeps;
  now?: Date;
};

/** Wix documents ≤5 structured-data markups per page — enforced on the
 *  MERGED tag set (existing + incoming), not just the incoming blocks,
 *  so repeated pushes of different @types can't pile past the limit. */
export const MAX_JSONLD_TAGS_PER_PAGE = 5;
/** Conservative ceiling on a serialized CMS item write. Wix doesn't
 *  publish a hard item-size limit; 1 MB is far past any sane text
 *  field and refusing locally beats an opaque API 4xx. */
export const MAX_CMS_ITEM_BYTES = 1_000_000;

/**
 * Execute one approved card. Returns the outcome; the CALLER (the
 * action) persists the status transition + revalidates, so this module
 * stays persistence-agnostic and unit-testable.
 *
 * `dryRun: true` exercises the full guard + resolution path and
 * returns `{kind: "dry_run"}` instead of writing (audit #35).
 */
export async function executePush(
  args: { tenantId: string; edit: RecommendedEditRow; dryRun?: boolean },
  deps: PushDeps = {},
): Promise<PushResult> {
  const { tenantId, edit } = args;
  const dryRun = args.dryRun === true;
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

  // ── wix_cms CREATE route (§page-factory) ────────────────────────────
  // Cards with element key "create:<collectionId>" insert a NEW item.
  // proposed_text is the JSON of the new item's fields (slug included —
  // a new page has no URL to *change*). Refuses if the URL already maps
  // to an existing item (creation never overwrites).
  const elementKey = edit.target_element_key ?? "";
  if (elementKey.startsWith("create:")) {
    const collectionId = elementKey.slice("create:".length);
    if (collectionId === "") {
      return { kind: "refused", reason: "create card missing collection id" };
    }
    let fields: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(edit.proposed_text ?? "");
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      fields = parsed as Record<string, unknown>;
    } catch {
      return { kind: "refused", reason: "create card proposed_text is not a JSON object of CMS fields" };
    }
    const existing = await resolveWixItemForUrl(edit.target_url);
    if (existing != null) {
      return {
        kind: "refused",
        reason: `a CMS item already renders ${edit.target_url} — creation never overwrites (use a field: edit card)`,
      };
    }
    if (dryRun) {
      return {
        kind: "dry_run",
        adapter: "wix_cms",
        detail: `would create a new item in ${collectionId} (${edit.target_url}) with ${Object.keys(fields).length} field(s)`,
      };
    }
    const insert = await wixInsertDataItem(
      { dataCollectionId: collectionId, data: fields },
      { ...deps.wix, tenantId },
    );
    if (!insert.ok) {
      await recordLedger(tenantId, edit, "push_failed", `create: ${insert.reason}`, now);
      return { kind: "refused", reason: `wix create failed: ${insert.reason}${insert.detail ? ` (${insert.detail})` : ""}` };
    }
    await recordLedger(tenantId, edit, "pushed", `created item ${insert.value.id} in ${collectionId}`, now);
    return {
      kind: "pushed",
      adapter: "wix_cms",
      detail: `created new item ${insert.value.id} in ${collectionId} (${edit.target_url})`,
    };
  }

  // ── wix_cms SEO route (Wix SEO push slice, 2026-06-12) ──────────────
  // add_schema cards whose draft carries machine-extractable JSON-LD
  // blocks AND whose URL resolves to a Wix STORES product get the
  // block(s) applied to the product's seoData via the Catalog API —
  // seoData renders server-side in the page <head> and overrides
  // pattern tags (Wix docs). CMS dynamic pages have NO per-item SEO
  // field (template-based by platform design) → those cards refuse
  // here and stay paste-ready.
  if (edit.action_type === "add_schema") {
    const blocks = extractJsonLdScriptBlocks(edit.proposed_text ?? "");
    if (blocks.length === 0) {
      return {
        kind: "refused",
        reason:
          "add_schema card has no extractable JSON-LD block — keep it as paste-ready instructions",
      };
    }
    // Wix structured-data limits: ≤5 markups/page, <7,000 chars each.
    if (blocks.length > 5 || blocks.some((b) => b.length >= 7000)) {
      return {
        kind: "refused",
        reason: "JSON-LD exceeds Wix limits (max 5 markups, <7000 chars each)",
      };
    }
    const slug = lastPathSegment(edit.target_url);
    if (!slug) {
      return { kind: "refused", reason: "target URL has no slug segment" };
    }
    const productsQuery = await wixQueryDataItems(
      { dataCollectionId: "Stores/Products", limit: 1000 },
      { ...deps.wix, tenantId },
    );
    if (!productsQuery.ok) {
      return {
        kind: "refused",
        reason: `could not query store products: ${productsQuery.reason} — card stays paste-ready`,
      };
    }
    const match = productsQuery.value.find(
      (it) => String(it.data["slug"] ?? "") === slug,
    );
    if (match == null) {
      return {
        kind: "refused",
        reason:
          "this page is not a Wix Stores product (CMS pages take schema via the dashboard template) — use the paste-ready block",
      };
    }
    // Fail-closed snapshot of the product's CURRENT seoData.
    const product = await wixGetStoreProduct(
      { productId: match.id },
      { ...deps.wix, tenantId },
    );
    if (!product.ok) {
      return {
        kind: "refused",
        reason: `could not read the product for a pre-push snapshot (${product.reason}) — refusing to change the live site without an undo`,
      };
    }
    // Merge: keep every existing tag EXCEPT our own prior custom
    // script tags whose @type matches an incoming block (idempotent
    // re-push), then append the new script tag(s).
    const incomingTypes = new Set(
      blocks
        .map((b) => {
          try {
            return String((JSON.parse(b) as { "@type"?: unknown })["@type"] ?? "");
          } catch {
            return "";
          }
        })
        .filter((t) => t !== ""),
    );
    const existing = (product.value.seoData?.tags ?? []).filter((t) => {
      if (t.type !== "script" || t.custom !== true) return true;
      try {
        const parsed = JSON.parse(t.children ?? "") as { "@type"?: unknown };
        return !incomingTypes.has(String(parsed["@type"] ?? ""));
      } catch {
        return true;
      }
    });
    const tags: WixSeoTag[] = [
      ...existing,
      ...blocks.map((b) => ({
        type: "script" as const,
        props: { type: "application/ld+json" },
        children: b,
        custom: true,
        disabled: false,
      })),
    ];
    // Audit #33 (2026-06-12): Wix's ≤5-markups-per-page limit applies
    // to the PAGE total — enforce it on the MERGED set, not just the
    // incoming blocks, or successive pushes of different @types pile
    // past the limit.
    const mergedJsonLdCount = tags.filter(
      (t) =>
        t.type === "script" &&
        (t.props as { type?: unknown } | undefined)?.type ===
          "application/ld+json",
    ).length;
    if (mergedJsonLdCount > MAX_JSONLD_TAGS_PER_PAGE) {
      return {
        kind: "refused",
        reason: `merged seoData would carry ${mergedJsonLdCount} JSON-LD scripts — Wix allows ${MAX_JSONLD_TAGS_PER_PAGE} markups per page (remove stale tags in the Wix dashboard first)`,
      };
    }
    if (dryRun) {
      return {
        kind: "dry_run",
        adapter: "wix_cms",
        detail: `would apply ${blocks.length} JSON-LD block(s) to product ${match.id} seoData (${edit.target_url}); merged page total ${mergedJsonLdCount}/${MAX_JSONLD_TAGS_PER_PAGE}`,
      };
    }
    // Fail-closed snapshot of the product's CURRENT seoData — must
    // persist before the live site changes.
    try {
      await appendPushSnapshot({
        id: `snap-${now.getTime()}-${edit.id.slice(0, 8)}`,
        tenant_id: tenantId,
        edit_id: edit.id,
        target_url: edit.target_url,
        dataCollectionId: "Stores/Products",
        dataItemId: match.id,
        field: "seoData",
        previous_text: JSON.stringify(product.value.seoData ?? { tags: [] }),
        captured_at: now.toISOString(),
      });
    } catch (err) {
      await recordLedger(tenantId, edit, "push_failed", "snapshot_capture_failed", now);
      return {
        kind: "refused",
        reason: `could not capture the pre-push snapshot (${err instanceof Error ? err.message : String(err)}) — refusing to change the live site without an undo`,
      };
    }
    const write = await wixUpdateProductSeoData(
      { productId: match.id, tags },
      { ...deps.wix, tenantId },
    );
    if (!write.ok) {
      await recordLedger(tenantId, edit, "push_failed", `seoData: ${write.reason}`, now);
      return {
        kind: "refused",
        reason: `wix seoData write failed: ${write.reason}${write.detail ? ` (${write.detail})` : ""}`,
      };
    }
    await recordLedger(
      tenantId,
      edit,
      "pushed",
      `seoData: ${blocks.length} JSON-LD block(s) on product ${match.id}`,
      now,
    );
    return {
      kind: "pushed",
      adapter: "wix_cms",
      detail: `applied ${blocks.length} JSON-LD block(s) to product seoData (${edit.target_url})`,
    };
  }

  // ── wix_cms EDIT route ──────────────────────────────────────────────
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

  // Audit #33 (2026-06-12): wixUpdateDataItem is a full-item PUT — the
  // merged payload travels whole. Refuse pathological sizes locally
  // with a precise reason instead of an opaque Wix 4xx.
  const mergedPreview = { ...item.data, [field]: edit.proposed_text ?? "" };
  if (JSON.stringify(mergedPreview).length > MAX_CMS_ITEM_BYTES) {
    return {
      kind: "refused",
      reason: `merged item would exceed ${MAX_CMS_ITEM_BYTES.toLocaleString()} bytes — too large for a safe CMS write`,
    };
  }

  if (dryRun) {
    return {
      kind: "dry_run",
      adapter: "wix_cms",
      detail: `would update "${field}" on ${mapEntry.dataCollectionId}/${mapEntry.dataItemId} (${edit.target_url})`,
    };
  }

  // Pre-push snapshot (#82, 2026-06-11) — FAIL-CLOSED: the safety net
  // must persist before the live site changes.
  try {
    await appendPushSnapshot({
      id: `snap-${now.getTime()}-${edit.id.slice(0, 8)}`,
      tenant_id: tenantId,
      edit_id: edit.id,
      target_url: edit.target_url,
      dataCollectionId: mapEntry.dataCollectionId,
      dataItemId: mapEntry.dataItemId,
      field,
      previous_text: String((item.data as Record<string, unknown>)[field] ?? ""),
      captured_at: now.toISOString(),
    });
  } catch (err) {
    await recordLedger(tenantId, edit, "push_failed", "snapshot_capture_failed", now);
    return {
      kind: "refused",
      reason: `could not capture the pre-push snapshot (${err instanceof Error ? err.message : String(err)}) — refusing to change the live site without an undo`,
    };
  }

  const write = await wixUpdateDataItem(
    { dataCollectionId: mapEntry.dataCollectionId, dataItemId: mapEntry.dataItemId, data: mergedPreview },
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
