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
 * THE REGISTRY IS A PARTITION OF KNOWN ANCHORS, AND THE RULES ONLY PLACE NEW ONES. Unioning groups on any
 * shared anchor made identity a one-way ratchet: merges survived, but a split was re-welded into its parent
 * on the very next pass, and one stale row sharing single anchors with two unrelated live cases cascaded
 * five subjects into one, deterministically. So each known anchor has exactly ONE owner. When two live rows
 * claim one anchor the registry itself is inconsistent, and ownership is awarded to the case holding more of
 * that anchor's rule group (ties to the smaller id) while the loser SHEDS it, out loud; a case shed to
 * nothing becomes an alias of the case that took its last anchor. Each live case then forms exactly one
 * group of exactly its owned anchors, so a merge is durable (the canonical case owns the union) AND a split
 * is durable (parent and branch own disjoint sets the rules may never regroup). A rule-made group's UNOWNED
 * anchors attach to the case owning the plurality of that group's known anchors, and a group nothing owns
 * mints exactly one new case, as ever.
 *
 * BOUNDED: at most MAX_CASES rows on file, and a case is kept or dropped as ONE UNIT with its aliases,
 * because an alias the cap orphaned is paid evidence nobody can find again. Two rows can never leave here
 * claiming ONE id: a duplicate is dropped loudly, because a registry that answers twice for one id is a
 * registry nothing downstream can join against.
 */

import { createHash } from "node:crypto";

import { log } from "@/lib/logger";
import type { ResearchCase } from "./funnel/research-evidence";
import { canonicalQueryKey } from "./relevance-gate";

/** Identity must be durable, not unbounded: the anchors one case may carry, and the rows on file. */
const MAX_ANCHORS = 40;
const MAX_CASES = 60;
/** The addresses one case may carry. A case answered by nine of my pages is a case I have not settled. */
const MAX_PAGES = 8;

/** ONE case resolved against the rows on file: the id it keeps, every anchor it is about, every id it still
 *  answers to (absorbed today, plus every alias those ids already carried), and `from`, the indexes of the
 *  caller's OWN groups this case was folded out of. `from` carries more than one index exactly when the
 *  registry outranked the rules, so the caller builds ONE packet for the one case rather than two. */
export type CaseFold = { id: string; anchors: string[]; aliases: string[]; from: number[] };

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
  // ── the partition: one owner per known anchor, resolved before any group exists ──
  const groupAt = new Map<string, number>();
  groups.forEach((g, i) => { for (const a of g) if (!groupAt.has(a)) groupAt.set(a, i); });
  const owner = new Map<string, string>();
  const lastTaker = new Map<string, string>();
  const claimsIn = (id: string, gi: number | undefined): number =>
    gi == null ? live.get(id)!.anchors.size : groups[gi]!.filter((a) => live.get(id)!.anchors.has(a)).length;
  for (const [id, row] of [...live].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const a of row.anchors) {
      const held = owner.get(a);
      if (!held) { owner.set(a, id); continue; }
      const gi = groupAt.get(a);
      // Group share first; a TIE falls back to the whole case's size, so a one-anchor rule group cannot
      // hand a subset case the anchor its superset owns; only then the smaller id, as a true last resort.
      const size = (x: string): number => live.get(x)!.anchors.size;
      const win = claimsIn(id, gi) !== claimsIn(held, gi) ? (claimsIn(id, gi) > claimsIn(held, gi) ? id : held)
        : size(id) !== size(held) ? (size(id) > size(held) ? id : held) : held < id ? held : id;
      const lose = win === id ? held : id;
      owner.set(a, win); live.get(lose)!.anchors.delete(a); lastTaker.set(lose, win);
      log.warn("[case-identity] two live cases claimed one anchor; ownership resolved and the loser shed it", { anchor: a, kept: win, shed: lose });
    }
  }
  // A case shed to nothing is not deleted: it becomes an alias of the case that ACTUALLY took its last
  // anchor, never of whichever case happens to sort first, because its whole alias chain and every paid
  // answer filed under it migrate with it, and misfiling those onto a stranger is misattribution.
  for (const [id, row] of live) {
    if (row.anchors.size > 0) continue;
    const taker = lastTaker.get(id);
    if (taker && live.has(taker)) { kept.set(taker, (kept.get(taker) ?? new Set<string>()).add(id)); for (const old of kept.get(id) ?? []) kept.get(taker)!.add(old); kept.delete(id); live.delete(id); }
  }
  // ── one group per live case (its owned anchors), then the rules place only what nobody owns ──
  const merged: number[][] = [];
  const united: string[][] = [];
  const caseSeat = new Map<string, number>();
  for (const [id, row] of [...live].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (row.anchors.size === 0) continue;
    caseSeat.set(id, united.length); united.push([...row.anchors].sort()); merged.push([]);
  }
  groups.forEach((g, i) => {
    const unowned = g.filter((a) => !owner.has(a));
    const known = g.filter((a) => owner.has(a));
    for (const a of known) { const seatAt = caseSeat.get(owner.get(a)!); if (seatAt != null && !merged[seatAt]!.includes(i)) merged[seatAt]!.push(i); }
    if (unowned.length === 0) return;
    const tally = new Map<string, number>();
    for (const a of known) tally.set(owner.get(a)!, (tally.get(owner.get(a)!) ?? 0) + 1);
    const host = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    const seatAt = host != null ? caseSeat.get(host) : undefined;
    if (seatAt != null) { united[seatAt] = [...new Set([...united[seatAt]!, ...unowned])].sort(); if (!merged[seatAt]!.includes(i)) merged[seatAt]!.push(i); }
    else { united.push([...unowned].sort()); merged.push([i]); }
  });

  const want = united.map((g) => new Set(g));
  const tag = united.map((g) => g.join("|"));
  const won = new Map<number, string[]>();
  for (const [id, row] of [...live].sort((a, b) => a[0].localeCompare(b[0]))) {
    let at = -1, best: [number, number, string] = [-1, -1, ""];
    for (let i = 0; i < united.length; i += 1) {
      const n = [...row.anchors].filter((a) => want[i].has(a)).length;
      const score: [number, number, string] = [want[i].has(row.minted) ? 1 : 0, n, tag[i]];
      if (n === 0 || (at >= 0 && (score[0] < best[0] || (score[0] === best[0] && (score[1] < best[1] || (score[1] === best[1] && score[2] >= best[2])))))) continue;
      at = i; best = score;
    }
    if (at >= 0) won.set(at, [...(won.get(at) ?? []), id]);
  }
  return united.map((g, i) => {
    const held = (won.get(i) ?? []).sort((a, b) => live.get(b)!.anchors.size - live.get(a)!.anchors.size || a.localeCompare(b));
    const id = held[0] ?? mintCaseId(g);
    return {
      id,
      from: merged[i]!,
      aliases: [...new Set([...held.slice(1), ...held.flatMap((h) => [...(kept.get(h) ?? [])])])].filter((a) => a !== id).sort(),
      anchors: [...new Set([...held.flatMap((h) => [...live.get(h)!.anchors]), ...g])].slice(0, MAX_ANCHORS),
    };
  });
}

