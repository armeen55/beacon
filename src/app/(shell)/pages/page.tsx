/**
 * /pages route — deliberate not-ready state (M5, operator audit 2026-05-05).
 *
 * Why this file is short:
 *
 *   The previous /pages route was 882 lines reading from ~15 domain
 *   stores (page-snapshots, page-snapshot-diffs, render-checks,
 *   sitemap-reconciliation, page-issues, outcome-watch, guardrail-
 *   alerts, rollout-waves, pattern-evidence, citation-evidence-index,
 *   playbook-briefs, fix-briefs, opportunity-scoring, scorecard,
 *   outcome events). Several of those stores return empty on Vercel
 *   (legacy module-level JSON), so the route rendered as a half-broken
 *   page-analytics product surface.
 *
 *   The operator audit (2026-05-05) said:
 *     "Do not build a giant page analytics product yet."
 *     "I prefer Option A only if it is small. If it is more than a
 *      bounded pass, choose Option B now and create a documented
 *      follow-up."
 *
 *   882 lines + 1407 lines of supporting files + 15-store fan-out is
 *   not a bounded pass. Option B chosen.
 *
 * What this file does NOW:
 *
 *   Renders an honest "not ready yet" placeholder explaining the
 *   state and pointing the operator to /today, /recommendations, and
 *   /changes — the surfaces that already power their daily flow. The
 *   route stays routable so direct links don't 404, but it does NOT
 *   pretend to be a working page-analytics product.
 *
 * What is preserved (and why):
 *
 *   - `pages-client.tsx` — exports types (`PageRow`, `PageSummary`,
 *     `PageChange`, etc.) consumed by `src/components/pages/*` and a
 *     few read sites in /topics. Keeping the types alive avoids a
 *     cross-domain refactor.
 *   - `issue-actions.ts` — exports `convertBriefToIssue` consumed by
 *     `src/app/(shell)/topics/package-actions.ts`. Removing the file
 *     would break /topics.
 *   - `scan-action.ts`, `verify-action.ts`, `wave-actions.ts`,
 *     `loading.tsx` — currently unreferenced from outside this folder
 *     but kept as dead-code-with-comment so the eventual rebuild
 *     doesn't have to re-derive them.
 *
 * Documented follow-up:
 *
 *   docs/IDEAS_PARKING_LOT.md gains an entry "Rebuild /pages — read
 *   citation evidence index from Supabase, render basic per-URL
 *   citation history". Scope: Supabase-only reads, no legacy JSON
 *   stores, ~200-line route, deferred until customer 2 is on the
 *   calendar (per master-plan §3.7 — /pages stays hidden through W4).
 *
 * Hard rules (locked by tests/routes/pages-smoke.test.ts):
 *   - Default export is the route component (Next.js requirement).
 *   - Renders the H2 "Pages" heading + the not-ready explanation.
 *   - Provides at least one in-product link to a working surface
 *     (/today, /recommendations, /changes).
 *   - Renders without throwing under SSG / RSC (no DB reads, no I/O).
 */

import Link from "next/link";

export default function PagesPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Pages</h2>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          Per-URL citation history and page health.
        </p>
      </div>
      <section
        className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
        aria-labelledby="pages-not-ready-heading"
        data-pages-state="not-ready"
      >
        <h3
          id="pages-not-ready-heading"
          className="text-[13px] font-semibold text-foreground tracking-tight"
        >
          Pages isn&rsquo;t ready yet
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          The per-URL citation history surface is being rebuilt to read directly
          from the citation evidence index in Supabase. Until that&rsquo;s ready,
          this page is intentionally hidden from the daily flow.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          The intelligence you&rsquo;d look for here lives on the surfaces
          you already use:
        </p>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
          <li>
            <Link
              href="/"
              className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
            >
              Today
            </Link>{" "}
            &mdash; the visibility chart, &ldquo;How AI described you,&rdquo;
            and the action queue.
          </li>
          <li>
            <Link
              href="/recommendations"
              className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
            >
              Recommendations
            </Link>{" "}
            &mdash; the per-page actions Beacon is suggesting, with evidence
            on each row.
          </li>
          <li>
            <Link
              href="/changes"
              className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
            >
              Changes
            </Link>{" "}
            &mdash; what&rsquo;s shipped, what&rsquo;s pending, and per-URL
            attribution.
          </li>
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground/80 italic">
          When Pages comes back, it will be a focused per-URL view: citation
          history from the evidence index, last crawl timestamp, and a link
          to the open recommendations on that page. No giant analytics
          product, no half-loaded panels.
        </p>
      </section>
    </div>
  );
}
