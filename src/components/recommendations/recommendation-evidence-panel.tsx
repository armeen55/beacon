/**
 * <RecommendationEvidencePanel> — Trust Sprint Mini-Phase T4.3 (2026-05-06).
 *
 * Customer-safe evidence panel for the /recommendations row drawer.
 * Per Trust Sprint Phase 2.B audit, the engine claims to use search
 * queries, owned-page matches, and competitor angles to ground each
 * recommendation, but the persisted row never surfaced them. This
 * panel categorizes the row's evidence refs into named buckets and
 * shows what's present + what's missing.
 *
 * Honesty contract:
 *   - Customer copy uses "AI search queries seen", "Prompts affected",
 *     "Owned page matched", "Competitor context", "Page elements
 *     referenced", "Brand assertions". NEVER raw enum names like
 *     "search_query", "owned_page", "evidence[].type".
 *   - When a category is missing, the "Evidence missing" sub-section
 *     lists it with a one-line reason — keeps the operator honest
 *     about what grounding the rec lacks.
 *   - When the row has zero evidence refs, surface
 *     "Evidence packet not available for this older recommendation."
 *     and skip the categorized breakdown. Do not fake evidence.
 *   - Operator-only debug detail (raw promptIds, full evidence JSON)
 *     stays gated behind the existing OPERATOR_MODE_DEBUG block in
 *     recommendations-client; this panel is customer-safe by default.
 *
 * Props mirror the row.detail fields wired in T4.2:
 *   - evidenceRefs: ReadonlyArray<SpecificEditEvidenceRef>
 *   - affectedPromptCount: number
 *   - observationCount: number
 *   - evidenceDepth: number
 *   - topCompetitor: { name; primaryPct } | null
 *   - promptTextById: lookup table for prompt text snippets
 *
 * Note: `aiSearchSignal.topSearchQueries` is the original packet
 * field; the persisted evidence array does NOT carry it today (Phase
 * 2.B audit finding). When `searchQueries` arrive in `evidenceRefs`
 * the panel will surface them; until that happens, the panel reports
 * "AI search queries seen: not surfaced for this rec" with an
 * explanatory caveat.
 */

import type { SpecificEditEvidenceRef } from "@/domains/recommendations/specific-edit-provider";

export type RecommendationEvidencePanelProps = {
  /** All evidence refs the persisted row carried. */
  evidenceRefs: ReadonlyArray<SpecificEditEvidenceRef>;
  /** Affected-prompt count from rec.evidence (denormalized to row.detail). */
  affectedPromptCount: number;
  /** Observation count from rec.evidence. */
  observationCount: number;
  /** Evidence-depth rank score (0..6) — exposed at the bottom for operator clarity. */
  evidenceDepth: number;
  /** Top competitor for the rec's affected prompts (filtered for directories). */
  topCompetitor: { name: string; primaryPct: number } | null;
  /** Prompt-id → prompt-text lookup so the panel can show snippets, not UUIDs. */
  promptTextById: Record<string, string>;
};

const URL_HOSTNAME_RE = /^https?:\/\/([^/]+)\//i;

function shortUrl(url: string): string {
  const m = URL_HOSTNAME_RE.exec(url + "/");
  if (!m) return url.length > 50 ? `${url.slice(0, 47)}…` : url;
  const host = m[1].replace(/^www\./, "");
  // strip protocol; trim path
  const stripped = url.replace(/^https?:\/\/(www\.)?/i, "");
  if (stripped.length <= 50) return stripped;
  return `${host}…`;
}

function snippet(text: string | undefined, max = 60): string {
  if (!text) return "an affected prompt";
  return text.length > max ? `${text.slice(0, max - 3).trim()}…` : text;
}

