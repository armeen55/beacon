"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/data/page-header";
import { saveSetup } from "./actions";

const INDUSTRY_OPTIONS = [
  { value: "home-builder", label: "Home Builder / Contractor" },
  { value: "dental", label: "Dental Practice" },
  { value: "legal", label: "Law Firm" },
  { value: "restaurant", label: "Restaurant / Food Service" },
  { value: "real-estate", label: "Real Estate" },
  { value: "medical", label: "Medical / Healthcare" },
  { value: "auto", label: "Automotive" },
  { value: "other", label: "Other" },
];

export default function SetupPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState({
    name: "",
    domain: "",
    industry: "home-builder",
    locations: "",
    services: "",
    competitors: "",
  });
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  const handleSave = () => {
    startTransition(async () => {
      const locations = config.locations
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const services = config.services
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const competitors = config.competitors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const r = await saveSetup({
        name: config.name,
        domain: config.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, ""),
        industry: config.industry,
        locations,
        services,
        primaryCompetitors: competitors,
      });

      setResult(r);
      if (r.success) setTimeout(() => router.push("/"), 1500);
    });
  };

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Set up Beacon"
        description="Tell us about your business so Beacon can monitor your AI visibility."
      />

      {step === 0 && (
        <div className="space-y-5">
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Business name</label>
            <input
              type="text"
              value={config.name}
              onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
              placeholder="e.g. Ritz Builders"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Website domain</label>
            <input
              type="text"
              value={config.domain}
              onChange={(e) => setConfig((c) => ({ ...c, domain: e.target.value }))}
              placeholder="e.g. ritzbuilders.com"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Industry</label>
            <select
              value={config.industry}
              onChange={(e) => setConfig((c) => ({ ...c, industry: e.target.value }))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            >
              {INDUSTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setStep(1)}
            disabled={!config.name || !config.domain}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Service areas / locations</label>
            <p className="text-[11px] text-muted-foreground mb-2">Comma-separated cities or regions you serve.</p>
            <input
              type="text"
              value={config.locations}
              onChange={(e) => setConfig((c) => ({ ...c, locations: e.target.value }))}
              placeholder="e.g. Palo Alto, Menlo Park, Atherton"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Key services</label>
            <p className="text-[11px] text-muted-foreground mb-2">Comma-separated services you want to track.</p>
            <input
              type="text"
              value={config.services}
              onChange={(e) => setConfig((c) => ({ ...c, services: e.target.value }))}
              placeholder="e.g. custom home, remodel, renovation, ADU"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Known competitors</label>
            <p className="text-[11px] text-muted-foreground mb-2">Comma-separated domain names of direct competitors.</p>
            <input
              type="text"
              value={config.competitors}
              onChange={(e) => setConfig((c) => ({ ...c, competitors: e.target.value }))}
              placeholder="e.g. competitorone.com, competitortwo.com"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStep(0)}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={handleSave}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save & start monitoring"}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`mt-5 rounded-lg border px-4 py-3 text-[12px] ${
          result.success
            ? "border-status-success/30 bg-status-success/[0.05] text-status-success"
            : "border-status-danger/30 bg-status-danger/[0.05] text-status-danger"
        }`}>
          {result.success
            ? "Business profile saved. Redirecting to Today…"
            : `Error: ${result.error}`
          }
        </div>
      )}
    </div>
  );
}
