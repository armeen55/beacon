import "server-only";

import type { PageSnapshot } from "@/domains/pages/types";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Finding, FindingPriority, FindingSeverity, FindingType } from "./types";
import { diffSnapshots } from "@/domains/pages/snapshot-diff";
import {
  evaluateAiBotAccess,
  type RobotsFile,
} from "@/domains/pages/robots-parser";
import { classifyAssetType } from "@/domains/pages/classify-asset-type";
import {
  diffSchemaCoverage,
  type SchemaCoverageDiff,
} from "@/domains/pages/expected-schema";
import { classifyFaqChange } from "./faq-change-classifier";
import { isFindingAutoLinkEnabled } from "@/lib/flags";

type CitationLookup = Map<string, number>;
type PreviouslyRejectedLookup = Set<string>;

/** Phase Auto-Link v2 (2026-04-24). Window for matching a finding to a
 *  recommendation-sourced changelog entry on the same URL. 14 days covers
 *  accept-Monday-ship-next-Monday cycles without false-linking stale
 *  acceptances. */
const REC_LINK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Phase Auto-Link v2 (2026-04-24) signal compatibility table.
 *
 * Determines whether a given finding type is "caused by" a changelog
 * entry of a given signal_type. Used to prevent over-linking: a
 * schema_changed scan finding should NOT link to a Strengthen content
 * changelog just because they share a URL.
 *
 * Mapping rationale:
 *   - Heading / meta / content findings → only content-signal changelog
 *     (Strengthen, Expand accept → content).
 *   - faq_changed → content OR technical. FAQ edits can come from
 *     Strengthen (content) or from add_section_or_faq (technical).
 *   - Schema / canonical / link findings → technical only (add_section,
 *     merge_or_dedupe, explicit schema work).
 *   - page_added / page_removed → page only (create_new_page).
 *   - faq_without_schema / schema_missing_for_page_type / faq_schema_*
 *     findings → technical (schema-family).
 */
const FINDING_TYPE_TO_COMPATIBLE_CHANGELOG_SIGNALS: Partial<
  Record<FindingType, ReadonlyArray<"content" | "technical" | "faq" | "page">>
> = {
  title_changed: ["content"],
  meta_changed: ["content"],
  h1_changed: ["content"],
  h2_changed: ["content"],
  h3_changed: ["content"],
  content_changed: ["content"],
  // FAQ edits legitimately come from Strengthen/Expand (content) or from
  // add_section_or_faq (technical). Both are valid source actions.
  faq_changed: ["content", "technical", "faq"],
  // Schema + canonical + links are structural — only technical changelog
  // actions (add_section_or_faq, merge_or_dedupe, explicit schema work)
  // should be able to claim a schema finding as their downstream effect.
  schema_changed: ["technical"],
  schema_entity_names_changed: ["technical"],
  schema_invalid: ["technical"],
  schema_missing_for_page_type: ["technical"],
  faq_without_schema: ["technical", "faq"],
  canonical_changed: ["technical"],
  links_changed: ["technical"],
  page_added: ["page"],
  page_removed: ["page"],
};

type ChangelogCandidate = {
  id: string;
  recId: string;
  patternId: string | null;
  signalType: string;
  timestampMs: number;
};

/**
 * Phase Auto-Link v2 (2026-04-24). Build a lookup of recent
 * recommendation-sourced changelog entries, keyed by normalised URL
 * path. Eligible entries:
 *   - hypothesis_source === "recommendation"
 *   - source_rec_id present
 *   - url present
 *   - timestamp within the 14-day window
 *
 * Multiple eligible entries on the same URL are preserved; the match
 * step picks the newest one whose signal_type is compatible with the
 * finding's type.
 *
 * needs_review / split / watch actions don't create changelog entries
 * via `acceptRecommendation` (see Phase 5 `shouldStampChangelog`), so
 * they're automatically excluded from this lookup.
 */
function buildRecommendationChangelogLookup(
  changelog: ReadonlyArray<ChangelogEntry>,
  nowIso: string,
): Map<string, ChangelogCandidate[]> {
  const out = new Map<string, ChangelogCandidate[]>();
  const nowMs = Date.parse(nowIso);
  const cutoff = nowMs - REC_LINK_WINDOW_MS;

  for (const entry of changelog) {
    if (entry.hypothesis_source !== "recommendation") continue;
    if (!entry.source_rec_id) continue;
    if (!entry.url) continue;
    const tsMs = Date.parse(entry.timestamp);
    if (!Number.isFinite(tsMs)) continue;
    if (tsMs < cutoff) continue;

    const key = entry.url
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    if (!key) continue;

    const existing = out.get(key) ?? [];
    existing.push({
      id: entry.id,
      recId: entry.source_rec_id,
      patternId: entry.source_pattern_id ?? null,
      signalType: entry.signal_type,
      timestampMs: tsMs,
    });
    out.set(key, existing);
  }
  return out;
}

