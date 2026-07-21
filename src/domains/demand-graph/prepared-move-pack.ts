/**
 * prepared-move-pack (2026-06-25, P3 - the Prepared Move Pack) - the envelope that
 * carries a Move from "the engine found it" to "ready for you to review and ship":
 * the specialist opinions (P1), the router decision (P2), the proof plan, a
 * deterministic readiness STATE MACHINE, and (later) the structured draft. It
 * COMPOSES the existing EvidencePacket (it stores the evidenceHash + scalars, not
 * a second copy of the packet) so it stays compact and never forks a parallel
 * system. A projected pack persists via `move_drafts` (kind="prepared_pack") - the
 * `kind` column is free text, so NO migration is needed.
 *
 * Sprint 1 packs reach `competitors_read` at most: there is no structured draft
 * yet (that is P4), so `draft_ready` / `proof_ready` / `ready_to_review` are
 * honestly not yet reachable. The state machine reports the TRUE state.
 *
 * PURE / deterministic / no I/O. Pinned by prepared-move-pack.test.ts.
 */

import type { EvidencePacket } from "./evidence-packet";
import type { GapKind } from "./build-graph";
import type { MoveRouterDecision, MoveParentType } from "./move-router";
import type { SpecialistOpinion } from "./specialist-opinions";
import type { ExperimentPlan } from "@/domains/llm/schemas";

/** The readiness chain. Forward-only along the happy path; terminal/recovery
 *  states branch off. Each transition is fired by a concrete code event. */
export type PreparedStatus =
  | "not_ready"
  | "demand_found"
  | "serp_checked"
  | "ai_checked"
  | "competitors_read"
  | "draft_ready"
  | "proof_ready"
  | "ready_to_review"
  | "staged"
  | "shipped"
  | "manual_done"
  | "measuring"
  | "won"
  | "lost"
  | "mixed"
  | "unclear"
  | "stale"
  | "failed";

/** Placeholder for the structured, schema-validated draft (P4). Null in Sprint 1. */
export type StructuredDraft = { kind: string; [k: string]: unknown } | null;

export type ImplementationStep = { step: string; pushMethod: string; done: boolean };

export type PreparedMovePack = {
  version: 1;
  tenantId: string;
  /** = EvidencePacket.move.key (the move_drafts rec_id join key). */
  moveId: string;
  moveType: GapKind;
  parentType: MoveParentType;
  targetUrl: string | null;
  proposedSlug: string | null;
  primaryQuery: string;
  secondaryQueries: string[];
  /** Compact receipt proving which research systems converged before drafting. */
  researchSummary?: {
    evidenceSources: string[];
    keywords: number;
    serpPatterns: number;
    questions: number;
    cloneBriefs: number;
    aiPrompts: number;
    citedPages: number;
  };
  /** The team's opinions (P1) - what each specialist found / objected to. */
  specialistOpinions: SpecialistOpinion[];
  /** The debate outcome (P2). */
  routerDecision: MoveRouterDecision;
  /** Reuse the packet's proof plan directly. */
  proofPlan: EvidencePacket["proofPlan"];
  /** Structured draft (P4) - null until the structured drafter runs. */
  structuredDraft: StructuredDraft;
  /** First-class experiment for this Move (P4 schema) - null until prepared. */
  experiment: ExperimentPlan | null;
  /** Implementation checklist - derived from the draft's operatorSteps (P5). */
  implementationChecklist: ImplementationStep[];
  /** Cost rolled up across the prepare steps (placeholder zeros in Sprint 1). */
  costSpent: { llmUsd: number; serpUsd: number };
  confidence: "high" | "medium" | "low";
  /** = EvidencePacket.evidenceHash (the LEGACY all-or-nothing staleness key -
   *  drifts on any evidence change; retained for packs prepared before
   *  copyBasisHash existed). */
  evidenceHash: string;
  /** = EvidencePacket.copyBasisHash (the copy-only staleness key). Present on
   *  packs prepared on/after 2026-07-20. Absent on legacy packs, which fall back
   *  to evidenceHash equality ONCE and get this stamped on the next prepare. */
  copyBasisHash?: string;
  generatedAt: string;
  staleAt: string;
  preparedStatus: PreparedStatus;
  /** Set when this draft was regenerated USING competitor teardown facts (the trust
   *  signal + recoverability of the prior draft). Absent on normal prepares. */
  regenMeta?: RegenMeta;
  /** R16: the drafter's de-templating guard flagged this draft as a near-copy of
   *  recent same-family drafts ("reads like a repeat"). The draft-quality gate
   *  demotes a ready verdict to needs-review when set. Absent on clean drafts. */
  draftRepeatFlag?: string;
  /** RANK-3: the honest one-line Google-results winnability verdict for this
   *  move, from a live SERP check on the prepare path. Present for BOTH the
   *  winnable case ("The top Google results here are real content you can beat,
   *  so this is worth doing.") and the held case ("The top results are
   *  marketplaces and directories I cannot outrank, so I am holding this..."),
   *  so the card always says why. Absent when no live check ran (dry-run /
   *  cache-empty / unconfigured) - existing behavior, byte-identical. */
  winnabilityLine?: string;
  /** RANK-3: true when the live Google-results check held this move as
   *  effectively unwinnable, so readiness was capped at serp_checked. Absent on
   *  winnable / unchecked moves. */
  winnabilityHold?: boolean;
};

