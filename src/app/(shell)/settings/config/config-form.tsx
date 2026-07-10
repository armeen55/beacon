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

/** Business-type choices the operator can confirm or override. Ordered so the
 *  most common self-serve types read first; "I'm not sure" maps to "other". */
const BUSINESS_TYPE_OPTIONS = [
  { value: "local_service", label: "A local business (I serve customers in specific places)" },
  { value: "ecommerce", label: "An online store (I sell products)" },
  { value: "saas", label: "A software product or app" },
  { value: "content_publisher", label: "A publication (articles, guides, an encyclopedia)" },
  { value: "other", label: "I'm not sure yet" },
] as const;

export type ConfigFormInitial = {
  name: string;
  domain: string;
  industry: string;
  phone: string;
  address: string;
  yelpBusinessId: string;
  /** Auto-derived business type ("" when Beacon has not decided yet). */
  businessType: string;
  locationsLine: string;
  servicesLine: string;
  competitorsLine: string;
  /** One rule per line. */
  contentRulesLine: string;
  /** Comma-separated banned terms (hard-rejected by the factory). */
  flaggedTermsLine: string;
  /** Wave 2A - the monthly-visits goal as a string ("" when none set). */
  monthlyVisitGoalLine: string;
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
  const [businessType, setBusinessType] = useState(initial.businessType);
  const [locationsLine, setLocationsLine] = useState(initial.locationsLine);
  const [servicesLine, setServicesLine] = useState(initial.servicesLine);
  const [competitorsLine, setCompetitorsLine] = useState(initial.competitorsLine);
  const [yelpBusinessId, setYelpBusinessId] = useState(initial.yelpBusinessId);
  const [contentRulesLine, setContentRulesLine] = useState(initial.contentRulesLine);
  const [flaggedTermsLine, setFlaggedTermsLine] = useState(initial.flaggedTermsLine);
  const [monthlyVisitGoalLine, setMonthlyVisitGoalLine] = useState(initial.monthlyVisitGoalLine);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    setName(initial.name);
    setDomain(initial.domain);
    setIndustry(initial.industry);
    setPhone(initial.phone);
    setAddress(initial.address);
    setBusinessType(initial.businessType);
    setLocationsLine(initial.locationsLine);
    setServicesLine(initial.servicesLine);
    setCompetitorsLine(initial.competitorsLine);
    setYelpBusinessId(initial.yelpBusinessId);
    setContentRulesLine(initial.contentRulesLine);
    setFlaggedTermsLine(initial.flaggedTermsLine);
    setMonthlyVisitGoalLine(initial.monthlyVisitGoalLine);
  }, [
    initial.name,
    initial.domain,
    initial.industry,
    initial.phone,
    initial.address,
    initial.businessType,
    initial.yelpBusinessId,
    initial.locationsLine,
    initial.servicesLine,
    initial.competitorsLine,
    initial.contentRulesLine,
    initial.flaggedTermsLine,
    initial.monthlyVisitGoalLine,
  ]);

  const handleSave = () => {
    setResult(null);
    // Wave 2A - parse the monthly-visits goal: blank clears it (null); otherwise it
    // must be a whole number above zero. Validate here so the operator sees the reason
    // before a round-trip.
    const goalRaw = monthlyVisitGoalLine.trim();
    let monthlyVisitGoal: number | null = null;
    if (goalRaw !== "") {
      const parsed = Number(goalRaw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setResult({ success: false, error: "Enter a whole number of visits above zero, or leave it blank." });
        return;
      }
      monthlyVisitGoal = parsed;
    }
    startTransition(async () => {
      const normalizedDomain = domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/+$/, "");
      const r = await saveSetup({
        name,
        domain: normalizedDomain,
        industry,
        businessType,
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
        monthlyVisitGoal,
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
        <label htmlFor="config-domain" className="mb-1.5 block text-[12px] font-medium text-foreground">Website address</label>
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
          Your Yelp page
        </label>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Paste your Yelp page link so Beacon can find your reviews. Optional.
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
        <label htmlFor="config-business-type" className="mb-1.5 block text-[12px] font-medium text-foreground">
          What kind of business you are
        </label>
        <p className="mb-2 text-[11px] text-muted-foreground">
          {initial.businessType && initial.businessType !== "other"
            ? "I worked this out from your website. If I got it wrong, pick the right one and I'll tailor everything to it."
            : "Pick the one that fits best so I can tailor everything to your business."}
        </p>
        <select
          id="config-business-type"
          value={businessType || "other"}
          onChange={(e) => setBusinessType(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        >
          {BUSINESS_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
        <p className="mb-2 text-[11px] text-muted-foreground">List the cities you serve, separated by commas.</p>
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
        <p className="mb-2 text-[11px] text-muted-foreground">List your main services, separated by commas, so we can watch how often people find them on Google.</p>
        <input
          id="config-services"
          type="text"
          value={servicesLine}
          onChange={(e) => setServicesLine(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>
      <div>
        <label htmlFor="config-competitors" className="mb-1.5 block text-[12px] font-medium text-foreground">Your competitors</label>
        <p className="mb-2 text-[11px] text-muted-foreground">Their names or website links, separated by commas.</p>
        <input
          id="config-competitors"
          type="text"
          value={competitorsLine}
          onChange={(e) => setCompetitorsLine(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>

      <div>
        <label htmlFor="config-monthly-visit-goal" className="mb-1.5 block text-[12px] font-medium text-foreground">
          Monthly visits goal
        </label>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Optional. The monthly visits you are aiming for. I grade this only from reconciled
          analytics, never from clicks. Leave it blank to set no goal.
        </p>
        <input
          id="config-monthly-visit-goal"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={monthlyVisitGoalLine}
          onChange={(e) => setMonthlyVisitGoalLine(e.target.value)}
          placeholder="e.g. 10000"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          data-config-field="monthly-visit-goal"
        />
      </div>

      <div>
        <label htmlFor="config-content-rules" className="mb-1.5 block text-[12px] font-medium text-foreground">
          Writing preferences
        </label>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Optional. One rule per line. Beacon follows these whenever it writes a
          suggestion for you. For example: &ldquo;Always say donut, never
          doughnut.&rdquo;
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
          Words to never use
        </label>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Separated by commas. Beacon will never use these words when it writes a
          suggestion for you.
        </p>
        <input
          id="config-flagged-terms"
          type="text"
          value={flaggedTermsLine}
          onChange={(e) => setFlaggedTermsLine(e.target.value)}
          placeholder="e.g. cheap, discount"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          data-config-field="flagged-terms"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !name.trim() || !domain.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        {(!name.trim() || !domain.trim()) && !pending ? (
          <span className="text-[11px] text-muted-foreground">
            Add a business name and website to save.
          </span>
        ) : null}
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
          {result.success ? "Business profile saved." : "Couldn't save. Please try again."}
        </div>
      )}
    </div>
  );
}
