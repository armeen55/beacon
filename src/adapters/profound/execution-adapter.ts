import "server-only";

import type { ObservationRun } from "@/domains/observation-runs/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
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
  ownedDomains: string[]
): {
  observations: PromptAnswerObservation[];
  runs: ObservationRun[];
  answerTexts: Record<string, string>;
  warnings: string[];
} {
  const rows = parseDirtyCSV<Record<string, string>>(filePath);
  const warnings: string[] = [];
  const ownedNormalized = ownedDomains
    .map(normalizeOwnedDomainEntry)
    .filter(Boolean);

  const groupCounts = new Map<string, number>();
  for (const row of rows) {
    const date = row.date?.trim() ?? "";
    const platform = row.platform?.trim() ?? "";
    const key = groupKey(date, platform);
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }

  const runByKey = new Map<string, ObservationRun>();
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

    observations.push({
      id,
      prompt_id,
      run_id: runRecord?.id ?? "",
      answer_hash: response.length ? djb2Hash(response) : null,
      position: parsePosition(row.position),
      tracked_brand_mentioned: parseMentionedFlag(row["mentioned?"]),
      tracked_brand_cited,
      citation_count: cited.citation_count,
      owned_citation_count: cited.owned_citation_count,
      citation_domains: cited.citation_domains,
      citation_categories: {},
      mentions: splitNormalizedMentions(row.normalized_mentions),
      observed_at: date ? `${date}T00:00:00.000Z` : "",
      platform,
      topic: row.topic?.trim() ?? "",
      metadata: {
        search_queries: row.search_queries ?? "",
      },
    });
  }

  return { observations, runs, answerTexts, warnings };
}
