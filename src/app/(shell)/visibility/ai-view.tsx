import Link from "next/link";
import { Panel } from "./parts";
import { DataTable } from "./table";
import type { aiView } from "./visibility-view";
import type { fanoutDetail } from "./fanout-detail";

/**
 * The AI answers workspace: how often the assistants name you, who they name instead, what they credit and
 * what they went and searched for before answering. Every number divides by the answers I actually finished
 * checking and says so, and what an assistant never reported stays unreported rather than becoming a zero.
 *
 * DEPTH IS A LINK, NEVER A WALL OF SENTENCES: a question opens into every run behind it, and a run opens into
 * the whole answer, both in the address bar, so any one of them can be sent to somebody.
 */

const RANGES = [7, 28];
const SUBS = [{ key: "prompts", label: "Questions" }, { key: "citations", label: "Sources and citations" }, { key: "searches", label: "Query fan-outs" }, { key: "pages", label: "Pages" }];

function Choices({ options }: { options: Array<{ href: string; label: string; active: boolean }> }) {
  return (
    <div className="inline-flex items-center rounded-full bg-surface-inset/60 p-0.5 ring-1 ring-border/40">
      {options.map((o) => (
        <Link key={o.label} href={o.href} scroll={false} aria-current={o.active ? "true" : undefined}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${o.active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}

/** One short ranked list with the count behind every line, so nothing here passes for agreement it never had. */
function Ranked({ title, items, empty }: { title: string; items: Array<{ text: string; count?: number; basis?: string }>; empty: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-inset/40 px-3 py-2.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {items.length === 0 ? <p className="mt-1 text-[12px] text-muted-foreground">{empty}</p> : (
        <ul className="mt-1.5 space-y-1">
          {items.map((i) => (
            <li key={i.text} className="text-[12px] text-foreground">
              <span className="font-medium">{i.text}</span>
              <span className="text-muted-foreground"> {i.basis ?? `in ${i.count} ${i.count === 1 ? "answer" : "answers"}`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AiWorkspace({ view, range, engine, sub, reading, fanout }: {
  view: ReturnType<typeof aiView>; range: number; engine: string | null; sub: string; reading: string[] | null;
  fanout: ReturnType<typeof fanoutDetail> | null;
}) {
  if (view.empty) return <Panel title="AI answers"><p className="text-[13px] leading-relaxed text-muted-foreground">{view.empty}</p></Panel>;
  // THE THREE DRILL-DOWNS ARE NEVER CARRIED BY ACCIDENT. `prompt`, `reading` and `fanout` all stay out of the
  // base, so any link that does not name one closes it: switching assistant or stretch while a search is open
  // used to leave a key in the address bar pointing at a row that stretch no longer holds.
  const at = (over: Record<string, string>): string => {
    const p = new URLSearchParams({ view: "ai", range: String(range), sub, ...(engine ? { engine } : {}) });
    for (const [k, v] of Object.entries(over)) { if (v === "") p.delete(k); else p.set(k, v); }
    return `?${p.toString()}`;
  };
  const d = view.detail, f = fanout;
  return (
    <div className="space-y-4">
      <Panel title="Where AI answers have you" note={view.watermark} tiles={view.tiles} chart={view.chart}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Choices options={[{ href: at({ engine: "" }), label: "All assistants", active: engine == null },
            ...view.engines.map((e) => ({ href: at({ engine: e.id }), label: e.label, active: engine === e.id }))]} />
          <Choices options={RANGES.map((r) => ({ href: at({ range: String(r) }), label: `${r} days`, active: range === r }))} />
        </div>}>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{view.coverage}</p>
        {view.boundaries.map((b) => <p key={b} className="mt-1 text-[12px] leading-relaxed text-status-warning">{b}</p>)}
      </Panel>

      {/* READ AND PASSED OVER: the one number that says a page of yours was good enough to open and not good enough to quote. It is the whole reason the next change exists, so it gets its own block and a way to act on it. */}
      {view.retrieval ? (
        <Panel title="Read but not credited"
          actions={<Link href="/changes" className="text-[12px] font-semibold text-accent-primary underline underline-offset-2">Take this to Changes</Link>}>
          <p className="text-[28px] font-semibold tabular-nums leading-none tracking-tight text-foreground">{view.retrieval.value}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{view.retrieval.basis}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">{view.retrieval.next}</p>
        </Panel>
      ) : null}

      {view.byEngine ? (
        <Panel title="Every assistant, side by side">
          <DataTable columns={view.byEngine.columns} rows={view.byEngine.rows} empty={view.byEngine.empty} note={view.byEngine.note} />
        </Panel>
      ) : null}

      {d ? (
        <Panel title="One question, every run behind it" note={d.headline}
          actions={<Link href={at({ prompt: "", reading: "" })} className="text-[12px] font-semibold text-accent-primary underline underline-offset-2">Back to all questions</Link>}>
          <p className="text-[15px] font-semibold leading-snug text-foreground">{d.question}</p>
          <div className="mt-3 space-y-4">
            <DataTable columns={d.platforms.columns} rows={d.platforms.rows} empty={d.platforms.empty} note={d.platforms.note} />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <Ranked title="Named instead of or beside you" items={d.rivals} empty="No answer to this question named anybody else." />
              <Ranked title="Pages these answers credited" items={d.sites} empty="No answer to this question said which pages it used." />
              <Ranked title="What the assistant searched for first" items={d.searches} empty="No answer to this question reported a search of its own." />
            </div>
            <DataTable columns={d.executions.columns} rows={d.executions.rows} empty={d.executions.empty} note={d.executions.note} tall />
            {reading ? (
              <div className="rounded-xl border border-accent-primary/40 bg-surface-inset/50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The whole of this one run</h3>
                  <Link href={at({ prompt: d.promptId, reading: "" })} className="text-[12px] font-semibold text-accent-primary underline underline-offset-2">Close</Link>
                </div>
                <div className="mt-2 space-y-1.5">
                  {reading.map((line, i) => <p key={i} className="whitespace-pre-line break-words text-[12px] leading-relaxed text-muted-foreground">{line}</p>)}
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : f ? (
        /* ONE SEARCH, ALL THE WAY DOWN: every wording it was typed with, the questions it came out of, every
           answer that ran it, who took the credit, and the one thing to do about it. */
        <Panel title="One search, and every answer that ran it" note={f.basis}
          actions={<Link href={at({ fanout: "" })} className="text-[12px] font-semibold text-accent-primary underline underline-offset-2">Back to all searches</Link>}>
          <p className="text-[15px] font-semibold leading-snug text-foreground">{f.query}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground">{f.headline}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{f.standing}</p>
          {f.added ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{f.added}</p> : null}
          <div className="mt-3 space-y-4">
            <div className="rounded-xl border border-accent-primary/40 bg-surface-inset/50 px-3 py-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What to do about it</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground">{f.disposition.line}</p>
              {f.disposition.href ? <Link href={f.disposition.href} className="mt-1.5 inline-block text-[12px] font-semibold text-accent-primary underline underline-offset-2">{f.disposition.label}</Link> : null}
            </div>
            <Ranked title="Every wording it was searched with" items={f.wordings} empty="" />
            <DataTable columns={f.parents.columns} rows={f.parents.rows} empty={f.parents.empty} note={f.parents.note} />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <DataTable columns={f.ownPages.columns} rows={f.ownPages.rows} empty={f.ownPages.empty} note={f.ownPages.note} />
              <DataTable columns={f.rivals.columns} rows={f.rivals.rows} empty={f.rivals.empty} note={f.rivals.note} />
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{f.caveat}</p>
            <DataTable columns={f.executions.columns} rows={f.executions.rows} empty={f.executions.empty} note={f.executions.note} tall />
          </div>
        </Panel>
      ) : (
        <Panel title={SUBS.find((s) => s.key === sub)?.label ?? "Questions"}
          actions={<Choices options={SUBS.map((s) => ({ href: at({ sub: s.key }), label: s.label, active: sub === s.key }))} />}>
          {sub === "citations" && view.citations ? <DataTable columns={view.citations.columns} rows={view.citations.rows} empty={view.citations.empty} note={view.citations.note} tall />
            : sub === "searches" && view.searches ? <div className="space-y-3">
              <DataTable columns={view.searches.columns} rows={view.searches.rows} empty={view.searches.empty} note={view.searches.note} tall />
              {view.promptIdeas && view.promptIdeas.length > 0 ? <Ranked title="Questions worth tracking" items={view.promptIdeas} empty="" /> : null}
            </div>
            : sub === "pages" && view.ownedPages ? <DataTable columns={view.ownedPages.columns} rows={view.ownedPages.rows} empty={view.ownedPages.empty} note={view.ownedPages.note} tall />
              : view.prompts ? <DataTable columns={view.prompts.columns} rows={view.prompts.rows} empty={view.prompts.empty} note={view.prompts.note} tall /> : null}
        </Panel>
      )}

      {view.intel ? (
        <Panel title="What the answers themselves keep saying"
          note={`Read off the ${view.intel.answers} answers finished checking. This is the assistants' own reading, and it is where the next change to make comes from.`}
          actions={<Link href="/changes" className="text-[12px] font-semibold text-accent-primary underline underline-offset-2">Take this to Changes</Link>}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Ranked title="Names they keep putting in front of customers" items={view.intel.competitors} empty="No name comes up often enough to call it a pattern." />
            <Ranked title="Shapes of page they keep asking for" items={view.intel.formats} empty="The answers have not asked for a particular kind of page." />
            <Ranked title="Questions they leave unanswered" items={view.intel.omissions} empty="The answers are not leaving an obvious hole to name." />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
