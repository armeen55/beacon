import { isOperatorModeServer } from "@/lib/operator-mode";
import { loadImplementationPlans } from "./execution-data";
import { ExecutionMarkApplied, CopyButton } from "./execution-mark-applied";

/**
 * execution-section (2026-06-25, Sprint 5D) — the Operator Execution Layer surface.
 * For each prepared Move it shows a professional implementation card: status, exact
 * location, paste-ready content (with a Copy button), the apply checklist, blocked
 * reason + missing evidence, risk labels, rollback notes, proof plan, and a
 * confirmation-gated "Mark applied" that starts measurement. READ-ONLY; no publish.
 * Self-hides when there's nothing + no operator.
 */

const STATUS_META: Record<string, { label: string; cls: string }> = {
  ready_to_apply: { label: "Ready to apply", cls: "bg-emerald-600 text-white" },
  needs_content_review: { label: "Needs content", cls: "bg-amber-100 text-amber-800 ring-1 ring-amber-300" },
  needs_location_review: { label: "Needs location review", cls: "bg-amber-100 text-amber-800 ring-1 ring-amber-300" },
  missing_page_mapping: { label: "No page mapping", cls: "bg-gray-100 text-gray-600 ring-1 ring-gray-300" },
  missing_inventory: { label: "Concept — no inventory", cls: "bg-gray-100 text-gray-600 ring-1 ring-gray-300" },
  legal_or_licensing_risk: { label: "⚖️ Licensing risk", cls: "bg-red-100 text-red-800 ring-1 ring-red-300" },
  insufficient_evidence: { label: "Weak evidence", cls: "bg-gray-100 text-gray-500 ring-1 ring-gray-300" },
  applied: { label: "Applied", cls: "bg-sky-100 text-sky-700 ring-1 ring-sky-300" },
  measuring: { label: "Measuring", cls: "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300" },
};
const RISK_CLS: Record<string, string> = {
  low: "text-gray-400",
  medium: "text-amber-700",
  high: "text-red-700",
};

function pathOf(url: string | null): string {
  if (!url) return "(no page)";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function ExecutionSection() {
  const operator = await isOperatorModeServer();
  let data;
  try {
    data = await loadImplementationPlans({ limit: 10 });
  } catch {
    return null;
  }
  if (data.plans.length === 0 && !operator) return null;

  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-gray-50 via-white to-emerald-50/30 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">Implement</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Exactly what to change, where, and what to paste — then mark it applied so Beacon measures it.
            Beacon never publishes; you apply each change manually.
          </p>
        </div>
        <span className="text-[11px] text-gray-400">{data.readyCount} ready · {data.blockedCount} need review</span>
      </div>

      {data.plans.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-gray-200 bg-white/60 px-4 py-6 text-center text-sm text-gray-500">
          No implementation plans yet — prepare some Moves first.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {data.plans.map((p) => {
            const meta = STATUS_META[p.status] ?? { label: p.status, cls: "bg-gray-100 text-gray-600" };
            const primary = p.contentPacks[0];
            const ready = p.status === "ready_to_apply";
            return (
              <div key={`${p.moveId}:${p.actionType}`} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>
                  <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-200">{p.actionType}</span>
                  <span className={`text-[10px] font-medium ${RISK_CLS[p.riskLevel]}`}>risk: {p.riskLevel}</span>
                  <span className="ml-auto text-[11px] text-gray-400">{pathOf(p.targetUrl)}</span>
                </div>

                {/* Location */}
                <p className="mt-2 text-[13px] text-gray-800">
                  <span className="font-semibold">Where:</span> {p.location.detail}
                  <span className="ml-1 text-[10px] text-gray-400">({p.targetSystem} · {p.location.confidence})</span>
                </p>

                {/* Blocked reason + missing evidence */}
                {p.blockedReason ? (
                  <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 ring-1 ring-amber-200">
                    <p className="font-medium">Why not ready: {p.blockedReason}</p>
                    {p.nextBestAction ? <p className="mt-0.5">Next: {p.nextBestAction}</p> : null}
                    {p.missingEvidence.length > 0 ? <p className="mt-0.5 text-amber-700/80">Missing: {p.missingEvidence.join(", ")}</p> : null}
                  </div>
                ) : null}

                {/* Paste-ready content */}
                {primary && primary.ready && primary.copy ? (
                  <div className="mt-2.5 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        {primary.type.replace(/_/g, " ")}{primary.charCount != null ? ` · ${primary.charCount} chars` : ""}
                      </span>
                      <CopyButton text={primary.copy} />
                    </div>
                    <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-gray-800">{primary.copy}</pre>
                    <p className="mt-1.5 text-[10px] text-gray-500">Paste into: {primary.whereToPaste}</p>
                    {primary.riskNotes ? <p className="mt-0.5 text-[10px] text-amber-700">⚠ {primary.riskNotes}</p> : null}
                  </div>
                ) : null}

                {/* Checklist */}
                <ol className="mt-2.5 grid gap-0.5 text-[12px] text-gray-600 sm:grid-cols-2">
                  {p.operatorSteps.map((s, i) => (
                    <li key={i} className="flex gap-1.5"><span className="text-gray-400">{i + 1}.</span>{s}</li>
                  ))}
                </ol>

                {/* Rollback + proof */}
                <details className="mt-2 text-[11px] text-gray-500">
                  <summary className="cursor-pointer select-none font-medium text-gray-600">Rollback &amp; proof</summary>
                  <p className="mt-1"><span className="font-medium">Rollback:</span> {p.rollback.join(" ")}</p>
                  <p className="mt-0.5"><span className="font-medium">Proof:</span> {p.proofPlan.join("; ")}</p>
                </details>

                {/* Mark applied (operator + ready + has a real URL) */}
                {operator && ready && p.targetUrl ? (
                  <ExecutionMarkApplied
                    implementationPlanId={`${p.moveId}:${p.actionType}`}
                    moveId={p.moveId}
                    targetUrl={p.targetUrl}
                    actionType={p.actionType}
                    query={p.targetTitle}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
