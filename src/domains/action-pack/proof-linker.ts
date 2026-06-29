import type { ActionPack, ActionType } from "./types";

/**
 * proof-linker (2026-06-28 — ActionPack execution loop, Phase 4) — a PURE,
 * deterministic resolver that links a proof/shipped-change row back to the
 * ActionPack that most likely caused it. No I/O, no migration, no stored id
 * required. Conservative by design: a false "exact" would be worse than an honest
 * "weak", so "exact" only fires on a stored id (none today) and "strong" requires
 * BOTH the same page AND a compatible change family.
 */

/** Minimal shape we need from a ShippedChangeRecord (kept loose for testability). */
export type ProofRowLike = {
  id: string;
  page: string; // full URL
  path: string; // host-stripped path
  actionType: string; // free string (e.g. "add_answer_block", "edit_title")
  targetQueries?: string[];
  /** Optional forward-only soft link — none today; honoured if it ever lands. */
  actionPackId?: string | null;
};

export type ProofLinkConfidence = "exact" | "strong" | "weak" | "none";

export type ProofLink<R extends ProofRowLike = ProofRowLike> = {
  proofRow: R;
  actionPack: ActionPack | null;
  confidence: ProofLinkConfidence;
  reason: string;
  candidateActionPackIds: string[];
};

/** Normalize any URL/path to a comparable path: strip protocol+host, query/hash,
 *  trailing slash; lowercase. Pure (no canonicalize-store dependency). */
export function normPath(u: string): string {
  if (!u) return "";
  let s = u.trim().toLowerCase();
  s = s.replace(/^https?:\/\/[^/]+/, "");
  s = s.split(/[?#]/)[0] ?? s;
  s = s.replace(/\/+$/, "");
  return s || "/";
}

/** Coarse change family from a free-text ledger action string. */
export function familyOfLedgerAction(a: string): string {
  const s = (a ?? "").toLowerCase();
  if (/title|meta|ctr/.test(s)) return "title_meta";
  if (/answer|aeo|faq|schema/.test(s)) return "aeo";
  if (/internal|link|consolidat/.test(s)) return "links";
  if (/friction|experience|\bcro\b|\bux\b|conversion/.test(s)) return "cro";
  if (/new.?page|create|hub/.test(s)) return "new_page";
  return "edit"; // generic existing-page edit
}

/** Coarse change family from a typed ActionPack action. */
function familyOfPackAction(a: ActionType): string {
  switch (a) {
    case "fix_title_meta_ctr":
      return "title_meta";
    case "add_answer_block":
      return "aeo";
    case "add_internal_links":
    case "consolidate_pages":
      return "links";
    case "fix_conversion_friction":
      return "cro";
    case "create_new_page":
    case "create_hub":
      return "new_page";
    default:
      return "edit"; // edit_existing_page + anything else existing-page
  }
}

/** Families are compatible when equal, or when one side is the generic existing-page
 *  "edit" (which can carry a title/answer/etc. change) — but never across new_page. */
export function familyCompatible(led: string, pack: string): boolean {
  if (led === pack) return true;
  if (led === "new_page" || pack === "new_page") return false;
  return led === "edit" || pack === "edit";
}

export function linkProofRowsToActionPacks<R extends ProofRowLike>(input: {
  proofRows: R[];
  actionPacks: ActionPack[];
}): ProofLink<R>[] {
  const { proofRows, actionPacks } = input;
  const byId = new Map(actionPacks.map((p) => [p.id, p]));
  const byPath = new Map<string, ActionPack[]>();
  for (const p of actionPacks) {
    if (!p.targetUrl) continue; // create/hub packs have no page to match a ship to
    const k = normPath(p.targetUrl);
    const arr = byPath.get(k) ?? [];
    arr.push(p);
    byPath.set(k, arr);
  }

  return proofRows.map((row) => {
    // 1. Exact — a stored id (forward-only; absent today, but honoured if present).
    if (row.actionPackId && byId.has(row.actionPackId)) {
      const pack = byId.get(row.actionPackId)!;
      return {
        proofRow: row,
        actionPack: pack,
        confidence: "exact",
        reason: "Linked by stored ActionPack id.",
        candidateActionPackIds: [pack.id],
      };
    }

    const rowPath = normPath(row.path || row.page);
    const samePath = byPath.get(rowPath) ?? [];
    const candidateActionPackIds = samePath.map((p) => p.id);
    if (samePath.length === 0) {
      return {
        proofRow: row,
        actionPack: null,
        confidence: "none",
        reason: "No ActionPack targets this page — manual or legacy change.",
        candidateActionPackIds,
      };
    }

    const ledFam = familyOfLedgerAction(row.actionType);
    // 2. Strong — same page AND a compatible change family.
    const strong = samePath.find((p) => familyCompatible(ledFam, familyOfPackAction(p.actionType)));
    if (strong) {
      return {
        proofRow: row,
        actionPack: strong,
        confidence: "strong",
        reason: "Same page and a matching change type.",
        candidateActionPackIds,
      };
    }
    // 3. Weak — same page only (the change kind differs from any pack on this page).
    return {
      proofRow: row,
      actionPack: samePath[0] ?? null,
      confidence: "weak",
      reason: "Same page, but a different change type than the ranked move.",
      candidateActionPackIds,
    };
  });
}
