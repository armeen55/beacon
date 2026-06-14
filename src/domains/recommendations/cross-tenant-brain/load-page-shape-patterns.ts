import "server-only";

/**
 * 2026-06-10 — loader for the cross-vertical page-shape pool (P0
 * wall 5). Gated by the SAME flag as the brain producer
 * (BEACON_CROSS_TENANT_BRAIN="1"): returns [] when off, when fewer
 * than 2 active tenants exist, or on any per-tenant read failure
 * (soft-skip that tenant — the pool degrades, never throws).
 *
 * Per tenant: latest snapshot per URL + the set of OWN-domain URLs any
 * AI answer cited (prompt_answer_observations.citation_urls). The
 * pooled inputs carry STRUCTURAL features + a cited boolean only —
 * no text/urls/tenant ids cross the boundary (see page-shape.ts).
 */

import { listTenants } from "@/domains/tenants/store";
import { getRepository } from "@/lib/persistence/repositories";
import { isCrossTenantProducerEnabled } from "@/domains/recommendations/cross-tenant-brain/config";
import {
  aggregatePageShapePatterns,
  extractPageShape,
  type PageShapeInput,
  type PageShapePattern,
} from "@/domains/recommendations/cross-tenant-brain/page-shape";
import type { PageSnapshot } from "@/domains/pages/types";

function normalizeUrl(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .split(/[?#]/)[0]!;
}

function sameSite(url: string, domain: string): boolean {
  const host = normalizeUrl(url).split("/")[0] ?? "";
  const d = domain.toLowerCase().replace(/^www\./, "");
  return host === d || host.endsWith(`.${d}`);
}

export async function loadPageShapePatterns(): Promise<PageShapePattern[]> {
  if (!isCrossTenantProducerEnabled()) return [];
  const tenants = (await listTenants()).filter((t) => t.status === "active");
  if (tenants.length < 2) return [];

  const inputs: PageShapeInput[] = [];
  // wave-5 #4 (2026-06-14): assign each tenant an ANONYMOUS integer index so
  // the aggregate can count DISTINCT contributing tenants per split side
  // (never carrying the tenant id/domain into the pooled inputs — privacy).
  let tenantBucket = -1;
  for (const t of tenants) {
    tenantBucket += 1;
    try {
      const repo = getRepository().forTenant(t.id);
      const [snapshots, observations] = await Promise.all([
        repo.getPageSnapshots(),
        repo.getPromptAnswerObservations(),
      ]);

      const latestByUrl = new Map<string, PageSnapshot>();
      for (const s of snapshots) {
        const key = normalizeUrl(s.url);
        const prev = latestByUrl.get(key);
        if (!prev || s.fetched_at > prev.fetched_at) latestByUrl.set(key, s);
      }

      const cited = new Set<string>();
      for (const obs of observations as Array<{ citation_urls?: string[] | null }>) {
        for (const u of obs.citation_urls ?? []) {
          if (typeof u === "string" && sameSite(u, t.domain)) cited.add(normalizeUrl(u));
        }
      }

      for (const [key, snap] of latestByUrl) {
        if (snap.http_status >= 400) continue;
        inputs.push({
          features: extractPageShape(snap),
          cited: cited.has(key),
          tenantBucket,
        });
      }
    } catch {
      // Soft-skip this tenant; the pool degrades rather than throwing.
      continue;
    }
  }

  if (inputs.length === 0) return [];
  return aggregatePageShapePatterns(inputs);
}
