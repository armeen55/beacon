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
import { isFindingAutoLinkEnabled } from "@/lib/flags";
// Fix 2 (2026-04-21) — auto-link lookup: read persisted recommendation
// responses so a detected change on a URL with a recent accepted rec can
// be stamped with source_rec_id + source_pattern_id at detection time.
import { recommendationResponses } from "@/domains/product/recommendation-response-store";

type CitationLookup = Map<string, number>;
type PreviouslyRejectedLookup = Set<string>;

/** Fix 2 (2026-04-21). Window for matching an accepted rec to a later-
 *  detected change on the same URL. 14 days is generous enough to cover
 *  dev cycles (accept Monday, ship next Monday) without false-linking
 *  stale acceptances. */
const REC_LINK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Build a normalized URL → most-recent-accepted-rec lookup. Used to stamp
 *  findings with `source_rec_id` + `source_pattern_id` so `confirmFindingAsChange`
 *  can carry the linkage into ChangelogEntry, and per-rec / per-pattern
 *  attribution becomes ground truth instead of URL-only inference. */
function buildAcceptedRecLookup(
  nowIso: string,
): Map<string, { recId: string; patternId: string | null }> {
  const out = new Map<string, { recId: string; patternId: string | null }>();
  const nowMs = Date.parse(nowIso);
  const cutoff = nowMs - REC_LINK_WINDOW_MS;

  // Newest-first so the first hit per URL is the most recent acceptance.
  const sorted = [...recommendationResponses].sort((a, b) =>
    b.respondedAt.localeCompare(a.respondedAt),
  );

  for (const r of sorted) {
    if (r.status !== "accepted") continue;
    const respondedMs = Date.parse(r.respondedAt);
    if (!Number.isFinite(respondedMs)) continue;
    if (respondedMs < cutoff) continue;
    if (!r.targetPageUrl) continue;
    const key = r.targetPageUrl
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    if (!key) continue;
    if (out.has(key)) continue; // keep newest-per-URL
    out.set(key, { recId: r.recId, patternId: r.patternId ?? null });
  }
  return out;
}

/** Fix 2 (2026-04-21). Stamp a finding with auto-link IDs when its URL has
 *  a recent accepted rec. No-op when no match. */
function stampAutoLinkIfMatch(
  finding: Finding,
  lookup: Map<string, { recId: string; patternId: string | null }>,
): void {
  if (!finding.url) return;
  const key = finding.url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  const match = lookup.get(key);
  if (!match) return;
  finding.source_rec_id = match.recId;
  finding.source_pattern_id = match.patternId;
}

