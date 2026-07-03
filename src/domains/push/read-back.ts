import "server-only";

/**
 * read-back (BEACON_500 P12, v1 393, 2026-07-03) - the read-back verification
 * tier: after a push, I READ THE FIELD BACK from Wix and confirm it actually took
 * before I ever tell you it is live.
 *
 * WHY. A successful write RESPONSE from Wix (HTTP 200) is not the same as the
 * value being STORED as we sent it - a silent server-side transform, a stale
 * cache, a partial write, or a field the platform re-derived can all return 200
 * while the stored value differs from what we sent. Claiming "live" off the write
 * response alone can be a false positive. This tier closes that: after the write,
 * re-read the exact item/field and compare. Only a MATCHING read-back is allowed
 * to claim the change is confirmed; a mismatch is reported as UNVERIFIED (the
 * write may still be propagating, or it may not have taken), never as live.
 *
 * Distinct from the two verification signals already in the codebase:
 *   - executePush's body-section route already re-reads and looks for the draft's
 *     first line (a substring probe). This module is the GENERAL, typed core that
 *     covers title/meta/h1 field writes AND structured (RICOS / seoData) writes,
 *     with an explicit unverified/inconclusive/verified verdict.
 *   - probeLiveText fetches the LIVE PUBLIC HTML. That is the strongest signal but
 *     is subject to CDN/propagation lag. Read-back checks the CMS STORE, which
 *     updates immediately, so a fresh push can be confirmed the same second.
 *
 * SAFETY / CONTRACT:
 *   1. PURE comparator core (`compareReadBack`) - no I/O; normalizes and compares
 *      what we sent against what the store returned. Trivially testable.
 *   2. The I/O helper (`readBackWixField`) only ever READS (wixGetDataItem /
 *      wixGetStoreProduct). It never writes and never touches any structural rail.
 *      All Wix calls are mockable via WixDeps (tests pass mocked deps).
 *   3. Fail-safe direction is ALWAYS toward NOT claiming live: a read error, a
 *      missing item, or a mismatch all yield a non-"verified" verdict. The
 *      caller keeps the row at `pushed` and lets the scan cadence be the
 *      authoritative verifier - identical posture to today's inconclusive probe.
 *   4. Additive: nothing calls this yet on the shipped path. On its own it changes
 *      no behavior; wiring it into a push receipt is a separate opt-in step.
 */

import {
  wixGetDataItem,
  wixGetStoreProduct,
  type WixDeps,
} from "@/lib/connectors/wix/client";

/**
 * A read-back verdict:
 *   - verified:     the store returned a value that MATCHES what we sent. Safe to
 *                   claim the change is in place.
 *   - unverified:   the store returned a value that does NOT match what we sent
 *                   (still propagating, or the write did not fully take). NEVER
 *                   claim live on this.
 *   - inconclusive: I could not read the value back at all (read error, item
 *                   gone). NEVER claim live on this either; it is honestly "I
 *                   could not confirm".
 */
export type ReadBackVerdict = "verified" | "unverified" | "inconclusive";

export type ReadBackResult = {
  verdict: ReadBackVerdict;
  /** Machine detail for the ledger (dash-free, short). */
  detail: string;
};

