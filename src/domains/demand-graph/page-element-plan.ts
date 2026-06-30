/**
 * page-element-plan (2026-06-29) — P4: turn "this page should own X" into "put X HERE."
 *
 * PURE. Composes a PageResearchPack (which keyword → which element, which lever, proof
 * constraints) with the live SERP "what wins" pattern + Clarity friction + the page's
 * current title into a concrete on-page element plan: title / meta / H1 / H2 sections /
 * FAQ + answer-block targets / internal-link anchors / schema / UX fix / new sibling.
 *
 * SENIOR RULES (enforced here):
 *  - EVERY element carries `evidence` citing a real signal (GSC query/rank, DataForSEO
 *    volume, SERP pattern, AI fan-out, proof outcome, Clarity friction). No generic recs.
 *  - A lever proof says came back FLAT here can never be `doFirst` (it's surfaced under
 *    `warnings` as "try a different lever").
 *  - A page mid-measurement gets a compounding warning (a second edit muddies the proof).
 *
 * No LLM, no paid call, no I/O — the projection layer passes the live signals in.
 */

import type { PageResearchPack, ResearchLever } from "./page-research-pack";

export type PageElementSlot =
  | "title"
  | "meta"
  | "h1"
  | "h2"
  | "faq"
  | "answer_block"
  | "internal_link"
  | "schema"
  | "ux_fix"
  | "new_sibling";

export type PlanElement = {
  slot: PageElementSlot;
  /** What to put / do, concretely. */
  recommendation: string;
  /** WHY — cites the real signal (GSC / volume / SERP / fan-out / proof / Clarity). */
  evidence: string;
};

export type PageElementPlan = {
  /** The single highest-leverage element to change first (the primary, unblocked lever). */
  doFirst: PlanElement | null;
  title: PlanElement | null;
  meta: PlanElement | null;
  h1: PlanElement | null;
  /** H2 sections to add for owned sub-intents. */
  sections: PlanElement[];
  /** FAQ / answer-block targets (the AI fan-out questions this page should answer). */
  faqs: PlanElement[];
  /** Cross-link anchors to sibling pages (don't merge). */
  internalLinks: PlanElement[];
  schema: PlanElement | null;
  uxFix: PlanElement | null;
  /** Sub-intents strong enough to deserve their own new page. */
  newSiblings: PlanElement[];
  /** Compounding / measuring / lost-lever cautions. */
  warnings: string[];
};

export type OnPagePlanOpts = {
  serpPattern?: {
    format: string;
    titlePattern?: string | null;
    elementImplication?: string | null;
    winningDomains?: string[];
  } | null;
  friction?: { deadPct: number; ragePct: number } | null;
  currentTitle?: string | null;
  /** Cached (real) keyword volume — cites "~Nk searches/mo" when present, never guesses. */
  volumeByKeyword?: Map<string, number | null> | Record<string, number | null> | null;
};

const titleCase = (s: string): string =>
  s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAi\b/g, "AI");

function volOf(
  kw: string,
  vol: OnPagePlanOpts["volumeByKeyword"],
): number | null {
  if (!vol) return null;
  const k = kw.trim().toLowerCase();
  const v = vol instanceof Map ? vol.get(k) : vol[k];
  return typeof v === "number" && v > 0 ? v : null;
}

const fmtVol = (n: number): string => (n >= 1000 ? `~${Math.round(n / 1000)}k` : `~${n}`);

/** Map a SERP format → the schema type that format rewards. */
function schemaForFormat(format: string): string {
  switch (format) {
    case "faq":
      return "FAQPage";
    case "table":
      return "Table + HowTo";
    case "product":
      return "Product";
    case "list":
      return "ItemList";
    case "ugc":
      return "QAPage";
    default:
      return "Article";
  }
}

/** The proof "family" a lever belongs to (mirrors page-research-pack's leverFamily). */
function leverFamily(l: ResearchLever): string {
  if (l === "title_meta") return "title_meta";
  if (l === "answer_block" || l === "schema") return "aeo";
  if (l === "internal_links") return "links";
  if (l === "ux_fix") return "cro";
  return "content";
}

/**
 * Build the concrete on-page element plan. PURE.
 */
