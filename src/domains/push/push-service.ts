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
 *   • git_pr / dev_note — formatted dev note only; never a live write.
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
 *   • BODY sections (BEACON_500 item 2, 2026-07-01) → CMS item body-field
 *       UPDATE when the operator mapped the collection's body field on
 *       /diagnostics/wix: add_answer_block prepends, add_faq and
 *       add_h2_section append, and an explicit "section:<heading>" key
 *       replaces that section. Snapshot first, merge locally (never wiping
 *       the original), write the full new value, verify by re-read.
 *       No body mapping → those cards stay paste-ready as before.
 *   • Blog posts + media are NOT wired into any push route today.
 *       The unwired Wix blog/media handlers were deleted 2026-07-01
 *       (FINAL PREMIUM PLAN item 102); blog/media cards are not produced
 *       and this service never touches them.
 */

import { getTenant } from "@/domains/tenants/store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import {
  exceedsPublishLengthLimit,
  PUSH_TITLE_MAX_CHARS,
  PUSH_META_MAX_CHARS,
} from "@/domains/recommendations/copy-artifact-guard";
import {
  appendPushLedger,
  assertNonDestructivePatch,
  checkDailyPushCap,
  finalizePushReservation,
  reservePushSlot,
} from "./caps";
import { formatDevNote } from "./dev-note";
import { appendPushSnapshot, isSnapshotRevertEdit } from "./push-snapshots";
import {
  bodyMergeModeForAction,
  mergeBodyContent,
  type BodyMergeMode,
} from "./body-merge";
import {
  resolveWixItemForUrl,
  resolveWixBodyFieldForUrl,
  deriveWixContentFieldKey,
  type ResolvedWixBodyField,
} from "@/lib/connectors/wix/url-map";
import {
  wixGetStoreProduct,
  wixInsertDataItem,
  wixQueryDataItems,
  wixQueryAllDataItems,
  wixGetDataItem,
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

  // audit-wave #8 (2026-06-23): validate non-destructiveness BEFORE reserving a
  // cap slot. Previously this ran after reservePushSlot, so a destructive
  // refusal left a `reserved` row that ate one of the 10 daily slots until the
  // 10-min self-free — don't spend a slot on a push we're about to refuse.
  // BEACON_500 item 2 (2026-07-01): a snapshot REVERT restores the exact
  // pre-push value, which for a body merge is legitimately much shorter than
  // the merged live value, so reverts skip the shrink heuristic only (the
  // empty-value refusal always applies; buildRevertEdit refuses empties too).
  const isRevert = isSnapshotRevertEdit(edit);
  const destructive = assertNonDestructivePatch({
    currentText: edit.current_text,
    proposedText: edit.proposed_text,
    restoreMode: isRevert,
  });
  if (!destructive.allowed) return { kind: "refused", reason: destructive.reason };

  // ── Invariant 3: caps IN the push path — reserve-before-write (#5) ──
  // Atomically claim a daily-cap slot BEFORE any live write, so a double-click
  // on one-click "Accept & publish" can't race two pushes past the cap. The
  // reservation is finalized to pushed/push_failed by recordLedger on every
  // write outcome; a later structural refusal that returns before the write
  // leaves a `reserved` row that self-frees after 10 min.
  // A dry-run must have NO ledger side effect (audit #35 contract), so it uses
  // the read-only cap check; a REAL push atomically reserves a slot.
  let reservationId: string | null = null;
  if (dryRun) {
    const cap = await checkDailyPushCap({ tenantId, now });
    if (!cap.allowed) return { kind: "refused", reason: cap.reason };
  } else {
    const cap = await reservePushSlot({
      tenantId,
      editId: edit.id,
      targetUrl: edit.target_url,
      now,
    });
    if (!cap.allowed) return { kind: "refused", reason: cap.reason };
    reservationId = cap.reservationId;
  }

  // ── wix_cms CREATE route (§page-factory) ────────────────────────────
  // Cards with element key "create:<collectionId>" insert a NEW item.
  // proposed_text is the JSON of the new item's fields (slug included —
  // a new page has no URL to *change*). Refuses if the URL already maps
  // to an existing item (creation never overwrites).
  let elementKey = edit.target_element_key ?? "";
  // Wix content-push slice (2026-06-13): a content edit (edit_title /
  // change_h1) reaches here with NO element key, because the deterministic
  // promotion mapper leaves target_element_key null — so it would refuse
  // below and stay paste-ready. If the operator has mapped this page's
  // collection field roles on /diagnostics/wix, derive the concrete
  // `field:<cmsField>` target now so the SAME safe field-write path
  // (snapshot → merge → write → rollback) publishes the edit LIVE. When
  // nothing is configured this is a no-op (returns null) and the card
  // stays paste-ready exactly as today — opt-in, per-tenant, no hardcoding.
  if (elementKey === "") {
    const derived = await deriveWixContentFieldKey(
      edit.target_url,
      edit.action_type,
    );
    if (derived != null) elementKey = derived;
  }
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
      await recordLedger(tenantId, edit, "push_failed", `create: ${insert.reason}`, now, reservationId);
      return { kind: "refused", reason: `wix create failed: ${insert.reason}${insert.detail ? ` (${insert.detail})` : ""}` };
    }
    await recordLedger(tenantId, edit, "pushed", `created item ${insert.value.id} in ${collectionId}`, now, reservationId);
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
    // audit-wave #13 (2026-06-23): paginate the full catalog instead of a single
    // limit:1000 page — a slug past row 1000 silently missed (the same
    // truncation the field-edit + url-map paths were fixed to avoid).
    const productsQuery = await wixQueryAllDataItems(
      { dataCollectionId: "Stores/Products" },
      { ...deps.wix, tenantId },
    );
    if (!productsQuery.ok) {
      await recordLedger(tenantId, edit, "push_failed", `products_query: ${productsQuery.reason}`, now, reservationId);
      return {
        kind: "refused",
        reason: `could not query store products: ${productsQuery.reason} — card stays paste-ready`,
      };
    }
    const match = productsQuery.value.find(
      (it) => String(it.data["slug"] ?? "") === slug,
    );
    if (match == null) {
      await recordLedger(tenantId, edit, "push_failed", "product_not_found", now, reservationId);
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
      await recordLedger(tenantId, edit, "push_failed", `product_read: ${product.reason}`, now, reservationId);
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
      await recordLedger(tenantId, edit, "push_failed", `merged_tags_limit: ${mergedJsonLdCount}`, now, reservationId);
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
      await recordLedger(tenantId, edit, "push_failed", "snapshot_capture_failed", now, reservationId);
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
      await recordLedger(tenantId, edit, "push_failed", `seoData: ${write.reason}`, now, reservationId);
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
      reservationId,
    );
    return {
      kind: "pushed",
      adapter: "wix_cms",
      detail: `applied ${blocks.length} JSON-LD block(s) to product seoData (${edit.target_url})`,
    };
  }

  // ── wix_cms BODY-SECTION route (BEACON_500 item 2, 2026-07-01) ──────
  // Section drafts stop being a paste chore when the operator has mapped
  // the collection's body field on /diagnostics/wix:
  //   • add_answer_block                → answer prepended to the body
  //   • add_faq / add_h2_section        → section appended to the body
  //   • element key "section:<heading>" → that section replaced
  // Rails: snapshot the FULL prior value first (fail-closed), merge
  // LOCALLY (prepend/append/replace, never wiping the original), write
  // the full new value through the same read-modify-write client call,
  // verify by re-read, ledger + daily cap + 1MB ceiling unchanged. No
  // body mapping → the card stays paste-ready exactly as before.
  const sectionHeadingFromKey = elementKey.startsWith("section:")
    ? elementKey.slice("section:".length).trim()
    : null;
  const bodyMode: BodyMergeMode | null =
    sectionHeadingFromKey != null
      ? "replace_section"
      : elementKey === ""
        ? bodyMergeModeForAction(edit.action_type)
        : null;
  if (bodyMode != null) {
    const resolvedBody = await resolveWixBodyFieldForUrl(edit.target_url);
    if (resolvedBody != null) {
      return await executeBodySectionPush({
        tenantId,
        edit,
        dryRun,
        now,
        reservationId,
        deps,
        resolvedBody,
        mode: bodyMode,
        sectionHeading: sectionHeadingFromKey,
      });
    }
    if (sectionHeadingFromKey != null) {
      await recordLedger(tenantId, edit, "push_failed", "body_field_unmapped", now, reservationId);
      return {
        kind: "refused",
        reason:
          "I have no body field mapped for this page's collection, so I left this section for you to paste. Map the body field on /diagnostics/wix to turn on one-click sections.",
      };
    }
    // No body mapping for an additive section card: fall through to the
    // field-target refusal below so behavior stays exactly as before.
  }

  // ── wix_cms EDIT route ──────────────────────────────────────────────
  if (!elementKey.startsWith("field:")) {
    await recordLedger(tenantId, edit, "push_failed", "element_key_mismatch", now, reservationId);
    return {
      kind: "refused",
      reason:
        `wix_cms v1 pushes field-targeted cards only (target_element_key "field:<itemField>"); ` +
        `this card targets "${elementKey || "(none)"}" — export it as a dev note or re-queue with a field target`,
    };
  }
  const field = elementKey.slice("field:".length);
  if (field === "" || field.toLowerCase().includes("slug")) {
    await recordLedger(tenantId, edit, "push_failed", `protected_field: ${field}`, now, reservationId);
    return { kind: "refused", reason: `field "${field}" is not pushable (Invariant 3: no URL/slug changes)` };
  }

  // audit-3 #11: SERP-display length gate. An over-limit title/meta written
  // un-trimmed is silently truncated by Google (and may exceed the CMS field) —
  // refuse with a precise reason naming the recommended target so the operator
  // shortens it rather than shipping a broken listing. Runs in dry-run too.
  // Shares one ceiling with the QA pushReadiness downgrade so the two agree.
  if (exceedsPublishLengthLimit(edit.action_type, edit.proposed_text)) {
    const proposedLen = (edit.proposed_text ?? "").trim().length;
    const isTitle = edit.action_type === "edit_title";
    await recordLedger(tenantId, edit, "push_failed", `length_limit: ${proposedLen}`, now, reservationId);
    return {
      kind: "refused",
      reason: isTitle
        ? `proposed title is ${proposedLen} chars — over the ${PUSH_TITLE_MAX_CHARS}-char push limit (aim for ~60); shorten it before publishing`
        : `proposed meta description is ${proposedLen} chars — over the ${PUSH_META_MAX_CHARS}-char push limit (aim for ~155); shorten it before publishing`,
    };
  }

  const mapEntry = await resolveWixItemForUrl(edit.target_url);
  if (mapEntry == null) {
    await recordLedger(tenantId, edit, "push_failed", "unmapped_url", now, reservationId);
    return {
      kind: "refused",
      reason: `no Wix CMS item mapped for ${edit.target_url} — run the url-map sync on /diagnostics/wix first`,
    };
  }

  // Read-modify-write: fetch the EXACT mapped item by id, merge the single field.
  // (Was a query of the first 1000 collection items + .find() — an item mapped
  // past row 1000 silently "no longer exists" and mis-refused.)
  const got = await wixGetDataItem(
    { dataCollectionId: mapEntry.dataCollectionId, dataItemId: mapEntry.dataItemId },
    { ...deps.wix, tenantId },
  );
  if (!got.ok) {
    await recordLedger(tenantId, edit, "push_failed", `read: ${got.reason}`, now, reservationId);
    return { kind: "refused", reason: `wix read failed: ${got.reason}${got.detail ? ` (${got.detail})` : ""}` };
  }
  const item = got.value;
  if (item == null) {
    await recordLedger(tenantId, edit, "push_failed", "item_gone", now, reservationId);
    return { kind: "refused", reason: "mapped Wix item no longer exists — re-run the url-map sync" };
  }

  // Audit #33 (2026-06-12): a Wix item update is a full-item PUT. Refuse
  // pathological sizes locally (precise reason vs opaque Wix 4xx). The actual
  // write (below) re-fetches the live item and changes ONLY `field`, so slug
  // + the generated link travel through unchanged — this preview is for the
  // size check + the snapshot's previous-value only.
  const mergedPreview = { ...item.data, [field]: edit.proposed_text ?? "" };
  if (JSON.stringify(mergedPreview).length > MAX_CMS_ITEM_BYTES) {
    return {
      kind: "refused",
      reason: `merged item would exceed ${MAX_CMS_ITEM_BYTES.toLocaleString()} bytes — too large for a safe CMS write`,
    };
  }

  // BEACON_500 item 2 (2026-07-01): some CMS fields hold STRUCTURED values
  // (a RICOS rich-content body is a JSON object, not a string). Serialize the
  // live value honestly for the snapshot + guards, and when the live value IS
  // an object, only ever write parsed JSON back (a body revert restores the
  // exact structure); writing a plain string over an object would corrupt the
  // field, so that refuses with a precise reason.
  const liveRaw = (item.data as Record<string, unknown>)[field];
  const liveField =
    liveRaw == null
      ? ""
      : typeof liveRaw === "string"
        ? liveRaw
        : JSON.stringify(liveRaw);
  let valueToWrite: unknown = edit.proposed_text ?? "";
  if (liveRaw != null && typeof liveRaw === "object") {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(edit.proposed_text ?? "");
    } catch {
      parsed = null;
    }
    if (parsed == null || typeof parsed !== "object") {
      await recordLedger(tenantId, edit, "push_failed", `structured_field_mismatch: ${field}`, now, reservationId);
      return {
        kind: "refused",
        reason: `the "${field}" field holds structured content and this draft is not valid structured JSON for it, so I did not write it`,
      };
    }
    valueToWrite = parsed;
  }

  // Re-run the non-destructive guard against the LIVE field value, not the
  // (possibly stale) draft's current_text — the page may have changed since the
  // rec was generated, so a >80% shrink must be judged against what we're about
  // to overwrite. Reported in dry-run too. (The early check at the top is a cheap
  // pre-filter on the draft.) Reverts skip only the shrink heuristic (see above).
  const liveDestructive = assertNonDestructivePatch({
    currentText: liveField,
    proposedText: edit.proposed_text,
    restoreMode: isRevert,
  });
  if (!liveDestructive.allowed) {
    await recordLedger(tenantId, edit, "push_failed", `live_destructive: ${liveDestructive.reason}`, now, reservationId);
    return { kind: "refused", reason: liveDestructive.reason };
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
      previous_text: liveField,
      captured_at: now.toISOString(),
    });
  } catch (err) {
    await recordLedger(tenantId, edit, "push_failed", "snapshot_capture_failed", now, reservationId);
    return {
      kind: "refused",
      reason: `could not capture the pre-push snapshot (${err instanceof Error ? err.message : String(err)}) — refusing to change the live site without an undo`,
    };
  }

  const write = await wixUpdateDataItem(
    {
      dataCollectionId: mapEntry.dataCollectionId,
      dataItemId: mapEntry.dataItemId,
      field,
      value: valueToWrite,
    },
    { ...deps.wix, tenantId },
  );
  if (!write.ok) {
    await recordLedger(tenantId, edit, "push_failed", `write: ${write.reason}`, now, reservationId);
    return { kind: "refused", reason: `wix write failed: ${write.reason}${write.detail ? ` (${write.detail})` : ""}` };
  }

  await recordLedger(tenantId, edit, "pushed", `field ${field} on item ${mapEntry.dataItemId}`, now, reservationId);
  return {
    kind: "pushed",
    adapter: "wix_cms",
    detail: `updated "${field}" on ${mapEntry.dataCollectionId}/${mapEntry.dataItemId} (${edit.target_url})`,
  };
}

