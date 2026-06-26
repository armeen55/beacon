/**
 * implementation-plan (2026-06-25, Sprint 5A/5C/5G) — turn a prepared Move into a
 * durable, structured, SAFE implementation plan. PURE / deterministic / no I/O.
 *
 * The plan answers: what to change, where, what to paste, what to check before/after,
 * how to mark applied, what to log as proof — WITHOUT auto-publishing. Content packs
 * ASSEMBLE existing prepared drafts (Sprint 2 deterministic drafts) — they never
 * fabricate copy; when copy is missing the plan becomes `needs_content_review`.
 *
 * Safety, enforced by a Zod refinement (fail closed):
 *  - A plan may only claim `ready_to_apply` with a non-blocked location, a ready
 *    primary content pack, and real evidence. Otherwise it is downgraded to a
 *    needs-review / blocked status — never a confident-but-wrong instruction.
 *  - Product opportunities stay concept-only (missing_inventory) unless inventory is
 *    verified; licensing/IP risk forces `legal_or_licensing_risk`.
 *  - No CMS write, no publish — the plan is operator instructions only.
 *
 * Pinned by implementation-plan.test.ts.
 */

import { z } from "zod";
import { resolveImplementationLocation, type ResolvedLocation } from "./location-resolver";

export type PlanStatus =
  | "ready_to_apply"
  | "needs_location_review"
  | "needs_content_review"
  | "missing_page_mapping"
  | "missing_inventory"
  | "legal_or_licensing_risk"
  | "insufficient_evidence"
  | "applied"
  | "measuring";

export type ContentPackType =
  | "answer_block"
  | "faq_block"
  | "title_meta"
  | "internal_link"
  | "product_concept_brief"
  | "collection_brief"
  | "schema_jsonld"
  | "image_alt"
  | "page_refresh"
  | "social";

export type MoveForPlan = {
  moveId: string;
  tenantId: string;
  actionType: string;
  targetUrl: string | null;
  targetTitle?: string | null;
  query?: string | null;
  confidence?: "high" | "medium" | "low";
  demand?: number | null;
  pageType?: string | null;
  knownCms?: { system: "wix" | "cms"; field?: string | null } | null;
  // Existing prepared content (any present); never invented downstream.
  draftTitle?: string | null;
  draftMeta?: string | null;
  answerBlock?: string | null;
  faqs?: string[];
  faqJsonLd?: string | null;
  schema?: string[];
  outline?: string[];
  internalLinkTargets?: { anchor: string; url: string }[];
  // Commerce.
  conceptOnly?: boolean;
  licensingRisk?: string | null;
  inventoryVerified?: boolean;
  // Evidence + proof.
  evidence?: string[];
  proofMetrics?: string[];
};

export type ContentPack = {
  type: ContentPackType;
  copy: string;
  charCount: number | null;
  whereToPaste: string;
  why: string;
  evidenceRefs: string[];
  riskNotes: string | null;
  proofSteps: string[];
  /** false ⇒ copy is a skeleton / missing → plan becomes needs_content_review. */
  ready: boolean;
};

export type ImplementationPlan = {
  moveId: string;
  tenantId: string;
  actionType: string;
  targetUrl: string | null;
  targetTitle: string | null;
  targetSystem: ResolvedLocation["system"];
  location: ResolvedLocation;
  status: PlanStatus;
  operatorSteps: string[];
  contentPacks: ContentPack[];
  preChecks: string[];
  postChecks: string[];
  rollback: string[];
  proofPlan: string[];
  riskLevel: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  missingEvidence: string[];
  blockedReason: string | null;
  /** Suggested next-best-action when blocked (still useful). */
  nextBestAction: string | null;
  generatedAt: string | null;
};

// ---- Zod schemas (validate shape + the safety invariant; fail closed) ----------