/** The rows to persist: every folded case with its aliases, then the cases this evidence did not reach,
 *  kept exactly as they were (out of today's evidence is not retired). The cap is spent by WHOLE CASE, so
 *  it can drop a case but can never strand an alias of one it keeps, and a live case outranks a dormant one. */
export function caseRows(folded: readonly CaseFold[], onFile: readonly ResearchCase[]): ResearchCase[] {
  const prior = new Map(onFile.map((c) => [c.id, c]));
  const canonical = new Map(folded.flatMap((f) => [[f.id, f.id] as const, ...f.aliases.map((a) => [a, f.id] as const)]));
  const units: ResearchCase[][] = folded.map((f) => [{ id: f.id, anchors: f.anchors, ...semanticOf(f, prior, canonical) },
    ...f.aliases.map((id) => ({ id, anchors: [], aliasOf: f.id }))]);
  const touched = new Set(units.flat().map((c) => c.id));
  const dormant = new Map<string, ResearchCase[]>();
  for (const c of onFile) {
    if (touched.has(c.id)) continue;
    const head = c.aliasOf && !touched.has(c.aliasOf) ? c.aliasOf : c.id;
    dormant.set(head, [...(dormant.get(head) ?? []), c]);
  }
  // ONE ROW PER ID, STRUCTURALLY. A Map keyed on id would have hidden this: two rows answering for one case
  // means a downstream join reads whichever it happened to see, so the duplicate is dropped and SAID.
  const out: ResearchCase[] = [], taken = new Set<string>();
  for (const unit of [...units, ...dormant.values()]) {
    const rows = unit.filter((c) => !taken.has(c.id));
    if (rows.length < unit.length) log.warn("[case-identity] two rows claimed one case id; I kept the first and dropped the rest", { dropped: unit.filter((c) => taken.has(c.id)).map((c) => c.id) });
    if (rows.length === 0 || out.length + rows.length > MAX_CASES) continue;
    for (const c of rows) taken.add(c.id);
    out.push(...rows);
  }
  return out;
}

/** WHAT THE SEMANTIC PASS FILED TRAVELS WITH THE CASE, exactly as an alias does: a page filed under an id
 *  this case absorbed is still this case's page, and a parent that has itself been absorbed is followed to
 *  the id that answers for it now. Bounded, and a parent that would make a case its own is dropped, not
 *  guessed. A case nothing was ever filed against carries neither field at all. */
