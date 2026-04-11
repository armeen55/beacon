import "server-only";

import type { PageSnapshot } from "@/domains/pages/types";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Finding, FindingSeverity, FindingType } from "./types";
import { diffSnapshots } from "@/domains/pages/snapshot-diff";

type CitationLookup = Map<string, number>;

export function generateFindings(opts: {
  currentSnapshots: PageSnapshot[];
  previousSnapshots: PageSnapshot[];
  currentGuardrails: GuardrailAlert[];
  previousGuardrails: GuardrailAlert[];
  changelog: ChangelogEntry[];
  scanRunId: string;
  citationsByUrl?: CitationLookup;
}): Finding[] {
  const {
    currentSnapshots,
    previousSnapshots,
    currentGuardrails,
    previousGuardrails,
    changelog,
    scanRunId,
    citationsByUrl,
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
      }));
    }
  }

  // Cleared guardrails
  const currGuardKeys = new Set(
    currentGuardrails.map((g) => `${g.category}::${norm(g.url)}`),
  );
  for (const g of previousGuardrails) {
    const key = `${g.category}::${norm(g.url)}`;
    if (!currGuardKeys.has(key)) {
      findings.push(makeFinding({
        type: "guardrail_cleared",
        url: g.url,
        scanRunId,
        now,
        previousState: g.message,
        currentState: null,
        severity: "low",
        summary: `Issue resolved on ${pathOf(g.url)}: ${g.category}`,
        suggestedAction: "No action needed — previously detected issue is now resolved",
      }));
    }
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
      }));
    }
  }

  return findings;
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
}): Finding {
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
    summary: opts.summary,
    suggestedAction: opts.suggestedAction,
    status: "pending",
    resolvedAt: null,
    linkedChangeId: null,
  };
}

function norm(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
