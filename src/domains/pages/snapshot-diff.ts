/**
 * Diff logic for page snapshots.
 * Compares current vs previous snapshot and produces a structured diff.
 */

import type { PageSnapshot, PageSnapshotDiff } from "./types";

/** Ordered string-array equality. Used for headings where sequence matters. */
function arraysEqualOrdered(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

/** Set-based string-array equality. Used for schema entity names where
 *  order doesn't carry editorial meaning. */
function arraysEqualSet(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  const aa = new Set(a ?? []);
  const bb = new Set(b ?? []);
  if (aa.size !== bb.size) return false;
  for (const v of aa) if (!bb.has(v)) return false;
  return true;
}

export function diffSnapshots(
  current: PageSnapshot,
  previous: PageSnapshot
): PageSnapshotDiff {
  const titleChanged = current.title !== previous.title;
  const h1Changed = current.h1 !== previous.h1;
  const metaDescriptionChanged =
    current.meta_description !== previous.meta_description;
  const faqCountChanged = current.faqs.length !== previous.faqs.length;
  const schemaChanged = current.schema_hash !== previous.schema_hash;
  const contentChanged = current.content_hash !== previous.content_hash;
  const headingsChanged = current.headings_hash !== previous.headings_hash;

  // Phase post-A+B1 (2026-04-21) — direct array diffs for fields that
  // PageSnapshot extraction already captures but the legacy hash set
  // didn't decompose. Kept as separate booleans so callers can emit
  // distinct finding types per field rather than the catch-all
  // `unexpected_change`.
  const h2Changed = !arraysEqualOrdered(current.h2_list, previous.h2_list);
  const h3Changed = !arraysEqualOrdered(current.h3_list, previous.h3_list);
  const schemaEntityNamesChanged = !arraysEqualSet(
    current.schema_entity_names,
    previous.schema_entity_names,
  );

  const changed =
    titleChanged ||
    h1Changed ||
    metaDescriptionChanged ||
    faqCountChanged ||
    schemaChanged ||
    contentChanged ||
    headingsChanged ||
    h2Changed ||
    h3Changed ||
    schemaEntityNamesChanged;

  const parts: string[] = [];
  if (titleChanged) parts.push("title");
  if (h1Changed) parts.push("H1");
  if (h2Changed) parts.push("H2");
  if (h3Changed) parts.push("H3");
  if (metaDescriptionChanged) parts.push("meta description");
  if (headingsChanged && !h1Changed && !h2Changed) parts.push("headings");
  if (faqCountChanged) {
    const delta = current.faqs.length - previous.faqs.length;
    parts.push(
      delta > 0
        ? `+${delta} FAQ${delta !== 1 ? "s" : ""}`
        : `${delta} FAQ${Math.abs(delta) !== 1 ? "s" : ""}`
    );
  }
  if (schemaChanged) parts.push("schema");
  if (schemaEntityNamesChanged) parts.push("schema entity names");
  if (contentChanged && !headingsChanged && !titleChanged && !h2Changed && !h3Changed)
    parts.push("content");

  const summary = changed
    ? `Changed: ${parts.join(", ")}`
    : "No changes detected";

  return {
    page_id: current.page_id,
    url: current.url,
    previous_fetched_at: previous.fetched_at,
    current_fetched_at: current.fetched_at,
    changed,
    title_changed: titleChanged,
    h1_changed: h1Changed,
    meta_description_changed: metaDescriptionChanged,
    faq_count_changed: faqCountChanged,
    previous_faq_count: previous.faqs.length,
    schema_changed: schemaChanged,
    content_changed: contentChanged,
    headings_changed: headingsChanged,
    h2_changed: h2Changed,
    h3_changed: h3Changed,
    schema_entity_names_changed: schemaEntityNamesChanged,
    summary,
  };
}
