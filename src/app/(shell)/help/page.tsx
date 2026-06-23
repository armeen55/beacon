import { TERM_GLOSSARY, NOTHING_GOES_LIVE_NOTE } from "@/lib/plain-language";

/**
 * Help & glossary (audit Phase 6). A plain-English home for "what does this
 * word mean?" and the core safety promise. Customer-safe: no operator gating,
 * no jargon. The glossary is generated from the shared TERM_GLOSSARY so it
 * stays in lockstep with the term map every other surface imports.
 */
export const dynamic = "force-static";

const REASSURANCE: { q: string; a: string }[] = [
  {
    q: "What does Beacon do?",
    a: "Beacon watches how people find you on Google and in AI search (like ChatGPT), points out the pages worth improving, writes the exact fix, and then checks whether more people found you afterward.",
  },
  {
    q: "Will anything change on my website automatically?",
    a: NOTHING_GOES_LIVE_NOTE + " You review every suggested edit, and nothing is published until you approve it. Beacon saves a copy of the page first, so any change can be undone.",
  },
  {
    q: "Do I need to understand SEO?",
    a: "No. Beacon tells you what is happening in plain English, whether it is good or bad, and what to do next. The glossary below explains any word you are unsure about.",
  },
  {
    q: "How long until I see results?",
    a: "After you make a change, Beacon re-checks the page after about 1, 2, and 4 weeks and compares it to similar pages you did not change, so you can see whether the change actually helped.",
  },
  {
    q: "How do I actually make a change Beacon suggests?",
    a: "If your Wix site is connected and you have turned on one-click publishing, you click \"Make this change\" and Beacon publishes that single edit for you. Otherwise Beacon gives you the exact text to paste: open the page in your Wix editor, find the title, description, or section Beacon names, paste the new text, and save. Then come back and click \"I made this change\" so Beacon starts measuring.",
  },
  {
    q: "Does this cost me anything to run?",
    a: "Using Beacon and reading your connected data does not add charges. The only outside costs are ones you control: a paid data tool you connect on your own plan (like SEMrush or Profound), and a small amount of AI usage when Beacon drafts wording for you. Beacon never spends or buys anything on your behalf.",
  },
];

export default function HelpPage() {
  const glossary = Object.values(TERM_GLOSSARY)
    .filter((e, i, arr) => arr.findIndex((x) => x.plain === e.plain) === i)
    .sort((a, b) => a.plain.localeCompare(b.plain));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          What Beacon does, what is safe, and what the words mean.
        </p>
      </div>

      <section className="mb-8 space-y-4" aria-labelledby="help-basics">
        <h2 id="help-basics" className="text-[15px] font-semibold text-foreground">
          The basics
        </h2>
        <dl className="space-y-3">
          {REASSURANCE.map((r) => (
            <div
              key={r.q}
              className="rounded-lg border border-border/60 bg-surface-inset/20 px-4 py-3"
            >
              <dt className="text-[13px] font-semibold text-foreground">{r.q}</dt>
              <dd className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {r.a}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="help-glossary">
        <h2 id="help-glossary" className="text-[15px] font-semibold text-foreground">
          Glossary
        </h2>
        <p className="mt-1 mb-3 text-[13px] text-muted-foreground">
          Plain-English meanings for the terms you will see around Beacon.
        </p>
        <dl className="divide-y divide-border/50 rounded-lg border border-border/60">
          {glossary.map((e) => (
            <div key={e.plain} className="px-4 py-3">
              <dt className="text-[13px] font-semibold capitalize text-foreground">
                {e.plain}
              </dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                {e.define}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