function semanticOf(f: CaseFold, prior: ReadonlyMap<string, ResearchCase>, canonical: ReadonlyMap<string, string>): Partial<ResearchCase> {
  const rows = [f.id, ...f.aliases].map((id) => prior.get(id)).filter((c): c is ResearchCase => !!c);
  const pages: NonNullable<ResearchCase["pages"]> = [];
  for (const p of rows.flatMap((c) => c.pages ?? [])) if (pages.length < MAX_PAGES && !pages.some((x) => x.url === p.url)) pages.push(p);
  const parentId = rows.map((c) => c.parentId).filter((p): p is string => !!p).map((p) => canonical.get(p) ?? p).find((p) => p !== f.id);
  return { ...(pages.length > 0 ? { pages } : {}), ...(parentId ? { parentId } : {}) };
}

/** The semantic reading, structurally. Decision owns the schema and Evidence may never import it, so this
 *  states ONLY the fields the application below actually reads: a reason is for the operator, not for me. */
type SynthesisPlan = {
  merges: readonly { keepId: string; absorbIds: readonly string[] }[];
  splits: readonly { fromId: string; moveQueries: readonly string[] }[];
  pageLinks: readonly { caseId: string; url: string; relation: NonNullable<ResearchCase["pages"]>[number]["relation"] }[];
  parentOf: readonly { parentId: string; childId: string }[];
};

/**
 * Fold an ADVISORY semantic reading into the identities the deterministic pass just proved. Every accepted
 * merge and split runs through `foldCases` above, so the rules that have always governed identity still
 * govern it: one canonical id per case, the absorbed id kept as a durable alias, exactly one new id minted
 * for a genuinely new branch, and no third id anywhere. The reading proposes that two cases are one; WHICH
 * id survives is still the file's own rule, never the model's preference.
 *
 * REFUSED BEFORE APPLIED, deterministically, and returned rather than thrown so the caller can say what it
 * did not accept: a merge of two cases that share no anchor and no result site is two strangers being forced
 * together; a merge naming an id that was already absorbed is refused OUT LOUD rather than silently doing
 * nothing; a split that would empty a case is a rename; a second split of one case in one pass is dropped;
 * and so is a parent that is the case itself, that has a different parent, or that closes a loop. An accepted
 * split SHEDS the moved searches from the case they left, because that row is what the next pass unions
 * against. Nothing here can lose a case that was on file.
 */
