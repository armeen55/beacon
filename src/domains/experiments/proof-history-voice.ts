/**
 * proof-history-voice (FINAL PREMIUM PLAN item 27) - the ninth deterministic voice in the
 * nightly debate: what the MEASURED ledger already says about this page family + lever family.
 * Two shapes:
 *   - same lever tried before -> the honest tally ("won 1, no clear lift 2")
 *   - a SIBLING lever settled without a win and tonight's lever differs -> the redirection
 *     reasoning out loud ("We tried a title change on similar pages: no lift after the full
 *     window. That is why tonight is a description change, not a title change.")
 * PURE, no I/O. Pinned by proof-history-voice.test.ts.
 */

export type SettledAgg = { won: number; lost: number; flat: number };

export const FAMILY_PLAIN: Record<string, string> = {
  title: "a title change",
  meta: "a description change",
  title_meta: "a title and description change",
  h1: "a headline change",
  answer: "a direct answer",
  link: "an internal link",
  schema: "structured data",
  content: "a content edit",
  new_page: "a new page",
  other: "a change",
};

/** Tally settled (non-measuring) verdicts by `${pageFamily}::${actionFamily}`. */
export function aggregateSettled(
  rows: Array<{ path: string; actionType: string; verdict: string }>,
  familyOfPath: (path: string) => string,
  familyOfAction: (actionType: string) => string,
): Map<string, SettledAgg> {
  const out = new Map<string, SettledAgg>();
  for (const r of rows) {
    if (r.verdict === "measuring") continue;
    const key = `${familyOfPath(r.path)}::${familyOfAction(r.actionType)}`;
    const agg = out.get(key) ?? { won: 0, lost: 0, flat: 0 };
    if (r.verdict === "won") agg.won += 1;
    else if (r.verdict === "lost") agg.lost += 1;
    else agg.flat += 1;
    out.set(key, agg);
  }
  return out;
}

/** The voice's claim for tonight's (pageFamily, actionFamily), or null when history is silent. */
export function proofHistoryLine(
  settled: Map<string, SettledAgg>,
  pageFamily: string,
  actionFamily: string,
): string | null {
  const agg = settled.get(`${pageFamily}::${actionFamily}`);
  if (agg) {
    const parts: string[] = [];
    if (agg.won > 0) parts.push(`won ${agg.won}`);
    if (agg.flat > 0) parts.push(`no clear lift ${agg.flat}`);
    if (agg.lost > 0) parts.push(`hurt ${agg.lost}`);
    return `We already tried this kind of change on similar pages: ${parts.join(", ")}.`;
  }
  // Lever redirection: a sibling lever on this page family settled without a win.
  for (const [key, sib] of settled) {
    const [fam, lever] = key.split("::");
    if (fam !== pageFamily || lever === actionFamily) continue;
    if (sib.won === 0 && sib.flat + sib.lost > 0) {
      const outcome = sib.lost > 0 ? "it hurt" : "no lift after the full window";
      const sibPlain = FAMILY_PLAIN[lever ?? "other"] ?? "a change";
      const tonightPlain = FAMILY_PLAIN[actionFamily] ?? "a different change";
      return `We tried ${sibPlain} on similar pages: ${outcome}. That is why tonight is ${tonightPlain}, not ${sibPlain}.`;
    }
  }
  return null;
}