/**
 * Phase Auto-Link v2 (2026-04-24). Stamp a finding with metadata from
 * the newest eligible recommendation-sourced changelog entry whose URL
 * matches and whose signal_type is compatible with the finding's type.
 *
 * Hard guardrails (in order):
 *   1. URL path must match (normalised, exact).
 *   2. Finding's `detectedAt` must be STRICTLY AFTER the changelog's
 *      timestamp — the edit must exist before it can be observed.
 *   3. Within 14-day window (already ensured by the lookup builder).
 *   4. Finding type must be compatible with changelog signal_type per
 *      FINDING_TYPE_TO_COMPATIBLE_CHANGELOG_SIGNALS.
 *   5. Finding stays `status=pending` — only metadata is stamped.
 *      Operator still has to click Confirm.
 *
 * No-op when no candidate matches. Never flips status.
 */
function stampFindingFromChangelog(
  finding: Finding,
  lookup: Map<string, ChangelogCandidate[]>,
): void {
  if (!finding.url) return;
  const key = finding.url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  const candidates = lookup.get(key);
  if (!candidates || candidates.length === 0) return;

  const compatible =
    FINDING_TYPE_TO_COMPATIBLE_CHANGELOG_SIGNALS[finding.type];
  if (!compatible) return;

  const detectedMs = Date.parse(finding.detectedAt);
  if (!Number.isFinite(detectedMs)) return;

  const eligible = candidates
    .filter((c) => {
      // Guardrail 2: finding must be detected STRICTLY AFTER the
      // recommendation-sourced changelog was stamped.
      if (c.timestampMs >= detectedMs) return false;
      // Guardrail 4: signal-type compatibility.
      return compatible.includes(
        c.signalType as "content" | "technical" | "faq" | "page",
      );
    })
    .sort((a, b) => b.timestampMs - a.timestampMs); // newest first

  const match = eligible[0];
  if (!match) return;

  finding.source_rec_id = match.recId;
  finding.source_pattern_id = match.patternId;
  finding.linkedChangeId = match.id;
}