export function applySynthesis(
  cases: readonly ResearchCase[],
  plan: SynthesisPlan,
  domains: ReadonlyMap<string, readonly string[]> = new Map(),
): { cases: ResearchCase[]; refused: string[] } {
  const refused: string[] = [];
  const live = cases.filter((c) => !c.aliasOf || c.aliasOf === c.id);
  const anchorsOf = new Map(live.map((c) => [c.id, c.anchors]));
  /** Ids that ARE on file but are no longer a case of their own: naming one is not a no-op worth hiding. */
  const absorbed = new Set(cases.filter((c) => c.aliasOf && c.aliasOf !== c.id).map((c) => c.id));
  const gone = (id: string): string => `${id} ${absorbed.has(id) ? "names a case that was already absorbed into another one" : "is not a case I hold"}`;
  const shares = (a: string, b: string): boolean =>
    (anchorsOf.get(a) ?? []).some((x) => (anchorsOf.get(b) ?? []).includes(x))
    || (domains.get(a) ?? []).some((d) => (domains.get(b) ?? []).includes(d));

  // ── merges: strangers refused, the rest collapsed onto one root ──
  const group = new Map(live.map((c) => [c.id, c.id]));
  const root = (id: string): string => { let at = id; while (group.get(at) !== at) at = group.get(at)!; return at; };
  const joined = new Set<string>();
  for (const m of plan.merges) {
    for (const id of m.absorbIds) {
      // A MERGE NAMING AN ID THAT IS ALREADY AN ALIAS USED TO APPLY AS SILENCE: nothing happened and nothing
      // said so, so the log claimed a reading had been applied in full when half of it named absorbed cases.
      const missing = [m.keepId, id].filter((x) => !anchorsOf.has(x));
      if (missing.length > 0) { refused.push(`I did not join ${m.keepId} and ${id}: ${missing.map(gone).join(", and ")}.`); continue; }
      if (root(id) === root(m.keepId)) continue; // already one case in this same pass: a real no-op
      if (!shares(m.keepId, id)) {
        refused.push(`I did not join ${m.keepId} and ${id}: they share no search and no site, so I hold nothing that says they are one subject.`);
        continue;
      }
      group.set(root(id), root(m.keepId));
      joined.add(id).add(m.keepId);
    }
  }

  // ── splits: ONE new branch per case, and never one that empties it ──
  const moved = new Map<string, string[]>();
  for (const s of plan.splits) {
    const anchors = anchorsOf.get(s.fromId) ?? [];
    const keys = new Set(s.moveQueries.map((q) => canonicalQueryKey(q)).filter(Boolean));
    const out = anchors.filter((a) => keys.has(a));
    const why =
      anchors.length === 0 ? `${s.fromId} is not a case I hold`
        : joined.has(s.fromId) ? `I joined ${s.fromId} to another case in this same pass`
          : moved.has(s.fromId) ? `I already split ${s.fromId} once in this pass`
            : out.length === 0 ? "none of those searches belong to it"
              : out.length === anchors.length ? "that moves every search out of it, which renames a case rather than splitting one"
                : null;
    if (why) { refused.push(`I did not split ${s.fromId}: ${why}.`); continue; }
    moved.set(s.fromId, out);
  }

  // ── the reading EDITS the registry, then one fold normalizes it ──
  // Under the partition, ownership is the registry's and a group can never override it, so an accepted merge
  // must move the absorbed case's anchors onto the keeper's ROW (the absorbed row becoming an alias), and an
  // accepted split must SHED the moved searches from the row they left. The moved searches are then the only
  // unowned anchors in sight, so the fold mints exactly one branch for them and touches nothing else.
  // WHICH ID SURVIVES A MERGE IS THE FILE'S OWN RULE, NEVER THE MODEL'S. The reading only asserts that
  // two cases are one; the survivor of each merged component is the case with the most anchors, ties to
  // the smaller id, exactly as foldCases has always chosen. keepId is advisory in fact, not just in prose.
  const survivorOf = new Map<string, string>();
  for (const c of live) {
    const at = root(c.id);
    const held = survivorOf.get(at);
    if (!held) { survivorOf.set(at, c.id); continue; }
    const better = c.anchors.length !== (anchorsOf.get(held)?.length ?? 0)
      ? (c.anchors.length > (anchorsOf.get(held)?.length ?? 0) ? c.id : held)
      : (c.id < held ? c.id : held);
    survivorOf.set(at, better);
  }
  const keeperOf = (id: string): string => survivorOf.get(root(id)) ?? id;
  const edited = cases.map((c) => {
    if (moved.has(c.id)) return { ...c, anchors: c.anchors.filter((a) => !moved.get(c.id)!.includes(a)) };
    if (anchorsOf.has(c.id) && keeperOf(c.id) !== c.id) return { ...c, anchors: [], aliasOf: keeperOf(c.id) };
    return c;
  }).map((c) => {
    if (!anchorsOf.has(c.id) || keeperOf(c.id) !== c.id) return c;
    const absorbedAnchors = live.filter((x) => x.id !== c.id && keeperOf(x.id) === c.id).flatMap((x) => x.anchors);
    return absorbedAnchors.length > 0 ? { ...c, anchors: [...new Set([...c.anchors, ...absorbedAnchors])] } : c;
  });
  const rows = caseRows(foldCases([...moved.values()], edited), cases);

  // ── what answers this case, and what it sits under ──
  const byId = new Map(rows.map((c) => [c.id, c]));
  const canon = (id: string): string => byId.get(id)?.aliasOf ?? (byId.has(id) ? id : "");
  for (const l of plan.pageLinks) {
    const at = byId.get(canon(l.caseId));
    if (!at) { refused.push(`I did not file ${l.url} under ${l.caseId}: I no longer hold that case.`); continue; }
    at.pages = [...(at.pages ?? []).filter((p) => p.url !== l.url), { url: l.url, relation: l.relation }]
      .sort((a, b) => a.url.localeCompare(b.url)).slice(0, MAX_PAGES);
  }
  for (const p of plan.parentOf) {
    const child = byId.get(canon(p.childId));
    const parent = canon(p.parentId);
    const loop = (at: string, seen = new Set<string>()): boolean => {
      for (let up: string | undefined = at; up && !seen.has(up); up = byId.get(up)?.parentId) { seen.add(up); if (up === child?.id) return true; }
      return false;
    };
    const why = !child || !parent ? "I no longer hold both of those cases"
      : parent === child.id ? "a case cannot sit under itself"
        : child.parentId && child.parentId !== parent ? `${child.id} already sits under ${child.parentId}`
          : loop(parent) ? "that would put the two of them under each other" : null;
    if (why) { refused.push(`I did not file ${p.childId} under ${p.parentId}: ${why}.`); continue; }
    child!.parentId = parent;
  }
  return { cases: rows, refused };
}
