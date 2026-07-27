import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ChangelogEntry } from "@/domains/measurement/changelog/types";
import { getRepository } from "@/lib/persistence/repositories";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";
import { loadProofLedgerPersisted } from "@/domains/measurement";
import { findProofForChange, proofResultHref } from "@/domains/measurement";
import { loadProposalQueue } from "@/domains/decision";
import type { ChangeProposal, ChangeBundle, BundleComponent, BundleEvidenceItem } from "@/domains/decision";
import { monthDayLabel } from "@/components/data/receipt-line";
import { loadChangesView } from "../../changes-data";
import { MarkImplemented } from "../../changes-list-client";

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
    const { id: rawId } = await params;
    // Next hands the path segment URL-encoded; proposal ids carry "::" and "/".
    const id = decodeURIComponent(rawId);
    const tenantId = await currentTenantId();
    const { access } = await requireReadyAccount(tenantId);
    if (access.kind === "suspended") redirect("/");

    // Slice 7: a ranked proposal carrying a Change Bundle owns this route and
    // renders its two-layer detail from saved data (the SAME cached surface the
    // list reads; the kernel is never called on the render path). Anything else,
    // including a proposal with no bundle, falls through to the unchanged
    // changelog → Results redirect below.
    const bundled = await findBundledProposal(tenantId, id);
    if (bundled) return <BundleDetail proposal={bundled} bundle={bundled.bundle} />;

    // Phase 1.6 (Sprint 1 follow-up, 2026-04-24): fresh per-request repo read.
    // The prior implementation called `changelogEntries.find(...)` against the
    // module-level array from @/lib/seed-data.server, which is hydrated once
    // per Vercel lambda cold start. A scan_detection entry written by a
    // different lambda was invisible here and the page rendered notFound.
    // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read.
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

/** Resolve this id to a ranked proposal that carries a bundle. Prefers the same
 *  cached customer surface the list renders; falls back to the persisted queue. */
/** Both reads are tenant-scoped internally (the surface blob rejects foreign
 *  rows; the queue query filters on tenant_id), and the id is only ever matched
 *  by equality inside that already-scoped data. */
async function findBundledProposal(
  tenantId: string,
  id: string,
): Promise<(ChangeProposal & { bundle: ChangeBundle }) | null> {
  const view = await loadChangesView().catch(() => null);
  let found = view?.proposals.find((p) => p.id === id) ?? null;
  if (!found) {
    const queue = await loadProposalQueue(tenantId).catch(() => null);
    found = queue?.ranked.find((p) => p.id === id) ?? null;
  }
  return found?.bundle ? { ...found, bundle: found.bundle } : null;
}

const EVIDENCE_GROUP: Record<BundleEvidenceItem["kind"], string> = {
  gsc_demand: "What people search on Google",
  keyword: "How much demand there is",
  serp: "What Google shows today",
  diagnosis: "Why I think this is the problem",
  ai_observation: "What AI assistants answer",
  winning_page: "Pages winning this today",
  page_extract: "What your page says now",
  competitor: "Other sites in this answer",
  internal_link: "Links across your own site",
};
const EVIDENCE_ORDER = Object.keys(EVIDENCE_GROUP) as BundleEvidenceItem["kind"][];