export function buildOnPagePlan(pack: PageResearchPack, opts: OnPagePlanOpts = {}): PageElementPlan {
  const primary = pack.primaryIntent;
  const serp = opts.serpPattern ?? null;
  const warnings: string[] = [];

  // ---- title ----------------------------------------------------------------
  let title: PlanElement | null = null;
  if (primary) {
    const v = volOf(primary, opts.volumeByKeyword);
    const serpHint = serp?.titlePattern ? ` Winning titles ${serp.titlePattern}.` : "";
    const ev = [
      `Primary intent "${primary}"`,
      v ? `${fmtVol(v)} searches/mo (DataForSEO)` : null,
      serp ? `Google rewards a ${serp.format} format here` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    title = {
      slot: "title",
      recommendation: `Lead the <title> with "${titleCase(primary)}"${
        opts.currentTitle ? ` (current: "${opts.currentTitle}")` : ""
      }.${serpHint}`,
      evidence: ev,
    };
  }

  // ---- meta -------------------------------------------------------------------
  const meta: PlanElement | null = primary
    ? {
        slot: "meta",
        recommendation: `Write a meta description that answers "${primary}" in the first 120 chars.`,
        evidence: serp ? `Match the ${serp.format} intent Google rewards for this query.` : `The page's primary intent.`,
      }
    : null;

  // ---- h1 ---------------------------------------------------------------------
  const h1: PlanElement | null = primary
    ? { slot: "h1", recommendation: `H1 = "${titleCase(primary)}".`, evidence: `The query this page should own.` }
    : null;

  // ---- H2 sections (owned sub-intents mapped to h2_section) -------------------
  const sections: PlanElement[] = pack.keywords
    .filter((k) => k.bucket === "own" && k.element === "h2_section")
    .slice(0, 5)
    .map((k) => {
      const v = volOf(k.keyword, opts.volumeByKeyword);
      return {
        slot: "h2" as const,
        recommendation: `Add an H2 section: "${titleCase(k.keyword)}".`,
        evidence: [k.why, v ? `${fmtVol(v)} searches/mo` : null].filter(Boolean).join(" · "),
      };
    });

  // ---- FAQ / answer-block targets (the AI fan-out questions) ------------------
  const faqs: PlanElement[] = pack.keywords
    .filter((k) => k.bucket === "answer")
    .slice(0, 5)
    .map((k) => ({
      slot: "faq" as const,
      recommendation: `Answer "${k.keyword}" in an FAQ + a concise answer block.`,
      evidence: k.source === "ai_fanout" ? "AI fans out into this sub-question." : k.why,
    }));

  // A dedicated opening answer block for the primary intent (definitional capture).
  const answerBlock: PlanElement | null = primary
    ? {
        slot: "answer_block",
        recommendation: `Open with a 40–60 word answer to "${primary}".`,
        evidence: serp?.format === "ugc"
          ? "SERP is forum/UGC-dominated — a clean, direct answer can win the snippet the forums lack."
          : "A quotable answer up top wins AI citations + featured snippets.",
      }
    : null;

  // ---- internal links (sibling pages — cross-link, don't merge) ---------------
  const internalLinks: PlanElement[] = pack.clusters.sibling
    .concat(pack.clusters.internal_link)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 4)
    .map((s) => ({
      slot: "internal_link" as const,
      recommendation: `Cross-link to your "${titleCase(s)}" page (don't merge it in).`,
      evidence: "A sibling page owns this related intent — link consolidates authority without cannibalizing.",
    }));

  // ---- schema -----------------------------------------------------------------
  const wantSchema = faqs.length > 0 || (serp && ["faq", "table", "list"].includes(serp.format));
  const schema: PlanElement | null = wantSchema
    ? {
        slot: "schema",
        recommendation: `Add ${schemaForFormat(serp?.format ?? "faq")} JSON-LD.`,
        evidence: serp
          ? `Google rewards a ${serp.format} format here — matching schema helps AI quote you.`
          : `${faqs.length} answerable question(s) — FAQ schema helps AI quote the page.`,
      }
    : null;

  // ---- UX fix (Clarity friction) ----------------------------------------------
  let uxFix: PlanElement | null = null;
  if (opts.friction && (opts.friction.deadPct >= 10 || opts.friction.ragePct >= 5)) {
    const f = opts.friction;
    const worst = f.deadPct >= f.ragePct ? `${Math.round(f.deadPct)}% dead clicks` : `${Math.round(f.ragePct)}% rage clicks`;
    uxFix = {
      slot: "ux_fix",
      recommendation: f.deadPct >= f.ragePct
        ? "Fix dead clicks — make non-links not look clickable (or make them work)."
        : "Reduce rage clicks — fix the slow/broken interaction visitors keep hitting.",
      evidence: `Clarity: ${worst} on this page.`,
    };
  }

  // ---- new siblings (spin-off pages) ------------------------------------------
  const newSiblings: PlanElement[] = pack.clusters.new_page.slice(0, 3).map((s) => ({
    slot: "new_sibling" as const,
    recommendation: `Consider a dedicated page for "${titleCase(s)}".`,
    evidence: "Real demand, but a different intent than this page — a focused page ranks better than a buried section.",
  }));

  // ---- warnings (proof) -------------------------------------------------------
  for (const fam of pack.proofConstraints.lostFamilies) {
    warnings.push(`"${fam}" already measured flat on this page — try a different lever, not the same one again.`);
  }
  for (const fam of pack.proofConstraints.measuringFamilies) {
    warnings.push(`A ${fam} change is mid-measurement here — shipping another edit now muddies the proof. Wait for the read.`);
  }

  // ---- doFirst (the primary, unblocked lever → its concrete element) ----------
  const primaryLever = pack.levers.find((l) => l.primary && !l.blocked) ?? null;
  const doFirst: PlanElement | null = primaryLever
    ? leverToElement(primaryLever.lever, { title, meta, sections, faqs, answerBlock, internalLinks, schema, uxFix }) ?? null
    : null;

  return {
    doFirst,
    title,
    meta,
    h1,
    sections,
    faqs: answerBlock ? [answerBlock, ...faqs] : faqs,
    internalLinks,
    schema,
    uxFix,
    newSiblings,
    warnings,
  };
}

/** Map the chosen primary lever to the element it concretely changes. */
function leverToElement(
  lever: ResearchLever,
  el: {
    title: PlanElement | null;
    meta: PlanElement | null;
    sections: PlanElement[];
    faqs: PlanElement[];
    answerBlock: PlanElement | null;
    internalLinks: PlanElement[];
    schema: PlanElement | null;
    uxFix: PlanElement | null;
  },
): PlanElement | null {
  switch (lever) {
    case "title_meta":
      return el.title;
    case "answer_block":
      return el.answerBlock ?? el.faqs[0] ?? null;
    case "internal_links":
      return el.internalLinks[0] ?? null;
    case "schema":
      return el.schema;
    case "ux_fix":
      return el.uxFix;
    case "content_depth":
      return el.sections[0] ?? el.answerBlock ?? null;
    default:
      return null;
  }
}
