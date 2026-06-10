/**
 * "Why them, not you" — per-rival forensics (§competitor-intel,
 * 2026-06-09). Server component.
 *
 * For each top-cited rival: their page vs your closest equivalent, the
 * structural gaps named in plain English, the words AI uses about them
 * vs you, and the prompts where they show up — losses (you absent)
 * first. No fabricated quotes: answer text isn't stored, so this speaks
 * in ranks, dates, and observed descriptor words only.
 */

import type { WhyThemReport } from "@/domains/competitor-intel/types";

export function WhyThemSection({ reports }: { reports: WhyThemReport[] }) {
  if (reports.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground">
        Why them, not you
      </h2>
      <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
        What the most-recommended rivals&apos; pages have that yours
        don&apos;t — and the exact questions where AI sends buyers their way.
      </p>
      <div className="mt-3 space-y-3">
        {reports.map((r) => (
          <details
            key={r.domain}
            className="group/whythem rounded-lg border border-border/50 px-4 py-3"
            open={reports.length === 1}
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/whythem:rotate-90">
                ▶
              </span>
              <span className="text-[13px] font-semibold text-foreground">
                {r.displayName}
              </span>
              <span className="text-[11px] text-muted-foreground">
                AI cited this page {r.theirCitationTotal} times
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-2 text-[11px] sm:grid-cols-2">
                <div className="rounded border border-border/40 bg-surface-inset/30 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Their page
                  </p>
                  <a
                    href={r.theirUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block truncate font-mono text-[10px] text-foreground hover:underline"
                  >
                    {r.theirUrl}
                  </a>
                  {r.theirTitle != null && (
                    <p className="mt-1 text-muted-foreground">{r.theirTitle}</p>
                  )}
                </div>
                <div className="rounded border border-border/40 bg-surface-inset/30 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Your closest page
                  </p>
                  {r.equivalentPageUrl != null ? (
                    <a
                      href={r.equivalentPageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block truncate font-mono text-[10px] text-foreground hover:underline"
                    >
                      {r.equivalentPageUrl}
                    </a>
                  ) : (
                    <p className="mt-1 text-muted-foreground">
                      No close match yet.
                    </p>
                  )}
                </div>
              </div>

              {r.gaps.length > 0 && (
                <ul className="space-y-1">
                  {r.gaps.map((g) => (
                    <li
                      key={g.dimension}
                      data-gap={g.dimension}
                      className="text-[12px] text-foreground leading-relaxed"
                    >
                      <span className="text-status-warning">▲</span> {g.sentence}
                    </li>
                  ))}
                </ul>
              )}

              {(r.descriptors.theirs.length > 0 ||
                r.descriptors.ours.length > 0) && (
                <div className="text-[11px] text-muted-foreground">
                  {r.descriptors.theirs.length > 0 && (
                    <p>
                      Words AI uses about them:{" "}
                      <span className="text-foreground">
                        {r.descriptors.theirs.join(", ")}
                      </span>
                    </p>
                  )}
                  {r.descriptors.ours.length > 0 && (
                    <p>
                      Words AI uses about you:{" "}
                      <span className="text-foreground">
                        {r.descriptors.ours.join(", ")}
                      </span>
                    </p>
                  )}
                </div>
              )}

              {r.prompts.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Questions where they show up
                  </p>
                  <ul className="space-y-1">
                    {r.prompts.map((p) => (
                      <li
                        key={`${p.promptText}|${p.platform}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]"
                      >
                        <span className="text-foreground">{p.promptText}</span>
                        <span className="text-muted-foreground">
                          {p.platform} · them #{p.theirRank} · you{" "}
                          {p.ourRank != null ? (
                            `#${p.ourRank}`
                          ) : (
                            <span className="font-semibold text-status-warning">
                              not cited
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
