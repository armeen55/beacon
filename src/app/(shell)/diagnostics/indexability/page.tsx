/**
 * 2026-05-14 Phase A.3 Step 5 — operator-only /diagnostics/indexability.
 *
 * Read-only inspector for the indexability verdict + raw signals
 * behind every URL Beacon knows about for the current tenant. The
 * page is the operator counterpart to the A.3.4 customer-facing
 * stuck-row diagnostic — it surfaces:
 *
 *   • Header summary: tenant domain, snapshot store stats,
 *     sitemap reconciliation stats (global store + tenant filter),
 *     robots state (presence, siteDomain match, freshness),
 *     verdict distribution.
 *   • Per-URL table: composite verdict + every raw signal driving
 *     it (HTTP status, canonical, robots_meta + noindex parse,
 *     per-bot allow/deny, evidence age, last fetched, provenance
 *     across PageSnapshot / recommended_edits / SitemapReconciliation).
 *
 * Operator-only. Gated by `BEACON_OPERATOR_MODE=true` via
 * `isOperatorModeServer`; `notFound()` for every other caller.
 * `NODE_ENV === "test"` extension preserves render-under-test.
 *
 * Maximum-extraction principle (operator-locked): raw enum values
 * (`bad_status_code`, `noindex_meta`, etc.) and raw signal strings
 * (the verbatim `robots_meta` value, the canonical URL target)
 * are intentionally rendered on this surface. The customer-vocab
 * forbidden-list does NOT apply here — this is a diagnostic tool,
 * not a customer surface.
 *
 * Read-only contract (pinned by
 * `indexability-diagnostics-no-fresh-fetch.test.ts`): no `fetch(`,
 * no scan triggers, no GSC, no LLM, no Supabase mutations. The
 * page consumes existing read-only modules — `loadIndexabilityForUrl`
 * (already pinned read-only by A.3.3b) plus the snapshot /
 * reconciliation / robots-state readers for the header summary.
 */

