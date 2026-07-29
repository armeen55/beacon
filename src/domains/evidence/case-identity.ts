/**
 * evidence/case-identity - ONE durable identity per researched subject, resolved against what is already
 * on file and never recomputed. It answers the only identity question that costs money: "is the answer I
 * bought yesterday still THIS case's answer?". Pure, bounded, and shared by the research packet build and
 * Runtime's reconcile so neither can resolve the same evidence differently from the other.
 *
 * MERGE: an investigation matching two cases on file keeps the id with the most anchors (ties to the
 * smaller id) and records the other as an ALIAS, never a third id. SPLIT: a case is awarded to exactly ONE
 * branch, the one holding the anchor it was minted from, and the genuinely new branch mints exactly one id.
 * Order-independent, so the same evidence always resolves the same way.
 *
 * AN ALIAS IS PART OF THE CASE FOR AS LONG AS THE CASE IS RETAINED. Carrying only the ids absorbed in
 * TODAY'S build meant that the moment the merge was saved, the alias vanished from every derived view: a
 * comparison bought under the absorbed id went invisible and was bought again with real money, and a live
 * new-page proposal filed under it was rebuilt as a second row for one subject. Every retained alias now
 * travels with its canonical case. Chains are FLATTENED and written back flat (A absorbed B, B had already
 * absorbed C, so C points straight at A), so a two-hop id can never fold under a middle id that is no
 * longer a case of its own.
 *
 * BOUNDED: at most MAX_CASES rows on file, and a case is kept or dropped as ONE UNIT with its aliases,
 * because an alias the cap orphaned is paid evidence nobody can find again.
 */

import { createHash } from "node:crypto";

import type { ResearchCase } from "./funnel/research-evidence";

/** Identity must be durable, not unbounded: the anchors one case may carry, and the rows on file. */
const MAX_ANCHORS = 40;
const MAX_CASES = 60;

/** ONE case resolved against the rows on file: the id it keeps, every anchor it is about, and every id it
 *  still answers to (absorbed today, plus every alias those ids already carried). */
export type CaseFold = { id: string; anchors: string[]; aliases: string[] };

const mintCaseId = (keys: readonly string[]): string =>
  `inv_${createHash("sha256").update(keys[0] ?? "").digest("hex").slice(0, 12)}`;

/** Follow an alias to the ONE id it ultimately belongs to. A cycle stops where it started. */
function flatten(id: string, aliasOf: ReadonlyMap<string, string>): string {
  let at = id;
  const seen = new Set([id]);
  for (let next = aliasOf.get(at); next && !seen.has(next); next = aliasOf.get(at)) { seen.add(next); at = next; }
  return at;
}

/** Resolve each group of anchors onto the identities on file (see the header for merge, split and alias). */
export function foldCases(groups: readonly string[][], cases: readonly ResearchCase[]): CaseFold[] {
  const aliasOf = new Map(cases.filter((c) => c.aliasOf && c.aliasOf !== c.id).map((c) => [c.id, c.aliasOf!]));
  const live = new Map<string, { anchors: Set<string>; minted: string }>();
  const kept = new Map<string, Set<string>>();
  for (const c of cases) {
    const id = flatten(c.id, aliasOf);
    const row = live.get(id) ?? { anchors: new Set<string>(), minted: "" };
    for (const a of c.anchors) row.anchors.add(a);
    if (c.id === id && c.anchors[0]) row.minted = c.anchors[0];
    live.set(id, row);
    if (c.id !== id) kept.set(id, (kept.get(id) ?? new Set<string>()).add(c.id));
  }
  const want = groups.map((g) => new Set(g));
  const tag = groups.map((g) => g.join("|"));
  const won = new Map<number, string[]>();
  for (const [id, row] of [...live].sort((a, b) => a[0].localeCompare(b[0]))) {
    let at = -1, best: [number, number, string] = [-1, -1, ""];
    for (let i = 0; i < groups.length; i += 1) {
      const n = [...row.anchors].filter((a) => want[i].has(a)).length;
      const score: [number, number, string] = [want[i].has(row.minted) ? 1 : 0, n, tag[i]];
      if (n === 0 || (at >= 0 && (score[0] < best[0] || (score[0] === best[0] && (score[1] < best[1] || (score[1] === best[1] && score[2] >= best[2])))))) continue;
      at = i; best = score;
    }
    if (at >= 0) won.set(at, [...(won.get(at) ?? []), id]);
  }
  return groups.map((g, i) => {
    const held = (won.get(i) ?? []).sort((a, b) => live.get(b)!.anchors.size - live.get(a)!.anchors.size || a.localeCompare(b));
    const id = held[0] ?? mintCaseId(g);
    return {
      id,
      aliases: [...new Set([...held.slice(1), ...held.flatMap((h) => [...(kept.get(h) ?? [])])])].filter((a) => a !== id).sort(),
      anchors: [...new Set([...held.flatMap((h) => [...live.get(h)!.anchors]), ...g])].slice(0, MAX_ANCHORS),
    };
  });
}

/** The rows to persist: every folded case with its aliases, then the cases this evidence did not reach,
 *  kept exactly as they were (out of today's evidence is not retired). The cap is spent by WHOLE CASE, so
 *  it can drop a case but can never strand an alias of one it keeps, and a live case outranks a dormant one. */
export function caseRows(folded: readonly CaseFold[], onFile: readonly ResearchCase[]): ResearchCase[] {
  const units: ResearchCase[][] = folded.map((f) => [{ id: f.id, anchors: f.anchors },
    ...f.aliases.map((id) => ({ id, anchors: [], aliasOf: f.id }))]);
  const touched = new Set(units.flat().map((c) => c.id));
  const dormant = new Map<string, ResearchCase[]>();
  for (const c of onFile) {
    if (touched.has(c.id)) continue;
    const head = c.aliasOf && !touched.has(c.aliasOf) ? c.aliasOf : c.id;
    dormant.set(head, [...(dormant.get(head) ?? []), c]);
  }
  const out: ResearchCase[] = [];
  for (const unit of [...units, ...dormant.values()]) if (out.length + unit.length <= MAX_CASES) out.push(...unit);
  return out;
}
