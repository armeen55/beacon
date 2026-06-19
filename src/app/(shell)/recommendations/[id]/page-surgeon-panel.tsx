"use client";

/**
 * Page Surgeon panel for the recommendation detail (OPERATOR-ONLY, READ-ONLY).
 *
 * Renders the evidence-based Page Surgeon AtomicChangePack ALONGSIDE the legacy
 * recommendation — clearly labeled so the two are never confused. Shows the
 * diagnosed plan, finished copy per change, the evidence/source coverage, the
 * auto-QA verdict + fact-check, per-artifact pushability + rollback readiness,
 * the persisted review decision, and the change history. Nothing here publishes.
 */

import type {
  AtomicChangePack,
  ArtifactPushability,
  PageSurgeonForUrl,
} from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import type { ChangeArtifact } from "@/domains/recommendation-intelligence/page-surgeon/artifact-bundle";

function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" | "bad" | "info" }) {
  const cls =
    tone === "good" ? "bg-status-success/15 text-status-success"
    : tone === "warn" ? "bg-amber-500/15 text-amber-600"
    : tone === "bad" ? "bg-red-500/15 text-red-600"
    : tone === "info" ? "bg-accent-primary/10 text-accent-primary"
    : "bg-surface-inset/60 text-muted-foreground";
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function pushTone(p: ArtifactPushability): "good" | "warn" | "bad" | "muted" {
  if (p.canAutoApply) return "good";
  if (p.method === "blocked_no_mapping" || p.method === "not_applicable") return "bad";
  return "warn";
}
const PUSH_LABEL: Record<ArtifactPushability["method"], string> = {
  wix_cms_field: "Wix field — auto",
  manual_cms_edit: "Manual edit",
  no_write_path: "No auto writer",
  not_applicable: "N/A",
  blocked_no_mapping: "No mapping",
};

function ArtifactRow({ a, push }: { a: ChangeArtifact; push?: ArtifactPushability }) {
  const copy = a.cmsField?.value ?? a.answerBlockText ?? (a.faq?.length ? `${a.faq.length} Q&A pairs` : a.instruction ?? "");
  return (
    <div className="rounded border border-border/40 bg-surface-inset/30 p-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone="info">{a.label}</Tag>
        {push && <Tag tone={pushTone(push)}>{PUSH_LABEL[push.method]}</Tag>}
        {push && <Tag tone={push.rollbackReady ? "good" : "warn"}>{push.rollbackReady ? "rollback ✓" : "rollback best-effort"}</Tag>}
        <span className="text-[10px] text-muted-foreground">step {a.dependencyOrder}</span>
      </div>
      {copy && <p className="mt-1.5 rounded bg-surface-raised/40 px-2 py-1 font-mono text-[11px] leading-snug text-foreground">{copy}</p>}
      {a.before != null && a.before.trim() !== "" && (
        <p className="mt-1 text-[10px] text-muted-foreground">was: <span className="line-through">{a.before}</span></p>
      )}
      {push && <p className="mt-1 text-[10px] text-muted-foreground">{push.reason}</p>}
    </div>
  );
}

function Pack({ pack }: { pack: AtomicChangePack }) {
  const artifacts: ChangeArtifact[] = [pack.bundle.primary, ...pack.bundle.supporting].filter(
    (c): c is ChangeArtifact => c != null,
  );
  const verdictTone = pack.reviewDecision?.verdict === "approve" ? "good"
    : pack.reviewDecision?.verdict === "reject" ? "bad"
    : pack.reviewDecision?.verdict === "needs_edit" ? "warn" : "muted";
  const usedSources = pack.sourceCoverage.filter((s) => s.used).map((s) => s.source);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone="info">action: {pack.headlineAction}</Tag>
        <Tag tone={pack.qa.pass ? "good" : "bad"}>{pack.qa.pass ? "QA pass" : "QA withheld"} · {Math.round(pack.qa.score * 100)}%</Tag>
        {pack.qa.factCheckRequired && <Tag tone="warn">fact-check</Tag>}
        <Tag tone="muted">{pack.confidence}</Tag>
        {pack.reviewDecision && <Tag tone={verdictTone}>review: {pack.reviewDecision.verdict}</Tag>}
      </div>

      {pack.operatorInsight && (
        <p className="rounded bg-accent-primary/[0.05] p-2 text-[12px] leading-relaxed text-foreground">{pack.operatorInsight}</p>
      )}

      {artifacts.length > 0 ? (
        <div className="space-y-1.5">
          {artifacts.map((a, i) => (
            <ArtifactRow key={i} a={a} push={pack.pushability[i]} />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">No change recommended (keep_current / needs-review).</p>
      )}

      {pack.bundle.deferred.length > 0 && (
        <p className="text-[11px] text-muted-foreground">+ {pack.bundle.deferred.length} deferred follow-up change(s).</p>
      )}

      {pack.publishBlockers.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/[0.05] p-2 text-[11px] text-amber-700 dark:text-amber-500">
          <p className="font-semibold">Live-publish blockers</p>
          <ul className="ml-4 mt-0.5 list-disc">
            {pack.publishBlockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Evidence used: {usedSources.join(", ") || "—"} · decided by {pack.decidedBy}
        {pack.generatedAt ? ` · ${new Date(pack.generatedAt).toLocaleDateString()}` : ""}
      </p>

      {pack.history.length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Change history ({pack.history.length})</summary>
          <ul className="ml-4 mt-1 list-disc">
            {pack.history.map((h, i) => (
              <li key={h.evidence_hash}>
                <span className="text-foreground/80">{new Date(h.created_at).toLocaleString()}</span> — {h.headline_action || "(no action)"}{i === 0 ? " · current" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[10px] text-muted-foreground">Read-only operator view · publishing disabled here.</p>
    </div>
  );
}

export function PageSurgeonPanel({ pageSurgeon }: { pageSurgeon: PageSurgeonForUrl | null }) {
  if (!pageSurgeon || pageSurgeon.status === "no_page") return null;

  return (
    <section className="mt-6 rounded-xl border border-accent-primary/30 bg-accent-primary/[0.03] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px]">🔬</span>
        <h3 className="text-[13px] font-semibold text-foreground">Page Surgeon — evidence-based draft</h3>
        <Tag tone="info">operator</Tag>
      </div>
      {pageSurgeon.status === "pack" ? (
        <Pack pack={pageSurgeon.pack} />
      ) : (
        <p className="text-[12px] text-muted-foreground">
          This page has evidence ({pageSurgeon.sourceCoverage.filter((s) => s.used).map((s) => s.source).join(", ") || "—"}
          {pageSurgeon.hasGsc ? "" : "; no GSC demand"}) but no Page Surgeon analysis has been run yet. Run it from{" "}
          <span className="font-mono">/diagnostics/page-surgeon/review</span>.
        </p>
      )}
    </section>
  );
}
