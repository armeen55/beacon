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
import { canonicalQueryKey } from "./relevance-gate";

/** Identity must be durable, not unbounded: the anchors one case may carry, and the rows on file. */
const MAX_ANCHORS = 40;
const MAX_CASES = 60;
/** The addresses one case may carry. A case answered by nine of my pages is a case I have not settled. */
const MAX_PAGES = 8;

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
  const out: ResearchCase[] = [];
  for (const unit of [...units, ...dormant.values()]) if (out.length + unit.length <= MAX_CASES) out.push(...unit);
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
 * together and is dropped; a split that would move every search out of a case is a rename and is dropped;
 * a second split of one case in one pass is dropped; and a parent that is the case itself, that already has
 * a different parent, or that closes a loop is dropped. Nothing here can lose a case that was on file.
 */
export function applySynthesis(
  cases: readonly ResearchCase[],
  plan: SynthesisPlan,
  domains: ReadonlyMap<string, readonly string[]> = new Map(),
): { cases: ResearchCase[]; refused: string[] } {
  const refused: string[] = [];
  const live = cases.filter((c) => !c.aliasOf || c.aliasOf === c.id);
  const anchorsOf = new Map(live.map((c) => [c.id, c.anchors]));
  const shares = (a: string, b: string): boolean =>
    (anchorsOf.get(a) ?? []).some((x) => (anchorsOf.get(b) ?? []).includes(x))
    || (domains.get(a) ?? []).some((d) => (domains.get(b) ?? []).includes(d));

  // ── merges: strangers refused, the rest collapsed onto one root ──
  const group = new Map(live.map((c) => [c.id, c.id]));
  const root = (id: string): string => { let at = id; while (group.get(at) !== at) at = group.get(at)!; return at; };
  const joined = new Set<string>();
  for (const m of plan.merges) {
    for (const id of m.absorbIds) {
      if (!anchorsOf.has(m.keepId) || !anchorsOf.has(id) || root(id) === root(m.keepId)) continue;
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

  // ── one fold, through the rule that has always decided identity ──
  const groups = new Map<string, string[]>();
  for (const c of live) {
    const out = new Set(moved.get(c.id) ?? []);
    const at = root(c.id);
    groups.set(at, [...new Set([...(groups.get(at) ?? []), ...c.anchors.filter((a) => !out.has(a))])]);
  }
  const rows = caseRows(foldCases([...[...groups.values()].filter((g) => g.length > 0), ...moved.values()], cases), cases);

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
