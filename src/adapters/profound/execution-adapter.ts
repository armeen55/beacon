import "server-only";

import type { ProfoundImportRun } from "@/domains/observation-runs/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import { parseSearchQueries } from "@/domains/prompt-answer-observations/search-query-parser";
import {
  normalizeHostname,
  parsePosition,
  parseDirtyCSV,
} from "@/lib/persistence/csv-parser";

const CITATION_COLUMN_COUNT = 36;

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function slugifyPlatform(platform: string): string {
  return platform
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function groupKey(date: string, platform: string): string {
  return `${date}\u0001${platform}`;
}

function parseMentionedFlag(value: string | undefined): boolean | null {
  const s = value?.trim();
  if (s === "Yes") return true;
  if (s === "No") return false;
  return null;
}

function splitNormalizedMentions(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(", ")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 2026-04-19: Profound's `mentions` and `mentioned?` CSV columns are
 * systematically incomplete. On certain platform-days (especially ChatGPT
 * and post-Apr 18 Google AI Overviews), the mentions column is 100% empty
 * even when the answer text clearly names the brand. Our store read-only
 * from those columns, producing a fake "mentions going down" trend while
 * citations correctly went up.
 *
 * Fix: also scan the `response` answer text for brand aliases. If the text
 * contains any alias OR the brand domain appears in a citation, treat as
 * mentioned. This aligns our numbers with Profound's UI (which does its
 * own text scan), and matches the SEO/AEO definition of a "mention."
 */
function scanResponseForBrand(
  response: string,
  brandAliases: string[],
  ownedHosts: string[],
): boolean {
  if (!response) return false;
  const haystack = response; // case-sensitive by default; aliases are cased already
  const haystackLower = response.toLowerCase();
  for (const alias of brandAliases) {
    if (!alias) continue;
    // audit-wave7 #2: a real \b boundary treats a HYPHEN as a boundary, so
    // `\bRitz\b` DOES match "Ritz-Carlton" (the case this comment claimed to
    // avoid). Use a boundary that counts letters/digits/hyphens as word chars so
    // a hyphenated different entity (Ritz-Carlton) can't false-match a shortened
    // brand alias. (Residual: a space-separated common noun like "Ritz crackers"
    // still matches a bare single-word alias — needs alias-scoping, see
    // NEXT_PHASE; this change is a strict improvement, never looser.)
    const esc = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const pattern = new RegExp(`(?<![A-Za-z0-9-])${esc}(?![A-Za-z0-9-])`, "i");
    if (pattern.test(haystack)) return true;
  }
  for (const host of ownedHosts) {
    if (host && haystackLower.includes(host.toLowerCase())) return true;
  }
  return false;
}

function hostnameFromCitationUrl(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  try {
    return normalizeHostname(new URL(t).hostname);
  } catch {
    try {
      const withProto = t.startsWith("http") ? t : `https://${t}`;
      return normalizeHostname(new URL(withProto).hostname);
    } catch {
      return null;
    }
  }
}

function normalizeOwnedDomainEntry(entry: string): string {
  const stripped = entry.replace(/^https?:\/\//i, "").split("/")[0] ?? entry;
  return normalizeHostname(stripped);
}

function isOwnedHostname(host: string, ownedNormalized: string[]): boolean {
  return ownedNormalized.some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
}

function collectCitationData(
  row: Record<string, string>,
  ownedNormalized: string[]
): {
  citation_count: number;
  owned_citation_count: number;
  citation_domains: string[];
} {
  const domainSet = new Set<string>();
  let citation_count = 0;
  let owned_citation_count = 0;

  for (let i = 1; i <= CITATION_COLUMN_COUNT; i++) {
    const raw = row[`citation_${i}`]?.trim();
    if (!raw) continue;
    citation_count++;
    const host = hostnameFromCitationUrl(raw);
    if (host) {
      domainSet.add(host);
      if (isOwnedHostname(host, ownedNormalized)) {
        owned_citation_count++;
      }
    }
  }

  const citation_domains = [...domainSet].sort((a, b) =>
    a.localeCompare(b)
  );

  return {
    citation_count,
    owned_citation_count,
    citation_domains,
  };
}

export function parseProfoundExecutions(
  filePath: string,
  accountId: string,
  importRunId: string,
  promptLookup: Map<string, string>,
  ownedDomains: string[],
  tenantId: string,
  brandAliases: string[] = [],
): {
  observations: PromptAnswerObservation[];
  runs: ProfoundImportRun[];
  answerTexts: Record<string, string>;
  warnings: string[];
} {
  if (!tenantId) {
    throw new Error(
      "[parseProfoundExecutions] tenantId required; pass currentTenantId() / BEACON_TENANT_ID from the calling import-orchestrator.",
    );
  }
  const rows = parseDirtyCSV<Record<string, string>>(filePath);
  const warnings: string[] = [];
  const ownedNormalized = ownedDomains
    .map(normalizeOwnedDomainEntry)
    .filter(Boolean);
  // Strict-cased aliases used for text-scan mention detection. Lowercase
  // prefix-match is handled inside scanResponseForBrand.
  const aliases = brandAliases.map((a) => a.trim()).filter(Boolean);

  const groupCounts = new Map<string, number>();
  for (const row of rows) {
    const date = row.date?.trim() ?? "";
    const platform = row.platform?.trim() ?? "";
    const key = groupKey(date, platform);
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }

  const runByKey = new Map<string, ProfoundImportRun>();
  for (const [key, prompt_count] of groupCounts) {
    const sep = key.indexOf("\u0001");
    const date = sep >= 0 ? key.slice(0, sep) : key;
    const platform = sep >= 0 ? key.slice(sep + 1) : "";
    const slug = slugifyPlatform(platform);
    const id = `run-${date}-${slug}`;
    runByKey.set(key, {
      id,
      account_id: accountId,
      import_run_id: importRunId,
      run_date: date,
      platform,
      model: null,
      geo: null,
      locale: null,
      source_type: "manual_import",
      status: "completed",
      prompt_count,
      metadata: {},
      created_at: `${date}T12:00:00.000Z`,
    });
  }

  const runs = [...runByKey.values()].sort((a, b) => {
    const byDate = a.run_date.localeCompare(b.run_date);
    return byDate !== 0 ? byDate : a.platform.localeCompare(b.platform);
  });

  const observations: PromptAnswerObservation[] = [];
  const answerTexts: Record<string, string> = {};

  for (const row of rows) {
    const id = row.run_id?.trim();
    if (!id) {
      warnings.push("Skipped row with missing run_id");
      continue;
    }

    const promptText = row.prompt?.trim() ?? "";
    let prompt_id = promptLookup.get(promptText);
    if (!prompt_id) {
      const fallback = `prompt-fallback-${djb2Hash(promptText)}`;
      warnings.push(
        `Prompt not in lookup; using fallback id "${fallback}" for run_id ${id}`
      );
      prompt_id = fallback;
    }

    const date = row.date?.trim() ?? "";
    const platform = row.platform?.trim() ?? "";
    const gk = groupKey(date, platform);
    const runRecord = runByKey.get(gk);
    if (!runRecord) {
      warnings.push(
        `No observation run for date="${date}" platform="${platform}" (run_id ${id})`
      );
    }

    const response = row.response ?? "";
    answerTexts[id] = response;

    const cited = collectCitationData(row, ownedNormalized);

    const tracked_brand_cited =
      cited.citation_count === 0
        ? null
        : cited.owned_citation_count > 0
          ? true
          : false;

    // 2026-04-19: mention detection uses TEXT SCAN of the answer as the
    // source of truth. Profound's "mentioned?" and "normalized_mentions"
    // columns are systematically wrong on many platform-days (e.g. ChatGPT
    // frequently reports "No" even when "Ritz Builders" is clearly in the
    // response text). Column flags are only trusted as a fallback when we
    // have NO answer text to scan.
    const colFlag = parseMentionedFlag(row["mentioned?"]);
    const mentionsFromCol = splitNormalizedMentions(row.normalized_mentions);
    const aliasInMentions = aliases.length > 0
      ? mentionsFromCol.some((m) => aliases.some((a) => a.toLowerCase() === m.toLowerCase()))
      : false;
    const aliasInResponse = aliases.length > 0
      ? scanResponseForBrand(response, aliases, ownedNormalized)
      : false;
    const hasResponse = response.length > 0;
    const tracked_brand_mentioned =
      aliasInResponse ? true
      : aliasInMentions ? true
      : hasResponse ? false
      : colFlag; // fallback when no text to scan and no alias match
    // Ensure `mentions[]` contains the owned brand alias when detected
    // via text scan, so downstream readers have the name available.
    const mergedMentions = [...mentionsFromCol];
    if (aliasInResponse && aliases.length > 0 && !aliasInMentions) {
      const ownedAlias = aliases[0];
      if (ownedAlias && !mergedMentions.includes(ownedAlias)) {
        mergedMentions.push(ownedAlias);
      }
    }

    const rawSearchQueries = row.search_queries ?? "";
    observations.push({
      id,
      prompt_id,
      run_id: runRecord?.id ?? "",
      answer_hash: response.length ? djb2Hash(response) : null,
      position: parsePosition(row.position),
      tracked_brand_mentioned,
      tracked_brand_cited,
      citation_count: cited.citation_count,
      owned_citation_count: cited.owned_citation_count,
      citation_domains: cited.citation_domains,
      citation_categories: {},
      mentions: mergedMentions,
      observed_at: date ? `${date}T00:00:00.000Z` : "",
      platform,
      topic: row.topic?.trim() ?? "",
      // Phase 7 Part 1b-v2 (2026-04-19): elevated search_queries to first-class
      // field + parsed array. Raw string preserved for lossless re-parsing.
      // metadata.search_queries kept for backward compat in case any legacy
      // reader still looks there.
      raw_search_queries: rawSearchQueries,
      search_queries: parseSearchQueries(rawSearchQueries),
      metadata: {
        search_queries: rawSearchQueries,
      },
      tenant_id: tenantId,
    });
  }

  return { observations, runs, answerTexts, warnings };
}
