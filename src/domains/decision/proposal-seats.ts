/** A proposal id is a permanent seat for one mutation, including after the row is retired. Producers read every
 * durable binding before minting, and the store/SQL guard remains the final authority if a producer ever slips. */
import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { deserializeChangeProposal } from "./contracts";
import { footprintKey } from "./mutation-footprint";

type Binding = Readonly<{ id: string; mutationKey: string; status?: string | null;
  terminalDisposition?: string | null; withdrawnReason?: string | null }>;

const digest = (text: string): string => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };

function seatFor(baseId: string, mutationKey: string, rows: Iterable<Binding>): string {
  const byId = new Map<string, Binding>(); for (const row of rows) if (row.id) byId.set(row.id, row);
  const mayUse = (id: string): boolean => { const row = byId.get(id); if (!row) return true;
    if (row.mutationKey !== mutationKey) return false;
    return row.terminalDisposition == null && row.status !== "implemented_pending_verification"; };
  if (mayUse(baseId)) return baseId;
  const topic = mutationKey.split("::").at(-1)?.trim() || digest(mutationKey), named = `${baseId}@${topic}`;
  if (mayUse(named)) return named;
  for (let n = 0; ; n += 1) { const candidate = `${named}@${digest(`${mutationKey}|${n}`)}`; if (mayUse(candidate)) return candidate; }
}

async function loadProposalSeats(tenantId: string, pageKeys: readonly string[]): Promise<Binding[]> {
  if (!tenantId) throw new Error("proposal seats require an account");
  const pages = [...new Set(pageKeys.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  if (pages.length === 0) return [];
  const out: Binding[] = [];
  for (let first = 0; first < pages.length; first += 50) for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabaseAdmin().from("change_proposals").select("id, mutation_key, status, terminal_disposition, withdrawn_reason, payload").eq("tenant_id", tenantId)
      .in("page_key", pages.slice(first, first + 50)).order("id", { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(`proposal seat read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ id?: unknown; mutation_key?: unknown; status?: unknown;
      terminal_disposition?: unknown; withdrawn_reason?: unknown; payload?: unknown }>;
    for (const row of rows) if (typeof row.id === "string" && typeof row.mutation_key === "string" && row.mutation_key) {
      const decoded = deserializeChangeProposal(typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload));
      out.push({ id: row.id, mutationKey: decoded ? footprintKey(decoded) : row.mutation_key,
        status: typeof row.status === "string" ? row.status : null,
        terminalDisposition: typeof row.terminal_disposition === "string" ? row.terminal_disposition : null,
        withdrawnReason: typeof row.withdrawn_reason === "string" ? row.withdrawn_reason : null });
    }
    if (rows.length < 500) break;
  }
  return out;
}

const proposalSeats = { seatFor, loadProposalSeats };
export default proposalSeats;