/** Provenance for a teardown-informed regeneration - surfaces the "Competitor-informed"
 *  chip + keeps the prior draft recoverable (move_drafts is insert-only, so the old row
 *  still exists; this also stores a short excerpt + the before/after quality). */
export type RegenMeta = {
  regeneratedFromTeardown: boolean;
  competitorUrl: string | null;
  competitorDomain: string | null;
  previousQuality: string | null;
  newQuality: string | null;
  costUsd: number;
  source: string;
  previousExcerpt: string | null;
  regeneratedAt: string;
};

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 14 * DAY; // align to the DataForSEO SERP cache TTL

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

/** Derive the TRUE readiness state from what's actually attached. Honest by
 *  construction: it can only claim a stage whose evidence exists. The chain is
 *  monotonic - reaching `proof_ready` requires a draft, so Sprint 1 (no draft)
 *  caps at `competitors_read`. */
export function derivePreparedStatus(args: {
  packet: EvidencePacket;
  hasSerpVerdict: boolean;
  hasAiCheck: boolean;
  structuredDraft: StructuredDraft;
  /** RANK-3: a live Google-results check judged this move effectively
   *  unwinnable (marketplace/structural top results, or the winnability numbers
   *  reject it). When true, readiness is CAPPED at `serp_checked` no matter what
   *  else is attached - we never present a confident "ready" draft for a move
   *  that cannot rank. Default false (unset = existing behavior, byte-identical). */
  winnabilityHold?: boolean;
}): PreparedStatus {
  const { packet, hasSerpVerdict, hasAiCheck, structuredDraft } = args;
  const hasDraft = structuredDraft != null;
  const hasProofPlan = (packet.proofPlan?.metrics?.length ?? 0) > 0;
  const competitorsRead = packet.competitor.facts != null;

  // RANK-3 winnability cap: an unwinnable move can climb no higher than
  // serp_checked (it DID get a live Google-results check - that check is exactly
  // what told us to hold). This overrides draft/proof presence so a "ready"
  // draft never masks an unrankable target.
  if (args.winnabilityHold) return "serp_checked";

  // Walk the chain top-down; return the highest stage whose prerequisites hold.
  if (hasDraft && hasProofPlan) return "ready_to_review"; // P5+: draft + proof + everything
  if (hasDraft) return "draft_ready"; // P4: structured draft exists
  if (competitorsRead) return "competitors_read";
  if (hasAiCheck) return "ai_checked";
  if (hasSerpVerdict) return "serp_checked";
  return "demand_found"; // the packet itself proves demand
}

export type BuildPreparedMovePackInput = {
  tenantId: string;
  packet: EvidencePacket;
  opinions: SpecialistOpinion[];
  decision: MoveRouterDecision;
  nowIso?: string;
  hasSerpVerdict?: boolean;
  hasAiCheck?: boolean;
  structuredDraft?: StructuredDraft;
  experiment?: ExperimentPlan | null;
  implementationChecklist?: ImplementationStep[];
  costSpent?: { llmUsd: number; serpUsd: number };
  ttlMs?: number;
  regenMeta?: RegenMeta;
  /** R16: thread the drafter's "reads like a repeat" flag onto the pack. */
  draftRepeatFlag?: string;
  /** RANK-3: the live Google-results winnability line (winnable or held). */
  winnabilityLine?: string;
  /** RANK-3: cap readiness at serp_checked (unwinnable target). */
  winnabilityHold?: boolean;
};