export function RecommendationEvidencePanel({
  evidenceRefs,
  affectedPromptCount,
  observationCount,
  evidenceDepth,
  topCompetitor,
  promptTextById,
}: RecommendationEvidencePanelProps) {
  // ── Group refs by category ──
  const promptRefs: Array<{ promptId?: string }> = [];
  const ownedPageRefs: Array<{ url?: string }> = [];
  const competitorRefs: Array<{ competitorName?: string }> = [];
  const elementRefs: Array<{ url?: string; elementKey?: string }> = [];
  const priorOutcomeRefs: Array<{ actionType?: string }> = [];
  const searchQueryRefs: Array<{ query?: string; count?: number }> = [];
  const brandAssertionRefs: Array<{ assertionId?: string }> = [];

  for (const ref of evidenceRefs ?? []) {
    if (ref.type === "prompt") promptRefs.push(ref);
    else if (ref.type === "owned_page") ownedPageRefs.push(ref);
    else if (ref.type === "competitor") competitorRefs.push(ref);
    else if (ref.type === "element") elementRefs.push(ref);
    else if (ref.type === "prior_outcome") priorOutcomeRefs.push(ref);
    // search_query + brand_assertion are not in the persisted union
    // today; kept here so the panel will surface them when the
    // serializer starts including them.
    else if ((ref as { type: string }).type === "search_query") {
      searchQueryRefs.push(ref as never);
    } else if ((ref as { type: string }).type === "brand_assertion") {
      brandAssertionRefs.push(ref as never);
    }
  }

  // ── Empty case: NO evidence refs AND no rec-level signals (
  // affectedPromptCount, observationCount, topCompetitor) → say so
  // honestly. Older rows whose evidence array was never serialized
  // hit this branch. When the rec carries denormalized counts or a
  // top competitor, we fall through and render those buckets even
  // though the evidence-refs array is empty.
  const hasAnyRecLevelSignal =
    affectedPromptCount > 0 ||
    observationCount > 0 ||
    topCompetitor !== null;
  if (
    evidenceRefs.length === 0 &&
    promptRefs.length === 0 &&
    ownedPageRefs.length === 0 &&
    competitorRefs.length === 0 &&
    !hasAnyRecLevelSignal
  ) {
    return (
      <div
        className="text-foreground/85 text-[12px] leading-relaxed"
        data-rec-evidence-panel="true"
        data-rec-evidence-empty="true"
      >
        <p className="italic text-muted-foreground">
          Evidence packet not available for this older recommendation.
        </p>
      </div>
    );
  }

  // ── Missing categories — operator-honest tag ──
  const missing: string[] = [];
  if (promptRefs.length === 0 && affectedPromptCount === 0) missing.push("Prompts affected");
  if (ownedPageRefs.length === 0) missing.push("Owned page matched");
  if (searchQueryRefs.length === 0) missing.push("AI search queries seen");
  if (competitorRefs.length === 0 && !topCompetitor) missing.push("Competitor context");
  if (brandAssertionRefs.length === 0) missing.push("Brand assertions");

  return (
    <div
      className="text-foreground/90 text-[12px] leading-relaxed space-y-2"
      data-rec-evidence-panel="true"
    >
      {/* Prompts affected */}
      {(affectedPromptCount > 0 || promptRefs.length > 0) && (
        <div data-rec-evidence-bucket="prompts">
          <p className="text-muted-foreground">
            Prompts affected:{" "}
            <span className="font-medium text-foreground">{affectedPromptCount}</span>
            {observationCount > 0 ? (
              <>
                {" "}
                <span className="text-muted-foreground/80">
                  ({observationCount} AI answer{observationCount === 1 ? "" : "s"})
                </span>
              </>
            ) : null}
          </p>
          {promptRefs.length > 0 && (
            <ul className="ml-4 mt-0.5 list-disc list-outside text-[11px] text-muted-foreground space-y-0.5">
              {promptRefs.slice(0, 3).map((ref, i) => (
                <li key={i}>
                  &ldquo;{snippet(promptTextById[ref.promptId ?? ""])}&rdquo;
                </li>
              ))}
              {promptRefs.length > 3 && (
                <li className="italic text-muted-foreground/70">
                  +{promptRefs.length - 3} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* AI search queries seen */}
      {searchQueryRefs.length > 0 && (
        <div data-rec-evidence-bucket="search-queries">
          <p className="text-muted-foreground">
            AI search queries seen:{" "}
            <span className="font-medium text-foreground">{searchQueryRefs.length}</span>
          </p>
          <ul className="ml-4 mt-0.5 list-disc list-outside text-[11px] text-muted-foreground space-y-0.5">
            {searchQueryRefs.slice(0, 3).map((ref, i) => (
              <li key={i}>
                &ldquo;{snippet(ref.query, 70)}&rdquo;
                {typeof ref.count === "number" && ref.count > 1 ? (
                  <span className="text-muted-foreground/70"> · {ref.count}×</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Owned page matched */}
      {ownedPageRefs.length > 0 && (
        <div data-rec-evidence-bucket="owned-page">
          <p className="text-muted-foreground">
            Owned page matched:{" "}
            <span className="font-medium text-foreground">{shortUrl(ownedPageRefs[0]!.url ?? "—")}</span>
            {ownedPageRefs.length > 1 && (
              <span className="text-muted-foreground/70">
                {" "}+ {ownedPageRefs.length - 1} more
              </span>
            )}
          </p>
        </div>
      )}

      {/* Competitor context */}
      {(topCompetitor || competitorRefs.length > 0) && (
        <div data-rec-evidence-bucket="competitor">
          <p className="text-muted-foreground">
            Competitor context:{" "}
            {topCompetitor ? (
              <>
                <span className="font-medium text-foreground">{topCompetitor.name}</span>
                <span className="text-muted-foreground/80">
                  {" "}primary in {topCompetitor.primaryPct}% of affected prompts
                </span>
              </>
            ) : (
              <span className="font-medium text-foreground">
                {competitorRefs[0]?.competitorName ?? "—"}
                {competitorRefs.length > 1 ? ` + ${competitorRefs.length - 1} more` : ""}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Page elements referenced */}
      {elementRefs.length > 0 && (
        <div data-rec-evidence-bucket="elements">
          <p className="text-muted-foreground">
            Page elements referenced:{" "}
            <span className="font-medium text-foreground">{elementRefs.length}</span>
          </p>
        </div>
      )}

      {/* Prior outcomes */}
      {priorOutcomeRefs.length > 0 && (
        <div data-rec-evidence-bucket="prior-outcomes">
          <p className="text-muted-foreground">
            Past similar edits:{" "}
            <span className="font-medium text-foreground">{priorOutcomeRefs.length}</span>
          </p>
        </div>
      )}

      {/* Brand assertions */}
      {brandAssertionRefs.length > 0 && (
        <div data-rec-evidence-bucket="brand-assertions">
          <p className="text-muted-foreground">
            Brand assertions used:{" "}
            <span className="font-medium text-foreground">{brandAssertionRefs.length}</span>
          </p>
        </div>
      )}

      {/* Missing evidence — operator-honest */}
      {missing.length > 0 && (
        <div
          className="border-l-2 border-amber-500/40 pl-3 mt-1.5"
          data-rec-evidence-bucket="missing"
        >
          <p className="text-amber-700 dark:text-amber-400 text-[11px]">
            Evidence missing: {missing.join(", ")}.
          </p>
        </div>
      )}

      {/* Evidence depth (rank score) — surfaces the T4.2 sort signal */}
      <p className="text-[11px] text-muted-foreground/70 pt-0.5">
        Evidence depth score: <span className="font-mono">{evidenceDepth}</span> / 6
        <span className="ml-1.5 text-muted-foreground/50">
          (higher = richer grounding; drives rank tiebreakers)
        </span>
      </p>
    </div>
  );
}
