/**
 * Insight layer — Workbench per-page SEO action matrix (Deep Workbench
 * Optimizer, slice 1). PURE, deterministic, NO LLM / paid / SERP calls.
 *
 * Projects one page's EvidencePacket (+ its Change Pack, if a brief exists, +
 * its worst cannibalization case) into a fixed grid of SEO LEVERS — title,
 * meta, H1, intro answer block, H2 sections, visible Q&A, internal links,
 * schema, new page, cannibalization — each carrying: is it needed and why
 * (deterministic, page-grounded), the current value, the proposed draft (from
 * the brief when present; deterministic JSON-LD for schema; an honest
 * "needs the analysis endpoint" when only the borrowed LLM can write the copy
 * — NEVER a fabricated draft), the expected benefit (reusing the same
 * Opportunity estimate the page shows), the publish method, and the risk.
 *
 * REUSES: buildDiagnosisMatrix (status + why), buildOpportunity (benefit +
 * SERP guard), composeJsonLd (deterministic schema), and the pack's
 * already-computed pushability. The ranked "do this first" verdict lives in
 * the sibling workbench-priority.ts (slice 2). change-pack.ts is server-only,
 * so we import only its TYPES (erased) and read pack.pushability DATA — never
 * call its functions here (keeps this module unit-testable + pure).
 */

import type { EvidencePacket } from "@/domains/recommendation-intelligence/page-surgeon/contract";
import {
  composeJsonLd,
  type ChangeArtifact,
} from "@/domains/recommendation-intelligence/page-surgeon/artifact-bundle";
import type {
  AtomicChangePack,
  ArtifactPushability,
  PushMethod,
} from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import {
  buildDiagnosisMatrix,
  type DiagnosisCannibalization,
  type DiagnosisRow,
  type DiagnosisStatus,
} from "./diagnosis-matrix";
import { buildOpportunity } from "./opportunity";

export type LeverKey =
  | "title"
  | "meta"
  | "h1"
  | "answer_block"
  | "h2_sections"
  | "visible_qa"
  | "internal_links"
  | "schema"
  | "new_page"
  | "cannibalization";

/** Where the proposed draft came from. "needs_endpoint" = a real change is
 *  warranted but only the borrowed LLM can write the literal copy (not
 *  configured) — we show the honest line, never a fabricated draft. */
export type ProposedSource = "llm_brief" | "deterministic" | "needs_endpoint" | "n/a";

export type LeverBenefit = {
  estClicksAtStake: number;
  window: "90d";
  confidence: "high" | "medium" | "low";
  serpGuardLabel: string | null;
};

export type WorkbenchLeverRow = {
  lever: LeverKey;
  label: string;
  needed: boolean;
  /** Plain-English, page-grounded reason (from the deterministic diagnosis). */
  whyNeeded: string;
  status: DiagnosisStatus;
  current: string | null;
  proposed: string | null;
  proposedSource: ProposedSource;
  benefit: LeverBenefit | null;
  risk: "low" | "medium" | "high";
  pushMethod: PushMethod;
  pushReason: string;
  canAutoApply: boolean;
  rollbackReady: boolean;
};

export type WorkbenchMatrix = { rows: WorkbenchLeverRow[] };

const LABELS: Record<LeverKey, string> = {
  title: "Title",
  meta: "Meta description",
  h1: "Page headline (H1)",
  answer_block: "Intro answer block",
  h2_sections: "H2 sections / depth",
  visible_qa: "Visible Q&A",
  internal_links: "Internal links",
  schema: "Structured data (schema)",
  new_page: "New page",
  cannibalization: "Cannibalization",
};

/** lever → the Change Pack artifact action that carries its drafted copy. */
const LEVER_ACTION: Record<LeverKey, ChangeArtifact["action"] | null> = {
  title: "title",
  meta: "meta",
  h1: "h1",
  answer_block: "intro_answer_block",
  h2_sections: "section_add",
  visible_qa: "faq",
  internal_links: "internal_link",
  schema: "schema",
  new_page: "create_new_page",
  cannibalization: null,
};