/**
 * Body-section push (BEACON_500 item 2, 2026-07-01): snapshot -> local
 * merge -> full-value write -> re-read verification -> receipt. Called
 * ONLY after every upstream guard (status, Ritz hard-block, publish
 * target, non-destructive pre-filter, cap reservation) has passed and
 * the page resolved to an operator-mapped body field.
 */
async function executeBodySectionPush(args: {
  tenantId: string;
  edit: RecommendedEditRow;
  dryRun: boolean;
  now: Date;
  reservationId: string | null;
  deps: PushDeps;
  resolvedBody: ResolvedWixBodyField;
  mode: BodyMergeMode;
  /** Heading from a "section:<heading>" element key (replace mode only). */
  sectionHeading: string | null;
}): Promise<PushResult> {
  const { tenantId, edit, dryRun, now, reservationId, deps } = args;
  const { entry, bodyField } = args.resolvedBody;

  // Read the EXACT mapped item (same read the field route uses).
  const got = await wixGetDataItem(
    { dataCollectionId: entry.dataCollectionId, dataItemId: entry.dataItemId },
    { ...deps.wix, tenantId },
  );
  if (!got.ok) {
    await recordLedger(tenantId, edit, "push_failed", `body_read: ${got.reason}`, now, reservationId);
    return { kind: "refused", reason: `wix read failed: ${got.reason}${got.detail ? ` (${got.detail})` : ""}` };
  }
  const item = got.value;
  if (item == null) {
    await recordLedger(tenantId, edit, "push_failed", "body_item_gone", now, reservationId);
    return { kind: "refused", reason: "mapped Wix item no longer exists, re-run the url-map sync" };
  }

  // Serialize the existing body per configured kind. A RICOS body is
  // usually a JSON OBJECT on the item; plain/html must be strings. A
  // value that doesn't match the configured kind fails closed: wrong
  // mapping beats a corrupted live page.
  const raw = (item.data as Record<string, unknown>)[bodyField.key];
  let existingText: string;
  let writeAsObject = false;
  if (raw == null) {
    existingText = "";
  } else if (typeof raw === "string") {
    existingText = raw;
  } else if (bodyField.kind === "ricos" && typeof raw === "object") {
    existingText = JSON.stringify(raw);
    writeAsObject = true;
  } else {
    await recordLedger(tenantId, edit, "push_failed", `body_kind_mismatch: ${bodyField.key}`, now, reservationId);
    return {
      kind: "refused",
      reason: `the "${bodyField.key}" field does not hold ${bodyField.kind} content I can safely edit, so I left this section for you to paste (check the body mapping on /diagnostics/wix)`,
    };
  }

  // Merge LOCALLY. Deterministic; refuses anything it cannot do without
  // risking the existing body (unrecognized kind, missing section,
  // deletion-shaped replacement, wiped original).
  const merge = mergeBodyContent({
    existing: existingText,
    draft: edit.proposed_text ?? "",
    kind: bodyField.kind,
    mode: args.mode,
    opts: args.sectionHeading != null ? { sectionHeading: args.sectionHeading } : {},
  });
  if (!merge.ok) {
    await recordLedger(tenantId, edit, "push_failed", `body_merge_refused: ${merge.reason.slice(0, 160)}`, now, reservationId);
    return { kind: "refused", reason: merge.reason };
  }

  // Idempotent re-push: the section is already on the page (verbatim,
  // normalized). No live write, no new snapshot (nothing to undo), and no
  // daily-cap slot spent for a push that changed nothing. The reservation
  // is released as push_failed (it did not count as a push) but the
  // operator sees an honest "pushed" outcome because the content really
  // is live. Prevents the classic re-push bug: clicking Approve & Push
  // twice on the same answer block or FAQ must not stack a duplicate copy.
  // A dry-run stays a dry-run: zero side effects (audit #35 contract), so
  // it reports the no-op honestly without touching the ledger.
  if (merge.alreadyApplied === true) {
    const detail =
      `I checked the "${bodyField.key}" field on ${edit.target_url} and this section is already there, so I made no change. ` +
      `Nothing was overwritten and no new undo snapshot was needed.`;
    if (dryRun) {
      return { kind: "dry_run", adapter: "wix_cms", detail: `would make no change: ${detail}` };
    }
    await recordLedger(tenantId, edit, "push_failed", `body_noop_already_applied: ${bodyField.key}`, now, reservationId);
    return { kind: "pushed", adapter: "wix_cms", detail };
  }

  // Same 1MB full-item ceiling as every CMS write.
  const mergedPreview = { ...item.data, [bodyField.key]: merge.merged };
  if (JSON.stringify(mergedPreview).length > MAX_CMS_ITEM_BYTES) {
    await recordLedger(tenantId, edit, "push_failed", "body_size_limit", now, reservationId);
    return {
      kind: "refused",
      reason: `merged item would exceed ${MAX_CMS_ITEM_BYTES.toLocaleString()} bytes, too large for a safe CMS write`,
    };
  }

  if (dryRun) {
    return {
      kind: "dry_run",
      adapter: "wix_cms",
      detail: `would have ${merge.summary} in "${bodyField.key}" on ${entry.dataCollectionId}/${entry.dataItemId} (${edit.target_url}), with the previous version saved first`,
    };
  }

  // Pre-push snapshot of the FULL prior body value. FAIL-CLOSED: the
  // safety net must persist before the live site changes.
  try {
    await appendPushSnapshot({
      id: `snap-${now.getTime()}-${edit.id.slice(0, 8)}`,
      tenant_id: tenantId,
      edit_id: edit.id,
      target_url: edit.target_url,
      dataCollectionId: entry.dataCollectionId,
      dataItemId: entry.dataItemId,
      field: bodyField.key,
      previous_text: existingText,
      captured_at: now.toISOString(),
    });
  } catch (err) {
    await recordLedger(tenantId, edit, "push_failed", "snapshot_capture_failed", now, reservationId);
    return {
      kind: "refused",
      reason: `could not capture the pre-push snapshot (${err instanceof Error ? err.message : String(err)}), so I refused to change the live site without an undo`,
    };
  }

  // Write the FULL merged value back (the client re-fetches and changes
  // only this field, so slug + every other field travel through intact).
  const write = await wixUpdateDataItem(
    {
      dataCollectionId: entry.dataCollectionId,
      dataItemId: entry.dataItemId,
      field: bodyField.key,
      value: writeAsObject ? (JSON.parse(merge.merged) as unknown) : merge.merged,
    },
    { ...deps.wix, tenantId },
  );
  if (!write.ok) {
    await recordLedger(tenantId, edit, "push_failed", `body_write: ${write.reason}`, now, reservationId);
    return { kind: "refused", reason: `wix write failed: ${write.reason}${write.detail ? ` (${write.detail})` : ""}` };
  }

  // Verify by re-read: fetch the item again and check the draft's first
  // line landed in the stored value. Inconclusive reads never fail the
  // push (the write already succeeded); they just read honestly.
  let verified = false;
  try {
    const check = await wixGetDataItem(
      { dataCollectionId: entry.dataCollectionId, dataItemId: entry.dataItemId },
      { ...deps.wix, tenantId },
    );
    if (check.ok && check.value != null) {
      const v = (check.value.data as Record<string, unknown>)[bodyField.key];
      const stored = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      const firstLine =
        (edit.proposed_text ?? "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l !== "") ?? "";
      const needle = normalize(firstLine).slice(0, 80);
      verified = needle.length > 0 && normalize(stored).includes(needle);
    }
  } catch {
    verified = false;
  }

  await recordLedger(
    tenantId,
    edit,
    "pushed",
    `body_${args.mode} on ${bodyField.key} (item ${entry.dataItemId})${verified ? " verified" : " unverified"}`,
    now,
    reservationId,
  );
  return {
    kind: "pushed",
    adapter: "wix_cms",
    detail:
      `I ${merge.summary} in the "${bodyField.key}" field on ${edit.target_url}. ` +
      `I saved the previous version first, so you can restore it in one click. ` +
      (verified
        ? "I re-read the page content and the new section is in place."
        : "I could not confirm the change on a re-read yet, so give it a minute and check the page."),
  };
}

async function recordLedger(
  tenantId: string,
  edit: RecommendedEditRow,
  result: "pushed" | "push_failed",
  detail: string,
  now: Date,
  reservationId: string | null,
): Promise<void> {
  try {
    if (reservationId != null) {
      // Reserve-before-write path (#5): finalize the slot we already claimed,
      // so the cap counts exactly one row per push attempt (not reserve + a
      // second appended row).
      await finalizePushReservation({ tenantId, reservationId, result, detail });
      return;
    }
    // Fallback (no reservation was made — e.g. a caller that bypassed the
    // reserve gate): append a fresh ledger row, today's behavior.
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
/**
 * Probe outcome — a TAGGED result so the caller never conflates an
 * authoritative "the text isn't on the page" with a transient "I couldn't
 * read the page" (timeout / 5xx / TLS / DNS). Only `found` is authoritative
 * enough to flip `verified_live`; `unreliable` and `not_found` both keep the
 * row at `pushed` and let the scan cadence verify, but they read differently
 * to the operator so a repeated `unreliable` (network) is distinguishable
 * from a genuine `not_found` (propagation lag).
 */
export type ProbeLiveResult =
  | { kind: "found"; status: number }
  | { kind: "not_found"; status: number }
  | { kind: "unreliable"; status: number };

export async function probeLiveText(
  args: { url: string; proposedText: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeLiveResult> {
  try {
    const res = await fetchImpl(args.url, {
      headers: { "User-Agent": "BeaconBot/1.0 (verify-live probe)", Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    // A non-2xx (5xx maintenance, 4xx, redirect loop) RESOLVES rather than
    // throwing — its body is not a trustworthy snapshot of the live page, so
    // it's inconclusive, never "the change isn't there".
    if (!res.ok) return { kind: "unreliable", status: res.status };
    const html = await res.text();
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const needle = norm(args.proposedText).slice(0, 120);
    const found = needle.length > 0 && norm(html).includes(needle);
    return { kind: found ? "found" : "not_found", status: res.status };
  } catch {
    // Timeout (AbortSignal), TLS, DNS — we never saw the page. Inconclusive.
    return { kind: "unreliable", status: 0 };
  }
}
