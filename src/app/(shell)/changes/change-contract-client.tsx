"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { ChangeType, PageType, ChangeContract } from "@/domains/changelog/change-contract";

type VerificationCheckRow = {
  id: string;
  label: string;
  status: "matched" | "did_not_match" | "not_checked";
  note?: string;
};

type VerificationView = {
  status?: string;
  matched: string[];
  missing: string[];
  skipped: string[];
  summary: string;
  checkRows?: VerificationCheckRow[];
};

const CHANGE_TYPES = [
  "faq_addition", "schema_addition", "title_meta_change", "hero_rewrite",
  "comparison_table", "internal_linking", "new_page_creation", "page_reconstruction",
  "service_page_upgrade", "city_page_upgrade", "homepage_change", "project_page_creation",
  "trust_page_creation", "entity_profile_update", "directory_profile_update",
  "technical_rendering_fix", "prerender_fix", "url_migration",
  "sitewide_title_meta", "sitewide_structural_update", "guide_page_creation",
  "llms_txt_update", "image_optimization", "nav_footer_update", "other",
] as const;

const CHANGE_TYPE_LABELS: Record<string, string> = {
  faq_addition: "Added Q&A content", schema_addition: "Added structured data",
  title_meta_change: "Updated page title / description", hero_rewrite: "Rewrote page header",
  comparison_table: "Added comparison table", internal_linking: "Improved page connections",
  new_page_creation: "Created new page", page_reconstruction: "Rebuilt page",
  service_page_upgrade: "Improved service page", city_page_upgrade: "Improved city page",
  homepage_change: "Updated homepage", project_page_creation: "Added project showcase",
  trust_page_creation: "Added trust / awards page", entity_profile_update: "Updated business profile",
  directory_profile_update: "Updated directory listing", technical_rendering_fix: "Fixed technical rendering",
  prerender_fix: "Fixed server-side rendering", url_migration: "Moved page URL",
  sitewide_title_meta: "Updated titles across site", sitewide_structural_update: "Structural update across site",
  guide_page_creation: "Created guide page", llms_txt_update: "Updated AI crawler guidance",
  image_optimization: "Optimized images", nav_footer_update: "Updated navigation", other: "Other change",
};

type Props = {
  contracts: ChangeContract[];
  onCreateContract: (input: {
    accountId: string;
    pageUrl: string;
    pageType: PageType;
    changeType: ChangeType;
    changeSummary: string;
    businessGoal: string;
    intendedHypothesis: string;
    dateRequested: string;
    dateLive?: string;
    city?: string;
    service?: string;
    topic?: string;
    faqCountExpected?: number;
    schemaTypesExpected?: string[];
    h1Expected?: string;
    sourceInputType?: "manual" | "pasted_instructions";
  }) => Promise<{ success: boolean; contractId?: string; errors?: string[]; warnings?: string[] }>;
  onVerifyContract: (contractId: string) => Promise<{
    success: boolean;
    status: string;
    matched: string[];
    missing: string[];
    skipped: string[];
    summary: string;
    checkRows: VerificationCheckRow[];
  }>;
};

const READINESS_LABELS: Record<string, { label: string; color: string }> = {
  strong: { label: "Strong tracking", color: "text-status-success" },
  usable: { label: "Usable", color: "text-accent-primary" },
  weak: { label: "Needs more detail", color: "text-status-warning" },
};

const VERIFY_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "text-muted-foreground" },
  verified_match: { label: "Matches scan", color: "text-status-success" },
  verified_mismatch: { label: "Mismatch found", color: "text-status-danger" },
  not_applicable: { label: "N/A", color: "text-muted-foreground" },
};

function verificationResultTone(vr: VerificationView): "success" | "warning" | "danger" {
  const checkRows = vr.checkRows ?? [];
  const hasMismatch = checkRows.some((r) => r.status === "did_not_match");
  const hasMixed = hasMismatch && checkRows.some((r) => r.status === "matched");
  if (hasMismatch && hasMixed) return "warning";
  if (hasMismatch) return "danger";
  return "success";
}

