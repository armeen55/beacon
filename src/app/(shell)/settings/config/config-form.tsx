"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSetup } from "./actions";

// Listed alphabetically so the form doesn't signal a default vertical
// (used to lead with "Home Builder" — a leftover from the first tenant; #257).
const INDUSTRY_OPTIONS = [
  { value: "auto", label: "Automotive" },
  { value: "dental", label: "Dental Practice" },
  { value: "home-builder", label: "Home Builder / Contractor" },
  { value: "legal", label: "Law Firm" },
  { value: "medical", label: "Medical / Healthcare" },
  { value: "real-estate", label: "Real Estate" },
  { value: "restaurant", label: "Restaurant / Food Service" },
  { value: "other", label: "Other" },
] as const;

export type ConfigFormInitial = {
  name: string;
  domain: string;
  industry: string;
  phone: string;
  address: string;
  yelpBusinessId: string;
  locationsLine: string;
  servicesLine: string;
  competitorsLine: string;
  /** One rule per line. */
  contentRulesLine: string;
  /** Comma-separated banned terms (hard-rejected by the factory). */
  flaggedTermsLine: string;
};

function splitList(line: string): string[] {
  return line
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ConfigForm({ initial }: { initial: ConfigFormInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [domain, setDomain] = useState(initial.domain);
  const [industry, setIndustry] = useState(initial.industry);
  const [phone, setPhone] = useState(initial.phone);
  const [address, setAddress] = useState(initial.address);
  const [locationsLine, setLocationsLine] = useState(initial.locationsLine);
  const [servicesLine, setServicesLine] = useState(initial.servicesLine);
  const [competitorsLine, setCompetitorsLine] = useState(initial.competitorsLine);
  const [yelpBusinessId, setYelpBusinessId] = useState(initial.yelpBusinessId);
  const [contentRulesLine, setContentRulesLine] = useState(initial.contentRulesLine);
  const [flaggedTermsLine, setFlaggedTermsLine] = useState(initial.flaggedTermsLine);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    setName(initial.name);
    setDomain(initial.domain);
    setIndustry(initial.industry);
    setPhone(initial.phone);
    setAddress(initial.address);
    setLocationsLine(initial.locationsLine);
    setServicesLine(initial.servicesLine);
    setCompetitorsLine(initial.competitorsLine);
    setYelpBusinessId(initial.yelpBusinessId);
    setContentRulesLine(initial.contentRulesLine);
    setFlaggedTermsLine(initial.flaggedTermsLine);
  }, [
    initial.name,
    initial.domain,
    initial.industry,
    initial.phone,
    initial.address,
    initial.yelpBusinessId,
    initial.locationsLine,
    initial.servicesLine,
    initial.competitorsLine,
    initial.contentRulesLine,
    initial.flaggedTermsLine,
  ]);

  const handleSave = () => {
    setResult(null);
    startTransition(async () => {
      const normalizedDomain = domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/+$/, "");
      const r = await saveSetup({
        name,
        domain: normalizedDomain,
        industry,
        phone: phone.trim(),
        address: address.trim(),
        locations: splitList(locationsLine),
        services: splitList(servicesLine),
        primaryCompetitors: splitList(competitorsLine),
        yelpBusinessId: yelpBusinessId.trim(),
        contentRules: contentRulesLine
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        flaggedTerms: splitList(flaggedTermsLine),
      });
      setResult(r);
      if (r.success) router.refresh();
    });
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <label htmlFor="config-name" className="mb-1.5 block text-[12px] font-medium text-foreground">Business name</label>
        <input
          id="config-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>
      <div>
        <label htmlFor="config-domain" className="mb-1.5 block text-[12px] font-medium text-foreground">Website domain</label>
        <input
          id="config-domain"
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>
      <div>
        <label htmlFor="config-phone" className="mb-1.5 block text-[12px] font-medium text-foreground">Phone</label>
        <input
          id="config-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>
      <div>
        <label htmlFor="config-address" className="mb-1.5 block text-[12px] font-medium text-foreground">Address</label>
        <input
          id="config-address"
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, City, ST 12345"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>
      <div>
        <label htmlFor="config-yelp" className="mb-1.5 block text-[12px] font-medium text-foreground">
          Yelp business ID or alias
        </label>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Used when you sync Yelp reviews from Settings → Connectors. Find this in your Yelp business URL or Fusion documentation.
        </p>
        <input
          id="config-yelp"
          type="text"
          value={yelpBusinessId}
          onChange={(e) => setYelpBusinessId(e.target.value)}
          placeholder="e.g. your-business-name"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>
      <div>
        <label htmlFor="config-industry" className="mb-1.5 block text-[12px] font-medium text-foreground">Industry</label>
        <select
          id="config-industry"
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        >
          {!INDUSTRY_OPTIONS.some((o) => o.value === industry) && industry ? (
            <option value={industry}>{industry}</option>
          ) : null}
          {INDUSTRY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="config-locations" className="mb-1.5 block text-[12px] font-medium text-foreground">Service areas / locations</label>
        <p className="mb-2 text-[11px] text-muted-foreground">Comma-separated cities or regions you serve.</p>
        <input
          id="config-locations"
          type="text"
          value={locationsLine}
          onChange={(e) => setLocationsLine(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>
      <div>
        <label htmlFor="config-services" className="mb-1.5 block text-[12px] font-medium text-foreground">Key services</label>
        <p className="mb-2 text-[11px] text-muted-foreground">Comma-separated services you want to track.</p>
        <input
          id="config-services"
          type="text"
          value={servicesLine}
          onChange={(e) => setServicesLine(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>
      <div>
        <label htmlFor="config-competitors" className="mb-1.5 block text-[12px] font-medium text-foreground">Known competitors</label>
        <p className="mb-2 text-[11px] text-muted-foreground">Comma-separated competitor domains.</p>
        <input
          id="config-competitors"
          type="text"
          value={competitorsLine}
          onChange={(e) => setCompetitorsLine(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>

      <div>
        <label htmlFor="config-content-rules" className="mb-1.5 block text-[12px] font-medium text-foreground">
          Content rules
        </label>
        <p className="mb-2 text-[11px] text-muted-foreground">
          One rule per line. Every piece of content Beacon drafts for you
          follows these — e.g. &ldquo;Call the language Persian, never
          Farsi.&rdquo;
        </p>
        <textarea
          id="config-content-rules"
          rows={4}
          value={contentRulesLine}
          onChange={(e) => setContentRulesLine(e.target.value)}
          placeholder={"One rule per line"}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          data-config-field="content-rules"
        />
      </div>

      <div>
        <label htmlFor="config-flagged-terms" className="mb-1.5 block text-[12px] font-medium text-foreground">
          Banned terms
        </label>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Comma-separated. Drafts containing these words are rejected
          outright — they can never reach your review queue.
        </p>
        <input
          id="config-flagged-terms"
          type="text"
          value={flaggedTermsLine}
          onChange={(e) => setFlaggedTermsLine(e.target.value)}
          placeholder="e.g. Farsi, cheapest"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          data-config-field="flagged-terms"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !name.trim() || !domain.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>

      {result && (
        <div
          role={result.success ? "status" : "alert"}
          aria-live={result.success ? "polite" : "assertive"}
          className={`rounded-lg border px-4 py-3 text-[12px] ${
            result.success
              ? "border-status-success/30 bg-status-success/[0.05] text-status-success"
              : "border-status-danger/30 bg-status-danger/[0.05] text-status-danger"
          }`}
        >
          {result.success ? "Business profile saved." : `Error: ${result.error}`}
        </div>
      )}
    </div>
  );
}