/** Whitespace-fold + lowercase for a tolerant text comparison (identical to the
 *  normalization the existing body-section re-read uses). */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** contains-mode normalization: as above, plus drop backslash escapes so a
 *  needle with plain quotes ({"@type":"Product"}) still matches when it lives
 *  inside a JSON-serialized wrapper that escaped them ({\"@type\":\"Product\"}).
 *  Used ONLY for contains (schema / body merges), never for the strict exact
 *  full-field comparison. */
function normalizeContains(s: string): string {
  return normalize(s).replace(/\\/g, "");
}

/** Serialize a stored field value honestly: strings pass through; objects (a
 *  RICOS body, a seoData object) serialize to JSON so structured writes compare. */
function serializeStored(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * PURE read-back comparison. `sent` is what we wrote; `stored` is what the store
 * returned on the re-read (null = could not read). `mode`:
 *   - "exact":    the stored value must equal (normalized) the sent value. Used
 *                 for full-field writes (title / meta / h1) where the field holds
 *                 exactly our value.
 *   - "contains": the stored value must CONTAIN (normalized) the sent needle.
 *                 Used for additive body merges + schema, where our text is one
 *                 part of a larger merged value.
 * Returns "inconclusive" when the store value is null (no read), "verified" on a
 * match, and "unverified" on a real mismatch. An empty `sent` needle is
 * inconclusive (nothing meaningful to confirm) so we never claim a match on "".
 */
export function compareReadBack(args: {
  sent: string;
  stored: string | null;
  mode: "exact" | "contains";
}): ReadBackResult {
  if (args.stored == null) {
    return { verdict: "inconclusive", detail: "read_back_no_value" };
  }
  const isExact = args.mode === "exact";
  const sent = isExact ? normalize(args.sent) : normalizeContains(args.sent);
  const stored = isExact ? normalize(args.stored) : normalizeContains(args.stored);
  if (sent.length === 0) {
    return { verdict: "inconclusive", detail: "read_back_empty_needle" };
  }
  const match = isExact
    ? stored === sent
    : // Cap the needle so a very long body still matches on its distinctive head.
      stored.includes(sent.slice(0, 200));
  return match
    ? { verdict: "verified", detail: "read_back_match" }
    : { verdict: "unverified", detail: "read_back_mismatch" };
}

/**
 * Read back a CMS item field after a write and compare it to what we sent.
 * READ-ONLY. Fail-safe: a read error or missing item returns "inconclusive"
 * (never "verified"). Tests pass mocked WixDeps so this never reaches the network.
 */
export async function readBackWixField(args: {
  tenantId: string;
  dataCollectionId: string;
  dataItemId: string;
  field: string;
  sent: string;
  mode: "exact" | "contains";
  deps?: WixDeps;
}): Promise<ReadBackResult> {
  let got;
  try {
    got = await wixGetDataItem(
      { dataCollectionId: args.dataCollectionId, dataItemId: args.dataItemId },
      { ...args.deps, tenantId: args.tenantId },
    );
  } catch {
    return { verdict: "inconclusive", detail: "read_back_read_threw" };
  }
  if (!got.ok || got.value == null) {
    return { verdict: "inconclusive", detail: "read_back_read_failed" };
  }
  const stored = serializeStored(
    (got.value.data as Record<string, unknown>)[args.field],
  );
  return compareReadBack({ sent: args.sent, stored, mode: args.mode });
}

/**
 * Read back a Stores product's seoData after a schema write and confirm our
 * JSON-LD block is present. READ-ONLY, fail-safe to "inconclusive". The seoData
 * merge appends our block(s), so a "contains" check is correct here.
 */
export async function readBackWixProductSeoData(args: {
  tenantId: string;
  productId: string;
  sent: string;
  deps?: WixDeps;
}): Promise<ReadBackResult> {
  let got;
  try {
    got = await wixGetStoreProduct(
      { productId: args.productId },
      { ...args.deps, tenantId: args.tenantId },
    );
  } catch {
    return { verdict: "inconclusive", detail: "read_back_read_threw" };
  }
  if (!got.ok || got.value == null) {
    return { verdict: "inconclusive", detail: "read_back_read_failed" };
  }
  const stored = serializeStored(got.value.seoData ?? { tags: [] });
  return compareReadBack({ sent: args.sent, stored, mode: "contains" });
}

/** Operator-facing line for a read-back verdict (Beacon voice, no dashes). A
 *  caller appends this to a push receipt so the operator sees the honest state. */
export function readBackReceiptLine(verdict: ReadBackVerdict): string {
  switch (verdict) {
    case "verified":
      return "I read the change back from your site and it is in place.";
    case "unverified":
      return "I could not confirm the change on a read back yet, so give it a minute and check the page.";
    case "inconclusive":
      return "I could not read the change back just now, so give it a minute and check the page.";
  }
}