export function generateFindings(opts: {
  currentSnapshots: PageSnapshot[];
  previousSnapshots: PageSnapshot[];
  currentGuardrails: GuardrailAlert[];
  previousGuardrails: GuardrailAlert[];
  changelog: ChangelogEntry[];
  scanRunId: string;
  tenantId: string;
  citationsByUrl?: CitationLookup;
  homepageUrl?: string;
  previouslyRejectedTypes?: PreviouslyRejectedLookup;
  /** G9 — parsed robots.txt for AI-bot disallow detection. Null/undefined → skip. */
  robots?: RobotsFile | null;
}): Finding[] {
  if (!opts.tenantId) {
    throw new Error(
      "[generateFindings] tenantId required; pass currentTenantId() / BEACON_TENANT_ID from the caller (orchestrate-scan or a CLI script).",
    );
  }
  const {
    currentSnapshots,
    previousSnapshots,
    currentGuardrails,
    previousGuardrails,
    changelog,
    scanRunId,
    tenantId,
    citationsByUrl,
    homepageUrl,
    previouslyRejectedTypes,
    robots,
  } = opts;

  const findings: Finding[] = [];
  const now = new Date().toISOString();
  const prevByUrl = new Map(previousSnapshots.map((s) => [norm(s.url), s]));
  const currByUrl = new Map(currentSnapshots.map((s) => [norm(s.url), s]));
  const changedUrls = new Set<string>();

  for (const curr of currentSnapshots) {
    const key = norm(curr.url);
    const prev = prevByUrl.get(key);
    if (!prev) continue;

    const diff = diffSnapshots(curr, prev);
    if (!diff.changed) continue;

    changedUrls.add(key);
    const citations = citationsByUrl?.get(key) ?? 0;
    const isHighCitation = citations >= 10;
    const isHP = homepageUrl ? norm(curr.url) === norm(homepageUrl) : curr.url.replace(/^https?:\/\/[^/]+\/?$/, "") === "";
    const wasRejected = (type: FindingType) => previouslyRejectedTypes?.has(`${type}::${key}`) ?? false;

    if (diff.title_changed) {
      findings.push(makeFinding({
        type: "title_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: prev.title,
        currentState: curr.title,
        severity: "medium",
        summary: `Title changed: "${prev.title ?? "(none)"}" → "${curr.title ?? "(none)"}"`,
        suggestedAction: "Review whether the new title is intentional",
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("title_changed"),
      }));
    }

    if (diff.meta_description_changed) {
      findings.push(makeFinding({
        type: "meta_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: prev.meta_description,
        currentState: curr.meta_description,
        severity: "medium",
        summary: `Meta description changed on ${pathOf(curr.url)}`,
        suggestedAction: "Confirm new description matches page intent",
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("meta_changed"),
      }));
    }

    if (diff.h1_changed) {
      findings.push(makeFinding({
        type: "h1_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: prev.h1,
        currentState: curr.h1,
        severity: "medium",
        summary: `H1 changed: "${prev.h1 ?? "(none)"}" → "${curr.h1 ?? "(none)"}"`,
        suggestedAction: "Verify the H1 still matches page topic",
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("h1_changed"),
      }));
    }

    // Phase post-A+B1 (2026-04-21) — H2 / H3 / schema-entity-names findings.
    // Replace the previous fall-through into `unexpected_change` for these
    // specific field diffs. Each finding carries a compact summary of the
    // first differing entry (or count delta) so Today's banner has real
    // operator copy, not a generic "unexpected" bucket.

    if (diff.h2_changed) {
      const prevH2 = prev.h2_list ?? [];
      const currH2 = curr.h2_list ?? [];
      const firstDiffIndex = (() => {
        const max = Math.max(prevH2.length, currH2.length);
        for (let i = 0; i < max; i++) {
          if (prevH2[i] !== currH2[i]) return i;
        }
        return -1;
      })();
      const detailPrev = firstDiffIndex >= 0 ? (prevH2[firstDiffIndex] ?? "(none)") : "(none)";
      const detailCurr = firstDiffIndex >= 0 ? (currH2[firstDiffIndex] ?? "(none)") : "(none)";
      findings.push(makeFinding({
        type: "h2_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: prevH2.join(" | ") || null,
        currentState: currH2.join(" | ") || null,
        severity: "medium",
        summary:
          prevH2.length !== currH2.length
            ? `H2 count changed on ${pathOf(curr.url)}: ${prevH2.length} → ${currH2.length}`
            : `H2 changed on ${pathOf(curr.url)}: "${detailPrev}" → "${detailCurr}"`,
        suggestedAction: "Review whether the new H2 still signposts the section's topic",
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("h2_changed"),
      }));
    }

    if (diff.h3_changed) {
      const prevH3 = prev.h3_list ?? [];
      const currH3 = curr.h3_list ?? [];
      const added = currH3.filter((h) => !prevH3.includes(h)).slice(0, 3);
      const removed = prevH3.filter((h) => !currH3.includes(h)).slice(0, 3);
      const deltaPieces: string[] = [];
      if (added.length) deltaPieces.push(`+${added.length} (${added[0]}${added.length > 1 ? "…" : ""})`);
      if (removed.length) deltaPieces.push(`-${removed.length} (${removed[0]}${removed.length > 1 ? "…" : ""})`);
      findings.push(makeFinding({
        type: "h3_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: prevH3.join(" | ") || null,
        currentState: currH3.join(" | ") || null,
        severity: "low",
        summary:
          deltaPieces.length > 0
            ? `H3 list changed on ${pathOf(curr.url)}: ${deltaPieces.join(", ")}`
            : `H3 list changed on ${pathOf(curr.url)} (${prevH3.length} → ${currH3.length})`,
        suggestedAction: "Review whether new sub-headings still signpost their sections clearly",
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("h3_changed"),
      }));
    }

    if (diff.schema_entity_names_changed) {
      const prevNames = prev.schema_entity_names ?? [];
      const currNames = curr.schema_entity_names ?? [];
      const added = currNames.filter((n) => !prevNames.includes(n));
      const removed = prevNames.filter((n) => !currNames.includes(n));
      const deltaPieces: string[] = [];
      if (added.length) deltaPieces.push(`+${added.slice(0, 3).join(", ")}${added.length > 3 ? "…" : ""}`);
      if (removed.length) deltaPieces.push(`-${removed.slice(0, 3).join(", ")}${removed.length > 3 ? "…" : ""}`);
      findings.push(makeFinding({
        type: "schema_entity_names_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: prevNames.join(", ") || "(none)",
        currentState: currNames.join(", ") || "(none)",
        severity: "low",
        summary: `Schema entity names changed on ${pathOf(curr.url)}: ${deltaPieces.join(" · ") || "updated"}`,
        suggestedAction: "Confirm the new schema entity names match the page's content",
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("schema_entity_names_changed"),
      }));
    }

    if (curr.canonical_url !== prev.canonical_url) {
      findings.push(makeFinding({
        type: "canonical_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: prev.canonical_url,
        currentState: curr.canonical_url,
        severity: isHighCitation ? "high" : "medium",
        summary: `Canonical URL changed on ${pathOf(curr.url)}`,
        suggestedAction: "Ensure canonical is correct — incorrect canonicals can lose citations",
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("canonical_changed"),
      }));
    }

    if (diff.faq_count_changed) {
      // Phase C (2026-04-24): classify using per-source breakdown +
      // FAQPage block count so duplicate-schema cleanup, schema removal
      // with visible content intact, and real content removal each get
      // their own honest copy. Replaces the pre-Phase-C "disappeared/
      // changed" binary that conflated these cases.
      const c = classifyFaqChange(prev, curr);
      const prevCount = prev.faqs.length;
      const currCount = curr.faqs.length;
      // Escalate severity on pages that actually get cited a lot, but
      // never escalate a duplicate_schema_cleanup (it's not a loss).
      const severity: FindingSeverity =
        c.kind === "duplicate_schema_cleanup"
          ? "low"
          : c.severity === "high" && isHighCitation
            ? "high"
            : c.severity;
      findings.push(makeFinding({
        type: "faq_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        // Keep the legacy "N Q&A blocks" shape for backward compatibility
        // with Rule β's numeric regex + per-finding UI cards that surface
        // prev/curr counts. The richer source breakdown lives on the
        // classifier's `evidence` object — if future UI wants it, thread
        // it through via a new field on Finding.
        previousState: `${prevCount} Q&A blocks`,
        currentState: `${currCount} Q&A blocks`,
        severity,
        summary: c.summary,
        suggestedAction: c.suggestedAction,
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("faq_changed"),
      }));
    }

    if (diff.schema_changed) {
      const prevTypes = prev.schema_types.join(", ") || "none";
      const currTypes = curr.schema_types.join(", ") || "none";
      const disappeared = prev.schema_types.length > 0 && curr.schema_types.length === 0;
      findings.push(makeFinding({
        type: "schema_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: prevTypes,
        currentState: currTypes,
        severity: disappeared && isHighCitation ? "high" : disappeared ? "medium" : "low",
        summary: disappeared
          ? `Structured data removed from ${pathOf(curr.url)} (was: ${prevTypes})`
          : `Schema changed: ${prevTypes} → ${currTypes}`,
        suggestedAction: disappeared
          ? "Verify schema removal was intentional"
          : "Review new schema types",
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("schema_changed"),
      }));
    }

    if (diff.content_changed && !diff.title_changed && !diff.h1_changed) {
      const wcDelta = curr.word_count - prev.word_count;
      const wcPct = prev.word_count > 0 ? Math.abs(wcDelta / prev.word_count) : 1;
      if (wcPct >= 0.2 || Math.abs(wcDelta) >= 200) {
        findings.push(makeFinding({
          type: "content_changed",
          url: curr.url,
          scanRunId,
          tenantId,
          now,
          previousState: `${prev.word_count} words`,
          currentState: `${curr.word_count} words`,
          severity: "medium",
          summary: `Content changed significantly on ${pathOf(curr.url)} (${wcDelta > 0 ? "+" : ""}${wcDelta} words)`,
          suggestedAction: "Review whether content change is expected",
          citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("content_changed"),
        }));
      }
    }

    const linkDelta = curr.internal_link_count - prev.internal_link_count;
    if (Math.abs(linkDelta) >= 3) {
      findings.push(makeFinding({
        type: "links_changed",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: `${prev.internal_link_count} internal links`,
        currentState: `${curr.internal_link_count} internal links`,
        severity: "low",
        summary: `Internal links ${linkDelta > 0 ? "increased" : "decreased"} by ${Math.abs(linkDelta)} on ${pathOf(curr.url)}`,
        suggestedAction: "Check if link changes were part of a site update",
        citationCount: citations, isHomepage: isHP, previouslyRejected: wasRejected("links_changed"),
      }));
    }
  }

  // New guardrails
  const prevGuardKeys = new Set(
    previousGuardrails.map((g) => `${g.category}::${norm(g.url)}`),
  );
  for (const g of currentGuardrails) {
    const key = `${g.category}::${norm(g.url)}`;
    if (!prevGuardKeys.has(key)) {
      const citations = citationsByUrl?.get(norm(g.url)) ?? 0;
      const isHP = homepageUrl ? norm(g.url) === norm(homepageUrl) : false;
      findings.push(makeFinding({
        type: "new_guardrail",
        url: g.url,
        scanRunId,
        tenantId,
        now,
        previousState: null,
        currentState: `${g.severity}: ${g.message}`,
        severity: citations >= 10 ? "high" : g.severity === "warning" ? "medium" : "low",
        summary: `New issue on ${pathOf(g.url)}: ${g.message}`,
        suggestedAction: "Open in Pages to see full detail",
        citationCount: citations, isHomepage: isHP,
      }));
    }
  }

  // Cleared guardrails — auto-accepted (informational, no user action needed)
  const currGuardKeys = new Set(
    currentGuardrails.map((g) => `${g.category}::${norm(g.url)}`),
  );
  for (const g of previousGuardrails) {
    const key = `${g.category}::${norm(g.url)}`;
    if (!currGuardKeys.has(key)) {
      const citations = citationsByUrl?.get(norm(g.url)) ?? 0;
      const finding = makeFinding({
        type: "guardrail_cleared",
        url: g.url,
        scanRunId,
        tenantId,
        now,
        previousState: g.message,
        currentState: null,
        severity: "low",
        summary: `Issue resolved on ${pathOf(g.url)}: ${g.category}`,
        suggestedAction: "No action needed — previously detected issue is now resolved",
        citationCount: citations,
      });
      // Auto-resolve: guardrail clearings are informational records, not user-confirmable
      finding.status = "accepted";
      finding.resolvedAt = now;
      finding.resolutionNote = "Auto-resolved: issue no longer detected";
      findings.push(finding);
    }
  }

  // FAQ without schema: pages with visible FAQ content but no matching FAQPage JSON-LD
  // This is the single highest-leverage finding — FAQ schema coverage drives ChatGPT citations
  for (const curr of currentSnapshots) {
    const hasFaq = (curr.faqs?.length ?? 0) > 0;
    const hasSchema = curr.schema_types.some((s) => s.toLowerCase().includes("faq"));
    const certainty = curr.extraction_certainty ?? "confident";

    if (hasFaq && !hasSchema && certainty !== "uncertain") {
      const key = norm(curr.url);
      const citations = citationsByUrl?.get(key) ?? 0;
      const isHP = homepageUrl ? key === norm(homepageUrl) : false;
      const faqCount = curr.faqs?.length ?? 0;
      // Severity scales with citation importance — zero-citation pages get "medium" not "high"
      const sev = (citations >= 1 || isHP) ? "high" as const : "medium" as const;
      findings.push(makeFinding({
        type: "faq_without_schema",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: `${faqCount} visible FAQ questions on page`,
        currentState: "No FAQPage JSON-LD schema detected",
        severity: sev,
        summary: `${pathOf(curr.url)}: ${faqCount} FAQ questions visible but no FAQPage schema`,
        suggestedAction: `Add FAQPage JSON-LD matching the ${faqCount} visible FAQ questions`,
        citationCount: citations, isHomepage: isHP,
      }));
    }
  }

  // ── G8: Schema validation vs Google rich-result specs ──
  // The extractor already populates `schema_validation_warnings` on each
  // snapshot. We emit ONE finding per snapshot with issues, severity bumped
  // by whether any `schema_critical:*` entries exist. These are the "your
  // rich snippets silently don't fire" findings.
  for (const curr of currentSnapshots) {
    const warnings = curr.schema_validation_warnings ?? [];
    if (warnings.length === 0) continue;

    const hasCritical = warnings.some((w) => w.startsWith("schema_critical:"));
    const hasWarning = warnings.some((w) => w.startsWith("schema_warning:"));
    const key = norm(curr.url);
    const citations = citationsByUrl?.get(key) ?? 0;
    const isHP = homepageUrl ? key === norm(homepageUrl) : false;

    // Severity: critical warnings on cited pages → high; otherwise medium/low.
    const severity: FindingSeverity = hasCritical && (citations >= 1 || isHP)
      ? "high"
      : hasCritical || hasWarning
        ? "medium"
        : "low";

    // Summary surfaces the first 2 warnings verbatim (short enough to read at
    // a glance on Today; "+N more" for the rest).
    const preview = warnings.slice(0, 2).join("; ");
    const remainder = warnings.length > 2 ? ` (+${warnings.length - 2} more)` : "";

    findings.push(makeFinding({
      type: "schema_invalid",
      url: curr.url,
      scanRunId,
      tenantId,
      now,
      previousState: null,
      currentState: preview + remainder,
      severity,
      summary: `${pathOf(curr.url)}: schema issues — ${preview}${remainder}`,
      suggestedAction:
        "Fix the flagged fields — each one blocks a specific Google rich-result type from firing.",
      citationCount: citations,
      isHomepage: isHP,
    }));
  }

  // ── G6: robots.txt AI-bot disallow detection ──
  // If robots.txt blocks GPTBot/PerplexityBot/ClaudeBot/Google-Extended/CCBot/
  // Applebot-Extended on any cited owned URL, emit a critical finding. This
  // is a silent AEO killer: everything else you do won't help if bots can't
  // reach the page.
  if (robots && robots.status === 200) {
    for (const curr of currentSnapshots) {
      const key = norm(curr.url);
      const citations = citationsByUrl?.get(key) ?? 0;
      const isHP = homepageUrl ? key === norm(homepageUrl) : false;

      // Only check cited or homepage URLs — we don't care about robots blocks
      // on pages nobody is citing anyway.
      if (citations < 1 && !isHP) continue;

      const verdict = evaluateAiBotAccess(robots, pathOf(curr.url));
      if (!verdict.anyDisallowed) continue;

      const blockedList = verdict.blockedCrawlers.join(", ");
      findings.push(makeFinding({
        type: "robots_txt_blocked",
        url: curr.url,
        scanRunId,
        tenantId,
        now,
        previousState: null,
        currentState: `robots.txt disallows: ${blockedList}`,
        severity: "high",
        summary: `${pathOf(curr.url)} blocked by robots.txt for ${verdict.blockedCrawlers.length} AI crawler${verdict.blockedCrawlers.length === 1 ? "" : "s"}: ${blockedList}`,
        suggestedAction: `Update robots.txt to allow these AI crawlers on this path. Without this, ${blockedList} cannot index the page and won't cite it in AI answers.`,
        citationCount: citations,
        isHomepage: isHP,
      }));
    }
  }

  // ── Phase 1: schema_missing_for_page_type ──
  // For each current snapshot, compare observed `schema_types` against the
  // per-`asset_type` expected set. Emit ONE finding per URL that's missing
  // any required type. Persistent state — not diff-based.
  //
  // Dedupe across scans: `addFindings` in findings-store.ts replaces
  // same-type+same-url pending findings (see that file for the branch).
  for (const curr of currentSnapshots) {
    const assetType = classifyAssetType(curr.url);
    const schemaTypes = curr.schema_types ?? [];
    const coverage = diffSchemaCoverage(assetType, schemaTypes);
    if (coverage.satisfies_all_required) continue;

    const key = norm(curr.url);
    const citations = citationsByUrl?.get(key) ?? 0;
    const isHP = homepageUrl ? key === norm(homepageUrl) : false;

    // Severity ladder (Phase 1 plan):
    //   high   — homepage or city_page with >50 lifetime citations
    //   medium — any other asset_type with >10 citations AND ≥2 missing types
    //   medium — ≥2 missing types regardless of citations
    //   low    — 1 missing type
    const missingCount = coverage.missing_required.length;
    // De-verticalized (2026-06-15): HIGH severity is gated on ANY content-
    // bearing asset type with >50 citations — not just homepage/city_page,
    // which excluded every content publisher's high-citation pages (articles,
    // guides, hubs) from ever reaching HIGH. Infra/sitemap/directory/lead-form
    // are not content assets and stay out.
    const CONTENT_ASSET_TYPES = new Set([
      "homepage",
      "city_page",
      "service_page",
      "project_page",
      "process_page",
      "brand_page",
      "hub_page",
    ]);
    const severity: FindingSeverity =
      CONTENT_ASSET_TYPES.has(assetType) && citations > 50
        ? "high"
        : missingCount >= 2
          ? "medium"
          : "low";

    const missingStr = coverage.missing_required.join(", ");
    const presentStr = schemaTypes.length > 0 ? schemaTypes.join(", ") : "(none)";

    findings.push(
      makeSchemaMissingFinding({
        url: curr.url,
        assetType,
        severity,
        missingCount,
        missingStr,
        presentStr,
        coverage,
        scanRunId,
        tenantId,
        now,
        citations,
        isHP,
      }),
    );
  }

  // Deploy mismatch: shipped changelog entries whose expected structural change is missing
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  for (const entry of changelog) {
    if (!entry.url) continue;
    if (new Date(entry.timestamp).getTime() < thirtyDaysAgo) continue;

    const snap = currByUrl.get(norm(entry.url));
    if (!snap) continue;

    const desc = (entry.change_description + " " + (entry.hypothesis ?? "")).toLowerCase();
    const mismatches: string[] = [];

    if ((desc.includes("faq") || desc.includes("q&a")) && snap.faqs.length === 0) {
      mismatches.push("FAQ/Q&A expected but 0 found in HTML");
    }
    if ((desc.includes("schema") || desc.includes("structured data") || desc.includes("json-ld")) && snap.schema_types.length === 0) {
      mismatches.push("Schema expected but none found in HTML");
    }

    if (mismatches.length > 0) {
      const citations = citationsByUrl?.get(norm(entry.url)) ?? 0;
      const isHP = homepageUrl ? norm(entry.url) === norm(homepageUrl) : false;
      findings.push(makeFinding({
        type: "deploy_mismatch",
        url: entry.url,
        scanRunId,
        tenantId,
        now,
        previousState: `Changelog: "${entry.asset_name}" (${new Date(entry.timestamp).toLocaleDateString()})`,
        currentState: mismatches.join("; "),
        severity: "high",
        summary: `Deploy mismatch on ${pathOf(entry.url)}: ${mismatches[0]}`,
        suggestedAction: "Verify whether the intended change actually reached production before creating new work",
        citationCount: citations, isHomepage: isHP, contradictsChangelog: true,
      }));
    }
  }

  // Unexpected changes: pages that changed but no matching recent changelog entry
  const changelogUrls = new Set(
    changelog
      .filter((e) => e.url && new Date(e.timestamp).getTime() > thirtyDaysAgo)
      .map((e) => norm(e.url!)),
  );
  for (const changedUrl of changedUrls) {
    if (!changelogUrls.has(changedUrl)) {
      const snap = currByUrl.get(changedUrl);
      if (!snap) continue;
      const existingTypes = findings
        .filter((f) => norm(f.url) === changedUrl)
        .map((f) => f.type);
      if (existingTypes.length <= 1 && existingTypes[0] === "content_changed") {
        continue;
      }
      if (existingTypes.length === 0) continue;

      const citations = citationsByUrl?.get(changedUrl) ?? 0;
      const isHP = homepageUrl ? changedUrl === norm(homepageUrl) : false;
      findings.push(makeFinding({
        type: "unexpected_change",
        url: snap.url,
        scanRunId,
        tenantId,
        now,
        previousState: null,
        currentState: `Changes detected but no matching changelog entry`,
        severity: "medium",
        summary: `Unexpected changes on ${pathOf(snap.url)} — no matching changelog entry`,
        suggestedAction: "Check if a team member made changes without logging them",
        citationCount: citations, isHomepage: isHP,
      }));
    }
  }

  // ── Auto-link (Phase Auto-Link v2, 2026-04-24) ────────────────────
  //
  // Gated on BEACON_AUTO_LINK_FINDINGS. When enabled, stamps each
  // pending finding with metadata from the newest compatible recent
  // recommendation-sourced changelog entry on the same URL. Finding
  // stays pending — operator still has to click Confirm.
  //
  // Match-through-changelog (Option B) replaces the previous Fix 2
  // (Apr-21) "buildAcceptedRecLookup from recommendation_responses"
  // path entirely. Matching against recommendation-sourced changelog
  // entries (hypothesis_source === "recommendation") gives us:
  //   - automatic exclusion of needs_review / split / watch actions
  //     (they don't produce changelog entries in the first place per
  //     Phase 5 shouldStampChangelog)
  //   - access to signal_type for finding-type compatibility
  //   - a concrete changelog id for finding.linkedChangeId
  //
  // The old Dogfeed Night 1 failure mode (auto-accepting findings into
  // keyword-matched older changelog entries) is retired for good. This
  // pass NEVER flips status — metadata only.
  if (isFindingAutoLinkEnabled()) {
    const lookup = buildRecommendationChangelogLookup(changelog, now);
    if (lookup.size > 0) {
      for (const f of findings) {
        stampFindingFromChangelog(f, lookup);
      }
    }
  }

  // Phase 3.5I (2026-04-22) — detector accuracy.
  //
  // Rule α (overlap suppression): when `schema_invalid` fires on a URL in a
  // given run, the downstream `schema_changed` and `faq_changed` findings on
  // that same URL describe the SAME underlying problem (unparseable JSON-LD →
  // extracted types = none → mainEntity count = 0). Keep the root-cause
  // finding (schema_invalid) and drop the echoes so operators don't read one
  // broken JSON-LD block as three separate issues.
  //
  // Rule β retired in Phase C (2026-04-24). The legacy string-regex
  // halving reframer has been superseded by `classifyFaqChange` in
  // detect-findings.ts's faq_count_changed branch, which uses the
  // snapshot's per-source faq counts + faq_schema_block_count to detect
  // duplicate-schema cleanup correctly instead of inferring from a
  // 2×-ratio heuristic. The classifier also handles the other four
  // cases (schema-removed-visible-present, visible-removed, expanded,
  // structure-changed) that Rule β couldn't.
  const urlsWithSchemaInvalid = new Set<string>();
  for (const f of findings) {
    if (f.type === "schema_invalid") urlsWithSchemaInvalid.add(norm(f.url));
  }
  const afterOverlapSuppression = findings.filter((f) => {
    if (f.type !== "schema_changed" && f.type !== "faq_changed") return true;
    return !urlsWithSchemaInvalid.has(norm(f.url));
  });

  afterOverlapSuppression.sort((a, b) => b.priorityScore - a.priorityScore);
  return afterOverlapSuppression;
}

