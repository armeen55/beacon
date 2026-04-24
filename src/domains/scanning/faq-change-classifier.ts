/**
 * Phase C (2026-04-24) — FAQ change classifier.
 *
 * Problem. Prior to Phase C, faq_count_changed findings emitted a single
 * flat summary regardless of source — "Q&A blocks disappeared from
 * /services (was 10)" or "Q&A count changed: 16 → 8". That conflated
 * three distinct events:
 *   (a) Visible FAQ content actually removed from the page.
 *   (b) FAQPage JSON-LD removed; visible HTML FAQ still present.
 *   (c) Duplicate FAQPage JSON-LD blocks deduplicated; same content.
 *
 * Operator saw (c) on /our-process (16 → 8, two blocks dedup'd to one)
 * and (b) on /services (schema removed, but visible FAQ renders fine)
 * and interpreted them as scary content loss. That's a trust break.
 *
 * This classifier takes the prev + curr PageSnapshot (same objects the
 * detector already has in hand) and returns the product-truthful
 * category + summary copy. Pure function. Zero I/O.
 */
import type { PageSnapshot, FaqItem } from "@/domains/pages/types";

export type FaqChangeKind =
  | "visible_removed"
  | "schema_removed_visible_present"
  | "duplicate_schema_cleanup"
  | "expanded"
  | "structure_changed";

export type FaqChangeClassification = {
  kind: FaqChangeKind;
  /** One-line summary suitable for Today's finding row. */
  summary: string;
  /** Imperative hint for the operator on what to do next. */
  suggestedAction: string;
  /** Severity tier — consumers can use to colour/sort findings. */
  severity: "high" | "medium" | "low";
  /** Per-source snapshot of the counts, so the UI can show evidence if
   *  it wants to. Not currently rendered but useful for debugging. */
  evidence: {
    prevTotal: number;
    currTotal: number;
    prevJsonld: number;
    currJsonld: number;
    prevVisible: number;
    currVisible: number;
    prevBlocks: number;
    currBlocks: number;
  };
};

function countBySource(faqs: ReadonlyArray<FaqItem>): {
  jsonld: number;
  html_details: number;
  html_section: number;
} {
  const counts = { jsonld: 0, html_details: 0, html_section: 0 };
  for (const f of faqs) {
    if (f.source === "jsonld") counts.jsonld += 1;
    else if (f.source === "html_details") counts.html_details += 1;
    else if (f.source === "html_section") counts.html_section += 1;
  }
  return counts;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function classifyFaqChange(
  prev: PageSnapshot,
  curr: PageSnapshot,
): FaqChangeClassification {
  const prevCounts = countBySource(prev.faqs ?? []);
  const currCounts = countBySource(curr.faqs ?? []);
  const prevJsonld = prevCounts.jsonld;
  const currJsonld = currCounts.jsonld;
  const prevVisible = prevCounts.html_details + prevCounts.html_section;
  const currVisible = currCounts.html_details + currCounts.html_section;
  const prevTotal = (prev.faqs ?? []).length;
  const currTotal = (curr.faqs ?? []).length;
  const prevBlocks = prev.faq_schema_block_count ?? 0;
  const currBlocks = curr.faq_schema_block_count ?? 0;
  const path = pathOf(curr.url);

  const evidence = {
    prevTotal,
    currTotal,
    prevJsonld,
    currJsonld,
    prevVisible,
    currVisible,
    prevBlocks,
    currBlocks,
  };

  // Case C — duplicate FAQPage block cleanup.
  // Signal: prev had >1 FAQPage JSON-LD blocks, curr has ≥1 fewer blocks,
  // and the total count dropped roughly proportionally (same questions,
  // fewer blocks).
  //
  // Canonical shape: 2 blocks × N questions (prev=2N) → 1 block × N
  // questions (curr=N). Halving, +/- tolerance for answer-text edits.
  if (prevBlocks > 1 && currBlocks < prevBlocks && currBlocks >= 1 && currTotal > 0) {
    const expectedCurr = Math.round(prevTotal * (currBlocks / prevBlocks));
    const tolerance = Math.max(1, Math.round(expectedCurr * 0.2));
    if (Math.abs(currTotal - expectedCurr) <= tolerance) {
      return {
        kind: "duplicate_schema_cleanup",
        severity: "low",
        summary: `Duplicate FAQ/schema cleanup detected on ${path} (${prevBlocks} FAQPage blocks → ${currBlocks})`,
        suggestedAction:
          "Intentional cleanup — visible content is unchanged. Confirm to log as a dedupe, or dismiss.",
        evidence,
      };
    }
  }

  // Case B — FAQPage JSON-LD removed, but visible HTML FAQ content remains.
  // Signal: prev had JSON-LD FAQs, curr has zero JSON-LD FAQs, but curr
  // still has visible HTML FAQs.
  if (prevJsonld > 0 && currJsonld === 0 && currVisible > 0) {
    return {
      kind: "schema_removed_visible_present",
      severity: "medium",
      summary: `FAQ schema removed on ${path}; visible FAQ content still present (${currVisible} Q&A)`,
      suggestedAction:
        "AI engines can no longer lift FAQs as structured data. Re-add FAQPage JSON-LD unless this was intentional.",
      evidence,
    };
  }

  // Case A — visible FAQ content removed.
  // Signal: total faqs dropped to zero (any source), AND prev had ≥1
  // visible FAQ. If prev only had JSON-LD and curr has nothing, we can't
  // confirm visible removal from extractor signals alone — fall through
  // to structure_changed.
  if (prevTotal > 0 && currTotal === 0 && prevVisible > 0) {
    return {
      kind: "visible_removed",
      severity: "high",
      summary: `Visible FAQ content removed from ${path} (was ${prevTotal} Q&A)`,
      suggestedAction:
        "Check if the removal was intentional. Pages with Q&A tend to get more AI citations.",
      evidence,
    };
  }

  // Case D — FAQ content expanded.
  // Signal: curr total strictly greater than prev total.
  if (currTotal > prevTotal) {
    const delta = currTotal - prevTotal;
    return {
      kind: "expanded",
      severity: "low",
      summary: `FAQ content expanded on ${path} (${prevTotal} → ${currTotal}, +${delta} Q&A)`,
      suggestedAction:
        "More Q&A coverage. Confirm to track whether this lifts AI citations.",
      evidence,
    };
  }

  // Case E — fallback: counts changed but we can't cleanly classify.
  // Includes: both JSON-LD and visible removed simultaneously,
  // non-halving reductions without block change, source migrations.
  return {
    kind: "structure_changed",
    severity: "medium",
    summary: `FAQ structure changed on ${path} — review (${prevTotal} → ${currTotal} Q&A)`,
    suggestedAction:
      "Source mix changed. Open the page to confirm whether this is content, schema, or layout.",
    evidence,
  };
}
