import { currentTenantId } from "@/lib/tenant-context";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { loadImageAltReports } from "./image-alt-actions";
import { ImageAltScanButton } from "./image-alt-client";

/**
 * image-alt-section (2026-06-25, Sprint 6) — surfaces image-alt findings from the
 * operator-triggered scan: per page, images missing/with-poor alt + a deterministic
 * suggestion to paste. READ-ONLY, $0. Self-hides when there's nothing + no operator.
 */
export async function ImageAltSection() {
  const operator = await isOperatorModeServer();
  let data;
  try {
    data = await loadImageAltReports(await currentTenantId());
  } catch {
    return null;
  }
  if (data.reports.length === 0 && !operator) return null;

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">Image alt-text</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Images missing good alt text — invisible to screen readers + image search. Paste the suggestions.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {operator ? <ImageAltScanButton /> : null}
          {data.summary.total > 0 ? (
            <span className="text-[11px] text-gray-400">{data.summary.total} to fix · {data.summary.missing} missing · {data.summary.poor} generic</span>
          ) : null}
        </div>
      </div>

      {data.reports.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-gray-200 bg-white/60 px-4 py-6 text-center text-sm text-gray-500">
          No scan yet.{operator ? " Click Scan to analyze your pages' images (polite fetch, $0)." : ""}
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {data.reports.slice(0, 6).map((rep) => (
            <div key={rep.url} className="rounded-2xl border border-gray-200 p-4">
              <p className="truncate text-[13px] font-semibold text-gray-900">{rep.url}</p>
              <div className="mt-2 space-y-1.5">
                {rep.findings.slice(0, 8).map((f, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ${f.quality === "missing" ? "bg-red-50 text-red-700 ring-red-200" : f.quality === "poor" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-gray-100 text-gray-600 ring-gray-200"}`}>{f.quality}</span>
                    <span className="truncate text-gray-500" style={{ maxWidth: "16rem" }}>{f.src}</span>
                    {f.suggestedAlt ? <span className="text-gray-800">→ alt=&quot;<span className="font-medium">{f.suggestedAlt}</span>&quot;</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
