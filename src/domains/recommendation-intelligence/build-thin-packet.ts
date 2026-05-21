/**
 * Slice 4.5.E.α₁b₁ (2026-05-21) — pure thin packet builder for the
 * LLM-draft gateway.
 *
 * Builds a minimal `SpecificEditEvidencePacket` from a single
 * recommendation candidate row plus the source PageSnapshot it
 * was derived from. Designed as the bridge between α₁a's weak-H2
 * trigger candidates and α₀'s LLM-draft gateway: the future α₁b₂
 * operator-only action will read a single weak-H2 candidate, build
 * a thin packet via this module, hand it to
 * `draftProposedTextForCandidate(...)`, and surface the result to
 * the operator preview.
 *
 * Why a "thin" packet (sibling, not reuse).
 *   The heavy packet builder exported from
 *   `@/domains/recommendations/specific-edit-evidence` requires the
 *   full upstream pipeline (tracked prompts, opportunities, primary
 *   summaries, observations, page inventory, citation index,
 *   competitor evidence). α₁b₁ does NOT need any of those — the
 *   weak-H2 trigger has already chosen the URL + element, and the
 *   LLM just needs enough context to draft a replacement H2.
 *   Reusing the full builder would force loading hundreds of
 *   irrelevant rows for every operator preview.
 *
 * Abstention contract bypass strategy (per α₁b₁ design lock).
 *   `validateAbstentionContract(packet, edit)` in
 *   `specific-edit-validator.ts` has 4 rules:
 *     • Rule A — low resolution.confidence + empty brandAssertions.
 *       Bypassed by setting `resolution: null` (rule only fires when
 *       resolution is non-null AND its confidence is `"low"`).
 *     • Rule B — all three grounding signals empty
 *       (aiSearchSignal.topSearchQueries + targetPageElements +
 *       brandAssertions). Bypassed by populating
 *       `targetPageElements` with the synthesized H2 block (always)
 *       AND by passing the caller's brandAssertions through
 *       (when present).
 *     • Rule C — single-prompt thin evidence
 *       (affectedPrompts.length === 1, observationCount < 2,
 *       brandPrimaryShare === 0). Bypassed by setting
 *       `affectedPrompts: []` (the rule explicitly only fires on
 *       length-1 arrays).
 *     • Rule D — thin faq_answer
 *       (elementType === "faq_answer", word_count < 30, no observed
 *       descriptors). Bypassed because the builder sets
 *       elementType: "h2" (never faq_answer).
 *
 *   When brandAssertions is empty AND no other grounding is
 *   present, the builder still produces a structurally valid packet
 *   — downstream the validator returns
 *   `abstention_contract_no_grounding_signals` and the gateway
 *   resolves to `validation_failed`. That is the correct, calm
 *   failure path through the existing pipeline; the builder does
 *   NOT throw on empty brandAssertions.
 *
 * Fail-loud preconditions (8). All throw `Error` with a stable
 * prefix `[build-thin-packet]` for grep-ability:
 *   1. `candidate.target_url` is non-null + non-empty + not the
 *      `needs_new_page` sentinel.
 *   2. `candidate.action_type === "rewrite_h2"` (only supported
 *      action type for α₁b₁; future α₁c+ may widen).
 *   3. `candidate.tenant_id` is non-empty.
 *   4. `pageSnapshot.url === candidate.target_url` (canonicalized
 *      string equality — caller is responsible for prior
 *      canonicalization; mismatch indicates a routing bug, not a
 *      missing-feature gap).
 *   5. `pageSnapshot.h2_list` is non-null + non-empty.
 *   6. `candidate.operator_evidence` contains at least one
 *      `h2[<n>]=` token (the weak-h2 predicate format).
 *   7. The parsed H2 index is within `pageSnapshot.h2_list.length`.
 *   8. The H2 text at the parsed index is non-empty / non-blank.
 *
 * Locked field assignments. Mirrors operator-locked α₁b₁ contract:
 *   • schemaVersion: "specific-edit/v1"
 *   • tenantId, recId, clusterId/clusterLabel/clusterKind (see below)
 *   • resolution: null
 *   • affectedPrompts: []
 *   • ownedPageCandidates: [] (LLM doesn't need cluster-matched
 *     candidates when we already chose the exact URL + element)
 *   • targetPageElements: [{ url, elementKey: `h2[<index>]:<sha>`,
 *     elementType: "h2", displayLabel: `H2 #<i+1>`, elementText,
 *     elementMetadata: {} }]
 *   • competitorAngles: []
 *   • priorOutcomes: []
 *   • allowedTargetUrls: [candidate.target_url]
 *   • allowedActionTypes: ["rewrite_h2"]
 *   • aiSearchSignal: empty block (zero caps)
 *   • competitorPageBlueprints: []
 *   • crossTenantPatterns: []
 *   • brandAssertions: pass-through (empty allowed)
 *   • clusterId: null, clusterLabel: null, clusterKind: null
 *   • recId: `"preview-" + candidate.dedupe_key.slice(0, 16)`
 *   • evidenceHash: sha1 of canonical-JSON of the packet sans the
 *     evidenceHash field itself.
 *
 * Pure / deterministic. No I/O. No DB lookups. No LLM calls. No
 * mutation of the input. Returns a fresh packet object.
 *
 * Pinned by:
 *   • tests/domains/recommendation-intelligence/build-thin-packet.test.ts
 *   • tests/architecture/recommendation-intelligence-llm-draft-
 *     gateway-render-isolation.test.ts (proves the builder is not
 *     imported by any customer-facing route)
 */