/** lever → the diagnosis-matrix dimension whose status + detail it inherits. */
const LEVER_DIAGNOSIS: Record<LeverKey, DiagnosisRow["key"] | null> = {
  title: "title",
  meta: "meta",
  h1: "h1",
  answer_block: "answer_block",
  h2_sections: "section_content",
  visible_qa: "qa_schema",
  internal_links: "internal_links",
  schema: "qa_schema",
  new_page: null,
  cannibalization: "cannibalization",
};

const CMS_FIELD_LEVERS = new Set<LeverKey>(["title", "meta", "h1", "schema"]);
const BODY_LEVERS = new Set<LeverKey>(["answer_block", "h2_sections", "visible_qa"]);

/** Levers whose movement is CTR/snippet recovery — they carry the page's
 *  Opportunity estimate. Structural levers (schema/links/sections/new page/
 *  cannibalization) move rank/extraction slowly and get no fabricated number. */
const CLICK_LEVERS = new Set<LeverKey>(["title", "meta", "answer_block"]);

const LEVERS: LeverKey[] = [
  "title",
  "meta",
  "h1",
  "answer_block",
  "h2_sections",
  "visible_qa",
  "internal_links",
  "schema",
  "new_page",
  "cannibalization",
];

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function findArtifact(
  pack: AtomicChangePack | null,
  action: ChangeArtifact["action"] | null,
): ChangeArtifact | null {
  if (!pack || !action) return null;
  const all = [pack.bundle.primary, ...pack.bundle.supporting, ...pack.bundle.deferred].filter(
    (a): a is ChangeArtifact => a != null,
  );
  return all.find((a) => a.action === action) ?? null;
}

function artifactProposed(a: ChangeArtifact): string | null {
  if (a.cmsField) return a.cmsField.value;
  if (a.jsonLd) return a.jsonLd.code;
  if (a.faq && a.faq.length > 0) {
    return a.faq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
  }
  if (a.answerBlockText) return a.answerBlockText;
  if (a.internalLinks && a.internalLinks.length > 0) {
    return a.internalLinks.map((l) => `${l.anchor} -> ${l.targetUrl ?? "(pick target)"}`).join("; ");
  }
  if (a.instruction) return a.instruction;
  return a.after;
}

/** Coarse, pure push method when no Change Pack exists (so the matrix renders
 *  a pushability hint without importing the server-only classifier). Mirrors
 *  classifyArtifactPushability's branches at a page level. */
function coarsePush(
  lever: LeverKey,
  packet: EvidencePacket,
): { method: PushMethod; canAutoApply: boolean; rollbackReady: boolean; reason: string } {
  if (lever === "cannibalization" || lever === "new_page") {
    return {
      method: "manual_cms_edit",
      canAutoApply: false,
      rollbackReady: false,
      reason: "Operator decision; no automated write path.",
    };
  }
  if (CMS_FIELD_LEVERS.has(lever)) {
    if (!packet.current.cmsFieldMapped) {
      return {
        method: "blocked_no_mapping",
        canAutoApply: false,
        rollbackReady: false,
        reason: "No Wix CMS mapping for this page yet; connect + map the collection to enable a field push.",
      };
    }
    return {
      method: "wix_cms_field",
      canAutoApply: false,
      rollbackReady: false,
      reason: "Mapped Wix CMS field; draft the copy (analysis endpoint) to enable a one-click push.",
    };
  }
  if (BODY_LEVERS.has(lever)) {
    return {
      method: "no_write_path",
      canAutoApply: false,
      rollbackReady: true,
      reason: "Body-content change; no automated CMS writer yet, apply manually. Reversible.",
    };
  }
  return {
    method: "manual_cms_edit",
    canAutoApply: false,
    rollbackReady: false,
    reason: "No automated write path for this change type; apply manually.",
  };
}

