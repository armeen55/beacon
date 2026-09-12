import type { BundleComponent, ChangeProposal } from "./contracts";
import { componentIdOf } from "./contracts";
import { COPY_RULES } from "./copy-sanitize";
import type { draftFieldForPage } from "./drafted-copy";
type Piece = Pick<NonNullable<Awaited<ReturnType<typeof draftFieldForPage>>>, "after" | "heading" | "claims" | "supportFacts" | "review" | "gain" | "editor" | "reviewOf"> & { preservation?: ChangeProposal["preservation"] };

/** Writer packet ids are local. Resolve them before combining separately reviewed pieces. */
export function assembleCopy(components: readonly BundleComponent[], pieces: readonly { index: number; copy: Piece }[]) {
  const claims: NonNullable<ChangeProposal["claims"]>[number][] = [], review: NonNullable<ChangeProposal["semanticReview"]>["claims"][number][] = [];
  const supportFacts = new Map<string, NonNullable<ChangeProposal["supportFacts"]>[number]>(), identities = new Map<string, string>();
  const reserved = new Set(pieces.flatMap(({ copy }) => copy.supportFacts.map((f) => f.id)));
  const gains: NonNullable<Piece["gain"]>[] = [], preservation: NonNullable<ChangeProposal["preservation"]>[number][] = [];
  for (const { index, copy } of pieces) {
    const ids = new Map<string, string>();
    for (const fact of copy.supportFacts) {
      const identity = JSON.stringify([fact.id, fact.fact, (fact.sources ?? []).map((s) => [s.url, s.kind]).sort()]);
      let id = identities.get(identity);
      if (!id) {
        id = fact.id;
        if (supportFacts.has(id)) {
          const family = /^(.*)-\d+$/.exec(id)?.[1] ?? (/^(?:target-section|section-after)$/.test(id) ? "page-copy" : id);
          let n = 1; do { id = `${family}-${n++}`; } while (reserved.has(id) || supportFacts.has(id));
        }
        identities.set(identity, id); supportFacts.set(id, { ...fact, id });
      }
      ids.set(fact.id, id);
    }
    const remap = (by: readonly string[]) => by.map((id) => ids.get(id) ?? `${index}:unbanked:${id}`);
    copy.claims.forEach((claim, n) => {
      const ruling = copy.review?.find((r) => r.i === n);
      if (ruling) review.push({ ...ruling, i: claims.length, by: remap(ruling.by), entailed: ruling.entailed && [...ruling.by, ...claim.supportedBy].every((id) => ids.has(id)) });
      claims.push({ ...claim, supportedBy: remap(claim.supportedBy), of: componentIdOf(components[index]!, index) });
    });
    if (copy.gain) gains.push({ ...copy.gain, by: remap(copy.gain.by) });
    preservation.push(...(copy.preservation ?? []).map((p) => ({ ...p, ...(p.by ? { by: remap(p.by) } : {}) })));
  }
  const hashes = new Set(gains.map((g) => g.bodyHash));
  const gain = gains.length === 0 ? null : { adds: gains.map((g) => g.adds).join(" "), by: [...new Set(gains.flatMap((g) => g.by))], pageWhole: gains.every((g) => g.pageWhole),
    ...(hashes.size === 1 && gains[0]!.bodyHash ? { bodyHash: gains[0]!.bodyHash } : {}), ...(gains.length === 1 && gains[0]!.targetHash ? { targetHash: gains[0]!.targetHash } : {}) };
  const editors = pieces.map(({ copy }) => copy.reviewOf === COPY_RULES.pieceKey(copy) && COPY_RULES.accepted(copy.editor) ? copy.editor : undefined);
  const editor = editors.length > 0 && editors.every((e) => e != null) ? { ...editors[0]!, usefulAndNatural: editors.every((e) => e!.usefulAndNatural), notes: editors.map((e) => e!.notes).join(" ").slice(0, 300) } : undefined;
  return { claims, review, supportFacts: [...supportFacts.values()], preservation, gain, editor };
}
