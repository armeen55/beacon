import "server-only";

/**
 * 2026-06-09 — "Why them, not you" loader (derive-on-read).
 *
 * For the tracked competitors AI cites most, assemble the forensic
 * report: their most-cited page, your closest equivalent, the named
 * structural gaps, the prompts where they show up (losses first), and
 * the words AI uses about them vs you. All inputs already exist —
 * citation evidence index, competitor page snapshots, observations,
 * prompt library, own-page snapshots. Soft-fails to [].
 */

import { getPromptAnswerObservations } from "@/storage/canonical-store";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { getCitationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { getCompetitorPageSnapshotsByUrl } from "@/domains/pages/competitor-page-snapshots";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { getPromptLibrary } from "@/domains/prompts/prompt-library";

import { normalizeHost } from "./citation-series";
import {
  buildWhyThemReport,
  type OurPageInput,
  type TheirPageInput,
} from "./forensics";
import type { WhyThemReport } from "./types";

/** Reports rendered per page view — the top rivals only. */
const MAX_REPORTS = 3;

function hostOf(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

export async function loadWhyThemReports(): Promise<WhyThemReport[]> {
  try {
    const [universe, index, snapshotsByUrl, ourSnapshots, observations, prompts] =
      await Promise.all([
        loadCompetitorUniverseRuntime(),
        getCitationEvidenceIndex(),
        getCompetitorPageSnapshotsByUrl(),
        getPageSnapshots(),
        getPromptAnswerObservations(),
        getPromptLibrary(),
      ]);
    if (universe.entries.length === 0 || index == null) return [];

    const tracked = new Map(
      universe.entries.map((e) => [
        normalizeHost(e.domain),
        { domain: normalizeHost(e.domain), displayName: e.display_name },
      ]),
    );

    // Their citations per (domain, url) from the evidence index.
    type TheirUrl = { url: string; total: number };
    const byDomain = new Map<string, Map<string, TheirUrl>>();
    for (const rollup of index.by_page_and_topic) {
      if (rollup.is_owned) continue;
      const host = hostOf(rollup.page_url) ?? normalizeHost(rollup.domain);
      if (!tracked.has(host)) continue;
      let urls = byDomain.get(host);
      if (urls == null) {
        urls = new Map();
        byDomain.set(host, urls);
      }
      const existing = urls.get(rollup.page_url);
      if (existing == null) {
        urls.set(rollup.page_url, {
          url: rollup.page_url,
          total: rollup.total_citations,
        });
      } else {
        existing.total += rollup.total_citations;
      }
    }
    if (byDomain.size === 0) return [];

    // Our pages, latest snapshot per URL, mapped to the pure input shape.
    const latestOurs = new Map<string, OurPageInput>();
    const seenAt = new Map<string, string>();
    for (const snap of ourSnapshots) {
      const prev = seenAt.get(snap.url);
      if (prev != null && prev >= snap.fetched_at) continue;
      seenAt.set(snap.url, snap.fetched_at);
      latestOurs.set(snap.url, {
        url: snap.url,
        title: snap.title,
        h1: snap.h1,
        h2_list: snap.h2_list,
        faq_count: snap.faqs.length,
        meta_description: snap.meta_description,
        extra_terms: snap.service_terms,
      });
    }
    const ourPages = [...latestOurs.values()];

    const promptTextById = new Map(
      prompts.map((p) => [p.id, p.prompt_text]),
    );

    // Rank rivals by their total citations; report on the top few.
    const ranked = [...byDomain.entries()]
      .map(([host, urls]) => {
        const top = [...urls.values()].sort((a, z) => z.total - a.total)[0]!;
        const domainTotal = [...urls.values()].reduce((s, u) => s + u.total, 0);
        return { host, top, domainTotal };
      })
      .sort((a, z) => z.domainTotal - a.domainTotal)
      .slice(0, MAX_REPORTS);

    const reports: WhyThemReport[] = [];
    for (const { host, top } of ranked) {
      const meta = tracked.get(host)!;
      const snap = snapshotsByUrl.get(top.url) ?? null;
      const theirSnapshot: TheirPageInput | null =
        snap == null
          ? null
          : {
              url: snap.url,
              title: snap.title,
              h1: snap.h1,
              h2_list: snap.h2_list,
              faq_questions: snap.faq_questions,
              meta_description: snap.meta_description,
            };
      const report = buildWhyThemReport({
        domain: meta.domain,
        displayName: meta.displayName,
        theirUrl: top.url,
        theirCitationTotal: top.total,
        theirSnapshot,
        ourPages,
        observations,
        promptTextById,
      });
      if (report != null) reports.push(report);
    }
    return reports;
  } catch {
    return [];
  }
}
