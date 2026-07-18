"use client";

/**
 * RevenueModelCard (2026-07-01, BEACON_500 item 3) - the operator sets what
 * traffic is worth: dollars per lead (service businesses) or ad RPM per
 * 1,000 sessions (content sites). Beacon multiplies this rate by REAL
 * measured GA4 traffic to produce dollar estimates that are always labeled
 * "your rate x real traffic" and never presented as a measured payout.
 * Sibling card to the business-info form on /settings/config.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRevenueModel } from "./actions";

export type RevenueModelInitial = {
  kind: "rpm" | "per_lead" | "off";
  rate: string; // pre-formatted for the input, "" when unset
};

const KIND_OPTIONS = [
  { value: "off", label: "Not set (I will not show dollar estimates)" },
  { value: "per_lead", label: "Leads: what one lead is worth to you" },
  { value: "rpm", label: "Ads: what 1,000 visits earn you (RPM)" },
] as const;

export function RevenueModelCard({ initial }: { initial: RevenueModelInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<RevenueModelInitial["kind"]>(initial.kind);
  const [rate, setRate] = useState(initial.rate);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  const needsRate = kind !== "off";
  const rateNumber = Number(rate);
  const rateOk = !needsRate || (Number.isFinite(rateNumber) && rateNumber > 0);

  const handleSave = () => {
    setResult(null);
    startTransition(async () => {
      const r = await saveRevenueModel(
        kind === "off" ? { kind: "off" } : { kind, rate: rateNumber },
      );
      setResult(r);
      if (r.success) router.refresh();
    });
  };

  return (
    <section
      aria-label="What your traffic is worth"
      className="mt-8 max-w-xl rounded-2xl border border-border bg-background p-5"
    >
      <h2 className="text-[14px] font-semibold text-foreground">What is your traffic worth?</h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Tell me what a lead is worth to you, or your ad RPM, and I will turn your real
        traffic into honest dollar estimates. Every number from this is labeled as your
        rate x real traffic. I will never present it as a measured payout.
      </p>
      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="revenue-kind" className="mb-1.5 block text-[12px] font-medium text-foreground">
            How your site makes money
          </label>
          <select
            id="revenue-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as RevenueModelInitial["kind"])}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {needsRate ? (
          <div>
            <label htmlFor="revenue-rate" className="mb-1.5 block text-[12px] font-medium text-foreground">
              {kind === "per_lead" ? "Dollars one lead is worth" : "Dollars per 1,000 visits (RPM)"}
            </label>
            <input
              id="revenue-rate"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder={kind === "per_lead" ? "e.g. 150" : "e.g. 20"}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !rateOk}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          {!rateOk && !pending ? (
            <span className="text-[11px] text-muted-foreground">Enter a dollar amount above zero.</span>
          ) : null}
        </div>
        {result ? (
          <div
            role={result.success ? "status" : "alert"}
            aria-live={result.success ? "polite" : "assertive"}
            className={`rounded-lg border px-4 py-3 text-[12px] ${
              result.success
                ? "border-status-success/30 bg-status-success/[0.05] text-status-success"
                : "border-status-danger/30 bg-status-danger/[0.05] text-status-danger"
            }`}
          >
            {result.success
              ? kind === "off"
                ? "Saved. I will not show dollar estimates."
                : "Saved. I will now turn your real traffic into dollar estimates, labeled as your rate x real traffic."
              : result.error || "Could not save. Please try again."}
          </div>
        ) : null}
      </div>
    </section>
  );
}