const ContentPackSchema = z.object({
  type: z.enum([
    "answer_block", "faq_block", "title_meta", "internal_link", "product_concept_brief",
    "collection_brief", "schema_jsonld", "image_alt", "page_refresh", "social",
  ]),
  copy: z.string(),
  charCount: z.number().nullable(),
  whereToPaste: z.string().min(1),
  why: z.string().min(1),
  evidenceRefs: z.array(z.string()),
  riskNotes: z.string().nullable(),
  proofSteps: z.array(z.string()),
  ready: z.boolean(),
});

export const ImplementationPlanSchema = z
  .object({
    moveId: z.string().min(1),
    tenantId: z.string().min(1),
    actionType: z.string().min(1),
    targetUrl: z.string().nullable(),
    targetTitle: z.string().nullable(),
    targetSystem: z.enum(["wix", "cms", "manual", "unknown"]),
    location: z.object({
      system: z.enum(["wix", "cms", "manual", "unknown"]),
      kind: z.string(),
      detail: z.string().min(1),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string(),
      blocked: z.boolean(),
    }),
    status: z.enum([
      "ready_to_apply", "needs_location_review", "needs_content_review", "missing_page_mapping",
      "missing_inventory", "legal_or_licensing_risk", "insufficient_evidence", "applied", "measuring",
    ]),
    operatorSteps: z.array(z.string()).min(1),
    contentPacks: z.array(ContentPackSchema),
    preChecks: z.array(z.string()),
    postChecks: z.array(z.string()),
    rollback: z.array(z.string()).min(1),
    proofPlan: z.array(z.string()),
    riskLevel: z.enum(["low", "medium", "high"]),
    confidence: z.enum(["high", "medium", "low"]),
    missingEvidence: z.array(z.string()),
    blockedReason: z.string().nullable(),
    nextBestAction: z.string().nullable(),
    generatedAt: z.string().nullable(),
  })
  // SAFETY INVARIANT: ready_to_apply may not claim certainty without a real,
  // localizable, paste-ready change. (Soft informational gaps in `missingEvidence`
  // — e.g. "no confirmed CMS field mapping" — are surfaced but don't block, since
  // the operator can still find SEO settings manually. The status machine already
  // requires real demand/evidence before ready_to_apply.)
  .refine(
    (p) => p.status !== "ready_to_apply" || (!p.location.blocked && p.contentPacks.some((c) => c.ready)),
    { message: "ready_to_apply requires a non-blocked location and a ready content pack" },
  );

// ---- Content packs (5C) --------------------------------------------------------

