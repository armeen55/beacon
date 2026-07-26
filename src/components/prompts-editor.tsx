"use client";

/**
 * prompts-editor - THE one editor for the questions I track across AI
 * assistants. Onboarding (Step 5) and Settings render this same component, so a
 * question is picked, reworded, added, and counted by one implementation and the
 * two screens can never disagree.
 *
 * Two trust rules live here. What is already saved wins on load, so returning to
 * the screen never quietly re-checks my recommendation over the operator's own
 * choice. And the checked set re-syncs whenever the incoming list changes, so the
 * counter always names the set that would actually be saved.
 */

import { useEffect, useMemo, useState } from "react";

/** One topic of questions. Onboarding passes its topic groups; Settings passes
 *  exactly one group holding the flat tracked list. */
type EditorGroup = {
  slug: string;
  name: string;
  prompts: { id: string; text: string; recommended: boolean; approved: boolean }[];
};
/** What the editor emits: kept ids keep their measurement history, edits name the
 *  row they replace, additions are brand new wording. */
type EditorSelection = {
  keepIds: string[];
  edits: { id: string; newText: string }[];
  additions: { text: string; groupSlug: string }[];
};

const BTN = "rounded-md bg-foreground text-background px-4 py-2.5 text-[14px] font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const MINI = "text-[12px] underline text-muted-foreground hover:text-foreground";
const INPUT = "flex-1 rounded border border-border/60 bg-background px-2 py-1 text-[13px] outline-none focus:border-foreground/40";
const MIN_TRACKED = 10;
const MAX_TRACKED = 100;

const norm = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function initialIncluded(groups: EditorGroup[]): Set<string> {
  const approved = new Set<string>();
  const recommended = new Set<string>();
  for (const g of groups) for (const p of g.prompts) {
    if (p.approved) approved.add(p.id);
    if (p.recommended) recommended.add(p.id);
  }
  return approved.size > 0 ? approved : recommended;
}

