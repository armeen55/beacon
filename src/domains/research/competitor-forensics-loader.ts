import "server-only";

import { runWithTenant } from "@/lib/tenant-context";
import { getPromptAnswerObservations, getTrackedPrompts } from "@/storage/canonical-store";
import { getPageSnapshotsForTenant } from "@/lib/tenant-data";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { getCompetitorPages } from "@/domains/pages/competitor-evidence";
import { getCompetitorPageSnapshots } from "@/domains/pages/competitor-page-snapshots";
import { buildWhyThemReport } from "@/domains/competitor-intel/forensics";
import type { WhyThemReport } from "@/domains/competitor-intel/types";

type LoaderDeps = {
  readUniverse: typeof loadCompetitorUniverseRuntime;
  readEvidence: typeof getCompetitorPages;
  readCompetitorSnapshots: typeof getCompetitorPageSnapshots;
  readOwnedSnapshots: typeof getPageSnapshotsForTenant;
  readObservations: typeof getPromptAnswerObservations;
  readPrompts: typeof getTrackedPrompts;
};

function defaultLoaderDeps(): LoaderDeps {
  return {
    readUniverse: loadCompetitorUniverseRuntime,
    readEvidence: getCompetitorPages,
    readCompetitorSnapshots: getCompetitorPageSnapshots,
    readOwnedSnapshots: getPageSnapshotsForTenant,
    readObservations: getPromptAnswerObservations,
    readPrompts: getTrackedPrompts,
  };
}

function urlKey(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./i, "").toLowerCase()}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  }
}

/**
 * Assemble the existing "why them, not you" engine into a tenant-explicit,
 * bounded research corpus. This is read-only: no crawl, poll, provider call,
 * or persistence. Reports fail closed unless the competitor has at least two
 * citations and a concrete cited prompt.
 */
export async function loadCompetitorForensicsForTenant(
  tenantId: string,
  injectedDeps?: LoaderDeps,
): Promise<WhyThemReport[]> {
  if (!tenantId) return [];
  const deps = injectedDeps ?? defaultLoaderDeps();
  return await runWithTenant(tenantId, async () => {
    const [universe, evidence, competitorSnapshots, ownedSnapshots, observations, prompts] = await Promise.all([
      deps.readUniverse(),
      deps.readEvidence(),
      deps.readCompetitorSnapshots(),
      deps.readOwnedSnapshots(tenantId),
      deps.readObservations(),
      deps.readPrompts(),
    ]);
    const names = new Map(
      universe.entries
        .filter((entry) => entry.status === "active")
        .map((entry) => [entry.domain.replace(/^www\./i, "").toLowerCase(), entry.display_name]),
    );
    if (names.size === 0) return [];
    const snapshots = new Map<string, (typeof competitorSnapshots)[number]>();
    for (const snapshot of competitorSnapshots) {
      snapshots.set(urlKey(snapshot.url), snapshot);
      if (snapshot.canonical_url) snapshots.set(urlKey(snapshot.canonical_url), snapshot);
    }
    const ourPages = ownedSnapshots.map((snapshot) => ({
      url: snapshot.canonical_url ?? snapshot.url,
      title: snapshot.title,
      h1: snapshot.h1,
      h2_list: snapshot.h2_list,
      faq_count: snapshot.faqs.length,
      meta_description: snapshot.meta_description,
      extra_terms: [...snapshot.location_terms, ...snapshot.service_terms],
    }));
    const promptTextById = new Map(prompts.map((prompt) => [prompt.id, prompt.text]));
    const tenantObservations = observations.filter((row) => row.tenant_id === tenantId);
    const reports: WhyThemReport[] = [];
    const seen = new Set<string>();
    for (const row of [...evidence].sort((a, b) => b.citationCount - a.citationCount)) {
      const key = urlKey(row.pageUrl);
      if (seen.has(key)) continue;
      const domain = row.domain.replace(/^www\./i, "").toLowerCase();
      const displayName = names.get(domain);
      if (!displayName) continue;
      seen.add(key);
      const snapshot = snapshots.get(key) ?? null;
      const report = buildWhyThemReport({
        domain,
        displayName,
        theirUrl: row.pageUrl,
        theirCitationTotal: row.citationCount,
        theirSnapshot: snapshot
          ? {
              url: snapshot.canonical_url ?? snapshot.url,
              title: snapshot.title,
              h1: snapshot.h1,
              h2_list: snapshot.h2_list,
              faq_questions: snapshot.faq_questions,
              meta_description: snapshot.meta_description,
            }
          : null,
        ourPages,
        observations: tenantObservations,
        promptTextById,
      });
      if (report) reports.push(report);
      if (reports.length >= 20) break;
    }
    return reports;
  });
}
