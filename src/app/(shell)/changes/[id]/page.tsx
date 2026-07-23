import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ChangelogEntry } from "@/domains/measurement/changelog/types";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";
import { loadProofLedgerPersisted } from "@/domains/measurement";
import { findProofForChange, proofResultHref } from "@/domains/measurement";

// Phase 1.6 (Sprint 1 follow-up, 2026-04-24): force dynamic render so every
// request runs the fresh-repo-read pattern below. Matches /changes main list.
export const dynamic = "force-dynamic";

/**
 * `/changes/[id]` — canonical-Results redirect.
 *
 * Surface collapse (2026-06-15): the legacy data-rich detail layout and the
 * v2 proof brief were both retired. Results owns the measurement truth, so a
 * changelog row deep-links to its exact proof card; an older untracked row
 * lands on Results without inventing an outcome. This route now resolves the
 * changelog entry (fresh per-request repo read) and redirects — it renders no
 * detail body of its own. The dead brief render and its legacy-only loaders
 * were removed in the bounded cleanup wave (2026-07-20).
 */
export default async function ChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const trace = createPerfTrace("loader:/changes/[id]", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/changes/[id]",
  });
  try {
    const { id } = await params;

    // Phase 1.6 (Sprint 1 follow-up, 2026-04-24): fresh per-request repo read.
    // The prior implementation called `changelogEntries.find(...)` against the
    // module-level array from @/lib/seed-data.server, which is hydrated once
    // per Vercel lambda cold start. A scan_detection entry written by a
    // different lambda was invisible here and the page rendered notFound.
    // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read.
    const tenantId = await currentTenantId();
    const repository = getRepository().forTenant(tenantId);
    let freshChangelogEntries: ChangelogEntry[];
    try {
      freshChangelogEntries = await repository.getChangelogEntries();
    } catch (error) {
      return <ChangeDetailReadError error={error} />;
    }

    const entry = freshChangelogEntries.find((c) => c.id === id);
    if (!entry) notFound();

    // Results owns the measurement truth. A tracked change deep-links to its
    // exact proof card (including compound-package semantics); an older
    // untracked changelog row lands on Results without inventing an outcome.
    const proofLedger = await loadProofLedgerPersisted(tenantId).catch(() => []);
    const canonicalProof = findProofForChange(entry, proofLedger);
    redirect(canonicalProof ? proofResultHref(canonicalProof) : "/results");
  } finally {
    trace.flush();
  }
}

/**
 * Phase 1.6 (Sprint 1 follow-up, 2026-04-24) — honest error state.
 *
 * Rendered when the repository fetch fails. Deliberately does NOT fall back
 * to the stale module-level `changelogEntries` array that this page used to
 * read from — the whole point of the fresh-read pattern is that operators
 * never see a detail page that conflicts with /changes. A transient read
 * failure is rare enough that a plain retry message is the right UX.
 * Matches the error shape on /changes main list.
 */
function ChangeDetailReadError({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown error reading changelog entry";
  return (
    <div className="max-w-3xl">
      <section
        className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-5"
        aria-labelledby="change-detail-read-error-heading"
      >
        <h2
          id="change-detail-read-error-heading"
          className="text-[13px] font-semibold text-foreground tracking-tight"
        >
          Couldn&apos;t load this change
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {message}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          This usually means the database is temporarily unreachable. Refresh
          the page to retry. We never fall back to cached data here, so you
          won&apos;t see stale truth by accident.
        </p>
        <Link
          href="/changes"
          className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          ← Back to Changes
        </Link>
      </section>
    </div>
  );
}
