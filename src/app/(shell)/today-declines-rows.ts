import type { TodayMove } from "./today-moves-data";
import type { GscCannibalizationCase } from "@/domains/recommendation-intelligence/gsc-cannibalization";
import { decisionFromCannibalization, type ChangeDecision } from "@/domains/changes/decide-action";
import { hasOppositeQualifiers } from "@/domains/recommendations/opposite-qualifier-guard";

/**
 * Pure helpers for the "Recover lost ground" section, no server imports, so they
 * are safely unit-testable. The section component consumes these.
 */

export type RecoveryRow = {
  moveId: string;
  page: string;
  targetUrl: string;
  query: string;
  dropPct: number;
  priorClicks: number;
  recentClicks: number;
  positionSlip: number;
};

/**
 * Flatten the worklist's per-move declines into one recovery list, ranked by
 * clicks at stake (prior clicks desc) and capped.
 */
export function buildRecoveryRows(
  moves: ReadonlyArray<Pick<TodayMove, "id" | "pageLabel" | "targetUrl" | "declines">>,
  cap = 8,
): RecoveryRow[] {
  return moves
    .flatMap((m) =>
      m.declines.map((d) => ({
        moveId: m.id,
        page: m.pageLabel,
        targetUrl: m.targetUrl,
        query: d.query,
        dropPct: d.dropPct,
        priorClicks: d.priorClicks,
        recentClicks: d.recentClicks,
        positionSlip: d.positionSlip,
      })),
    )
    .sort((a, b) => b.priorClicks - a.priorClicks)
    .slice(0, cap);
}

/** Total monthly clicks slipping across the recovery rows (never negative). */
export function recoveryClicksLost(rows: ReadonlyArray<RecoveryRow>): number {
  return rows.reduce((s, r) => s + Math.max(0, r.priorClicks - r.recentClicks), 0);
}

export type CannibalEntry = {
  query: string;
  otherPages: string[];
  /** True when THIS page is the best-ranking (natural canonical) of the group. */
  isLead: boolean;
  /** The best-ranking page's pretty name (the consolidation target). */
  leadPage: string;
  /** Exact owned URLs retained for a fail-closed redirect plan. Labels alone
   * are never enough to emit a destructive redirect instruction. */
  leadUrl?: string;
  otherUrls?: string[];
  /** Plain-English consolidation directive (the ACTION, not just the diagnosis). Wave 3C: exactly
   *  ONE action, never "redirect or internal-link". */
  fix: string;
  /** Wave 3C - THE single decided action for this case (edit_existing = keep + internal-link;
   *  prune_redirect = redirect a dead page in). Consumed by decide-action.ts / changes-data.ts so
   *  the ranked Changes card and this row never disagree. */
  decision: ChangeDecision;
  /** Paste-ready internal-link snippet a FOLLOWER adds to point at the canonical
   *  lead (null for the lead page itself). The concrete consolidation artifact. */
  linkSnippet: string | null;
};

/** Title-case a query for use as link anchor text. */
function anchorCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export type CannibalizationCaseRow = {
  query: string;
  leadPage: string;
  others: string[];
  /** The query's clicks, summed across all competing own-URLs (split clicks). */
  clicksAtStake: number;
  fix: string;
  /** Wave 3C - THE single decided action for this case (edit_existing vs prune_redirect). */
  decision: ChangeDecision;
  /** Paste-ready link a follower adds to point at the canonical lead (or null). */
  linkSnippet: string | null;
};

/**
 * Site-wide "stop competing with yourself" rows: one per cannibalized query (2+ of
 * your own pages co-ranking), the best-ranking page as the consolidation lead,
 * ranked by clicks at stake. Pure (canon + pretty injected); homepage-lead aware
 * (a topic page should NOT defer to the root). The section consumes this.
 */
export function buildCannibalizationCaseRows(
  cases: ReadonlyArray<Pick<GscCannibalizationCase, "query" | "competingUrls">>,
  canon: (u: string) => string,
  pretty: (u: string) => string,
  opts: { cap?: number; maxOthers?: number } = {},
): CannibalizationCaseRow[] {
  const cap = opts.cap ?? 8;
  const maxOthers = opts.maxOthers ?? 3;
  const rows: CannibalizationCaseRow[] = [];
  for (const c of cases) {
    if (c.competingUrls.length < 2) continue;
    const lead = c.competingUrls[0]!; // sorted best-position first
    const leadUrl = lead.url;
    const leadPage = pretty(leadUrl);
    const leadKey = canon(leadUrl);
    const others = [...new Set(c.competingUrls.filter((x) => canon(x.url) !== leadKey).map((x) => pretty(x.url)))].slice(0, maxOthers);
    if (others.length === 0) continue;
    const clicksAtStake = c.competingUrls.reduce((s, u) => s + Math.max(0, u.clicks), 0);
    const leadIsHome = /^https?:\/\/[^/]+\/?$/.test(leadUrl);
    // Wave 3C - the followers' own Google clicks decide HOW to fold them in: keep + internal-link
    // when they still earn clicks, redirect them when they are dead. One action, never a fork.
    const followerHasDemand = c.competingUrls.filter((u) => canon(u.url) !== leadKey).reduce((s, u) => s + Math.max(0, u.clicks), 0) > 0;
    const decision = decisionFromCannibalization({ isLead: true, followerHasDemand, leadIsHome });
    const fix = leadIsHome
      ? `Your homepage out-ranks your topic pages for "${c.query}". Make one dedicated page the clear answer with a stronger title, H1, and more depth, and link to it from the homepage.`
      : decision === "prune_redirect"
        ? `"${leadPage}" is your best-ranking page for "${c.query}", so fold ${others.join(", ")} into it with a redirect so they stop splitting its clicks.`
        : `"${leadPage}" is your best-ranking page for "${c.query}", so fold ${others.join(", ")} into it with one internal link each so they stop splitting its clicks.`;
    const linkSnippet = leadIsHome ? null : `<a href="${leadUrl}">${anchorCase(c.query)}</a>`;
    rows.push({ query: c.query, leadPage, others, clicksAtStake, fix, decision, linkSnippet });
  }
  return rows.sort((a, b) => b.clicksAtStake - a.clicksAtStake).slice(0, cap);
}