function seenLabel(observedAt: string | null): string {
  const day = monthDayLabel(observedAt);
  return day ? ` (checked ${day})` : "";
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[14px] font-semibold text-foreground">{children}</h2>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-muted-foreground">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

/** Slice 7: the two-layer bundle detail. Layer 1 decides, layer 2 proves.
 *  Slice 8: the same two layers render a new-page bundle. Nothing forks: the
 *  page-does-not-exist truth is stated once and every component is a pure
 *  insertion, so the before/after framing simply drops away. */
function BundleDetail({ proposal, bundle }: { proposal: ChangeProposal; bundle: ChangeBundle }) {
  const facts = new Map(bundle.receipt.items.map((i) => [i.key, i]));
  const chips = [...bundle.scope.queries, ...bundle.scope.prompts];
  const isNew = proposal.kind === "new_page";
  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/changes" className="inline-flex text-[13px] text-muted-foreground hover:text-foreground">
        Back to Changes
      </Link>

      <section className="space-y-2 rounded-2xl border border-accent-primary/40 bg-surface-raised p-5">
        <h1 className="text-[14px] font-semibold text-foreground">What I recommend</h1>
        <p className="text-[15px] font-semibold leading-relaxed text-foreground">{bundle.objective}</p>
        <p className="text-[13px] text-muted-foreground">
          {isNew ? "A new page for" : "On this page"}: {proposal.pageLabel}
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{proposal.whyItMatters}</p>
      </section>

      <section className="space-y-3">
        <Heading>{isNew ? "The pieces to paste" : "The exact edits"}</Heading>
        {isNew ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">This page does not exist yet.</p>
        ) : null}
        {bundle.components.map((c, i) => (
          <ComponentCard key={i} component={c} facts={facts} isNew={isNew} />
        ))}
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>Why this is the smartest move</Heading>
        {bundle.confidenceReasons.length > 0 ? <Bullets items={bundle.confidenceReasons} /> : null}
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {chips.map((c, i) => (
              <span key={i} className="rounded-md bg-surface-inset px-2 py-1 text-[12px] text-muted-foreground">
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>What I checked</Heading>
        {EVIDENCE_ORDER.map((kind) => {
          const items = bundle.receipt.items.filter((i) => i.kind === kind);
          if (items.length === 0) return null;
          return (
            <div key={kind} className="space-y-1">
              <p className="text-[12px] font-semibold text-foreground">{EVIDENCE_GROUP[kind]}</p>
              <Bullets items={items.map((i) => `${i.fact}${seenLabel(i.observedAt)}`)} />
            </div>
          );
        })}
        {bundle.receipt.missing.length > 0 ? (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-[12px] font-semibold text-foreground">What I could not check yet</p>
            <Bullets items={bundle.receipt.missing} />
          </div>
        ) : null}
      </section>

      {bundle.alternatives.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
          <Heading>What else I considered</Heading>
          <Bullets items={bundle.alternatives.map((a) => `${a.option}: ${a.reason}`)} />
        </section>
      ) : null}

      {bundle.risks.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
          <Heading>Risks</Heading>
          <Bullets items={bundle.risks} />
        </section>
      ) : null}

      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>How I will measure it</Heading>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{bundle.measurementPlan}</p>
        <p className="text-[13px] text-muted-foreground">I will watch: {bundle.metric}</p>
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-5">
        <MarkImplemented proposalId={proposal.id} label={isNew ? "I built this page" : "I made this change"} />
        <p className="mt-2 text-[12px] text-muted-foreground">
          After you make it, record this page on Results and the measurement starts.
        </p>
      </section>
    </div>
  );
}

function ComponentCard({
  component,
  facts,
  isNew,
}: {
  component: BundleComponent;
  facts: Map<string, BundleEvidenceItem>;
  isNew: boolean;
}) {
  const cited = component.evidenceKeys.map((k) => facts.get(k)).filter((i): i is BundleEvidenceItem => Boolean(i));
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-semibold text-foreground">{component.label}</p>
        {component.risk === "review" ? (
          <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[11px] text-status-warning">
            Worth a quick fact check
          </span>
        ) : null}
      </div>
      {isNew ? null : component.before ? (
        <div className="space-y-1">
          <p className="text-[12px] text-muted-foreground">On the page now</p>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-surface-inset px-3 py-2 text-[13px] text-muted-foreground line-through">
            {component.before}
          </p>
        </div>
      ) : (
        <p className="text-[12px] italic text-muted-foreground">This page has none today.</p>
      )}
      <div className="space-y-1">
        <p className="text-[12px] text-muted-foreground">Use this</p>
        <CopyBlock component={component} />
      </div>
      {cited.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[12px] font-semibold text-foreground">What this is based on</p>
          <Bullets items={cited.map((i) => i.fact)} />
        </div>
      ) : null}
    </div>
  );
}

/** Slice 8: the copy-ready block. A page plan reads as a list and a source pack
 *  puts each source on its own line, so a multi-line insertion stays readable
 *  instead of one wall of text. Every other component stays one exact block. */
function CopyBlock({ component }: { component: BundleComponent }) {
  const box =
    "rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2 text-[13px] leading-relaxed text-foreground";
  const lines = component.after.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && component.kind === "section") {
    return (
      <ul className={`${box} list-disc space-y-1 break-words pl-7`}>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    );
  }
  if (lines.length > 1 && component.kind === "source_pack") {
    return (
      <div className={`${box} space-y-1`}>
        {lines.map((l, i) => (
          <p key={i} className="break-words">
            {l}
          </p>
        ))}
      </div>
    );
  }
  return <p className={`${box} whitespace-pre-wrap break-words`}>{component.after}</p>;
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
