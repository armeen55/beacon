"use client";

import { useState, useTransition } from "react";
import { saveSetup, type SetupView } from "./actions";

const BUSINESS_TYPE_OPTIONS = [
  { value: "local_service", label: "A local business (I serve customers in specific places)" },
  { value: "ecommerce", label: "An online store (I sell products)" },
  { value: "saas", label: "A software product or app" },
  { value: "content_publisher", label: "A publication (articles, guides, an encyclopedia)" },
  { value: "other", label: "I'm not sure yet" },
];

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/30";
const labelCls = "mb-1.5 block text-[12px] font-medium text-foreground";
const hintCls = "mt-1 text-[11px] text-muted-foreground";

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
        geographicScopeLine: form.geographicScopeLine,
        offeringsLine: form.offeringsLine,
        competitorsLine: form.competitorsLine,
        editorialRulesLine: form.editorialRulesLine,
        bannedTermsLine: form.bannedTermsLine,
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

      <div>
        <label htmlFor="config-business-type" className={labelCls}>What kind of business is this?</label>
        <select id="config-business-type" className={inputCls} value={form.businessType} onChange={set("businessType")}>
          <option value="">Choose one</option>
          {BUSINESS_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="config-locations" className={labelCls}>Places you serve</label>
        <input id="config-locations" className={inputCls} value={form.geographicScopeLine} onChange={set("geographicScopeLine")} placeholder="Comma separated. Leave blank if location does not matter." />
      </div>

      <div>
        <label htmlFor="config-offerings" className={labelCls}>What you offer</label>
        <input id="config-offerings" className={inputCls} value={form.offeringsLine} onChange={set("offeringsLine")} placeholder="Your products, services, or main topics. Comma separated." />
      </div>

      <div>
        <label htmlFor="config-competitors" className={labelCls}>Your competitors</label>
        <input id="config-competitors" className={inputCls} value={form.competitorsLine} onChange={set("competitorsLine")} placeholder="Comma separated." />
      </div>

      <div>
        <label htmlFor="config-content-rules" className={labelCls}>Writing rules Beacon must follow</label>
        <textarea id="config-content-rules" className={inputCls} rows={3} value={form.editorialRulesLine} onChange={set("editorialRulesLine")} placeholder="One rule per line." />
      </div>

      <div>
        <label htmlFor="config-banned-terms" className={labelCls}>Words Beacon must never use</label>
        <input id="config-banned-terms" className={inputCls} value={form.bannedTermsLine} onChange={set("bannedTermsLine")} placeholder="Comma separated." />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-4 py-2 text-[13px] font-medium text-background disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {status === "saved" && <span className="text-[12px] text-muted-foreground">Saved. I use this on every ranked change.</span>}
        {status === "error" && <span className="text-[12px] text-red-600">{error}</span>}
      </div>
    </form>
  );
}
