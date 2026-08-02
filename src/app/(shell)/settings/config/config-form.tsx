"use client";

import { useState, useTransition } from "react";
import { saveSetup, type SetupView } from "./actions";

const BUSINESS_TYPE_OPTIONS = [
  { value: "local_service", label: "A local business (I serve customers in specific places)" },
  { value: "ecommerce", label: "An online store (I sell products)" },
  { value: "saas", label: "A software product or app" },
  { value: "content_publisher", label: "A publication (articles, guides, an encyclopedia)" },
  { value: "other", label: "Something else" },
];

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/30";
const labelCls = "mb-1.5 block text-[12px] font-medium text-foreground";
const hintCls = "mt-1 text-[11px] text-muted-foreground";

const LIST_HINT = "One per line, or separate them with commas.";

/** The three answers research runs on, then the optional detail. Every label is
 *  a question a stranger can answer about any kind of business. */
const FIELDS: Array<{ key: keyof SetupView; label: string; hint: string; rows: number }> = [
  {
    key: "offeringsText",
    label: "What does your business sell, provide, or publish?",
    hint: `Products, services, or the subjects you write about. ${LIST_HINT}`,
    rows: 5,
  },
  { key: "audiencesText", label: "Who is it for?", hint: `The people you want to reach. ${LIST_HINT}`, rows: 3 },
  {
    key: "topicsToOwnText",
    label: "What should people find you for?",
    hint: `The subjects you want to be the answer to. ${LIST_HINT}`,
    rows: 4,
  },
  {
    key: "geographicScopeText",
    label: "Where do you operate?",
    hint: `Optional. Leave this empty if location does not matter. ${LIST_HINT}`,
    rows: 2,
  },
  {
    key: "competitorsText",
    label: "Competitors you already know",
    hint: `Optional. I also discover competitors from search and AI evidence, so leave this empty if you are not sure. ${LIST_HINT}`,
    rows: 2,
  },
  {
    key: "competitorRulesText",
    label: "Corrections to the competitors I find",
    hint: 'Optional. I work out who your competitors are from your search results and AI answers. Correct me one line at a time: "pin example.com", "exclude example.com", or "example.com is a publisher".',
    rows: 3,
  },
  {
    key: "editorialRulesText",
    label: "Writing or factual rules I must follow",
    hint: "Optional. One rule per line.",
    rows: 3,
  },
  {
    key: "bannedTermsText",
    label: "Forbidden words or claims",
    hint: `Optional. I reject any draft that uses these. ${LIST_HINT}`,
    rows: 2,
  },
];

export function ConfigForm({ initial }: { initial: SetupView }) {
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (k: keyof SetupView) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("idle");
    setError(null);
    startTransition(async () => {
      const res = await saveSetup({
        name: form.name,
        businessType: form.businessType,
        offeringsText: form.offeringsText,
        audiencesText: form.audiencesText,
        topicsToOwnText: form.topicsToOwnText,
        geographicScopeText: form.geographicScopeText,
        competitorsText: form.competitorsText,
        competitorRulesText: form.competitorRulesText,
        editorialRulesText: form.editorialRulesText,
        bannedTermsText: form.bannedTermsText,
      });
      if (res.success) setStatus("saved");
      else {
        setStatus("error");
        setError(res.error ?? "Something went wrong. Try again in a moment.");
      }
    });
  };

  return (
    <form onSubmit={submit} className="mt-6 max-w-xl space-y-5">
      <div>
        <label htmlFor="config-name" className={labelCls}>Business name</label>
        <input id="config-name" className={inputCls} value={form.name} onChange={set("name")} />
      </div>

      <div>
        <label htmlFor="config-domain" className={labelCls}>Website</label>
        <input id="config-domain" className={inputCls + " opacity-60"} value={form.websiteDomain} readOnly disabled />
        <p className={hintCls}>Your website was confirmed during setup. It is the one site Beacon works on.</p>
      </div>

      {FIELDS.map((f) => (
        <div key={f.key}>
          <label htmlFor={`config-${f.key}`} className={labelCls}>{f.label}</label>
          <textarea
            id={`config-${f.key}`}
            className={inputCls}
            rows={f.rows}
            value={form[f.key]}
            onChange={set(f.key)}
          />
          <p className={hintCls}>{f.hint}</p>
        </div>
      ))}

      <div>
        <label htmlFor="config-business-type" className={labelCls}>What kind of business is this?</label>
        <select id="config-business-type" className={inputCls} value={form.businessType} onChange={set("businessType")}>
          <option value="">Choose one</option>
          {BUSINESS_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className={hintCls}>Optional. I research your business the same way either way.</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-4 py-2 text-[13px] font-medium text-background disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {status === "saved" && (
          <span className="text-[12px] text-muted-foreground">
            Saved. This is now your confirmed truth and I research against it.
          </span>
        )}
        {status === "error" && <span className="text-[12px] text-red-600">{error}</span>}
      </div>
    </form>
  );
}
