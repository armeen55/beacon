import type { SecondOrderDomainPlaybook, SecondOrderPlaybookResult } from "@/domains/ai-visibility/second-order-citations";

/**
 * SecondOrderCitationsSection (BEACON_500 item 72, 2026-07-02) - "The sources
 * AI already trusts." AI engines repeat the same handful of domains across
 * answers; getting listed ON one of those domains is often faster than trying
 * to outrank it. Self-hiding: renders nothing until real citation data exists.
 * Plain-English, first person, no lab jargon. Every action here is a suggestion
 * for the operator to act on by hand - nothing sends anything automatically.
 */

const CLASS_LABEL: Record<SecondOrderDomainPlaybook["class"], string> = {
  listicle: "Listicle",
  directory: "Directory",
  ugc_community: "Community",
  media_press: "Media",
  reference: "Reference",
  other: "Other",
};

const CLASS_CLS: Record<SecondOrderDomainPlaybook["class"], string> = {
  listicle: "bg-violet-50 text-violet-700 ring-violet-200",
  directory: "bg-sky-50 text-sky-700 ring-sky-200",
  ugc_community: "bg-gray-100 text-gray-500 ring-gray-200",
  media_press: "bg-amber-50 text-amber-700 ring-amber-200",
  reference: "bg-gray-100 text-gray-500 ring-gray-200",
  other: "bg-gray-50 text-gray-500 ring-gray-200",
};

function prettyUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`;
  } catch {
    return u;
  }
}

const MAX_DOMAINS_SHOWN = 8;

export function SecondOrderCitationsSection({ result }: { result: SecondOrderPlaybookResult }) {
  if (result.domains.length === 0) return null;
  const top = result.domains.slice(0, MAX_DOMAINS_SHOWN);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">The sources AI already trusts</h2>
        <p className="mt-0.5 text-[12px] text-gray-500">
          AI keeps citing these sites when it answers questions on your topics. Getting listed on one of
          them can reach every AI answer that already trusts it, often faster than trying to outrank it.
        </p>
      </div>
      <div className="grid gap-3">
        {top.map((d) => (
          <div key={d.domain} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-gray-900">{d.domain}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${CLASS_CLS[d.class]}`}>
                  {CLASS_LABEL[d.class]}
                </span>
                {!d.isOutreachTarget ? (
                  <span className="shrink-0 rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-400 ring-1 ring-gray-200">
                    Different playbook
                  </span>
                ) : null}
                {d.outreach.inOutreachPipeline ? (
                  <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 ring-1 ring-indigo-200">
                    In your outreach list ({d.outreach.status})
                  </span>
                ) : null}
              </div>
              <span className="text-[11px] text-gray-500">
                cited {d.citationCount} time{d.citationCount === 1 ? "" : "s"} on your topics
              </span>
            </div>

            {d.topTopics.length > 0 ? (
              <p className="mt-1.5 text-[11px] text-gray-500">
                Topics: {d.topTopics.join(", ")}
              </p>
            ) : null}

            {d.exampleCitedUrl ? (
              <p className="mt-1 text-[11px] text-gray-600">
                <span className="font-medium text-gray-700">Page AI cited:</span>{" "}
                <a
                  href={d.exampleCitedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-900 underline-offset-2 hover:underline"
                >
                  {prettyUrl(d.exampleCitedUrl)}
                </a>
              </p>
            ) : null}

            <p className="mt-1 text-[11px] text-gray-500">
              <span className="font-medium text-gray-700">A prompt it wins:</span> {d.examplePrompt}
            </p>

            <p className="mt-1.5 text-[11px] font-medium text-emerald-700">{d.suggestedAction}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
