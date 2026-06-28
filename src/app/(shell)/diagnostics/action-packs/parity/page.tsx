/**
 * /diagnostics/action-packs/parity — Phase E.0 Step 2 proof.
 *
 * Does the unified ActionPack brain cover the legacy surfaces? Per-surface
 * represented / missing / replaceability, so legacy removal is evidence-led.
 * Operator-only. Read-only; no live Profound/DataForSEO on render.
 */
import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import { loadActionPackParityForTenant, type SurfaceVerdict } from "@/domains/action-pack/parity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function gate(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

const VERDICT_TONE: Record<SurfaceVerdict, string> = {
  yes: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  metric_not_rows: "bg-gray-100 text-gray-600",
  not_measured: "bg-rose-100 text-rose-700",
};
const VERDICT_LABEL: Record<SurfaceVerdict, string> = {
  yes: "replaceable",
  partial: "partial — reconcile",
  metric_not_rows: "metric, not rows",
  not_measured: "not measured",
};

export default async function ActionPackParityPage() {
  if (!gate()) notFound();
  const tenantId = await currentTenantId();
  const r = await loadActionPackParityForTenant(tenantId);

  return (
    <div className="space-y-5 p-1">
      <PageHeader
        title="ActionPack parity — does the new brain cover the old surfaces?"
        description="Per-surface coverage of the unified ActionPack vs each legacy surface. Legacy is killed only after a surface proves replaceable here."
      />

      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Unified ActionPack total: <span className="font-semibold text-gray-900">{r.actionPackTotal}</span>. Each surface below: legacy rows → represented in ActionPack.
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-2 py-1.5">Legacy surface</th>
              <th className="px-2 py-1.5 text-right">Rows</th>
              <th className="px-2 py-1.5 text-right">Represented</th>
              <th className="px-2 py-1.5 text-right">Missing</th>
              <th className="px-2 py-1.5 text-right">%</th>
              <th className="px-2 py-1.5">Replaceable?</th>
              <th className="px-2 py-1.5">Note</th>
            </tr>
          </thead>
          <tbody>
            {r.surfaces.map((s) => (
              <tr key={s.surface} className="border-t border-gray-100 align-top">
                <td className="px-2 py-1.5 font-medium text-gray-900">{s.surface}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s.legacyRows}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{s.represented}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{s.missing}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s.pct}%</td>
                <td className="px-2 py-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${VERDICT_TONE[s.verdict]}`}>{VERDICT_LABEL[s.verdict]}</span>
                </td>
                <td className="px-2 py-1.5 text-gray-500" style={{ maxWidth: 360 }}>{s.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {r.legacyOnlySamples.length > 0 ? (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-rose-700">Legacy-only rows (gaps to reconcile before flip)</h2>
          <ul className="list-disc pl-5 text-xs text-gray-600">
            {r.legacyOnlySamples.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </section>
      ) : (
        <p className="text-xs text-emerald-700">No legacy-only rows — every measured legacy row is represented in ActionPack.</p>
      )}
    </div>
  );
}
