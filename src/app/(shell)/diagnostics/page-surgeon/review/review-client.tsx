"use client";

import { useMemo, useState, useTransition } from "react";

import type { PageSurgeonReviewRow } from "../actions";
import { recordReviewDecision, runPageSurgeonReview } from "../actions";
import type { ArtifactBundle, ChangeArtifact, SnippetPreview } from "@/domains/recommendation-intelligence/page-surgeon/artifact-bundle";
import type { QaVerdict } from "@/domains/recommendation-intelligence/page-surgeon/artifact-qa";

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" | "bad" }) {
  const cls =
    tone === "good" ? "bg-status-success/15 text-status-success"
    : tone === "warn" ? "bg-amber-500/15 text-amber-600"
    : tone === "bad" ? "bg-red-500/15 text-red-600"
    : "bg-surface-inset/60 text-muted-foreground";
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

/** Google-style SERP snippet preview. */
function Snippet({ s, label }: { s: SnippetPreview; label: string }) {
  const path = s.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <div className="rounded-md border border-border/50 bg-white/[0.03] p-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-[12px] text-emerald-700 dark:text-emerald-400">{path}</p>
      <p className="text-[16px] leading-snug text-blue-700 dark:text-blue-400">{s.title || "(no title)"}</p>
      <p className="text-[12px] leading-snug text-muted-foreground">{s.meta || "(no meta description)"}</p>
    </div>
  );
}

function CharBar({ count, limit }: { count: number; limit: number }) {
  const pct = Math.min(100, Math.round((count / limit) * 100));
  const over = count > limit;
  return (
    <div className="mt-1">
      <div className="h-1 w-full overflow-hidden rounded bg-surface-inset/60">
        <div className={`h-full ${over ? "bg-red-500" : "bg-status-success"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-0.5 text-[10px] ${over ? "text-red-600" : "text-muted-foreground"}`}>{count}/{limit} chars{over ? " — over limit" : ""}</p>
    </div>
  );
}

function ArtifactCard({ c, label }: { c: ChangeArtifact; label: string }) {
  return (
    <div className="rounded border border-border/40 bg-surface-inset/30 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="good">{label}: {c.label}</Pill>
        <Pill tone={c.publishability === "staged" ? "good" : "muted"}>{c.publishability}</Pill>
        <span className="text-[10px] text-muted-foreground">step {c.dependencyOrder}</span>
      </div>

      {/* Finished, paste-ready content */}
      {c.cmsField && (
        <div className="mt-2">
          <p className="rounded bg-surface-raised/40 px-2 py-1 font-mono text-[12px] text-foreground">{c.cmsField.value}</p>
          <CharBar count={c.cmsField.charCount} limit={c.cmsField.limit} />
        </div>
      )}
      {c.answerBlockText && (
        <div className="mt-2 rounded bg-surface-raised/40 px-2 py-1.5 leading-relaxed text-foreground">{c.answerBlockText}</div>
      )}
      {c.faq && c.faq.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {c.faq.map((f, i) => (
            <li key={i} className="rounded bg-surface-raised/40 px-2 py-1">
              <p className="font-semibold text-foreground">{f.question}</p>
              <p className="text-muted-foreground">{f.answer}</p>
            </li>
          ))}
        </ul>
      )}
      {c.jsonLd && (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface-raised/50 p-2 text-[10px] leading-snug text-muted-foreground"><code>{c.jsonLd.code}</code></pre>
      )}
      {c.internalLinks && c.internalLinks.length > 0 && (
        <ul className="mt-2 ml-4 list-disc text-muted-foreground">
          {c.internalLinks.map((l, i) => (
            <li key={i}>“{l.anchor}” → {l.targetUrl ? <span className="text-foreground/80">{l.targetUrl}</span> : <span className="text-amber-600">{l.note}</span>}</li>
          ))}
        </ul>
      )}
      {c.instruction && !c.cmsField && !c.answerBlockText && (!c.faq || !c.faq.length) && !c.jsonLd && (!c.internalLinks || !c.internalLinks.length) && (
        <p className="mt-2 text-foreground/90">{c.instruction}</p>
      )}

      <div className="mt-2 space-y-0.5 text-muted-foreground">
        <p><span className="font-medium text-foreground/80">Why:</span> {c.hypothesis}</p>
        {c.evidence && <p><span className="font-medium text-foreground/80">Evidence:</span> {c.evidence}</p>}
        {c.risk && <p><span className="font-medium text-foreground/80">Risk:</span> {c.risk}</p>}
        <p><span className="font-medium text-foreground/80">Measure:</span> {c.measurement}</p>
        <p><span className="font-medium text-foreground/80">Rollback:</span> {c.rollback}</p>
      </div>
    </div>
  );
}