import { createHash } from "node:crypto";

import type { BusinessConfig } from "@/lib/business-config";
import type { PageSnapshot } from "@/domains/pages/types";
import type {
  BrandAssertion,
  SpecificEditEvidencePacket,
  TargetPageElementBlock,
} from "@/domains/recommendations/specific-edit-evidence";
import { canonicalStringify } from "@/domains/recommendations/evidence-packet";

import type { RecommendationCandidateRow } from "./emitter/candidate-row";

export type BuildThinPacketInput = {
  candidate: RecommendationCandidateRow;
  pageSnapshot: PageSnapshot;
  /** Passed through so the builder is tenant-agnostic; the BusinessConfig
   *  is not directly read by the builder (no fields are needed today)
   *  but accepting it future-proofs the contract for α₁b₂+ which will
   *  surface tenant context to the gateway. */
  businessConfig: BusinessConfig;
  /** Operator-curated brand assertions. Pass `[]` when the tenant has
   *  no curated list — the validator handles the empty-grounding case
   *  via the abstention contract. */
  brandAssertions: ReadonlyArray<BrandAssertion>;
  /** Defaults to `new Date()`; injectable for tests. */
  now?: Date;
};

const ERR = "[build-thin-packet]";
const NEEDS_NEW_PAGE_SENTINEL = "needs_new_page";
const RECID_PREFIX = "preview-";
const RECID_DEDUPE_SLICE_LEN = 16;
const ELEMENT_KEY_HASH_LEN = 12;

/**
 * Extracts every `h2[<index>]=` token from the weak-h2 predicate's
 * `operator_evidence` string and returns the lowest index. Returns
 * `null` when no token is found; throws via the caller's
 * precondition path for malformed inputs.
 *
 * Format reference: see `triggers/weak-h2.ts:130-135` — entries are
 * joined by ` | ` and look like `h2[0]="Why Choose Us"`. We extract
 * the INDEX only and treat `pageSnapshot.h2_list[<index>]` as the
 * source of truth for the H2 text (JSON-escape-tolerant; the
 * predicate's text serialization may be lossy under unusual chars).
 */
function lowestH2IndexFromOperatorEvidence(
  operatorEvidence: string,
): number | null {
  const re = /h2\[(\d+)\]=/g;
  let lowest: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(operatorEvidence)) !== null) {
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isFinite(n) || n < 0) continue;
    if (lowest === null || n < lowest) lowest = n;
  }
  return lowest;
}