function buildRow(
  lever: LeverKey,
  packet: EvidencePacket,
  pack: AtomicChangePack | null,
  diagByKey: Map<DiagnosisRow["key"], DiagnosisRow>,
  pushByAction: Map<string, ArtifactPushability>,
  pageBenefit: LeverBenefit | null,
): WorkbenchLeverRow {
  const action = LEVER_ACTION[lever];
  const diagKey = LEVER_DIAGNOSIS[lever];
  const diag = diagKey ? diagByKey.get(diagKey) ?? null : null;
  const artifact = findArtifact(pack, action);
  const crawl = packet.crawl;

  // status + whyNeeded from the deterministic diagnosis (honest "unknown"
  // when there's no data to judge). new_page can't be judged deterministically.
  const status: DiagnosisStatus = lever === "new_page" ? "unknown" : diag?.status ?? "unknown";
  const needed = status === "attention" || status === "monitor";
  const whyNeeded =
    lever === "new_page"
      ? "Whether the intent deserves its own page (vs editing this one) needs the analysis endpoint to judge. Not configured yet."
      : diag?.detail ?? "No signal to judge this lever yet.";

  const current =
    lever === "title"
      ? crawl?.title ?? null
      : lever === "meta"
        ? crawl?.metaDescription ?? null
        : lever === "h1"
          ? crawl?.h1 ?? null
          : null;

  // proposed + source. NEVER fabricate copy: a brief artifact, deterministic
  // JSON-LD for schema, or the honest needs-endpoint marker.
  let proposed: string | null = null;
  let proposedSource: ProposedSource = "needs_endpoint";
  if (lever === "cannibalization") {
    proposed = null;
    proposedSource = "n/a";
  } else if (artifact) {
    proposed = artifactProposed(artifact);
    proposedSource = "llm_brief";
  } else if (lever === "schema" && crawl) {
    // Schema is the one structured lever we can ALWAYS draft deterministically
    // from the crawl (no LLM needed).
    proposed = composeJsonLd(packet, undefined).code;
    proposedSource = "deterministic";
  }

  const benefit = CLICK_LEVERS.has(lever) ? pageBenefit : null;

  const risk: WorkbenchLeverRow["risk"] =
    lever === "new_page"
      ? "high"
      : BODY_LEVERS.has(lever) || lever === "cannibalization"
        ? "medium"
        : artifact?.cmsField && !artifact.cmsField.withinLimit
          ? "medium"
          : "low";

  const push = action ? pushByAction.get(action) : undefined;
  const pushInfo = push
    ? {
        method: push.method,
        canAutoApply: push.canAutoApply,
        rollbackReady: push.rollbackReady,
        reason: push.reason,
      }
    : coarsePush(lever, packet);

  return {
    lever,
    label: LABELS[lever],
    needed,
    whyNeeded,
    status,
    current,
    proposed,
    proposedSource,
    benefit,
    risk,
    pushMethod: pushInfo.method,
    pushReason: pushInfo.reason,
    canAutoApply: pushInfo.canAutoApply,
    rollbackReady: pushInfo.rollbackReady,
  };
}

/**
 * Build the fixed 10-lever Workbench action matrix for one page. Pure: pass the
 * assembled EvidencePacket, the page's Change Pack (or null), and the worst
 * cannibalization case (or null). No I/O.
 */
export function buildWorkbenchMatrix(
  packet: EvidencePacket,
  pack: AtomicChangePack | null,
  cannibalization: DiagnosisCannibalization = null,
): WorkbenchMatrix {
  const diag = buildDiagnosisMatrix(packet, cannibalization);
  const diagByKey = new Map(diag.map((r) => [r.key, r] as const));

  const opp = packet.gsc
    ? buildOpportunity({
        canonUrl: packet.current.pageUrl,
        path: pathOf(packet.current.pageUrl),
        gsc: {
          clicks90d: packet.gsc.clicks,
          impressions90d: packet.gsc.impressions,
          ctr90d: packet.gsc.ctr,
          position90d: packet.gsc.avgPosition,
          topQuery: packet.gsc.topQueries[0]?.query,
        },
        serpStatus: "unknown",
      })
    : null;
  const pageBenefit: LeverBenefit | null = opp
    ? {
        estClicksAtStake: opp.estClicksAtStake,
        window: "90d",
        confidence: opp.estConfidence,
        serpGuardLabel: opp.serpGuardLabel,
      }
    : null;

  const pushByAction = new Map<string, ArtifactPushability>(
    (pack?.pushability ?? []).map((p) => [p.action, p] as const),
  );

  const rows = LEVERS.map((lever) =>
    buildRow(lever, packet, pack, diagByKey, pushByAction, pageBenefit),
  );
  return { rows };
}