import { notFound } from "next/navigation";
import Link from "next/link";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { getBusinessConfig } from "@/lib/business-config";
import { readRobotsState } from "@/domains/pages/robots-parser";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  loadIndexabilityForUrl,
  type GscFreshFetchBudget,
} from "@/domains/indexability/load-indexability";
import { GSC_INSPECT_PER_RENDER_LIMIT } from "@/domains/indexability/load-gsc-signal";
import type {
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "@/domains/indexability/types";
import { SiteHealthPanel } from "@/components/site-health/site-health-panel";
import { detectAiCrawlerBlock } from "@/domains/site-health/ai-crawler-block";
import { detectCms } from "@/domains/site-health/cms-detect";

export const dynamic = "force-dynamic";

function isOperatorMode(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const NEEDS_NEW_PAGE_SENTINEL = "needs_new_page";
const MS_PER_DAY = 86_400_000;
const STALE_ROBOTS_THRESHOLD_DAYS = 30;

const VERDICT_SEVERITY: Record<IndexabilityVerdict, number> = {
  bad_status_code: 0,
  noindex_meta: 1,
  canonical_elsewhere: 2,
  blocked_by_robots_for_googlebot: 3,
  blocked_by_robots_for_ai: 4,
  not_in_sitemap: 5,
  not_indexed_in_gsc: 6,
  indexed_but_not_cited: 7,
  unknown: 8,
  ok: 9,
};

const VERDICT_TONE: Record<IndexabilityVerdict, string> = {
  bad_status_code: "bg-status-danger/15 text-status-danger",
  noindex_meta: "bg-status-warning/20 text-status-warning",
  canonical_elsewhere: "bg-status-warning/15 text-status-warning",
  blocked_by_robots_for_googlebot: "bg-status-warning/15 text-status-warning",
  blocked_by_robots_for_ai: "bg-status-warning/10 text-status-warning",
  not_in_sitemap: "bg-status-warning/10 text-foreground/70",
  not_indexed_in_gsc: "bg-muted/60 text-muted-foreground",
  indexed_but_not_cited: "bg-status-success/10 text-foreground/70",
  unknown: "bg-muted/40 text-muted-foreground",
  ok: "bg-status-success/15 text-status-success",
};

const ALL_VERDICTS: ReadonlyArray<IndexabilityVerdict> = [
  "bad_status_code",
  "noindex_meta",
  "canonical_elsewhere",
  "blocked_by_robots_for_googlebot",
  "blocked_by_robots_for_ai",
  "not_in_sitemap",
  "not_indexed_in_gsc",
  "indexed_but_not_cited",
  "unknown",
  "ok",
];

// ─────────────────────────────────────────────────────────────────────
// Helpers — host normalization mirrors loader logic
// ─────────────────────────────────────────────────────────────────────

function normalizeHost(raw: string | null | undefined): string {
  if (raw == null) return "";
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return "";
  let host = trimmed;
  if (/^https?:\/\//.test(host)) {
    try {
      host = new URL(host).hostname.toLowerCase();
    } catch {
      return "";
    }
  } else {
    const slash = host.indexOf("/");
    if (slash !== -1) host = host.slice(0, slash);
  }
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

function ageDays(iso: string | null, nowMs: number): number | null {
  if (iso == null) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / MS_PER_DAY));
}

// ─────────────────────────────────────────────────────────────────────
// Per-URL union with provenance
// ─────────────────────────────────────────────────────────────────────

type ProvenanceKey = "snapshot" | "rec_edit" | "sitemap";

type UnionEntry = {
  canonicalUrl: string;
  rawUrl: string;
  sources: Set<ProvenanceKey>;
};

function unionizeUrls(args: {
  snapshotUrls: string[];
  recEditTargets: ReadonlyArray<string | null>;
  sitemapUrls: ReadonlyArray<string>;
  tenantDomain: string;
}): UnionEntry[] {
  const map = new Map<string, UnionEntry>();
  const add = (raw: string | null, src: ProvenanceKey) => {
    if (raw == null) return;
    if (raw === NEEDS_NEW_PAGE_SENTINEL) return;
    const c = canonicalizeCitationUrl(raw);
    if (c == null) return;
    if (args.tenantDomain !== "") {
      // Only include URLs on the tenant's domain. Foreign-domain
      // URLs from any source (e.g., a misclassified recommended_edit
      // target) are dropped to keep the operator surface aligned
      // with the loader's tenant-domain filter.
      const host = normalizeHost(c);
      if (host !== args.tenantDomain) return;
    }
    const existing = map.get(c);
    if (existing) {
      existing.sources.add(src);
    } else {
      map.set(c, {
        canonicalUrl: c,
        rawUrl: raw,
        sources: new Set([src]),
      });
    }
  };
  for (const u of args.snapshotUrls) add(u, "snapshot");
  for (const u of args.recEditTargets) add(u, "rec_edit");
  for (const u of args.sitemapUrls) add(u, "sitemap");
  return Array.from(map.values()).sort((a, b) =>
    a.canonicalUrl.localeCompare(b.canonicalUrl),
  );
}

// ─────────────────────────────────────────────────────────────────────
// Row shape — verdict + extracted display fields
// ─────────────────────────────────────────────────────────────────────

type Row = {
  url: string;
  sources: Set<ProvenanceKey>;
  verdict: IndexabilityVerdict;
  indexability: OwnedUrlIndexability;
};

// ─────────────────────────────────────────────────────────────────────
// Filtering — read query params
// ─────────────────────────────────────────────────────────────────────

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(p: SearchParams, key: string): string | null {
  const v = p[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function applyFilters(rows: Row[], sp: SearchParams): Row[] {
  const verdict = readParam(sp, "verdict");
  const source = readParam(sp, "source");
  const staleRobots = readParam(sp, "stale_robots") === "1";
  const botBlocked = readParam(sp, "bot_blocked") === "1";
  const q = readParam(sp, "q");
  return rows.filter((r) => {
    if (verdict && r.verdict !== verdict) return false;
    if (source && !r.sources.has(source as ProvenanceKey)) return false;
    if (staleRobots) {
      const allNull =
        r.indexability.signals.robots_txt.googlebot_allowed === null &&
        r.indexability.signals.robots_txt.gptbot_allowed === null;
      if (!allNull) return false;
    }
    if (botBlocked) {
      const robots = r.indexability.signals.robots_txt;
      const anyFalse =
        robots.googlebot_allowed === false ||
        robots.gptbot_allowed === false ||
        robots.perplexitybot_allowed === false ||
        robots.claudebot_allowed === false ||
        robots.google_extended_allowed === false;
      if (!anyFalse) return false;
    }
    if (q && q.trim() !== "") {
      if (!r.url.toLowerCase().includes(q.toLowerCase())) return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Reason derivation — operator-friendly one-line summary per row
// ─────────────────────────────────────────────────────────────────────

function deriveReason(row: Row): string {
  switch (row.verdict) {
    case "ok":
      return "all signals positive — page is healthy";
    case "bad_status_code":
      return `HTTP ${row.indexability.signals.page_snapshot?.http_status ?? "?"} — page may no longer serve content`;
    case "noindex_meta":
      return "robots_meta declares noindex — AI crawlers will skip";
    case "canonical_elsewhere":
      return `canonical points to ${row.indexability.signals.page_snapshot?.canonical_url ?? "(unknown)"}`;
    case "blocked_by_robots_for_googlebot":
      return "robots.txt blocks Googlebot — discoverability floor failure";
    case "blocked_by_robots_for_ai": {
      const r = row.indexability.signals.robots_txt;
      const blocked: string[] = [];
      if (r.gptbot_allowed === false) blocked.push("GPTBot");
      if (r.perplexitybot_allowed === false) blocked.push("PerplexityBot");
      if (r.claudebot_allowed === false) blocked.push("ClaudeBot");
      if (r.google_extended_allowed === false) blocked.push("Google-Extended");
      return `robots.txt blocks ${blocked.join(", ") || "AI crawler(s)"}`;
    }
    case "not_in_sitemap":
      return "URL absent from sitemap reconciliation (tenant-domain filtered)";
    case "not_indexed_in_gsc": {
      const gsc = row.indexability.signals.gsc;
      const state = gsc?.indexing_state ?? "unknown";
      const cov = gsc?.coverage_state ?? "";
      return `GSC reports not indexed: ${state}${cov ? ` (${cov})` : ""}`;
    }
    case "indexed_but_not_cited":
      return "reserved — citation-cross verdict deferred";
    case "unknown": {
      // Best-effort: which signal is missing?
      const s = row.indexability.signals;
      if (s.page_snapshot == null) return "no PageSnapshot for this URL — scan never crawled";
      if (s.page_snapshot.http_status == null) return "PageSnapshot present but http_status missing";
      const robots = s.robots_txt;
      if (
        robots.googlebot_allowed === null &&
        robots.gptbot_allowed === null
      ) {
        return "robots state null / siteDomain mismatch / stale (flat-path defense)";
      }
      if (s.sitemap_membership.in_sitemap == null) {
        return "sitemap reconciliation missing OR no tenant-domain rows";
      }
      return "insufficient signal evidence to claim ok";
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Server component
// ─────────────────────────────────────────────────────────────────────

export default async function OperatorIndexabilityDiagnosticsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  if (!isOperatorMode()) {
    notFound();
  }

  const sp: SearchParams = (await (searchParams ?? Promise.resolve({}))) ?? {};

  const tenantId = await currentTenantId();
  const cfg = getBusinessConfig(tenantId);
  const tenantDomain = normalizeHost(cfg.domain);
  const now = new Date();
  const nowMs = now.getTime();

  // Pull existing tenant-scoped + global stored signals for the
  // header summary AND the URL union. The loader's per-URL call
  // also reads these — sharing the data here costs nothing because
  // each read is cached at its own boundary.
  // Phase A.3 (post-A.3.5 production-data fix, 2026-05-14):
  // page-snapshots flow through the tenant-scoped repository so the
  // header summary + URL union see the Supabase-backed snapshot
  // rows that the daily-scan persists. The prior direct read from
  // `@/domains/pages/snapshot-store` returned `[]` on Vercel
  // because the lambda FS doesn't carry the file path. The loader
  // (`load-indexability.ts`) made the same switch in the same step.
  // Phase A.3 (post-A.3.5 second-stage, 2026-05-15): all three
  // signal sources now flow through the tenant-scoped repository.
  // Robots-state is async + tenant-scoped via the
  // `public.robots_state` Supabase mirror (soft-fails to null on
  // missing migration). Sitemap-reconciliation is read tenant-
  // scoped from `public.sitemap_reconciliation` after the
  // GLOBAL → TENANT_SCOPED classification flip.
  const repo = getRepository().forTenant(tenantId);
  const [snapshots, reconciliation, recEdits, robotsState] = await Promise.all([
    repo.getPageSnapshots(),
    repo.getSitemapReconciliation(),
    repo.getRecommendedEdits(),
    readRobotsState({ tenantId }),
  ]);

  const sitemapTenantRows =
    reconciliation == null
      ? []
      : reconciliation.canonical_pages.filter((p) => {
          const host = normalizeHost(p.url);
          return host !== "" && host === tenantDomain;
        });

  const unionEntries = unionizeUrls({
    snapshotUrls: snapshots.map((s) => s.url),
    recEditTargets: recEdits.map((e) => e.target_url ?? null),
    sitemapUrls: sitemapTenantRows.map((p) => p.url),
    tenantDomain,
  });

  // Per-URL verdict fetch via the loader. Operator-only diagnostic
  // is the SOLE caller in Beacon that passes `enableGsc: true`.
  // Customer surfaces (Changes detail Act 3, etc.) call the same
  // loader WITHOUT `enableGsc`, so they keep byte-equal pre-beta
  // behavior. Pinned by
  // `tests/architecture/gsc-no-customer-surface-import.test.ts`.
  //
  // GSC fresh-fetch budget is shared across all per-URL calls in
  // this render. Once exhausted (default cap = 5 via
  // GSC_INSPECT_PER_RENDER_LIMIT), remaining URLs fall back to
  // cache-read only. The durable Supabase cache (A.3.b2) means
  // even cache-miss URLs only trigger one Google API call per
  // 24h regardless.
  //
  // Sequential iteration — NOT parallel — when GSC is enabled, so
  // each `loadIndexabilityForUrl` call sees the mutated budget
  // counter from the previous call. Promise.all with a shared
  // mutable counter would race. Non-GSC callers can still go
  // parallel; A.3.4 customer code paths are unchanged.
  const gscBudget: GscFreshFetchBudget = {
    remaining: GSC_INSPECT_PER_RENDER_LIMIT,
  };
  const verdicts: Array<OwnedUrlIndexability | null> = [];
  for (const e of unionEntries) {
    try {
      const v = await loadIndexabilityForUrl({
        tenantId,
        url: e.canonicalUrl,
        now,
        enableGsc: true,
        gscBudget,
      });
      verdicts.push(v);
    } catch {
      // Loader throws only on tenant-context mismatch; on this
      // operator surface, fall through to a synthesized
      // unknown-verdict row so the table stays consistent.
      verdicts.push(null);
    }
  }
  const gscFreshFetchesIssued =
    GSC_INSPECT_PER_RENDER_LIMIT - gscBudget.remaining;

  const rows: Row[] = unionEntries
    .map((entry, i) => {
      const v = verdicts[i];
      if (v == null) return null;
      return {
        url: entry.canonicalUrl,
        sources: entry.sources,
        verdict: v.composite_verdict,
        indexability: v,
      };
    })
    .filter((r): r is Row => r !== null);

  const filtered = applyFilters(rows, sp);
  filtered.sort(
    (a, b) => VERDICT_SEVERITY[a.verdict] - VERDICT_SEVERITY[b.verdict],
  );

  // ── Header summary stats ────────────────────────────────────────────
  const robotsAge =
    robotsState != null
      ? ageDays(robotsState.lastFetchedAt, nowMs)
      : null;
  const robotsSiteDomain = robotsState?.siteDomain ?? null;
  const robotsSiteDomainMatch =
    robotsSiteDomain != null &&
    tenantDomain !== "" &&
    normalizeHost(robotsSiteDomain) === tenantDomain;
  const robotsStale = robotsAge != null && robotsAge >= STALE_ROBOTS_THRESHOLD_DAYS;
  const directivesCount = robotsState?.parsed?.directives.length ?? null;

  const verdictDistribution: Record<IndexabilityVerdict, number> = {
    bad_status_code: 0,
    noindex_meta: 0,
    canonical_elsewhere: 0,
    blocked_by_robots_for_googlebot: 0,
    blocked_by_robots_for_ai: 0,
    not_in_sitemap: 0,
    not_indexed_in_gsc: 0,
    indexed_but_not_cited: 0,
    unknown: 0,
    ok: 0,
  };
  for (const r of rows) verdictDistribution[r.verdict]++;

  // P16 site-health READ layer (2026-07-03) - the self-hiding plain-English
  // panel that names exactly which AI assistants / Google's crawler are blocked
  // and what platform Beacon detected, from signals this page already loaded
  // ($0, no new fetch). Empty-safe: when nothing is blocked and no platform is
  // recognized, the panel renders nothing (byte-identical to before).
  //   - AI-crawler-block: robots.txt is site-wide, so any owned URL's parsed
  //     robots signals answer it; pick the first row whose robots signals are
  //     resolved (not all-null) so we read a real robots.txt, not "no scan yet".
  //   - CMS: from a representative snapshot's schema types, URL, and captured
  //     asset-host / class-token body markers (internal-link hrefs + card text).
  //   - JS-shell is intentionally omitted here: its honest heuristic needs a
  //     page's 90-day Google impressions, which this indexability surface does
  //     not load. The panel hides that fact independently, so passing [] is
  //     byte-identical, not a broken promise.
  const robotsBearingRow =
    rows.find((r) => {
      const rt = r.indexability.signals.robots_txt;
      return (
        rt.googlebot_allowed !== null ||
        rt.gptbot_allowed !== null ||
        rt.perplexitybot_allowed !== null ||
        rt.claudebot_allowed !== null ||
        rt.google_extended_allowed !== null
      );
    }) ?? null;
  const aiCrawlerBlockFact = robotsBearingRow
    ? detectAiCrawlerBlock(robotsBearingRow.indexability)
    : null;

  const cmsSnapshot = snapshots[0] ?? null;
  const cmsFact = cmsSnapshot
    ? detectCms({
        schemaTypes: cmsSnapshot.schema_types ?? [],
        url: cmsSnapshot.url,
        bodyMarkers: [
          ...(cmsSnapshot.internal_links ?? []).map((l) => l.href),
          ...(cmsSnapshot.card_texts ?? []),
        ],
      })
    : null;

  const siteHealthCheckedAt =
    robotsState?.lastFetchedAt ?? cmsSnapshot?.fetched_at ?? null;

  return (
    <main
      className="container mx-auto max-w-7xl px-4 py-6 space-y-6"
      data-diagnostics-page="indexability"
    >
      {/* P16 - self-hiding site-health read: names the blocked AI/Google
          crawlers + detected platform in plain English. Renders nothing when
          nothing is blocked and no platform is recognized. */}
      <SiteHealthPanel
        aiCrawlerBlock={aiCrawlerBlockFact}
        jsShell={[]}
        cms={cmsFact}
        checkedAt={siteHealthCheckedAt}
        nowMs={nowMs}
      />
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold tracking-tight">
          Indexability diagnostics
        </h1>
        <p className="text-[12px] text-muted-foreground">
          Operator-only surface. Raw signals + composite verdict per
          owned URL. Maps the data behind /changes Act 3 stuck-row
          diagnostics.
        </p>
      </header>

      {/* ── Header summary ───────────────────────────────────────────── */}
      <section
        className="rounded-md border border-border/60 bg-surface-base p-4 space-y-3"
        data-diagnostics-section="header-summary"
      >
        <h2 className="text-[13px] font-semibold">Stores & signal health</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
          <SummaryRow label="Tenant domain" value={tenantDomain || "(placeholder)"} />
          <SummaryRow
            label="Snapshot rows"
            value={`${snapshots.length} total`}
          />
          <SummaryRow
            label="Sitemap reconciliation"
            value={
              reconciliation == null
                ? "null (no scan yet)"
                : `${reconciliation.canonical_pages.length} canonical_pages · ${sitemapTenantRows.length} tenant-domain`
            }
          />
          <SummaryRow
            label="Robots state"
            value={
              robotsState == null
                ? "null (no scan yet)"
                : `siteDomain=${robotsSiteDomain ?? "?"} ${robotsSiteDomainMatch ? "✓ match" : "✗ mismatch"}`
            }
          />
          {robotsState != null ? (
            <>
              <SummaryRow
                label="Robots fetched"
                value={`${robotsState.lastFetchedAt} · age ${robotsAge ?? "?"}d ${robotsStale ? "(stale)" : "(fresh)"}`}
              />
              <SummaryRow
                label="Robots directives"
                value={`${directivesCount ?? "?"} blocks parsed`}
              />
            </>
          ) : null}
          <SummaryRow label="URL union size" value={String(rows.length)} />
          <SummaryRow
            label="Filtered rows (showing)"
            value={String(filtered.length)}
          />
          <SummaryRow
            label="GSC site URL"
            value={
              process.env.BEACON_GSC_SITE_URL &&
              process.env.BEACON_GSC_SITE_URL.trim() !== ""
                ? process.env.BEACON_GSC_SITE_URL
                : "(unset)"
            }
          />
          <SummaryRow
            label="GSC fresh inspections this render"
            value={`${gscFreshFetchesIssued} / ${GSC_INSPECT_PER_RENDER_LIMIT} cap`}
          />
        </dl>

        <div
          className="flex flex-wrap gap-2 pt-2"
          data-diagnostics-section="verdict-distribution"
        >
          {ALL_VERDICTS.map((v) => (
            <span
              key={v}
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${VERDICT_TONE[v]}`}
              data-verdict-tally={v}
            >
              <span className="tabular-nums">{verdictDistribution[v]}</span>
              <span className="font-mono">{v}</span>
            </span>
          ))}
        </div>
      </section>

      {/* ── Filter chips ─────────────────────────────────────────────── */}
      <FilterChips searchParams={sp} />

      {/* ── Per-URL table ────────────────────────────────────────────── */}
      <section
        className="rounded-md border border-border/60 bg-surface-base overflow-x-auto"
        data-diagnostics-section="url-table"
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">
            No URLs match the current filters.
          </div>
        ) : (
          <table className="w-full text-[11.5px]" data-diagnostics-table="indexability">
            <thead className="text-left text-muted-foreground border-b border-border/60">
              <tr>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-2 py-2 font-medium">Sources</th>
                <th className="px-2 py-2 font-medium">Verdict</th>
                <th className="px-2 py-2 font-medium">HTTP</th>
                <th className="px-2 py-2 font-medium">Sitemap</th>
                <th className="px-2 py-2 font-medium">Canonical</th>
                <th className="px-2 py-2 font-medium">robots_meta</th>
                <th className="px-2 py-2 font-medium">Googlebot</th>
                <th className="px-2 py-2 font-medium">GPTBot</th>
                <th className="px-2 py-2 font-medium">PerplexityBot</th>
                <th className="px-2 py-2 font-medium">ClaudeBot</th>
                <th className="px-2 py-2 font-medium">Google-Extended</th>
                <th className="px-2 py-2 font-medium">Age (d)</th>
                <th className="px-2 py-2 font-medium">Fetched</th>
                <th className="px-2 py-2 font-medium">GSC</th>
                <th className="px-2 py-2 font-medium">GSC state</th>
                <th className="px-2 py-2 font-medium">GSC checked</th>
                <th className="px-3 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <RowDisplay key={r.url} row={r} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-muted-foreground w-44 shrink-0">{label}</dt>
      <dd className="font-mono text-[11.5px] break-all">{value}</dd>
    </div>
  );
}

function FilterChips({ searchParams }: { searchParams: SearchParams }) {
  // Render as plain links so the chips work without client JS — the
  // page is a server component and filtering is server-side via the
  // URL query string.
  const verdict = readParam(searchParams, "verdict");
  const staleRobots = readParam(searchParams, "stale_robots") === "1";
  const botBlocked = readParam(searchParams, "bot_blocked") === "1";
  const source = readParam(searchParams, "source");
  return (
    <section
      className="flex flex-wrap items-center gap-2 text-[11.5px]"
      data-diagnostics-section="filter-chips"
    >
      <span className="text-muted-foreground">Filter:</span>
      <ChipLink
        href="/diagnostics/indexability"
        active={
          verdict == null &&
          !staleRobots &&
          !botBlocked &&
          source == null
        }
        label="all"
      />
      {ALL_VERDICTS.map((v) => (
        <ChipLink
          key={v}
          href={`/diagnostics/indexability?verdict=${v}`}
          active={verdict === v}
          label={v}
          dataAttr={`verdict=${v}`}
        />
      ))}
      <ChipLink
        href="/diagnostics/indexability?stale_robots=1"
        active={staleRobots}
        label="stale_robots"
        dataAttr="stale_robots"
      />
      <ChipLink
        href="/diagnostics/indexability?bot_blocked=1"
        active={botBlocked}
        label="bot_blocked"
        dataAttr="bot_blocked"
      />
      <ChipLink
        href="/diagnostics/indexability?source=snapshot"
        active={source === "snapshot"}
        label="source=snapshot"
        dataAttr="source=snapshot"
      />
      <ChipLink
        href="/diagnostics/indexability?source=rec_edit"
        active={source === "rec_edit"}
        label="source=rec_edit"
        dataAttr="source=rec_edit"
      />
      <ChipLink
        href="/diagnostics/indexability?source=sitemap"
        active={source === "sitemap"}
        label="source=sitemap"
        dataAttr="source=sitemap"
      />
    </section>
  );
}

function ChipLink({
  href,
  active,
  label,
  dataAttr,
}: {
  href: string;
  active: boolean;
  label: string;
  dataAttr?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono ${
        active
          ? "bg-foreground text-background"
          : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
      }`}
      data-diagnostics-chip={dataAttr ?? label}
      data-diagnostics-chip-active={active ? "true" : "false"}
    >
      {label}
    </Link>
  );
}

function botCell(value: boolean | null): string {
  if (value === true) return "✓";
  if (value === false) return "✗";
  return "—";
}

/**
 * Per-row GSC status badge. Five visible states:
 *   • indexed     — Google confirmed indexed (green).
 *   • not_indexed — Google confirmed NOT indexed (red).
 *   • ambiguous   — inspection returned but indexing/coverage didn't
 *                   match either pattern (yellow operator-triage).
 *   • unchecked   — no cache row + adapter didn't issue a fresh fetch
 *                   this render (neutral).
 *
 * Operator vocabulary only; no customer-facing copy.
 */
function GscBadge({
  gsc,
}: {
  gsc: OwnedUrlIndexability["signals"]["gsc"];
}) {
  if (gsc == null) {
    return (
      <span
        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] bg-muted/40 text-muted-foreground"
        data-row-gsc-state="unchecked"
      >
        unchecked
      </span>
    );
  }
  if (gsc.indexed === true) {
    return (
      <span
        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] bg-status-success/15 text-status-success"
        data-row-gsc-state="indexed"
      >
        indexed
      </span>
    );
  }
  if (gsc.indexed === false) {
    return (
      <span
        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] bg-status-danger/15 text-status-danger"
        data-row-gsc-state="not_indexed"
      >
        not_indexed
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] bg-status-warning/15 text-status-warning"
      data-row-gsc-state="ambiguous"
    >
      ambiguous
    </span>
  );
}

function RowDisplay({ row }: { row: Row }) {
  const snap = row.indexability.signals.page_snapshot;
  const robots = row.indexability.signals.robots_txt;
  const sitemap = row.indexability.signals.sitemap_membership;
  const noindex = snap?.noindex_detected ?? false;
  const sourcesArr = Array.from(row.sources);
  return (
    <tr
      className="border-b border-border/40 last:border-b-0 align-top"
      data-diagnostics-row="true"
      data-row-url={row.url}
      data-row-verdict={row.verdict}
    >
      <td className="px-3 py-2 font-mono text-[11px] break-all max-w-[280px]">
        {row.url}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px] whitespace-nowrap">
        {sourcesArr
          .map((s) => (s === "rec_edit" ? "rec" : s.slice(0, 4)))
          .join(",")}
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-mono ${VERDICT_TONE[row.verdict]}`}
          data-row-verdict-pill={row.verdict}
        >
          {row.verdict}
        </span>
      </td>
      <td className="px-2 py-2 font-mono tabular-nums">
        {snap?.http_status ?? "—"}
      </td>
      <td className="px-2 py-2 font-mono">
        {sitemap.in_sitemap === true
          ? "✓"
          : sitemap.in_sitemap === false
            ? "✗"
            : "—"}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px] break-all max-w-[180px]">
        {snap?.has_canonical_mismatch
          ? (snap.canonical_url ?? "(mismatch)")
          : snap?.has_canonical_mismatch === false
            ? "✓"
            : "—"}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px] break-all max-w-[160px]">
        {snap?.robots_meta ?? "—"}
        {noindex ? (
          <span className="ml-1 inline-block rounded bg-status-warning/30 px-1 text-[10px] text-status-warning">
            [noindex]
          </span>
        ) : null}
      </td>
      <td className="px-2 py-2 font-mono">{botCell(robots.googlebot_allowed)}</td>
      <td className="px-2 py-2 font-mono">{botCell(robots.gptbot_allowed)}</td>
      <td className="px-2 py-2 font-mono">
        {botCell(robots.perplexitybot_allowed)}
      </td>
      <td className="px-2 py-2 font-mono">{botCell(robots.claudebot_allowed)}</td>
      <td className="px-2 py-2 font-mono">
        {botCell(robots.google_extended_allowed)}
      </td>
      <td
        className={`px-2 py-2 font-mono tabular-nums ${
          row.indexability.evidence_freshness_days != null &&
          row.indexability.evidence_freshness_days >= STALE_ROBOTS_THRESHOLD_DAYS
            ? "text-status-warning"
            : ""
        }`}
      >
        {row.indexability.evidence_freshness_days ?? "—"}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px]">
        {snap?.fetched_at ? snap.fetched_at.slice(0, 10) : "—"}
      </td>
      <td className="px-2 py-2 font-mono whitespace-nowrap" data-row-gsc-badge>
        <GscBadge gsc={row.indexability.signals.gsc} />
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px] break-all max-w-[160px]">
        {row.indexability.signals.gsc?.indexing_state ?? "—"}
      </td>
      <td className="px-2 py-2 font-mono text-[10.5px]">
        {row.indexability.signals.gsc?.last_checked_at
          ? row.indexability.signals.gsc.last_checked_at.slice(0, 10)
          : "—"}
      </td>
      <td className="px-3 py-2 text-[11px] text-muted-foreground max-w-[260px]">
        {deriveReason(row)}
      </td>
    </tr>
  );
}