export function generateFindings(opts: {
  currentSnapshots: PageSnapshot[];
  previousSnapshots: PageSnapshot[];
  currentGuardrails: GuardrailAlert[];
  previousGuardrails: GuardrailAlert[];
  changelog: ChangelogEntry[];
  scanRunId: string;
  citationsByUrl?: CitationLookup;
  homepageUrl?: string;
  previouslyRejectedTypes?: PreviouslyRejectedLookup;
  /** G9 — parsed robots.txt for AI-bot disallow detection. Null/undefined → skip. */
  robots?: RobotsFile | null;
}): Finding[] {
  const {
    currentSnapshots,
    previousSnapshots,
    currentGuardrails,
    previousGuardrails,
    changelog,
    scanRunId,
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
      const prevCount = prev.faqs.length;
      const currCount = curr.faqs.length;
      const disappeared = prevCount > 0 && currCount === 0;
      findings.push(makeFinding({
        type: "faq_changed",
        url: curr.url,
        scanRunId,
        now,
        previousState: `${prevCount} Q&A blocks`,
        currentState: `${currCount} Q&A blocks`,
        severity: disappeared && isHighCitation ? "high" : disappeared ? "medium" : "low",
        summary: disappeared
          ? `Q&A blocks disappeared from ${pathOf(curr.url)} (was ${prevCount})`
          : `Q&A count changed: ${prevCount} → ${currCount} on ${pathOf(curr.url)}`,
        suggestedAction: disappeared
          ? "Check if Q&A removal was intentional — pages with Q&A tend to get more citations"
          : "Review Q&A content change",
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
    const severity: FindingSeverity =
      (assetType === "homepage" || assetType === "city_page") && citations > 50
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

  // ── Auto-reconcile: if a finding's URL matches a recent changelog entry
  // with a compatible signal type, auto-link and accept the finding so it
  // doesn't appear as an unresolved detection on Today. ──
  //
  // Phase 1 gate — OFF by default. When disabled, every finding stays in
  // `status: "pending"` until an operator confirms or dismisses it via
  // `confirmFindingAsChange()`, which is the only path that stamps
  // structured schema-experiment fields. Flip BEACON_AUTO_LINK_FINDINGS=1
  // to re-enable the legacy 30-day auto-collapse behavior (not recommended
  // while running schema-experiment dogfeed).
  const autoLinkEnabled = isFindingAutoLinkEnabled();
  const now2 = new Date().toISOString();
  const recentByPath = new Map<string, ChangelogEntry[]>();
  if (autoLinkEnabled) {
    for (const entry of changelog) {
      if (!entry.url) continue;
      if (new Date(entry.timestamp).getTime() < thirtyDaysAgo) continue;
      const p = norm(entry.url);
      const arr = recentByPath.get(p) ?? [];
      arr.push(entry);
      recentByPath.set(p, arr);
    }
  }

  const FINDING_TO_SIGNAL: Record<string, { signals: string[]; keywords: string[] }> = {
    title_changed: { signals: ["technical"], keywords: ["title"] },
    meta_changed: { signals: ["technical"], keywords: ["meta"] },
    h1_changed: { signals: ["content"], keywords: ["h1", "heading"] },
    faq_changed: { signals: ["faq", "technical"], keywords: ["faq", "q&a", "json-ld"] },
    schema_changed: { signals: ["technical"], keywords: ["schema", "json-ld", "structured data"] },
    content_changed: { signals: ["content"], keywords: ["content", "copy", "section"] },
    links_changed: { signals: ["content", "technical"], keywords: ["link", "internal link"] },
  };

  if (autoLinkEnabled) {
    for (const f of findings) {
      if (f.status !== "pending") continue;
      const fPath = norm(f.url);
      const matches = recentByPath.get(fPath);
      if (!matches || matches.length === 0) continue;

      const mapping = FINDING_TO_SIGNAL[f.type];
      if (!mapping) continue;

      const linked = matches.find((c) => {
        if (mapping.signals.includes(c.signal_type)) return true;
        const desc = c.change_description.toLowerCase();
        return mapping.keywords.some((kw) => desc.includes(kw));
      });

      if (linked) {
        f.status = "accepted";
        f.resolvedAt = now2;
        f.linkedChangeId = linked.id;
        f.resolutionNote = `Auto-linked: matches changelog "${linked.change_description.slice(0, 60)}" (${linked.timestamp.slice(0, 10)})`;
      }
    }
  }

  // Fix 2 (2026-04-21) — auto-link pass. For every finding whose URL has
  // a recently-accepted rec, stamp source_rec_id + source_pattern_id.
  // `confirmFindingAsChange` then carries these into the created
  // ChangelogEntry. Manual Confirm preserved — this is metadata linkage,
  // not auto-confirmation.
  const acceptedRecLookup = buildAcceptedRecLookup(now);
  if (acceptedRecLookup.size > 0) {
    for (const f of findings) {
      stampAutoLinkIfMatch(f, acceptedRecLookup);
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
  // Rule β (dedup-fix reframing): when `faq_changed` shows an exact-half
  // reduction (current ≈ previous / 2, tolerance ±1 to handle odd/even),
  // it's a classic duplicate-schema-injection fix signature. Reframe the
  // summary/suggestedAction so operators see "likely dedupe fix" instead of
  // "content disappeared".
  const urlsWithSchemaInvalid = new Set<string>();
  for (const f of findings) {
    if (f.type === "schema_invalid") urlsWithSchemaInvalid.add(norm(f.url));
  }
  const afterOverlapSuppression = findings.filter((f) => {
    if (f.type !== "schema_changed" && f.type !== "faq_changed") return true;
    return !urlsWithSchemaInvalid.has(norm(f.url));
  });

  for (const f of afterOverlapSuppression) {
    if (f.type !== "faq_changed") continue;
    // previousState/currentState are strings like "16 Q&A blocks" or "0 Q&A blocks".
    const prevMatch = /^(\d+)/.exec(f.previousState ?? "");
    const currMatch = /^(\d+)/.exec(f.currentState ?? "");
    if (!prevMatch || !currMatch) continue;
    const prev = Number(prevMatch[1]);
    const curr = Number(currMatch[1]);
    if (prev <= 0 || curr <= 0) continue; // "disappeared" case stays as-is
    const expectedHalf = prev / 2;
    if (Math.abs(curr - expectedHalf) <= 1) {
      f.summary = `Q&A count halved on ${pathOf(f.url)} (${prev} → ${curr}) — likely a duplicate-schema-injection fix. Verify visible Q&A matches canonical ${curr}.`;
      f.suggestedAction =
        "Likely a dedup fix of a duplicated FAQPage schema block. Inspect the page's JSON-LD: if there's now a single FAQPage with the canonical count, no action needed.";
    }
  }

  afterOverlapSuppression.sort((a, b) => b.priorityScore - a.priorityScore);
  return afterOverlapSuppression;
}

function makeFinding(opts: {
  type: FindingType;
  url: string;
  scanRunId: string;
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
    tenant_id: "",
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
