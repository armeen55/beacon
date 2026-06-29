import "server-only";
import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { ACTION_LABEL, type ActionPack } from "@/domains/action-pack/types";
import { cleanTopicLabel } from "@/domains/demand-graph/clean-topic-label";
import { topicTokens } from "@/domains/evidence/relevance-gate";

/** Turn an AI prompt into a short page topic: drop leading question words + trailing
 *  punctuation, then humanize. "What are Persian wedding customs?" → "Persian Wedding
 *  Customs". PURE. */
export function promptToTopic(prompt: string): string {
  const q = /^\s*(what|which|who|where|when|why|how|are|is|the|a|an|do|does|can|should|list|tell me)\b[\s,'’]*/i;
  let s = (prompt ?? "").trim();
  for (let i = 0; i < 3 && q.test(s); i++) s = s.replace(q, "");
  s = s.replace(/[?!.]+\s*$/g, "").trim();
  const cleaned = cleanTopicLabel(s || prompt);
  return cleaned.length > 56 ? cleaned.slice(0, 53).trimEnd() + "…" : cleaned;
}

/** Short human verbs for the AI-Questions surface (operator spec: "Create page",
 *  "Add answer block", "Edit page" — not "Create hub" / "Create new page"). */
const SHORT_VERB: Record<string, string> = {
  create_hub: "Create page",
  create_new_page: "Create page",
  edit_existing_page: "Edit page",
  add_answer_block: "Add answer block",
  add_internal_links: "Add internal links",
  consolidate_pages: "Consolidate pages",
  fix_title_meta_ctr: "Fix title/meta",
  fix_conversion_friction: "Fix UX",
};

/** A short, human action label: "Create page: Persian Wedding Customs" — never the raw
 *  "Create hub: <entire question> - Complete Guide". PURE. */
export function shortActionLabel(actionType: string, prompt: string): string {
  const verb =
    SHORT_VERB[actionType] ?? (ACTION_LABEL as Record<string, string>)[actionType] ?? actionType.replace(/_/g, " ");
  return `${verb}: ${promptToTopic(prompt)}`;
}

/** Cluster key = the lead distinguishing token of the prompt (generic brand words
 *  stripped) so "Persian wedding family/customs/proposal" collapse together. PURE. */
export function clusterKeyOf(prompt: string): string {
  return topicTokens(prompt)[0] ?? "other";
}

/**
 * AI Questions data (2026-06-28 — route consolidation) — the real "AI questions"
 * surface, derived from the CANONICAL ActionPack brain's Profound receipts (the
 * same cached prompt/fanout/citation evidence the worklist + cockpit already use).
 *
 * The legacy /prompts page read `tracked_prompts` (the borrowed-account tracked
 * prompt library), which is EMPTY for Iranopedia — so the page lied ("no questions
 * added") while Profound had hundreds of prompts behind the moves. This reads from
 * the brain instead: every pack with a Profound receipt IS an AI question, with who
 * AI cites, whether we're absent, and a link to the move that answers it.
 * Read-only, cached/durable only — NO live Profound API.
 */
export type AiQuestion = {
  id: string;
  prompt: string;
  promptCount: number;
  fanoutCount: number;
  citedDomains: string[];
  ownAbsent: boolean;
  moveLabel: string;
  actionLabel: string;
  /** Short, human action label: "Create page: Persian Wedding Customs". */
  actionLabelShort: string;
  /** Lead topic token, for grouping near-duplicate questions. */
  cluster: string;
  /** How many near-duplicate questions in the same cluster+action collapsed into this. */
  relatedCount: number;
  targetUrl: string | null;
};

export type AiQuestionsData = {
  questions: AiQuestion[];
  totals: {
    questions: number;
    fanouts: number;
    citedDomains: number;
    absent: number;
    cited: number;
  };
};

const EMPTY: AiQuestionsData = {
  questions: [],
  totals: { questions: 0, fanouts: 0, citedDomains: 0, absent: 0, cited: 0 },
};

function buildFromPacks(packs: ActionPack[]): AiQuestionsData {
  const seen = new Set<string>();
  const questions: AiQuestion[] = [];
  for (const p of packs) {
    const r = p.profoundReceipt;
    if (!r || !r.topPrompt.trim()) continue;
    const key = r.topPrompt.toLowerCase().trim();
    if (seen.has(key)) continue; // one row per distinct AI question
    seen.add(key);
    questions.push({
      id: p.id,
      prompt: r.topPrompt,
      promptCount: r.promptCount,
      fanoutCount: r.fanoutCount,
      citedDomains: r.citedDomains,
      ownAbsent: r.ownAbsent,
      moveLabel: p.label,
      actionLabel: ACTION_LABEL[p.actionType],
      actionLabelShort: shortActionLabel(p.actionType, r.topPrompt),
      cluster: clusterKeyOf(r.topPrompt),
      relatedCount: 0,
      targetUrl: p.targetUrl,
    });
  }
  // Opportunity-first: questions where AI cites rivals but NOT us, then by breadth
  // (fanouts) and how contested they are (cited-domain count).
  questions.sort(
    (a, b) =>
      Number(b.ownAbsent) - Number(a.ownAbsent) ||
      b.fanoutCount - a.fanoutCount ||
      b.citedDomains.length - a.citedDomains.length,
  );

  // Cluster near-duplicates: keep the strongest representative per (cluster + action),
  // collapsing "Persian wedding family / customs / proposal" into one row with a
  // "+N related" count instead of a repetitive dump.
  const repByGroup = new Map<string, AiQuestion>();
  for (const q of questions) {
    const g = `${q.cluster}::${q.actionLabel}`;
    const rep = repByGroup.get(g);
    if (rep) rep.relatedCount += 1;
    else repByGroup.set(g, q);
  }
  const clustered = [...repByGroup.values()];

  const domains = new Set<string>();
  let fanouts = 0;
  for (const q of questions) {
    fanouts += q.fanoutCount;
    for (const d of q.citedDomains) domains.add(d.toLowerCase());
  }
  return {
    questions: clustered,
    totals: {
      questions: questions.length,
      fanouts,
      citedDomains: domains.size,
      absent: questions.filter((q) => q.ownAbsent).length,
      cited: questions.filter((q) => !q.ownAbsent).length,
    },
  };
}

async function loadUncached(tenantId: string): Promise<AiQuestionsData> {
  const wl = await loadActionPackWorklistForTenant(tenantId).catch(() => null);
  if (!wl) return EMPTY;
  return buildFromPacks(wl.packs);
}

/** Request-memoized AI questions, ActionPack-powered. */
export const loadAiQuestions = cache(
  async (): Promise<AiQuestionsData> => loadUncached(await currentTenantId()),
);