export function PromptsEditor({
  groups, mode, busy, error, submitLabel, onSubmit, extraActions,
}: {
  groups: EditorGroup[];
  mode: "onboarding" | "settings";
  busy?: boolean;
  error?: string | null;
  submitLabel: string;
  onSubmit: (selection: EditorSelection) => void;
  extraActions?: React.ReactNode;
}) {
  const fingerprint = useMemo(
    () => groups.map((g) => g.prompts.map((p) => `${p.id}:${p.approved ? 1 : 0}`).join(",")).join("|"),
    [groups],
  );
  const [included, setIncluded] = useState<Set<string>>(() => initialIncluded(groups));
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [additions, setAdditions] = useState<{ text: string; groupSlug: string }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(mode === "settings" ? (groups[0]?.slug ?? null) : null);
  const [addDraft, setAddDraft] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  useEffect(() => {
    setIncluded(initialIncluded(groups));
    setEdits(new Map()); setAdditions([]); setPasteNote(null); setPasteDraft("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  const textOf = (p: { id: string; text: string }) => edits.get(p.id) ?? p.text;
  const count = useMemo(() => {
    let n = additions.length;
    for (const g of groups) for (const p of g.prompts) if (included.has(p.id)) n += 1;
    return n;
  }, [groups, included, additions]);
  const inBounds = count >= MIN_TRACKED && count <= MAX_TRACKED;

  function toggle(id: string) {
    const next = new Set(included);
    if (next.has(id)) next.delete(id); else next.add(id);
    setIncluded(next);
  }
  function edit(id: string, value: string) {
    const next = new Map(edits); next.set(id, value); setEdits(next);
    if (!included.has(id)) toggle(id);
  }
  function addOne(groupSlug: string) {
    const text = addDraft.trim();
    if (!text) return;
    setAdditions([...additions, { text, groupSlug }]);
    setAddDraft("");
  }
  function applyPaste(groupSlug: string) {
    const known = new Set<string>();
    for (const g of groups) for (const p of g.prompts) if (included.has(p.id)) known.add(norm(textOf(p)));
    for (const a of additions) known.add(norm(a.text));
    const fresh: { text: string; groupSlug: string }[] = [];
    let dupes = 0, blanks = 0;
    for (const raw of pasteDraft.split("\n")) {
      const key = norm(raw);
      if (!key) { blanks += 1; continue; }
      if (known.has(key)) { dupes += 1; continue; }
      known.add(key); fresh.push({ text: raw.trim(), groupSlug });
    }
    setAdditions([...additions, ...fresh]);
    setPasteDraft("");
    const skipped = [dupes > 0 ? `${dupes} you already track` : "", blanks > 0 ? `${blanks} blank line${blanks === 1 ? "" : "s"}` : ""].filter(Boolean);
    setPasteNote(`I added ${fresh.length}.` + (skipped.length > 0 ? ` I skipped ${skipped.join(" and ")}.` : ""));
  }
  function submit() {
    const keepIds: string[] = [];
    const editList: { id: string; newText: string }[] = [];
    for (const g of groups) for (const p of g.prompts) {
      if (!included.has(p.id)) continue;
      const next = edits.get(p.id);
      if (next !== undefined && norm(next) !== norm(p.text)) editList.push({ id: p.id, newText: next });
      else keepIds.push(p.id);
    }
    onSubmit({ keepIds, edits: editList, additions });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {groups.map((g) => {
          const open = mode === "settings" || expanded === g.slug;
          const mine = additions.filter((a) => a.groupSlug === g.slug);
          return (
            <div key={g.slug} className="rounded-lg border border-border/60 bg-surface">
              {mode === "onboarding" ? (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="block text-[13px] font-semibold">{g.name}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {g.prompts.filter((p) => included.has(p.id)).length} of {g.prompts.length} picked
                    </span>
                  </span>
                  <button type="button" onClick={() => { setExpanded(open ? null : g.slug); setAddDraft(""); }} className={MINI}>
                    {open ? "Hide" : "See questions"}
                  </button>
                </div>
              ) : null}
              {open ? (
                <div className={`px-4 py-2 space-y-1 ${mode === "onboarding" ? "border-t border-border/60" : ""}`}>
                  {g.prompts.map((p) => {
                    const changed = norm(textOf(p)) !== norm(p.text);
                    return (
                      <div key={p.id} className="py-0.5">
                        <div className="flex items-center gap-2 text-[13px]">
                          <input type="checkbox" checked={included.has(p.id)} onChange={() => toggle(p.id)}
                            className="accent-foreground" aria-label={`track: ${p.text}`} />
                          <input value={textOf(p)} onChange={(e) => edit(p.id, e.target.value)} className={INPUT} />
                        </div>
                        {changed ? (
                          <p className="pl-6 text-[11px] text-muted-foreground">
                            Changing a question starts a new measurement history for that wording.
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  {mine.map((a, i) => (
                    <div key={`add-${g.slug}-${i}`} className="flex items-center gap-2 text-[13px] py-0.5">
                      <input type="checkbox" checked readOnly className="accent-foreground" aria-label={`added: ${a.text}`} />
                      <span className="flex-1">{a.text} <span className="text-[11px] text-muted-foreground">added</span></span>
                      <button type="button" className={MINI} onClick={() => setAdditions(additions.filter((x) => x !== a))}>Remove</button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <input value={addDraft} onChange={(e) => setAddDraft(e.target.value)} placeholder="Add a question"
                      className={INPUT} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOne(g.slug); } }} />
                    <button type="button" onClick={() => addOne(g.slug)} disabled={!addDraft.trim()} className={MINI}>Add</button>
                  </div>
                  <div className="pt-1">
                    <button type="button" className={MINI} onClick={() => setPasteOpen(!pasteOpen)}>
                      {pasteOpen ? "Hide the paste box" : "Paste a list"}
                    </button>
                    {pasteOpen ? (
                      <div className="pt-1 space-y-1">
                        <textarea value={pasteDraft} onChange={(e) => setPasteDraft(e.target.value)} rows={4}
                          placeholder="One question per line. I ignore blank lines and anything I already track."
                          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-[13px] outline-none focus:border-foreground/40" />
                        <button type="button" className={MINI} onClick={() => applyPaste(g.slug)} disabled={!pasteDraft.trim()}>
                          Add these questions
                        </button>
                        {pasteNote ? <p className="text-[12px] text-muted-foreground">{pasteNote}</p> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-[12px] text-muted-foreground tabular-nums">
        {count} of {MAX_TRACKED}. I need at least {MIN_TRACKED}, and 50 is where I do my best work.
      </p>
      {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={busy || !inBounds} className={BTN}>
          {busy ? "Saving your questions" : submitLabel}
        </button>
        {extraActions}
      </div>
    </div>
  );
}