export function ChangeContractUI({ contracts, onCreateContract, onVerifyContract }: Props) {
  // Read prefill from URL params
  const urlPrefill = typeof window !== "undefined" ? (() => {
    const params = new URLSearchParams(window.location.search);
    return { pageUrl: params.get("page") ?? "", city: params.get("city") ?? "", topic: params.get("topic") ?? "" };
  })() : { pageUrl: "", city: "", topic: "" };

  const [showForm, setShowForm] = useState(!!urlPrefill.pageUrl);
  const [showPaste, setShowPaste] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ errors?: string[]; warnings?: string[] } | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, VerificationView>>({});

  // Form state
  const [pageUrl, setPageUrl] = useState(urlPrefill.pageUrl);
  const [pageType, setPageType] = useState<PageType>("other");
  const [changeType, setChangeType] = useState<ChangeType>("other");
  const [summary, setSummary] = useState("");
  const [businessGoal, setBusinessGoal] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [dateLive, setDateLive] = useState("");
  const [city, setCity] = useState(urlPrefill.city);
  const [service, setService] = useState("");
  const [topic, setTopic] = useState(urlPrefill.topic);
  const [faqCount, setFaqCount] = useState("");
  const [schemas, setSchemas] = useState("");
  const [h1, setH1] = useState("");

  function resetForm() {
    setPageUrl(""); setPageType("other"); setChangeType("other");
    setSummary(""); setBusinessGoal(""); setHypothesis(""); setDateLive("");
    setCity(""); setService(""); setTopic("");
    setFaqCount(""); setSchemas(""); setH1(""); setResult(null);
  }

  function handlePaste() {
    const text = pastedText;
    if (text.toLowerCase().includes("faq") || text.toLowerCase().includes("q&a")) setChangeType("faq_addition");
    else if (text.toLowerCase().includes("schema") || text.toLowerCase().includes("json-ld")) setChangeType("schema_addition");
    else if (text.toLowerCase().includes("new page") || text.toLowerCase().includes("created")) setChangeType("new_page_creation");
    else if (text.toLowerCase().includes("rebuilt") || text.toLowerCase().includes("overhaul")) setChangeType("page_reconstruction");
    const faqMatch = text.match(/(\d+)\s*(?:faq|q&a|question)/i);
    if (faqMatch) setFaqCount(faqMatch[1]);
    const schemaTypes: string[] = [];
    if (/faqpage/i.test(text)) schemaTypes.push("FAQPage");
    if (/homeandconstruction/i.test(text)) schemaTypes.push("HomeAndConstructionBusiness");
    if (/\barticle\b/i.test(text)) schemaTypes.push("Article");
    if (schemaTypes.length > 0) setSchemas(schemaTypes.join(", "));
    setShowPaste(false);
    setShowForm(true);
  }

  async function handleSubmit() {
    startTransition(async () => {
      const r = await onCreateContract({
        accountId: "default",
        pageUrl: pageUrl.trim(),
        pageType,
        changeType,
        changeSummary: summary.trim(),
        businessGoal: businessGoal.trim(),
        intendedHypothesis: hypothesis.trim(),
        dateRequested: new Date().toISOString(),
        dateLive: dateLive || undefined,
        city: city || undefined,
        service: service || undefined,
        topic: topic || undefined,
        faqCountExpected: faqCount ? parseInt(faqCount, 10) : undefined,
        schemaTypesExpected: schemas ? schemas.split(",").map(s => s.trim()).filter(Boolean) : undefined,
        h1Expected: h1 || undefined,
        sourceInputType: "manual",
      });
      setResult({ errors: r.errors, warnings: r.warnings });
      if (r.success) { resetForm(); setShowForm(false); }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { setShowForm(true); setShowPaste(false); }} className="px-4 py-2 rounded-md bg-accent-primary text-white text-[11px] font-semibold hover:bg-accent-primary/90 transition-colors">
          Log a change
        </button>
        <button onClick={() => { setShowPaste(true); setShowForm(false); }} className="px-3 py-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:bg-surface-inset transition-colors">
          Paste instructions
        </button>
        {contracts.length > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{contracts.length} saved record{contracts.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <details className="group/check rounded-md border border-border/50 bg-surface-inset/15">
        <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/check:rotate-90">▶</span>
          How scan check works
        </summary>
        <p className="px-3 pb-3 text-[10px] text-muted-foreground leading-relaxed border-t border-border/40 pt-2">
          Beacon compares each saved record to your <span className="font-medium text-foreground/90">latest stored crawl</span> (Q&amp;A count, structured data types, heading, HTTP status where relevant).
          It does <span className="font-medium text-foreground/90">not</span> re-fetch the live site here and is <span className="font-medium text-foreground/90">not</span> a full QA pass — it is a fast consistency check against what Beacon already captured.
        </p>
      </details>

      {/* Paste flow */}
      {showPaste && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-[12px] font-semibold">Paste your dev instructions</p>
          <p className="text-[10px] text-muted-foreground">Beacon will draft a structured change record from your instructions. You will review it before saving.</p>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            className="w-full h-32 rounded-md border border-border bg-background px-3 py-2 text-[11px] resize-none"
            placeholder="Paste dev instructions, PDF content, or change description here..."
          />
          <div className="flex gap-2">
            <button onClick={handlePaste} disabled={!pastedText.trim()} className="px-3 py-1.5 rounded-md bg-accent-primary text-white text-[10px] font-semibold hover:bg-accent-primary/90">Draft from this</button>
            <button onClick={() => setShowPaste(false)} className="px-3 py-1.5 rounded-md border border-border text-[10px] text-muted-foreground hover:bg-surface-inset">Cancel</button>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="rounded-lg border border-border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold">Log a change</p>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Page *" value={pageUrl} onChange={setPageUrl} placeholder="/locations/menlo-park" />
            <div>
              <label className="text-[10px] font-medium text-muted-foreground block mb-1">What changed *</label>
              <select value={changeType} onChange={(e) => setChangeType(e.target.value as ChangeType)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px]">
                {CHANGE_TYPES.map((t) => <option key={t} value={t}>{CHANGE_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>

          <Field label="Describe the change *" value={summary} onChange={setSummary} placeholder="Added 6 Q&A items and FAQPage structured data to the Menlo Park city page" multiline />
          <Field label="Why this matters *" value={businessGoal} onChange={setBusinessGoal} placeholder="Competitors show up more than us for Menlo Park custom home searches" />
          <Field label="What you expect to improve *" value={hypothesis} onChange={setHypothesis} placeholder="Should increase tracked mentions for Menlo Park custom home searches" />

          <details className="group">
            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground font-medium">
              Verification details (helps Beacon check your work)
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Q&A items expected" value={faqCount} onChange={setFaqCount} placeholder="6" />
              <Field label="Structured data types" value={schemas} onChange={setSchemas} placeholder="FAQPage, HomeAndConstructionBusiness" />
              <Field label="Page heading (H1)" value={h1} onChange={setH1} placeholder="Luxury Custom Home Builder in Menlo Park, CA" />
            </div>
          </details>

          <details className="group">
            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground font-medium">
              Context (city, service, topic, live date)
            </summary>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="City" value={city} onChange={setCity} placeholder="Menlo Park" />
              <Field label="Service" value={service} onChange={setService} placeholder="Custom homes" />
              <Field label="Topic" value={topic} onChange={setTopic} placeholder="Menlo Park Construction" />
              <Field label="When it went live" value={dateLive} onChange={setDateLive} placeholder="2026-04-08" />
            </div>
          </details>

          {/* Errors / warnings */}
          {result?.errors && result.errors.length > 0 && (
            <div className="rounded-md bg-status-danger/5 border border-status-danger/20 px-3 py-2 space-y-0.5">
              {result.errors.map((e, i) => <p key={i} className="text-[10px] text-status-danger">✗ {e}</p>)}
            </div>
          )}
          {result?.warnings && result.warnings.length > 0 && (
            <div className="rounded-md bg-status-warning/5 border border-status-warning/20 px-3 py-2 space-y-0.5">
              {result.warnings.map((w, i) => <p key={i} className="text-[10px] text-status-warning">⚠ {w}</p>)}
            </div>
          )}

          <button onClick={handleSubmit} disabled={pending} className="px-4 py-2 rounded-md bg-accent-primary text-white text-[11px] font-semibold hover:bg-accent-primary/90 transition-colors w-full">
            {pending ? "Saving…" : "Save change"}
          </button>
        </div>
      )}

      {/* Saved contracts */}
      {contracts.length > 0 && (
        <div className="space-y-2">
          {contracts.map((c) => {
            const ar = READINESS_LABELS[c.attributionReadiness] ?? READINESS_LABELS.weak;
            const vs = VERIFY_STATUS[c.verificationStatus] ?? VERIFY_STATUS.pending;
            const vrRaw =
              verifyResults[c.contractId] ??
              (c.verificationResult
                ? (() => {
                    try {
                      return JSON.parse(c.verificationResult) as VerificationView;
                    } catch {
                      return null;
                    }
                  })()
                : null);

            const verificationDetail =
              vrRaw &&
              (() => {
                const vr = vrRaw;
                const checkRows = vr.checkRows ?? [];
                const hasMismatch = checkRows.some((r) => r.status === "did_not_match");
                const hasMixed = hasMismatch && checkRows.some((r) => r.status === "matched");
                const hasLegacyLists =
                  (vr.matched?.length ?? 0) > 0 ||
                  (vr.missing?.length ?? 0) > 0 ||
                  (vr.skipped?.length ?? 0) > 0;
                if (checkRows.length === 0 && !hasLegacyLists) return null;

                return (
                  <div
                    className={cn(
                      "rounded-md px-3 py-2 border",
                      hasMismatch
                        ? hasMixed
                          ? "bg-status-warning/5 border-status-warning/20"
                          : "bg-status-danger/5 border-status-danger/20"
                        : "bg-status-success/5 border-status-success/20",
                    )}
                  >
                    {checkRows.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[9px] font-medium text-muted-foreground">Checks</p>
                        <ul className="space-y-1">
                          {checkRows.map((row) => (
                            <li key={row.id} className="text-[9px] flex gap-2 items-start">
                              <span
                                className={cn(
                                  "shrink-0 font-semibold w-[80px]",
                                  row.status === "matched" && "text-status-success",
                                  row.status === "did_not_match" && "text-status-danger",
                                  row.status === "not_checked" && "text-muted-foreground",
                                )}
                              >
                                {row.status === "matched"
                                  ? "OK"
                                  : row.status === "did_not_match"
                                    ? "Mismatch"
                                    : "Skipped"}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="text-foreground font-medium">{row.label}</span>
                                {row.note && <span className="text-muted-foreground"> — {row.note}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <>
                        {vr.matched?.length > 0 && (
                          <div className="space-y-0.5">
                            <p className="text-[9px] text-muted-foreground font-medium">Re-run check for line-by-line results (older save).</p>
                            {vr.matched.map((m: string, i: number) => (
                              <p key={i} className="text-[9px] text-status-success">
                                ✓ {m}
                              </p>
                            ))}
                          </div>
                        )}
                        {vr.missing?.length > 0 && (
                          <div className="space-y-0.5 mt-1">
                            {vr.missing.map((m: string, i: number) => (
                              <p key={i} className="text-[9px] text-status-danger">
                                ✗ {m}
                              </p>
                            ))}
                          </div>
                        )}
                        {vr.skipped?.length > 0 && (
                          <div className="space-y-0.5 mt-1">
                            {vr.skipped.map((s: string, i: number) => (
                              <p key={i} className="text-[9px] text-muted-foreground">
                                — {s}
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })();

            const tone = vrRaw ? verificationResultTone(vrRaw) : null;

            return (
              <div key={c.contractId} className="rounded-lg border border-border/70 overflow-hidden text-[10px]">
                <div className="flex flex-wrap items-start gap-3 px-3 py-2.5 bg-surface-inset/25">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-foreground leading-snug line-clamp-2">{c.changeSummary}</p>
                    <p className="text-[9px] font-mono text-muted-foreground truncate mt-0.5">{c.pageUrl}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[9px] text-muted-foreground">
                      <span>{CHANGE_TYPE_LABELS[c.changeType]}</span>
                      {c.city && <span>{c.city}</span>}
                      {c.dateLive && (
                        <span>
                          Live {new Date(c.dateLive).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="flex flex-wrap justify-end gap-1.5 text-[9px]">
                      <span className={cn("font-medium", ar.color)}>{ar.label}</span>
                      <span className={cn("font-medium", vs.color)}>{vs.label}</span>
                    </div>
                    <button
                      onClick={() =>
                        startTransition(async () => {
                          const r = await onVerifyContract(c.contractId);
                          if (r.success) setVerifyResults((prev) => ({ ...prev, [c.contractId]: r }));
                        })
                      }
                      disabled={pending}
                      className="px-2.5 py-1 rounded-md border border-accent-primary/30 text-accent-primary text-[10px] font-semibold hover:bg-accent-primary/10 transition-colors"
                    >
                      {pending ? "Checking…" : c.verificationStatus === "pending" ? "Run check" : "Re-check"}
                    </button>
                    <span className="text-[9px] text-muted-foreground/70 text-right max-w-[200px]">
                      {c.expectedOutcomeWindowDays}d window
                      {c.verifiedAt &&
                        ` · ${new Date(c.verifiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                    </span>
                  </div>
                </div>

                {vrRaw?.summary && (
                  <div
                    className={cn(
                      "px-3 py-1.5 border-t border-border/40 text-[10px] leading-snug",
                      tone === "danger" && "bg-status-danger/[0.06] text-status-danger",
                      tone === "warning" && "bg-status-warning/[0.06] text-status-warning",
                      tone === "success" && "bg-status-success/[0.06] text-status-success",
                    )}
                  >
                    {vrRaw.summary}
                  </div>
                )}

                <details className="group/rec border-t border-border/50">
                  <summary className="cursor-pointer list-none px-3 py-2 text-[10px] font-medium text-muted-foreground hover:bg-surface-inset/40 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <span className="text-[8px] text-muted-foreground/50 transition-transform group-open/rec:rotate-90">▶</span>
                    Context &amp; check detail
                  </summary>
                  <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/30 bg-background/40">
                    {c.businessGoal && (
                      <p className="text-muted-foreground leading-relaxed">
                        <span className="font-medium text-foreground">Why it mattered:</span> {c.businessGoal}
                      </p>
                    )}
                    {c.intendedHypothesis && (
                      <p className="text-muted-foreground leading-relaxed">
                        <span className="font-medium text-foreground">Expected lift:</span> {c.intendedHypothesis}
                      </p>
                    )}
                    {verificationDetail}
                    {c.expectedVerification.length > 0 && !verifyResults[c.contractId] && c.verificationStatus === "pending" && (
                      <details className="group mt-1 rounded border border-border/40 px-2 py-1.5">
                        <summary className="text-[9px] text-muted-foreground cursor-pointer hover:text-foreground list-none [&::-webkit-details-marker]:hidden">
                          Planned checks ({c.expectedVerification.length})
                        </summary>
                        <div className="mt-1.5 space-y-0.5">
                          {c.expectedVerification.map((v, i) => (
                            <p key={i} className="text-[9px] text-muted-foreground">
                              {v}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] font-medium text-muted-foreground block mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] resize-none h-16" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px]" />
      )}
    </div>
  );
}