/** Assemble a PreparedMovePack from a Move's packet + the team's opinions + the
 *  router decision. Pure. */
export function buildPreparedMovePack(input: BuildPreparedMovePackInput): PreparedMovePack {
  const { tenantId, packet, opinions, decision } = input;
  const nowIso = input.nowIso ?? new Date().toISOString();
  const baseMs = Number.isFinite(Date.parse(nowIso)) ? Date.parse(nowIso) : Date.now();
  const structuredDraft = input.structuredDraft ?? null;

  const preparedStatus = derivePreparedStatus({
    packet,
    hasSerpVerdict: input.hasSerpVerdict ?? false,
    hasAiCheck: input.hasAiCheck ?? false,
    structuredDraft,
    winnabilityHold: input.winnabilityHold ?? false,
  });

  const isCreate = packet.move.gapType === "create_page";

  return {
    version: 1,
    tenantId,
    moveId: packet.move.key,
    moveType: packet.move.gapType,
    parentType: decision.parentType,
    targetUrl: packet.yourPage.url,
    proposedSlug: isCreate ? slugify(packet.move.label) : null,
    primaryQuery: packet.move.label,
    secondaryQueries: [...new Set([
      ...packet.demand.queries.map((row) => row.query),
      ...(packet.demand.fanoutSeeds ?? []),
      ...(packet.research?.questions ?? [])
        .filter((row) => row.coverageStatus !== "answered")
        .map((row) => row.question),
    ])].filter((query) => query.toLocaleLowerCase("en-US") !== packet.move.label.toLocaleLowerCase("en-US")),
    ...(packet.research
      ? {
          researchSummary: {
            evidenceSources: packet.research.evidenceSources,
            keywords: packet.research.keywords.length,
            serpPatterns: packet.research.serpPatterns.length,
            questions: packet.research.questions.length,
            cloneBriefs: packet.research.cloneBriefs.length,
            aiPrompts: packet.research.ai?.promptCount ?? 0,
            citedPages: packet.research.ai?.topCitedPages.length ?? 0,
          },
        }
      : {}),
    specialistOpinions: opinions,
    routerDecision: decision,
    proofPlan: packet.proofPlan,
    structuredDraft,
    experiment: input.experiment ?? null,
    implementationChecklist: input.implementationChecklist ?? [],
    costSpent: input.costSpent ?? { llmUsd: 0, serpUsd: 0 },
    confidence: decision.confidenceLevel,
    evidenceHash: packet.evidenceHash,
    ...(packet.copyBasisHash ? { copyBasisHash: packet.copyBasisHash } : {}),
    generatedAt: nowIso,
    staleAt: new Date(baseMs + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    preparedStatus,
    ...(input.regenMeta ? { regenMeta: input.regenMeta } : {}),
    ...(input.draftRepeatFlag ? { draftRepeatFlag: input.draftRepeatFlag } : {}),
    ...(input.winnabilityLine ? { winnabilityLine: input.winnabilityLine } : {}),
    ...(input.winnabilityHold ? { winnabilityHold: true } : {}),
  };
}

/**
 * Two-tier, VERIFICATION-BASED age bounds (2026-07-20 redesign).
 *
 * MAX_PACK_AGE_MS (14d) - the UNVERIFIABLE-basis horizon. When we cannot confirm
 * the copy against the page's CURRENT signals (no live packet, or a legacy pack
 * that predates copyBasisHash and stores no basis we could recompute), a
 * two-week-old draft deserves a fresh look. Aligned to the DataForSEO SERP cache
 * TTL.
 *
 * VERIFIED_MAX_PACK_AGE_MS (45d) - the VERIFIED-basis horizon. When the pack's
 * copyBasisHash still MATCHES the page's current title/H1/action/query, the copy
 * is provably unchanged, so age alone must not discard it: it stays valid out to
 * the crawl-evidence confidence horizon (45 days), the pack's own 14-day TTL
 * notwithstanding. Beyond 45 days we re-check even verified copy.
 */
const MAX_PACK_AGE_MS = 14 * DAY;
const VERIFIED_MAX_PACK_AGE_MS = 45 * DAY;

/** What the live build knows about a Move's current inputs, for the staleness
 *  comparison. `null` means there is NO live packet for this row (the URL-fallback
 *  join path) - then only the age/TTL bounds apply and the persisted copy governs
 *  itself. A structural subset of EvidencePacket so a whole packet can be passed. */
export type CurrentPackInputs = { evidenceHash: string; copyBasisHash?: string | null } | null | undefined;

/**
 * A pack is stale when its PREPARED COPY is no longer valid, or it aged out.
 * Verification-based two-tier contract (2026-07-20), replacing the old all-or-
 * nothing evidenceHash equality that discarded perfectly good drafts whenever any
 * evidence context (competitor facts, dossier hash, demand query-share) drifted:
 *
 *   (A) VERIFIABLE basis - BOTH the pack and the live page expose a copyBasisHash.
 *       The copy's validity is checked DIRECTLY against current signals; volatile
 *       evidence context is never consulted.
 *         - mismatch => the title/H1/action/query the copy was written against
 *                       changed => STALE now, at any age.
 *         - match    => provably unchanged => FRESH out to the hard 45-day
 *                       crawl-evidence horizon, regardless of the 14-day TTL.
 *   (B) UNVERIFIABLE basis - no live packet, a copyBasisHash missing on either
 *       side, or a legacy pack. The copy cannot be confirmed against current
 *       signals, so the honest 14-day age bound (plus the pack's own staleAt TTL)
 *       governs. We deliberately do NOT discard the copy on volatile evidence
 *       drift here: a legacy pack stores no basis we could recompute, and folding
 *       in evidence CONTEXT was the exact bug this redesign removes. After the
 *       next prepare stamps copyBasisHash, the pack upgrades to tier (A).
 */
export function isPackStale(pack: PreparedMovePack, current: CurrentPackInputs, nowIso?: string): boolean {
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const genMs = Date.parse(pack.generatedAt);
  const ageMs = Number.isFinite(genMs) ? now - genMs : 0;

  // (A) Verifiable basis: compare the copy-only key against the live page.
  if (current && pack.copyBasisHash != null && current.copyBasisHash != null) {
    if (pack.copyBasisHash !== current.copyBasisHash) return true;
    // Verified unchanged: valid to the 45-day horizon, age/TTL notwithstanding.
    return ageMs > VERIFIED_MAX_PACK_AGE_MS;
  }

  // (B) Unverifiable basis: the honest 14-day age bound + the pack's own TTL.
  if (ageMs > MAX_PACK_AGE_MS) return true;
  if (Number.isFinite(Date.parse(pack.staleAt)) && now > Date.parse(pack.staleAt)) return true;
  return false;
}

/** Projection for durable storage. The pack is already compact (it references the
 *  packet by hash, never embeds it), so this is near-identity - it exists as the
 *  single choke point for any future size trimming, and pairs with parse below.
 *  G6 (2026-07-10): the replacer DROPS any transient `fetchedText` a source
 *  carries. That full-page text (up to 200 KB) is set at generation time ONLY, to
 *  let per-claim coverage back a roundup; it is never part of SourceRefSchema and
 *  must never reach a store - stripping it here is the single, load-bearing choke
 *  point (and keeps the pack under the persist size cap). */
export function toPersistedPack(pack: PreparedMovePack): string {
  return JSON.stringify(pack, (key, val) => (key === "fetchedText" ? undefined : val));
}

/**
 * FALLBACK JOIN (2026-07-20) - index persisted prepared packs that are THEMSELVES
 * ready_to_review by their own canonical target URL, so a Move row whose live
 * packet went missing can still surface its persisted ready draft (see
 * today-moves-data.ts). This is the orphaned-by-join fix: the packet-first draft
 * lookup keys on move.key, so a valid ready draft was invisible whenever the live
 * build emitted no packet for that URL.
 *
 * Only ready_to_review packs are indexed - this join NEVER fabricates readiness.
 * Newest-wins is the caller's responsibility: feed rows newest-first (the
 * move_drafts loader already returns them that way) and the first pack per URL is
 * kept. `canon` is injected so the store owns no URL policy. PURE.
 */
export function indexReadyPacksByUrl(
  rows: Iterable<{ kind: string; content: string }>,
  canon: (url: string | null | undefined) => string,
): Map<string, PreparedMovePack> {
  const out = new Map<string, PreparedMovePack>();
  for (const row of rows) {
    if (row.kind !== "prepared_pack") continue;
    const pack = parsePreparedPack(row.content);
    if (!pack || pack.preparedStatus !== "ready_to_review") continue;
    const u = canon(pack.targetUrl);
    if (!u || out.has(u)) continue;
    out.set(u, pack);
  }
  return out;
}

/**
 * Pick the persisted pack for a Move row under the fallback-join contract. The
 * packet-key match wins - EXCEPT when it is itself regressed (not ready) or stale
 * while a ready + valid URL-indexed pack exists for the same URL: a genuinely
 * ready draft must never be shadowed by a packet-keyed pack that lost its draft
 * (e.g. a re-prepare that only reached competitors_read) or aged out. When the
 * packet-key join misses entirely, the URL-keyed ready pack is used.
 *
 * A draft for URL X can never attach to a row for URL Y: the index is keyed by
 * each pack's own canonical target and looked up by the row's canonical target,
 * so `readyByUrl.get(rowCanonUrl)` can only return a pack whose canonical target
 * equals the row's. PURE.
 *
 * `isReadyAndValid` decides whether a candidate is ready + fresh (the caller
 * supplies the staleness check, which needs the live packet + clock). It defaults
 * to treating every pack as ready + valid, preserving the original packet-key-wins
 * behavior when the caller does not supply a verdict.
 */
export function selectPersistedPackForRow(args: {
  packetKeyedPack: PreparedMovePack | null;
  readyByUrl: Map<string, PreparedMovePack>;
  rowCanonUrl: string;
  isReadyAndValid?: (pack: PreparedMovePack) => boolean;
}): PreparedMovePack | null {
  const urlPack = args.readyByUrl.get(args.rowCanonUrl) ?? null;
  const ok = args.isReadyAndValid ?? (() => true);
  if (args.packetKeyedPack) {
    // Prefer the packet-key match when it is itself ready + valid.
    if (ok(args.packetKeyedPack)) return args.packetKeyedPack;
    // Regressed/stale packet-keyed pack: a ready + valid URL-indexed pack wins so
    // a real ready draft is never shadowed. Otherwise keep the packet-keyed pack
    // (its non-ready status is the honest current state of preparation).
    if (urlPack && ok(urlPack)) return urlPack;
    return args.packetKeyedPack;
  }
  return urlPack;
}

/**
 * ROW-EXISTENCE fallback (2026-07-20). The URL-fallback join can only lift an
 * EXISTING move row; a URL whose only surfaced evidence is a persisted READY
 * prepared pack - with no live queue row at all - would still render nothing.
 * Prepared work is sunk cost and immediately executable, so it must surface even
 * when its demand rank never earned a worklist row.
 *
 * Returns the { url, pack } to synthesize a surfaced row for: every entry in
 * `readyByUrl` that is (1) not already a row (`existingRowUrls`, canonical) and
 * (2) still valid under the caller's freshness predicate (an aged-out ready pack
 * must not resurface as a live "ready" row). PURE.
 */
export function unsurfacedReadyPackUrls(args: {
  readyByUrl: Map<string, PreparedMovePack>;
  existingRowUrls: ReadonlySet<string>;
  isFresh: (pack: PreparedMovePack) => boolean;
}): Array<{ url: string; pack: PreparedMovePack }> {
  const out: Array<{ url: string; pack: PreparedMovePack }> = [];
  for (const [url, pack] of args.readyByUrl) {
    if (!url || args.existingRowUrls.has(url)) continue;
    if (!args.isFresh(pack)) continue;
    out.push({ url, pack });
  }
  return out;
}

/** Parse a persisted pack. Fail-soft → null on any malformed/legacy content. */
export function parsePreparedPack(content: string | null | undefined): PreparedMovePack | null {
  if (!content) return null;
  try {
    const obj = JSON.parse(content) as PreparedMovePack;
    if (!obj || obj.version !== 1 || !obj.moveId || !obj.routerDecision) return null;
    return obj;
  } catch {
    return null;
  }
}
