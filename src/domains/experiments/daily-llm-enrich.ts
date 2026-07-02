/**
 * daily-llm-enrich (2026-07-01, assistant-first phase 2 slice D-1) — the LLM "write it" pass for the
 * daily batch. At plan time, for each selected candidate, the intent-aware LLM drafts a sharper
 * version of the proposed text (a description or title) grounded in the page + the searcher's intent.
 * The draft REPLACES the deterministic proposedText and is flagged draftSource="llm" so the card can
 * say "Beacon wrote this, edit before you use it". FALLS BACK to the deterministic text on any of:
 * LLM off, budget hit, error, empty, or no-change. Answer-block WRITING (a new add-operation) is a
 * later slice; this one only touches drop-in field edits (meta/title) so the operation is unchanged.
 *
 * PURE orchestration: the drafter is injected, so this is unit-tested with zero paid calls. The real
 * wiring (build-today-preview) passes a drafter backed by the budgeted structured-drafter.
 */

import type { BuiltCandidate } from "./build-daily-candidates";

/** Injected drafter: returns the improved text + a one-line rationale, or null to keep deterministic. */
export type MetaTitleDrafter = (input: {
  query: string;
  pageLabel: string;
  field: "meta" | "title";
  currentValue: string | null;
  intent?: string;
  /** BEACON_500 item 48: the candidate's page url, so the drafter can look up the page's
   *  own cached crawl facts (title/h1/meta/body) and ground the rewrite in them. Optional -
   *  a caller that omits it just gets an ungrounded outline, never an error. */
  url?: string;
}) => Promise<{ text: string; rationale: string } | null>;

/**
 * Enrich the drop-in field candidates (meta/title) in place with an LLM-written version. Never throws
 * (a per-candidate failure keeps the deterministic text). Returns how many were upgraded to "llm".
 */
export async function enrichDailyCandidatesWithLlm(
  cands: BuiltCandidate[],
  intentByUrl: Map<string, string | undefined>,
  draft: MetaTitleDrafter,
): Promise<number> {
  let upgraded = 0;
  await Promise.all(
    cands.map(async (c) => {
      if (c.leverField !== "meta" && c.leverField !== "title") return; // drop-in levers only (D-1)
      const currentValue = c.currentText && c.currentText !== "(none)" ? c.currentText : null;
      let res: Awaited<ReturnType<MetaTitleDrafter>> = null;
      try {
        res = await draft({ query: c.targetQuery, pageLabel: c.pageLabel, field: c.leverField, currentValue, intent: intentByUrl.get(c.url), url: c.url });
      } catch {
        res = null; // fail soft -> keep the deterministic proposal
      }
      const text = res?.text?.trim();
      if (text && text !== (currentValue ?? "").trim() && text !== c.proposedText.trim()) {
        c.proposedText = text;
        c.draftSource = "llm";
        c.llmRationale = res!.rationale?.trim() || undefined;
        upgraded += 1;
      }
    }),
  );
  return upgraded;
}
