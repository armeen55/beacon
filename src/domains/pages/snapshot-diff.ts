/**
 * Diff logic for page snapshots.
 * Compares current vs previous snapshot and produces a structured diff.
 */

import type { PageSnapshot, PageSnapshotDiff } from "./types";

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

  const changed =
    titleChanged ||
    h1Changed ||
    metaDescriptionChanged ||
    faqCountChanged ||
    schemaChanged ||
    contentChanged ||
    headingsChanged;

  const parts: string[] = [];
  if (titleChanged) parts.push("title");
  if (h1Changed) parts.push("H1");
  if (metaDescriptionChanged) parts.push("meta description");
  if (headingsChanged) parts.push("headings");
  if (faqCountChanged) {
    const delta = current.faqs.length - previous.faqs.length;
    parts.push(
      delta > 0
        ? `+${delta} FAQ${delta !== 1 ? "s" : ""}`
        : `${delta} FAQ${Math.abs(delta) !== 1 ? "s" : ""}`
    );
  }
  if (schemaChanged) parts.push("schema");
  if (contentChanged && !headingsChanged && !titleChanged) parts.push("content");

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
    schema_changed: schemaChanged,
    content_changed: contentChanged,
    headings_changed: headingsChanged,
    summary,
  };
}
