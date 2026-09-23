import "server-only";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { deserializeChangeProposal, type ChangeProposal } from "./contracts";
import { actionableProposalFailures } from "./validate-proposal";
import { rankProposals } from "./rank-proposals";

export const QUEUE_PAGE = 500, QUEUE_CEILING = 20_000;
type Lane = "ready" | "todo" | "research";
const decode = (payload: unknown): ChangeProposal | null => payload == null ? null
  : deserializeChangeProposal(typeof payload === "string" ? payload : JSON.stringify(payload));
const laneOfRow = (p: ChangeProposal, stamped: string | undefined): Lane =>
  p.status === "ready" && p.researchOnly !== true ? "ready" : p.researchOnly === true ? "research" : stamped === "research" ? "research" : "todo";
const escaped = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

/** One DB page of the stamped ranking. A later material write clears its stamp
 * atomically, so neither a changed proposal nor a source hold consumes a slot. */
export async function readQueuePage(tenantId: string, lane: Lane | "all", basis: string, afterRank: number, limit: number,
  eligible?: (p: ChangeProposal) => boolean): Promise<{ rows: ChangeProposal[]; laneById: Record<string, Lane>; rankById: Record<string, number>; stampedLaneById: Record<string, string>; total: number; dropped: number; release: string | null; nextRank: number; more: boolean }> {
  const at = Math.max(0, Math.floor(afterRank)), nothing = { rows: [], laneById: {}, rankById: {}, stampedLaneById: {}, total: 0, dropped: 0, release: null, nextRank: at, more: false };
  try {
    const sb = getSupabaseAdmin(), { data: head } = await sb.from("change_proposals").select("queue_lane")
      .eq("tenant_id", tenantId).gt("queue_rank", 0).order("queue_rank", { ascending: true }).limit(1);
    const release = ((head ?? []) as Array<{ queue_lane: string | null }>)[0]?.queue_lane?.split("::")[0] ?? null;
    if (!release) return nothing;
    const accountBasis = escaped(basis.replace(/::d\d+$/, ""));
    const scoped = (cols: string, count?: { count: "exact"; head: true }) => {
      const q = sb.from("change_proposals").select(cols, count).eq("tenant_id", tenantId).like("basis", `${accountBasis}%`).is("terminal_disposition", null);
      return lane === "all" ? q.like("queue_lane", `${escaped(release)}::%`) : q.eq("queue_lane", `${release}::${lane}`);
    };
    const [counted, page] = await Promise.all([
      scoped("id", { count: "exact", head: true }),
      scoped("id, payload, queue_rank, queue_lane").gt("queue_rank", at).order("queue_rank", { ascending: true }).order("id", { ascending: true }).limit(limit),
    ]);
    if (page.error) throw new Error(page.error.message);
    const read = (page.data ?? []) as unknown as Array<{ payload: unknown; queue_rank: number; queue_lane: string | null }>;
    const kept = read.map(r => ({ p: decode(r.payload), rank: r.queue_rank, stamped: (r.queue_lane ?? "").split("::")[1] }))
      .filter((r): r is { p: ChangeProposal; rank: number; stamped: string } => !!r.p && actionableProposalFailures(r.p, { tenantId, currentBasis: basis }).length === 0 && (eligible?.(r.p) ?? true) && (lane !== "ready" || laneOfRow(r.p, r.stamped) === "ready"));
    const rows = kept.map(r => r.p), fresh = new Map(rankProposals(rows).map(p => [p.id, p]));
    return { rows: rows.map(p => fresh.get(p.id) ?? p), laneById: Object.fromEntries(kept.map(r => [r.p.id, laneOfRow(r.p, r.stamped)])),
      rankById: Object.fromEntries(kept.map(r => [r.p.id, r.rank])), stampedLaneById: Object.fromEntries(kept.map(r => [r.p.id, r.stamped])),
      total: Math.max(rows.length, (counted.count ?? rows.length) - (read.length - rows.length)), dropped: read.length - rows.length,
      release, nextRank: read.at(-1)?.queue_rank ?? at, more: read.length === limit };
  } catch (e) {
    log.error("[queue-paging] the ranked page could not be read", { tenantId, lane, error: e instanceof Error ? e.message : String(e) });
    return nothing;
  }
}

/** Count only stamped, currently eligible rows. The bounded scan already
 * existed for live lane correction; material writes now remove stale stamps. */
export async function queueLaneCounts(tenantId: string, release: string, basis: string,
  eligible?: (p: ChangeProposal) => boolean): Promise<{ ready: number; todo: number; research: number }> {
  const out = { ready: 0, todo: 0, research: 0 }, counted = new Set<string>(); let after: string | null = null;
  try {
    for (let guard = 0; guard * 100 < QUEUE_CEILING; guard += 1) {
      let q = getSupabaseAdmin().from("change_proposals").select("id, payload, queue_lane")
        .eq("tenant_id", tenantId).like("queue_lane", `${escaped(release)}::%`).like("basis", `${escaped(basis.replace(/::d\d+$/, ""))}%`).is("terminal_disposition", null);
      if (after) q = q.gt("id", after);
      const { data, error } = await q.order("id", { ascending: true }).limit(100);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as Array<{ id: string; payload: unknown; queue_lane: string | null }>;
      for (const r of page) { if (counted.has(r.id)) continue; counted.add(r.id); const p = decode(r.payload); if (p && actionableProposalFailures(p, { tenantId, currentBasis: basis }).length === 0 && (eligible?.(p) ?? true)) out[laneOfRow(p, (r.queue_lane ?? "").split("::")[1])] += 1; }
      if (page.length < 100) break;
      after = page[page.length - 1]!.id;
    }
    return out;
  } catch (e) { log.error("[queue-paging] lane counts could not be read", { tenantId, error: e instanceof Error ? e.message : String(e) }); return { ready: 0, todo: 0, research: 0 }; }
}