function QaBadge({ qa }: { qa: QaVerdict }) {
  return <Pill tone={qa.pass ? "good" : "bad"}>{qa.pass ? "QA passed" : "withheld by QA"} · {Math.round(qa.score * 100)}%</Pill>;
}

function BundleView({ bundle, qa, canonUrl }: { bundle: ArtifactBundle; qa: QaVerdict; canonUrl: string }) {
  const [recorded, setRecorded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const record = (verdict: "approve" | "reject" | "needs_edit") =>
    startTransition(async () => {
      const r = await recordReviewDecision(canonUrl, verdict);
      setRecorded(r.message);
    });

  return (
    <div className="mt-3 space-y-3">
      {/* SERP before/after */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Snippet s={bundle.snippetBefore} label="Now (Google)" />
        <Snippet s={bundle.snippetAfter} label="Proposed (Google)" />
      </div>

      <p className="rounded bg-accent-primary/[0.05] p-2 text-[12px] leading-relaxed">
        <span className="font-semibold text-foreground">💡 Why this:</span> {bundle.operatorInsight}
      </p>
      {bundle.whyNotJustTitle && (
        <p className="text-[12px] leading-relaxed"><span className="font-semibold text-foreground">Why it&apos;s not just a title tweak:</span> <span className="text-muted-foreground">{bundle.whyNotJustTitle}</span></p>
      )}
      {bundle.whatNormalSeoMisses && (
        <p className="text-[12px] leading-relaxed"><span className="font-semibold text-foreground">What a normal SEO misses:</span> <span className="text-muted-foreground">{bundle.whatNormalSeoMisses}</span></p>
      )}

      {bundle.primary && <ArtifactCard c={bundle.primary} label="PRIMARY" />}
      {bundle.supporting.map((c, i) => <ArtifactCard key={i} c={c} label="supporting" />)}

      {bundle.wordingResearch.length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Wording researched ({bundle.wordingResearch.length}) — alternatives weighed, grounded in GSC/SEMrush</summary>
          <ul className="ml-4 mt-1 list-disc">
            {bundle.wordingResearch.map((w, i) => (
              <li key={i}>“{w.variant}” → <span className="text-foreground/80">{w.best_placement}</span>{w.evidence ? ` (${w.evidence})` : ""}</li>
            ))}
          </ul>
        </details>
      )}

      {bundle.rejected.length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Rejected ({bundle.rejected.length}) — why these were not chosen</summary>
          <ul className="ml-4 mt-1 list-disc">
            {bundle.rejected.map((r, i) => <li key={i}><span className="font-medium text-foreground/80">{r.action}</span> — {r.reason}</li>)}
          </ul>
        </details>
      )}

      {/* The 10-second decision */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
        <button type="button" disabled={pending} onClick={() => record("approve")} className="rounded-md bg-status-success px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50">Approve</button>
        <button type="button" disabled={pending} onClick={() => record("needs_edit")} className="rounded-md bg-amber-500 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50">Needs edit</button>
        <button type="button" disabled={pending} onClick={() => record("reject")} className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-inset/60 disabled:opacity-50">Reject</button>
        <span className="text-[10px] text-muted-foreground">Publishing is disabled — nothing is pushed.</span>
      </div>
      {recorded && <p className="text-[11px] text-status-success">{recorded}</p>}
      <p className="text-[10px] text-muted-foreground">Evidence: {bundle.sourceCoverage.filter((s) => s.used).map((s) => s.source).join(", ") || "—"} · decided by {bundle.decidedBy}</p>
      {bundle.evidenceGaps.length > 0 && (
        <p className="text-[10px] text-amber-600">Missing sources: {bundle.evidenceGaps.join(" · ")}</p>
      )}
    </div>
  );
}

function ReviewCard({ row }: { row: PageSurgeonReviewRow }) {
  const [bundle, setBundle] = useState(row.bundle);
  const [qa, setQa] = useState(row.qa);
  const [stale, setStale] = useState(row.stale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      setError(null);
      const r = await runPageSurgeonReview(row.canonUrl);
      if (r.ok) { setBundle(r.bundle); setQa(r.qa); setStale(false); }
      else setError(r.error);
    });

  const path = row.pageUrl.replace(/^https?:\/\/[^/]+/, "") || "/";
  return (
    <div className="rounded-lg border border-border/60 bg-surface-inset/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground">{path}</p>
          <p className="truncate text-[12px] text-muted-foreground">now: “{row.currentTitle ?? "(no title)"}”</p>
          {row.gsc && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              “{row.gsc.topQuery}” · {row.gsc.impressions.toLocaleString()} impr · {row.gsc.clicks.toLocaleString()} clicks · pos {row.gsc.position.toFixed(1)} · {(row.gsc.ctr * 100).toFixed(2)}% CTR
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {qa && <QaBadge qa={qa} />}
          <button type="button" onClick={run} disabled={pending || !row.hasOpenAi} className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50">
            {pending ? "Drafting…" : bundle ? "Re-draft" : "Draft change"}
          </button>
          {stale && <span className="text-[10px] text-amber-600">evidence changed — re-draft</span>}
          {!row.hasOpenAi && <span className="text-[10px] text-muted-foreground">no OpenAI key</span>}
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
      {bundle && qa && qa.pass && <BundleView bundle={bundle} qa={qa} canonUrl={row.canonUrl} />}
      {bundle && qa && !qa.pass && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/[0.04] p-3 text-[12px]">
          <p className="font-semibold text-red-600">Withheld by auto-QA — not shown for approval</p>
          <ul className="ml-4 mt-1 list-disc text-muted-foreground">
            {qa.failures.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PageSurgeonReviewClient({ rows }: { rows: PageSurgeonReviewRow[] }) {
  const { ready, withheld, undrafted } = useMemo(() => {
    const ready: PageSurgeonReviewRow[] = [];
    const withheld: PageSurgeonReviewRow[] = [];
    const undrafted: PageSurgeonReviewRow[] = [];
    for (const r of rows) {
      if (r.bundle && r.qa?.pass) ready.push(r);
      else if (r.bundle && r.qa) withheld.push(r);
      else undrafted.push(r);
    }
    return { ready, withheld, undrafted };
  }, [rows]);

  if (rows.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No pages with Google Search Console demand yet. Connect + refresh Search Console first.</p>;
  }
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-[13px] font-semibold text-foreground">Ready to review ({ready.length})</h2>
        <div className="space-y-4">
          {ready.length === 0 && <p className="text-[12px] text-muted-foreground">Click “Draft change” on a page below to generate a QA-passed artifact.</p>}
          {ready.map((r) => <ReviewCard key={r.canonUrl} row={r} />)}
        </div>
      </section>
      {undrafted.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-foreground">Not yet drafted ({undrafted.length})</h2>
          <div className="space-y-4">{undrafted.map((r) => <ReviewCard key={r.canonUrl} row={r} />)}</div>
        </section>
      )}
      {withheld.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-red-600">Rejected by QA ({withheld.length})</h2>
          <div className="space-y-4">{withheld.map((r) => <ReviewCard key={r.canonUrl} row={r} />)}</div>
        </section>
      )}
    </div>
  );
}
