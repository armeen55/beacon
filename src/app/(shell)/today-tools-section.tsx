import { currentTenantId } from "@/lib/tenant-context";
import { loadToolIntentQueries } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildToolOpportunities, buildAssetSpec } from "@/domains/demand-graph/tool-intent";

/**
 * today-tools-section (2026-06-25, §5/§8 asset engine) — "Tools worth building":
 * interactive ASSETS (converters / calculators / generators / quizzes) the site's
 * own searchers are explicitly asking for, mined deterministically from real GSC
 * tool-intent queries. Tools earn links + AI citations + conversions a static
 * article can't. Demand-grounded, no LLM; self-hides when there's no tool demand.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

const KIND_STYLE: Record<string, string> = {
  converter: "bg-cyan-100 text-cyan-700",
  calculator: "bg-cyan-100 text-cyan-700",
  generator: "bg-fuchsia-100 text-fuchsia-700",
  quiz: "bg-amber-100 text-amber-700",
  checker: "bg-emerald-100 text-emerald-700",
  estimator: "bg-emerald-100 text-emerald-700",
  template: "bg-slate-100 text-slate-700",
  tool: "bg-slate-100 text-slate-700",
};

export async function TodayToolsSection() {
  let ops: ReturnType<typeof buildToolOpportunities> = [];
  try {
    const tenantId = await currentTenantId();
    const queries = await loadToolIntentQueries(tenantId).catch(() => []);
    // Low threshold on purpose: GSC structurally UNDERCOUNTS tool demand — the site
    // can't rank for a converter/generator it doesn't have, so even a small repeated
    // signal means real latent demand the tool would capture.
    ops = buildToolOpportunities(queries, { minImpressions: 5 });
  } catch {
    return null;
  }
  if (ops.length === 0) return null;

  const demand = ops.reduce((s, o) => s + o.impressions, 0);

  return (
    <section className="rounded-3xl border border-cyan-200/70 bg-gradient-to-br from-cyan-50/50 via-white to-fuchsia-50/20 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-cyan-500">⚙</span> Tools worth building
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Interactive tools your searchers are explicitly asking for. A converter, calculator, or
            generator earns links, AI citations, and repeat visits a static page can&apos;t. The search
            counts look small only because you have no tool to rank for yet — the demand is real and
            uncaptured.
          </p>
        </div>
        <div className="rounded-xl border border-cyan-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-cyan-600">~{fmtNum(demand)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly searches for tools</div>
        </div>
      </div>

      <ul className="mt-5 space-y-1.5">
        {ops.map((o, i) => {
          const spec = buildAssetSpec(o.kind, o.topic);
          return (
            <li key={i} className="rounded-xl border border-cyan-100 bg-white/70 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_STYLE[o.kind] ?? "bg-slate-100 text-slate-700"}`}
                  >
                    {o.kind}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium text-gray-900">Build a {o.suggestion}</span>
                    <span className="ml-2 text-xs text-gray-400">people search &ldquo;{o.query}&rdquo;</span>
                  </span>
                </div>
                <span className="text-xs text-gray-500">{o.impressions.toLocaleString()} searches/mo</span>
              </div>
              {/* Deterministic build brief so the idea is shippable, not just a wish. */}
              <details className="mt-1.5 text-xs text-gray-500">
                <summary className="cursor-pointer text-cyan-700 hover:text-cyan-900">Build brief</summary>
                <div className="mt-1.5 space-y-1 pl-1">
                  <p>{spec.summary}</p>
                  <p><span className="font-medium text-gray-700">Inputs:</span> {spec.inputs.join("; ")}</p>
                  <p><span className="font-medium text-gray-700">Outputs:</span> {spec.outputs.join("; ")}</p>
                  <p><span className="font-medium text-gray-700">Build path:</span> {spec.buildPath}</p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
