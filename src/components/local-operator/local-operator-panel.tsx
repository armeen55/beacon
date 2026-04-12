import type { ReactNode } from "react";
import Link from "next/link";
import type { LocalOperatorSurface } from "@/domains/local-operator/types";
import { cn } from "@/lib/utils";

function ProofBlock({
  label,
  lines,
  className,
}: {
  label: string;
  lines: string[];
  className?: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div className={cn("text-[9px] leading-snug", className)}>
      <p className="font-semibold text-foreground/80 uppercase tracking-wide mb-0.5">{label}</p>
      <ul className="list-disc pl-3 space-y-0.5 text-muted-foreground">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

function severityBorder(sev: string): string {
  if (sev === "urgent") return "border-status-danger/35 bg-status-danger/[0.04]";
  if (sev === "watch") return "border-status-warning/30 bg-status-warning/[0.03]";
  return "border-border/50 bg-surface-inset/10";
}

export function LocalOperatorPanel({
  surface,
  variant,
}: {
  surface: LocalOperatorSurface;
  variant: "market" | "health";
}) {
  const compact = variant === "health";

  const inner = (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground leading-relaxed">{surface.dataSourceNote}</p>

      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2">Local presence</h3>
        <div className="space-y-2">
          {surface.presenceSignals.map((s) => (
            <div
              key={s.id}
              className={cn("rounded-lg border px-3 py-2.5", severityBorder(s.severity))}
            >
              <p className="text-[12px] font-medium text-foreground">{s.headline}</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{s.detail}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <ProofBlock label="Observed" lines={s.proof.observed} />
                <ProofBlock label="Inferred" lines={s.proof.inferred} />
              </div>
              <ProofBlock label="Missing / partial data" lines={s.proof.dataGaps} className="mt-2" />
              {s.proof.stalenessNote && (
                <p className="text-[9px] text-status-warning mt-1.5 font-medium">{s.proof.stalenessNote}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2">Reviews & reputation (tasks)</h3>
        <div className="space-y-2">
          {surface.reviewTasks.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-border/50 bg-surface-inset/10 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-foreground">{t.headline}</p>
                <span className="text-[9px] font-medium uppercase text-muted-foreground shrink-0">
                  {t.cadence}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{t.detail}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <ProofBlock label="Observed" lines={t.proof.observed} />
                <ProofBlock label="Inferred" lines={t.proof.inferred} />
              </div>
              <ProofBlock label="Missing / partial data" lines={t.proof.dataGaps} className="mt-2" />
              {t.proof.stalenessNote && (
                <p className="text-[9px] text-status-warning mt-1.5 font-medium">{t.proof.stalenessNote}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/80">
        Weekly loop: skim this block on Market; daily only when Today shows the urgent strip.{" "}
        <Link href="/settings/health" className="text-accent-primary hover:underline font-medium">
          Health
        </Link>{" "}
        carries the same readout for deep checks.
      </p>
    </div>
  );

  if (compact) {
    return (
      <DisclosureBlock title="Local presence & reviews (Tier 1C)" subtitle="Checklist + optional import — not a listings CRM.">
        {inner}
      </DisclosureBlock>
    );
  }

  return (
    <section id="local-ops" className="scroll-mt-6">
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Local presence & reviews</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            High-signal operator tasks for contractors, clinics, firms, hospitality — without vertical forks.
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-surface-raised/30 px-4 py-4">{inner}</div>
    </section>
  );
}

function DisclosureBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <details className="rounded-lg border border-border/60 bg-card [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/30 rounded-lg">
        <span className="block">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{subtitle}</span>
        )}
      </summary>
      <div className="border-t border-border/40 px-4 py-4">{children}</div>
    </details>
  );
}