function clip(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Build the primary (+ optional supporting) content pack(s) for a Move. PURE.
 *  Uses EXISTING prepared content; missing copy ⇒ ready:false (no fabrication). */
export function buildContentPacks(move: MoveForPlan, location: ResolvedLocation): ContentPack[] {
  const where = location.detail;
  const ev = move.evidence ?? [];
  const proof = move.proofMetrics ?? [];
  const packs: ContentPack[] = [];
  const a = move.actionType;

  const pushTitleMeta = () => {
    const title = move.draftTitle ? clip(move.draftTitle) : "";
    const meta = move.draftMeta ? clip(move.draftMeta) : "";
    const ready = title.length > 0;
    const copy = ready ? `Title: ${title}${meta ? `\nMeta description: ${meta}` : ""}` : "";
    packs.push({
      type: "title_meta",
      copy,
      // charCount = the FULL paste length (title + meta), matching the answer_block
      // pack + what the operator actually pastes. The SERP title-budget concern is
      // surfaced separately via riskNotes (title > 60 chars).
      charCount: ready ? copy.length : null,
      whereToPaste: where,
      why: "Improve the click-through title / meta for the queries this page ranks for.",
      evidenceRefs: ev,
      riskNotes:
        title.length > 60 ? "Title >60 chars — may truncate in SERPs; trim before pasting." : null,
      proofSteps: ["Capture the old title/meta first (rollback).", ...proof],
      ready,
    });
  };

  if (a === "edit_title" || a === "change_title_meta" || a === "update_title_meta") {
    pushTitleMeta();
  } else if (a === "add_answer_block") {
    const copy = move.answerBlock ? clip(move.answerBlock) : "";
    packs.push({
      type: "answer_block",
      copy,
      charCount: copy ? copy.length : null,
      whereToPaste: where,
      why: "A concise answer block helps win the zero-click / AI-answer slot for this query.",
      evidenceRefs: ev,
      riskNotes: null,
      proofSteps: proof,
      ready: copy.length > 0,
    });
  } else if (a === "add_faq" || a === "faq") {
    const copy = (move.faqs && move.faqs.length > 0)
      ? move.faqs.join("\n\n")
      : move.faqJsonLd
      ? clip(move.faqJsonLd)
      : "";
    packs.push({
      type: "faq_block",
      copy,
      charCount: copy ? copy.length : null,
      whereToPaste: where,
      why: "FAQ content captures long-tail question queries + can earn FAQ rich results.",
      evidenceRefs: ev,
      riskNotes: null,
      proofSteps: proof,
      ready: copy.length > 0,
    });
  } else if (a === "add_schema" || a === "fix_schema") {
    const copy = (move.schema && move.schema.length > 0) ? move.schema.join("\n") : move.faqJsonLd ? move.faqJsonLd : "";
    packs.push({
      type: "schema_jsonld",
      copy,
      charCount: copy ? copy.length : null,
      whereToPaste: where,
      why: "Valid JSON-LD helps search/AI understand the page; eligible for rich results.",
      evidenceRefs: ev,
      riskNotes: "Validate the JSON-LD (Rich Results Test) before publishing.",
      proofSteps: proof,
      ready: copy.length > 0,
    });
  } else if (a === "add_internal_links") {
    const links = move.internalLinkTargets ?? [];
    const copy = links.map((l) => `[${l.anchor}](${l.url})`).join("\n");
    packs.push({
      type: "internal_link",
      copy,
      charCount: copy ? copy.length : null,
      whereToPaste: where,
      why: "Contextual internal links pass relevance + help users/crawlers reach the target.",
      evidenceRefs: ev,
      riskNotes: null,
      proofSteps: proof,
      ready: links.length > 0,
    });
  } else if (a === "create_product" || a === "improve_product_page") {
    const concept = move.query ?? move.targetTitle ?? "product";
    packs.push({
      type: "product_concept_brief",
      copy:
        `PRODUCT CONCEPT (not live inventory): ${concept}\n` +
        `Demand: ${move.demand?.toLocaleString() ?? "n/a"}/mo\n` +
        `Proposed: draft a product-page concept (title/desc/images) — do NOT create a live product or set a price.`,
      charCount: null,
      whereToPaste: location.detail,
      why: "Commerce demand exists; capture it as a concept until inventory/licensing is confirmed.",
      evidenceRefs: ev,
      riskNotes:
        move.licensingRisk ?? "Concept only — confirm you can source/fulfil before listing; no live product is created.",
      proofSteps: ["After (if ever) launched: product-page impressions/clicks (GSC), conversions (GA4)."],
      ready: true, // a concept brief is a valid deliverable (the operator decides build-vs-skip)
    });
  } else if (a === "create_collection" || a === "improve_collection") {
    const concept = move.query ?? move.targetTitle ?? "collection";
    packs.push({
      type: "collection_brief",
      copy:
        `COLLECTION/CATEGORY CONCEPT (no live products attached): ${concept}\n` +
        `Demand: ${move.demand?.toLocaleString() ?? "n/a"}/mo\n` +
        `Proposed: draft a category landing concept (intro copy + which products WOULD belong).`,
      charCount: null,
      whereToPaste: location.detail,
      why: "Category-level demand exists; a collection landing can capture it.",
      evidenceRefs: ev,
      riskNotes: move.licensingRisk ?? "Concept only — no live products attached.",
      proofSteps: ["Collection-page impressions/clicks (GSC) after launch."],
      ready: true,
    });
  } else if (a === "content_refresh" || a === "expand_page" || a === "create_page") {
    const outline = move.outline ?? [];
    const copy = outline.length > 0 ? outline.map((s, i) => `${i + 1}. ${s}`).join("\n") : "";
    packs.push({
      type: "page_refresh",
      copy,
      charCount: copy ? copy.length : null,
      whereToPaste: location.detail,
      why: a === "create_page" ? "Outline for the net-new page." : "Sections to refresh/expand to recover or grow demand.",
      evidenceRefs: ev,
      riskNotes: null,
      proofSteps: proof,
      ready: outline.length > 0,
    });
    if (move.draftTitle) pushTitleMeta();
  } else if (a === "improve_image_seo" || a === "add_image_alt_text") {
    packs.push({
      type: "image_alt",
      copy: "",
      charCount: null,
      whereToPaste: location.detail,
      why: "Descriptive alt text improves image SEO + accessibility.",
      evidenceRefs: ev,
      riskNotes: "Needs the page's image list — not available from demand data; operator-supplied.",
      proofSteps: proof,
      ready: false, // no image inventory available → content review
    });
  }

  return packs;
}

// ---- Status (5G) + builder (5A) -----------------------------------------------

const COMMERCE_ACTIONS = new Set(["create_product", "create_collection", "improve_product_page", "improve_collection"]);

function rollbackFor(actionType: string): string[] {
  switch (actionType) {
    case "edit_title":
    case "change_title_meta":
    case "update_title_meta":
      return ["Before saving, copy the CURRENT title + meta.", "To roll back: paste the old title/meta and save."];
    case "add_answer_block":
    case "add_faq":
    case "faq":
    case "add_internal_links":
      return ["The change is additive.", "To roll back: delete the added block/links and save."];
    case "add_schema":
    case "fix_schema":
      return ["Copy the existing JSON-LD (if any) first.", "To roll back: remove/restore the JSON-LD and save."];
    case "content_refresh":
    case "expand_page":
      return ["Keep a copy of the original section text.", "To roll back: restore the original copy and save."];
    case "create_page":
    case "create_product":
    case "create_collection":
      return ["The draft is net-new and NOT published.", "To roll back: discard the draft (nothing was live)."];
    default:
      return ["Capture the current state before changing.", "To roll back: restore the previous state and save."];
  }
}

function computeStatusAndGaps(
  move: MoveForPlan,
  location: ResolvedLocation,
  packs: ContentPack[],
): { status: PlanStatus; blockedReason: string | null; missingEvidence: string[]; nextBestAction: string | null } {
  const missing: string[] = [];
  const primary = packs[0] ?? null;
  const hasEvidence = (move.evidence?.length ?? 0) > 0 || (move.demand ?? 0) > 0;

  if (!hasEvidence) missing.push("no demand/evidence signal");
  if (!location.blocked && location.confidence === "low") missing.push("low location confidence");
  if (!move.knownCms && location.kind !== "page") missing.push("no confirmed CMS field mapping");
  if (primary && !primary.ready) missing.push("no prepared draft content");

  // Precedence: location blocked → licensing → inventory → content → evidence → ready.
  if (location.blocked) {
    const reason = location.reason === "missing_page_mapping" ? "missing_page_mapping" : "needs_location_review";
    return {
      status: reason,
      blockedReason:
        reason === "missing_page_mapping"
          ? "No target page to apply this to."
          : "Can't pinpoint where to make this change from current evidence.",
      missingEvidence: missing,
      nextBestAction:
        reason === "missing_page_mapping"
          ? "Map this Move to a page (or treat it as a create-page concept)."
          : "Have an operator confirm the exact location, then re-generate the plan.",
    };
  }

  if (COMMERCE_ACTIONS.has(move.actionType) || move.licensingRisk) {
    if (move.licensingRisk) {
      return {
        status: "legal_or_licensing_risk",
        blockedReason: move.licensingRisk,
        missingEvidence: missing,
        nextBestAction: "Confirm licensing/IP rights before treating this as a sellable product.",
      };
    }
    if ((move.actionType === "create_product" || move.actionType === "create_collection") && !move.inventoryVerified) {
      missing.push("no confirmed inventory");
      return {
        status: "missing_inventory",
        blockedReason: "No confirmed inventory — concept only; do not imply the product exists.",
        missingEvidence: missing,
        nextBestAction: "Confirm you can source/fulfil this, then build the concept into a real product page.",
      };
    }
  }

  if (primary && !primary.ready) {
    return {
      status: "needs_content_review",
      blockedReason: "No prepared paste-ready content yet for this Move.",
      missingEvidence: missing,
      nextBestAction: "Run 'Prepare' / draft the content for this Move, then re-generate the plan.",
    };
  }

  if (!hasEvidence) {
    return {
      status: "insufficient_evidence",
      blockedReason: "Not enough demand/evidence to justify acting yet.",
      missingEvidence: missing,
      nextBestAction: "Gather demand evidence (GSC/DataForSEO) before acting.",
    };
  }

  return { status: "ready_to_apply", blockedReason: null, missingEvidence: missing, nextBestAction: null };
}

/**
 * Build a validated implementation plan for a Move. PURE. Fail closed: if the plan
 * fails the Zod safety invariant, it is downgraded to needs_content_review rather
 * than returned as ready.
 */
export function buildImplementationPlan(move: MoveForPlan): ImplementationPlan {
  const location = resolveImplementationLocation({
    actionType: move.actionType,
    targetUrl: move.targetUrl,
    pageType: move.pageType,
    knownCms: move.knownCms ?? null,
  });
  const contentPacks = buildContentPacks(move, location);
  const { status, blockedReason, missingEvidence, nextBestAction } = computeStatusAndGaps(move, location, contentPacks);

  const riskLevel: ImplementationPlan["riskLevel"] = move.licensingRisk
    ? "high"
    : COMMERCE_ACTIONS.has(move.actionType) || location.confidence === "low"
    ? "medium"
    : "low";

  const operatorSteps =
    status === "ready_to_apply"
      ? [
          `Open the target page: ${move.targetUrl ?? "(n/a)"}`,
          `Go to: ${location.detail}`,
          "Paste the content pack below (review first).",
          "Save / publish the change MANUALLY (Beacon does not publish).",
          "Verify the change on the live URL.",
          "Mark applied here so Beacon starts measuring.",
        ]
      : [
          blockedReason ?? "Needs review before applying.",
          nextBestAction ?? "Resolve the gap above, then re-generate this plan.",
        ];

  const plan: ImplementationPlan = {
    moveId: move.moveId,
    tenantId: move.tenantId,
    actionType: move.actionType,
    targetUrl: move.targetUrl,
    targetTitle: move.targetTitle ?? null,
    targetSystem: location.system,
    location,
    status,
    operatorSteps,
    contentPacks,
    preChecks:
      status === "ready_to_apply"
        ? ["Confirm you're on the correct page/section.", "Capture the current state (for rollback).", "Review the paste content for accuracy."]
        : ["Resolve the blocking gap before applying."],
    postChecks:
      status === "ready_to_apply"
        ? ["The change is visible on the live URL.", "No layout/render breakage.", "Marked applied so measurement starts."]
        : [],
    rollback: rollbackFor(move.actionType),
    proofPlan: move.proofMetrics ?? ["GSC clicks/impressions/position before vs 7/14/28d after"],
    riskLevel,
    confidence: move.confidence ?? location.confidence,
    missingEvidence,
    blockedReason,
    nextBestAction,
    generatedAt: null, // stamped by the caller (pure fn can't read the clock)
  };

  // Fail closed: validate the safety invariant.
  const parsed = ImplementationPlanSchema.safeParse(plan);
  if (!parsed.success) {
    return {
      ...plan,
      status: "needs_content_review",
      blockedReason: `Plan failed safety validation: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      nextBestAction: "Re-prepare this Move with complete evidence + content, then re-generate.",
    };
  }
  return plan;
}