function makeFinding(opts: {
  type: FindingType;
  url: string;
  scanRunId: string;
  tenantId: string;
  now: string;
  previousState: string | null;
  currentState: string | null;
  severity: FindingSeverity;
  summary: string;
  suggestedAction: string;
  citationCount?: number;
  isHomepage?: boolean;
  contradictsChangelog?: boolean;
  previouslyRejected?: boolean;
}): Finding {
  const citationCount = opts.citationCount ?? 0;
  const isHomepage = opts.isHomepage ?? false;
  const contradictsChangelog = opts.contradictsChangelog ?? false;

  const priorityScore = computePriorityScore({
    severity: opts.severity,
    type: opts.type,
    citationCount,
    isHomepage,
    contradictsChangelog,
    previouslyRejected: opts.previouslyRejected ?? false,
  });

  const priority = scoreToPriority(priorityScore);

  return {
    id: `${opts.type}-${norm(opts.url)}-${opts.scanRunId}`,
    type: opts.type,
    url: opts.url,
    pagePath: pathOf(opts.url),
    detectedAt: opts.now,
    scanRunId: opts.scanRunId,
    previousState: opts.previousState,
    currentState: opts.currentState,
    severity: opts.severity,
    priority,
    priorityScore,
    summary: opts.summary,
    suggestedAction: opts.suggestedAction,
    status: "pending",
    resolvedAt: null,
    linkedChangeId: null,
    promotionStatus: "none",
    resolutionNote: null,
    suppressUntil: null,
    citationCount,
    isHomepage,
    contradictsChangelog,
    tenant_id: opts.tenantId,
  };
}