export function buildThinPacketForCandidate(
  input: BuildThinPacketInput,
): SpecificEditEvidencePacket {
  const { candidate, pageSnapshot, brandAssertions } = input;
  const now = input.now ?? new Date();

  // ── Preconditions 1–8 (fail-loud) ──────────────────────────────
  // 1. target_url presence + non-sentinel.
  if (
    candidate.target_url === null ||
    candidate.target_url.length === 0 ||
    candidate.target_url === NEEDS_NEW_PAGE_SENTINEL
  ) {
    throw new Error(
      `${ERR} candidate.target_url must be a concrete URL (got: ${JSON.stringify(candidate.target_url)})`,
    );
  }
  // 2. action_type lock.
  if (candidate.action_type !== "rewrite_h2") {
    throw new Error(
      `${ERR} only action_type "rewrite_h2" is supported in α₁b₁ (got: ${candidate.action_type})`,
    );
  }
  // 3. tenant_id presence.
  if (candidate.tenant_id.length === 0) {
    throw new Error(`${ERR} candidate.tenant_id must be non-empty`);
  }
  // 4. snapshot URL match.
  if (pageSnapshot.url !== candidate.target_url) {
    throw new Error(
      `${ERR} pageSnapshot.url (${pageSnapshot.url}) does not match candidate.target_url (${candidate.target_url})`,
    );
  }
  // 5. h2_list non-empty.
  if (
    pageSnapshot.h2_list === null ||
    pageSnapshot.h2_list === undefined ||
    pageSnapshot.h2_list.length === 0
  ) {
    throw new Error(
      `${ERR} pageSnapshot.h2_list must be non-empty for rewrite_h2`,
    );
  }
  // 6. operator_evidence has at least one h2[<n>]= token.
  const h2Index = lowestH2IndexFromOperatorEvidence(
    candidate.operator_evidence,
  );
  if (h2Index === null) {
    throw new Error(
      `${ERR} candidate.operator_evidence missing any "h2[<n>]=" token`,
    );
  }
  // 7. parsed index in range.
  if (h2Index >= pageSnapshot.h2_list.length) {
    throw new Error(
      `${ERR} parsed h2 index ${h2Index} out of range for h2_list length ${pageSnapshot.h2_list.length}`,
    );
  }
  // 8. H2 text at the index is non-blank.
  const elementText = pageSnapshot.h2_list[h2Index] ?? "";
  if (elementText.trim().length === 0) {
    throw new Error(
      `${ERR} pageSnapshot.h2_list[${h2Index}] is blank — refusing to draft`,
    );
  }

  // ── Synthesize the target element ──────────────────────────────
  // element_key shape mirrors the conventional `<type>[<index>]:<hash>`
  // pattern from `page-element-inventory` so the validator's
  // `elementKey` lookup against `packet.targetPageElements` works
  // without invention. Hash is sha1(elementText) sliced to a short
  // prefix for compactness + determinism.
  const contentHash = createHash("sha1")
    .update(elementText)
    .digest("hex")
    .slice(0, ELEMENT_KEY_HASH_LEN);
  const elementKey = `h2[${h2Index}]:${contentHash}`;
  const displayLabel = `H2 #${h2Index + 1}`;

  const targetElement: TargetPageElementBlock = {
    url: candidate.target_url,
    elementKey,
    elementType: "h2",
    displayLabel,
    elementText,
    elementMetadata: {},
  };

  // ── recId — preview-scoped so the gateway cost ledger trace can
  // distinguish operator-preview drafts from production rec drafts. ──
  const recId =
    RECID_PREFIX +
    candidate.dedupe_key.slice(0, RECID_DEDUPE_SLICE_LEN);

  // ── Assemble packet (sans evidenceHash) ────────────────────────
  const withoutHash: Omit<SpecificEditEvidencePacket, "evidenceHash"> = {
    schemaVersion: "specific-edit/v1",
    generatedAt: now.toISOString(),
    tenantId: candidate.tenant_id,
    recId,
    clusterId: null,
    clusterLabel: null,
    clusterKind: null,
    resolution: null,
    affectedPrompts: [],
    ownedPageCandidates: [],
    targetPageElements: [targetElement],
    competitorAngles: [],
    priorOutcomes: [],
    allowedTargetUrls: [candidate.target_url],
    allowedActionTypes: ["rewrite_h2"],
    aiSearchSignal: {
      topSearchQueries: [],
      topDescriptors: [],
      topCompetitorCoMentions: [],
      caps: {
        maxSearchQueries: 0,
        maxDescriptors: 0,
        maxCompetitorCoMentions: 0,
      },
    },
    competitorPageBlueprints: [],
    crossTenantPatterns: [],
    brandAssertions: [...brandAssertions],
  };

  const evidenceHash = createHash("sha1")
    .update(canonicalStringify(withoutHash))
    .digest("hex");

  return { ...withoutHash, evidenceHash };
}
