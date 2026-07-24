"use client";

/**
 * Step 5 body: topics and AI prompts (Slice 5). Group cards with intent coverage
 * and selected/total counts. The dominant action approves the recommended core;
 * inside an expanded group every prompt has a real include/exclude checkbox, a
 * compact inline edit, and a remove, plus one "add a prompt" box per group. The
 * second action approves that customized selection with its live count.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateCandidatesAction, approvePromptsAction } from "./actions";
import type { OnboardingState } from "@/domains/runtime";

const BTN = "rounded-md bg-foreground text-background px-4 py-2.5 text-[14px] font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const GHOST = "rounded-md border border-border/60 px-4 py-2 text-[13px] font-medium hover:border-foreground/30";
const MINI = "text-[12px] underline text-muted-foreground hover:text-foreground";
const INPUT = "flex-1 rounded border border-border/60 bg-background px-2 py-1 text-[13px] outline-none focus:border-foreground/40";

export function PromptsBody({ prompts }: { prompts: OnboardingState["prompts"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const recommendedIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of prompts.groups) for (const p of g.prompts) if (p.recommended) s.add(p.id);
    return s;
  }, [prompts]);
  const [included, setIncluded] = useState<Set<string>>(recommendedIds);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [additions, setAdditions] = useState<Map<string, string[]>>(new Map());
  const [addDraft, setAddDraft] = useState("");

  const hasCandidates = prompts.candidateCount > 0;

  const textOf = (id: string, fallback: string) => edits.get(id) ?? fallback;
  const selectionCount = useMemo(() => {
    let n = 0;
    for (const g of prompts.groups) for (const p of g.prompts) if (included.has(p.id) && !removed.has(p.id)) n += 1;
    for (const texts of additions.values()) n += texts.length;
    return n;
  }, [prompts, included, removed, additions]);

  function toggleRow(id: string) {
    const next = new Set(included);
    if (next.has(id)) next.delete(id); else next.add(id);
    setIncluded(next);
  }
  function removeRow(id: string) {
    const nr = new Set(removed); nr.add(id); setRemoved(nr);
    const ni = new Set(included); ni.delete(id); setIncluded(ni);
  }
  function saveEdit(id: string) {
    const ne = new Map(edits); ne.set(id, draft.trim()); setEdits(ne);
    const ni = new Set(included); ni.add(id); setIncluded(ni);
    setEditingId(null); setDraft("");
  }
  function addPrompt(slug: string) {
    const t = addDraft.trim();
    if (!t) return;
    const na = new Map(additions); na.set(slug, [...(na.get(slug) ?? []), t]); setAdditions(na);
    setAddDraft("");
  }

  function build() {
    setError(null);
    start(async () => {
      const r = await generateCandidatesAction();
      if (!("ok" in r) || !r.ok) setError("error" in r ? r.error : "I could not build your prompts. Try again.");
      else router.refresh();
    });
  }
  function submit(selection: Parameters<typeof approvePromptsAction>[0]) {
    setError(null);
    start(async () => {
      const r = await approvePromptsAction(selection);
      if (!r.ok) setError(r.error);
      else router.push("/onboard?step=6");
    });
  }
  function approveRecommended() { submit({ useRecommendedDefault: true }); }
  function approveSelection() {
    const approvedIds: string[] = [];
    const editList: Array<{ fromId: string; text: string }> = [];
    for (const g of prompts.groups) for (const p of g.prompts) {
      if (!included.has(p.id) || removed.has(p.id)) continue;
      const e = edits.get(p.id);
      if (e && e !== p.text) editList.push({ fromId: p.id, text: e });
      else approvedIds.push(p.id);
    }
    const additionList: Array<{ groupSlug: string; text: string }> = [];
    for (const [slug, texts] of additions) for (const t of texts) additionList.push({ groupSlug: slug, text: t });
    submit({ approvedIds, edits: editList, additions: additionList });
  }

  if (!hasCandidates) {
    return (
      <div className="space-y-5">
        <p className="text-[14px] text-muted-foreground">
          I will build a broad set of the questions your customers ask AI assistants, then recommend the 50 worth
          tracking first. You approve them in a moment, and you can add, edit, or drop any before you do.
        </p>
        {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}
        <button type="button" onClick={build} disabled={pending} className={BTN}>
          {pending ? "Building your prompts. This takes a moment." : "Build my prompts"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-[14px] text-muted-foreground">
        I built {prompts.candidateCount} prompts across {prompts.groups.length} topics and recommend{" "}
        {prompts.recommendedCount} to track first. Approve the recommendation, or open a topic to pick, edit, and add your own.
      </p>

      <div className="space-y-2">
        {prompts.groups.map((g) => {
          const isOpen = expanded === g.slug;
          const added = additions.get(g.slug) ?? [];
          return (
            <div key={g.slug} className="rounded-lg border border-border/60 bg-surface">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block text-[13px] font-semibold">{g.name}</span>
                  <span className="block text-[12px] text-muted-foreground">{g.recommended} of {g.total} recommended - {g.intent}</span>
                </span>
                <button type="button" onClick={() => { setExpanded(isOpen ? null : g.slug); setAddDraft(""); }} className={MINI}>
                  {isOpen ? "Hide" : "See prompts"}
                </button>
              </div>
              {isOpen ? (
                <div className="border-t border-border/60 px-4 py-2 space-y-1">
                  {g.prompts.filter((p) => !removed.has(p.id)).map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-[13px] py-0.5">
                      <input type="checkbox" checked={included.has(p.id)} onChange={() => toggleRow(p.id)} className="accent-foreground" aria-label="track this prompt" />
                      {editingId === p.id ? (
                        <>
                          <input value={draft} onChange={(e) => setDraft(e.target.value)} className={INPUT} autoFocus />
                          <button type="button" onClick={() => saveEdit(p.id)} className={MINI}>Save</button>
                          <button type="button" onClick={() => { setEditingId(null); setDraft(""); }} className={MINI}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1">{textOf(p.id, p.text)}</span>
                          <button type="button" onClick={() => { setEditingId(p.id); setDraft(textOf(p.id, p.text)); }} className={MINI}>Edit</button>
                          <button type="button" onClick={() => removeRow(p.id)} className={MINI}>Remove</button>
                        </>
                      )}
                    </div>
                  ))}
                  {added.map((t, i) => (
                    <div key={`add-${i}`} className="flex items-center gap-2 text-[13px] py-0.5">
                      <input type="checkbox" checked readOnly className="accent-foreground" aria-label="added prompt" />
                      <span className="flex-1">{t} <span className="text-[11px] text-muted-foreground">added</span></span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <input value={addDraft} onChange={(e) => setAddDraft(e.target.value)} placeholder="Add a prompt to this topic" className={INPUT}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPrompt(g.slug); } }} />
                    <button type="button" onClick={() => addPrompt(g.slug)} disabled={!addDraft.trim()} className={MINI}>Add</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={approveRecommended} disabled={pending} className={BTN}>
          {pending ? "Saving your prompts" : `Approve recommended (${prompts.recommendedCount})`}
        </button>
        <button type="button" onClick={approveSelection} disabled={pending} className={GHOST}>
          Approve my selection ({selectionCount})
        </button>
      </div>
    </div>
  );
}
