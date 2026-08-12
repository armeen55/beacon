/** THE MARK-IMPLEMENTED TRANSACTION. There is no bare status flip on the decision facade: the record is written FIRST and the change is flipped SECOND, carrying that
 *  record's own id, so a crash between the two leaves a record the next press heals where the reverse would leave a change marked done that nothing on earth is
 *  measuring. A piece is named by its exact copy too, so a redraft is genuinely new work while pressing the SAME version twice stays one record. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChangeProposal } from "@/domains/decision";

const led = vi.hoisted(() => ({ records: [] as Array<{ id: string; proposalId: string; proposalVersion: string; componentsApplied: Array<{ id: string }> }>, breakWrite: false, flip: vi.fn(async (..._a: unknown[]) => true) }));
const stored = vi.hoisted(() => ({ proposal: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "t" }));
vi.mock("@/lib/auth/can-publish", () => ({ canPublishForCurrentTenant: async () => true }));
vi.mock("@/lib/persistence/repositories", () => ({ getRepository: () => ({ forTenant: () => ({}) }) }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => {} }));
vi.mock("@/domains/account", () => ({ getTenant: async () => ({ id: "t", domain: "site.example" }) }));
vi.mock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
  loadChangeProposal: async () => stored.proposal, resolveCurrentBasis: async () => "basis_now::d4", transitionProposalToImplemented: led.flip }));
vi.mock("@/domains/measurement", async () => ({ ...(await vi.importActual<typeof import("@/domains/measurement")>("@/domains/measurement")),
  loadShippedChanges: async () => led.records, captureChangeMeta: async () => null,
  // THE ONE DOOR, standing in for the real one: it always writes and always answers with the row's id, it is idempotent on (proposal, version), and the row is durable
  // the moment it lands, which is exactly what a retry after a crash finds.
  recordShipment: async (f: { proposalId: string; proposalVersion: string; componentsApplied: Array<{ id: string }> }) => {
    if (led.breakWrite) throw new Error("relation shipped_change_proof does not exist");
    const held = led.records.find((r) => r.proposalVersion === f.proposalVersion);
    if (held) return { shipmentId: held.id, measurement: "measuring" };
    led.records.push({ id: `rec-${led.records.length + 1}`, proposalId: f.proposalId, proposalVersion: f.proposalVersion, componentsApplied: f.componentsApplied });
    return { shipmentId: led.records[led.records.length - 1]!.id, measurement: "measuring" }; } }));

const SEEN = new Date(Date.now() - 2 * 86_400_000).toISOString();
const AFTER = "Iranian comedians: the 12 names people actually search for";
const change = (after = AFTER): ChangeProposal => ({
  id: "t::/famous-iranian-comedians::existing_edit::bundle", tenantId: "t", kind: "existing_edit", pagePath: "/famous-iranian-comedians",
  pageUrl: "https://site.example/famous-iranian-comedians", pageLabel: "Famous Iranian comedians", primaryQuery: "iranian comedians", changeFamily: "title",
  opportunityType: "Answer the exact search", status: "ready", basis: "basis_now::d4", limitations: [], createdAt: SEEN, riskLevel: "low", confidence: "high",
  estimatedEffortMinutes: 6, whyItMatters: "This page lost 163 clicks last month.", recommendedChange: { kind: "existing_edit", field: "title", before: "Comedians", after },
  bundle: { objective: "Answer the exact question people search", metric: "clicks from that search", measurementPlan: "The next 28 days are compared with the last 28.",
    scope: { queries: ["iranian comedians"], prompts: [] }, confidenceReasons: ["163 clicks lost in 4 weeks"], alternatives: [], risks: [],
    components: [{ kind: "title", label: "Title", risk: "safe", before: "Comedians", after, evidenceKeys: ["k1"] }],
    receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "163 clicks lost in 4 weeks.", observedAt: SEEN }], missing: [], freshestObservedAt: SEEN } },
} as unknown as ChangeProposal);
const press = async (p: ChangeProposal) => { stored.proposal = p;
  return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id }); };
beforeEach(() => { led.records = []; led.breakWrite = false; led.flip.mockReset(); led.flip.mockResolvedValue(true); });

describe("nothing is marked done that no record stands behind", () => {
  it("has no bare flip on the facade at all: the one door demands the record that is measuring the change", async () => {
    const facade = await vi.importActual<Record<string, unknown>>("@/domains/decision");
    expect(Object.keys(facade)).not.toContain("markProposalImplemented");
    expect([typeof facade.transitionProposalToImplemented, typeof facade.reconcileImplementedWithoutShipment]).toEqual(["function", "function"]); });
  it("a crash BEFORE the record lands flips nothing, so the change is still theirs to do", async () => {
    led.breakWrite = true;
    const res = await press(change());
    expect([res.success, led.records.length, led.flip.mock.calls.length]).toEqual([false, 0, 0]);
    expect(res.error).not.toMatch(/relation|shipped_change_proof|supabase/i); }); // a table name is not an answer to a customer
  it("a crash AFTER the record lands heals on the next press: one record, and the change then closes", async () => {
    led.flip.mockRejectedValueOnce(new Error("relation change_proposals does not exist"));
    expect((await press(change())).success).toBe(false);
    expect(led.records).toHaveLength(1); // the record is durable, and it is what the retry finds
    expect((await press(change())).success).toBe(true);
    expect([led.records.length, led.flip.mock.calls.length, led.flip.mock.calls[1]![2]]).toEqual([1, 2, "rec-1"]); }); // no second record, and the flip lands carrying it
  it("treats a re-press of the SAME version as nothing at all, a redrafted piece as new work, and an older era's name at its own precision", async () => {
    expect((await press(change())).success).toBe(true);
    const again = await press(change()); // the identical version, pressed again
    expect([again.success, led.records.length, /already on file/.test(again.note ?? "")]).toEqual([true, 1, true]);
    const REDRAFT = "Iranian comedians: who is actually funny in 2026";
    expect((await press(change(REDRAFT))).success).toBe(true);
    expect(led.records).toHaveLength(2); // new wording is a new piece, measured on its own
    led.records[1]!.componentsApplied = [{ id: "0:title" }]; // as an older era wrote it, before the copy was part of the name
    expect(/already on file/.test((await press(change(REDRAFT))).note ?? "")).toBe(true); }); // still matched, at that name's own precision
});