/**
 * Phase 1 — factory for `schema_missing_for_page_type` findings.
 *
 * Separate from `makeFinding` because the summary/action/state strings are
 * deterministically derived from the coverage diff, not from free-text
 * input. Keeps the emitter block above short.
 */
function makeSchemaMissingFinding(opts: {
  url: string;
  assetType: import("@/lib/constants").AssetType;
  severity: FindingSeverity;
  missingCount: number;
  missingStr: string;
  presentStr: string;
  coverage: SchemaCoverageDiff;
  scanRunId: string;
  tenantId: string;
  now: string;
  citations: number;
  isHP: boolean;
}): Finding {
  const assetLabel = opts.assetType.replace(/_/g, " ");
  const summary = `${pathOf(opts.url)}: ${assetLabel} is missing ${opts.missingCount} required schema type${opts.missingCount === 1 ? "" : "s"} — ${opts.missingStr}`;
  const suggestedAction = `Add page-scoped JSON-LD for: ${opts.missingStr}. Do not change visible content. Run a fresh scan after deploy.`;

  return makeFinding({
    type: "schema_missing_for_page_type",
    url: opts.url,
    scanRunId: opts.scanRunId,
    tenantId: opts.tenantId,
    now: opts.now,
    previousState: `schema_types: [${opts.presentStr}]`,
    currentState: `missing_required: [${opts.missingStr}]`,
    severity: opts.severity,
    summary,
    suggestedAction,
    citationCount: opts.citations,
    isHomepage: opts.isHP,
  });
}