/**
 * Index cannibalization cases by each competing own-URL to the cases it's in, each
 * with a CONSOLIDATION DIRECTIVE and ONE decided action (Wave 3C): if this page is the
 * best-ranking one, absorb the others into it (fold with internal links, or a redirect
 * when the followers are dead); otherwise point this page at the canonical lead with an
 * internal link, or, for a distinct audience, give it its own clearly different focus.
 * Pure (canon + pretty injected) so it's unit-testable.
 */
export function indexCannibalizationByUrl(
  cases: ReadonlyArray<Pick<GscCannibalizationCase, "query" | "competingUrls" | "leadUrl">>,
  canon: (u: string) => string,
  pretty: (u: string) => string,
  maxOthers = 3,
): Map<string, CannibalEntry[]> {
  const out = new Map<string, CannibalEntry[]>();
  for (const c of cases) {
    const leadKey = canon(c.leadUrl);
    const leadPage = pretty(c.leadUrl);
    for (const cu of c.competingUrls) {
      const key = canon(cu.url);
      const others = [...new Set(c.competingUrls.filter((x) => canon(x.url) !== key).map((x) => pretty(x.url)))].slice(0, maxOthers);
      const otherUrls = [...new Set(c.competingUrls.filter((x) => canon(x.url) !== key).map((x) => x.url))].slice(0, maxOthers);
      if (others.length === 0) continue;
      const isLead = key === leadKey;
      // A homepage/root "lead" is a special case: a dedicated topic page should NOT
      // defer to the homepage (that's backwards), so we advise making the topic page the
      // dedicated answer instead, and never emit a link pointing a topic page at the root.
      const leadIsHome = /^https?:\/\/[^/]+\/?$/.test(c.leadUrl);
      // Wave 3C - decide ONE action per case (never "internal link, or differentiate").
      const followerHasDemand = c.competingUrls.filter((x) => canon(x.url) !== leadKey).reduce((s, x) => s + Math.max(0, x.clicks), 0) > 0;
      // Distinct-audience pages (male/female, boy/girl, ...) are differentiated in place, never
      // folded together.
      const oppositeIntent = !isLead && !leadIsHome && hasOppositeQualifiers(cu.url, c.leadUrl);
      const decision: ChangeDecision = decisionFromCannibalization({ isLead, followerHasDemand, oppositeIntent, leadIsHome });
      let fix: string;
      if (isLead) {
        fix = decision === "prune_redirect"
          ? `This is your best-ranking page for "${c.query}", so fold ${others.join(", ")} into it with a redirect so they stop splitting its clicks.`
          : `This is your best-ranking page for "${c.query}", so fold ${others.join(", ")} into it with one internal link each so they stop splitting its clicks.`;
      } else if (leadIsHome) {
        fix = `Your homepage is currently out-ranking this page for "${c.query}". Make this the clear, dedicated answer with a stronger title, H1, and more depth so it becomes the canonical result, and link to it from the homepage.`;
      } else if (oppositeIntent) {
        fix = `Give this page a clearly different focus from "${leadPage}" for "${c.query}" so they stop competing.`;
      } else {
        fix = `Point this page at "${leadPage}", your best-ranking one for "${c.query}", with one internal link so they stop competing.`;
      }
      // Paste-ready internal link the FOLLOWER adds, anchored on the shared topic, only when the
      // canonical is a real dedicated page (never point at the homepage) and we are keeping this
      // page distinct rather than pointing it at the lead.
      const linkSnippet = isLead || leadIsHome || oppositeIntent ? null : `<a href="${c.leadUrl}">${anchorCase(c.query)}</a>`;
      const arr = out.get(key) ?? [];
      arr.push({ query: c.query, otherPages: others, leadUrl: c.leadUrl, otherUrls, isLead, leadPage, fix, decision, linkSnippet });
      out.set(key, arr);
    }
  }
  return out;
}
