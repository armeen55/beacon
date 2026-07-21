import { redirect } from "next/navigation";

/**
 * /research/keywords - retired (Phase 4B Lane 1, 2026-07-21). It owned no
 * backend: it was a read-only view over @/domains/research/keyword-library,
 * which already flows into Changes via the allocator (allocator/unified-list.ts
 * -> changes-data.ts). The keyword caches/stores are untouched and keep feeding
 * Changes; only this redundant view dies. Thin permanent redirect so no
 * bookmark or muscle-memory link breaks.
 */
export default function ResearchKeywordsRedirect() {
  redirect("/changes");
}