function computePriorityScore(opts: {
  severity: FindingSeverity;
  type: FindingType;
  citationCount: number;
  isHomepage: boolean;
  contradictsChangelog: boolean;
  previouslyRejected: boolean;
}): number {
  let score = 0;

  if (opts.severity === "high") score += 40;
  else if (opts.severity === "medium") score += 20;
  else score += 5;

  if (opts.isHomepage) score += 25;
  if (opts.citationCount >= 100) score += 30;
  else if (opts.citationCount >= 50) score += 20;
  else if (opts.citationCount >= 10) score += 10;
  else if (opts.citationCount >= 1) score += 3;

  if (opts.contradictsChangelog) score += 20;

  const HIGH_IMPACT_TYPES: FindingType[] = [
    "deploy_mismatch", "title_changed", "canonical_changed", "unexpected_change",
    "faq_without_schema",
    // G9: new AEO-critical types. Blocked crawlers kill everything else.
    "robots_txt_blocked", "schema_invalid",
  ];
  const MEDIUM_IMPACT_TYPES: FindingType[] = [
    "meta_changed", "h1_changed", "schema_changed", "faq_changed",
  ];
  if (HIGH_IMPACT_TYPES.includes(opts.type)) score += 15;
  else if (MEDIUM_IMPACT_TYPES.includes(opts.type)) score += 8;

  if (opts.previouslyRejected) score -= 15;

  return Math.max(0, score);
}

function scoreToPriority(score: number): FindingPriority {
  if (score >= 60) return "critical";
  if (score >= 35) return "important";
  if (score >= 15) return "minor";
  return "informational";
}

function norm(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase();
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
