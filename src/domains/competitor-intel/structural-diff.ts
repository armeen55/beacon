/**
 * 2026-06-09 — Competitor page structural diff (pure).
 *
 * Compares two `CompetitorPageSnapshot`s of the SAME URL (the stored one
 * vs a fresh fetch) and names what changed in plain English: FAQ added/
 * expanded, new sections, retitled, meta added. The refresh pipeline
 * runs this at fetch time (the snapshot store keeps latest-per-URL, so
 * this is the only moment both shapes exist) and persists the detected
 * changes; move detection joins them with citation aftermath.
 *
 * Conservative by design: only emits changes a customer would recognize
 * as a real content move. Extraction-uncertain fetches (client-rendered
 * pages the raw fetch may have missed) are compared but FAQ/section
 * REMOVALS are never emitted — absence under uncertainty is not evidence.
 */

import type { CompetitorPageSnapshot } from "@/domains/pages/competitor-page-snapshots";
import type { CompetitorStructuralChange } from "./types";

function normalizeHeading(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Diff prev → next for one URL. `meta` supplies the competitor identity
 * (the snapshot itself only carries the URL).
 */
export function diffCompetitorPageStructure(
  prev: CompetitorPageSnapshot,
  next: CompetitorPageSnapshot,
  meta: { domain: string; displayName: string },
): CompetitorStructuralChange[] {
  const changes: CompetitorStructuralChange[] = [];
  const base = {
    url: next.url,
    domain: meta.domain,
    displayName: meta.displayName,
    capturedAt: next.fetched_at,
  };

  // FAQ: appeared or meaningfully grew. Never report shrink/removal.
  const prevFaq = prev.faq_questions.length;
  const nextFaq = next.faq_questions.length;
  if (prevFaq === 0 && nextFaq > 0) {
    changes.push({
      ...base,
      kind: "faq_added",
      detail: `added an FAQ (${nextFaq} question${nextFaq === 1 ? "" : "s"})`,
    });
  } else if (prevFaq > 0 && nextFaq - prevFaq >= 2) {
    changes.push({
      ...base,
      kind: "faq_expanded",
      detail: `expanded their FAQ from ${prevFaq} to ${nextFaq} questions`,
    });
  }

  // New H2 sections (token-normalized so cosmetic edits don't fire).
  const prevH2 = new Set(prev.h2_list.map(normalizeHeading).filter(Boolean));
  const added: string[] = [];
  for (const h of next.h2_list) {
    const norm = normalizeHeading(h);
    if (norm !== "" && !prevH2.has(norm)) added.push(h.trim());
  }
  if (added.length > 0) {
    const named = added.slice(0, 2).map((h) => `“${h}”`).join(", ");
    const more = added.length > 2 ? ` and ${added.length - 2} more` : "";
    changes.push({
      ...base,
      kind: "section_added",
      detail: `added new section${added.length === 1 ? "" : "s"}: ${named}${more}`,
    });
  }

  // Retitled (both present and different).
  const prevTitle = prev.title?.trim() ?? "";
  const nextTitle = next.title?.trim() ?? "";
  if (prevTitle !== "" && nextTitle !== "" && prevTitle !== nextTitle) {
    changes.push({
      ...base,
      kind: "title_changed",
      detail: `retitled the page to “${nextTitle}”`,
    });
  }

  // Meta description appeared.
  const prevMeta = prev.meta_description?.trim() ?? "";
  const nextMeta = next.meta_description?.trim() ?? "";
  if (prevMeta === "" && nextMeta !== "") {
    changes.push({
      ...base,
      kind: "meta_added",
      detail: "added a search description",
    });
  }

  return changes;
}
