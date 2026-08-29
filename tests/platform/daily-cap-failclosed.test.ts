import { describe, expect, it, vi } from "vitest";
/** AN UNREADABLE BUDGET IS NOT THE DEFAULT BUDGET. The cap fell back to the standard allowance when the tenant read failed, so an account whose operator had set the day to zero, which this file's own contract calls turning paid work off, would have spent against a five dollar cap the moment that read flickered. */
const t = vi.hoisted(() => ({ fail: false, budget: 0 as number | null }));
vi.mock("@/lib/persistence/supabase", () => ({ isSupabaseConfigured: () => true, getSupabaseAdmin: () => ({}) })); vi.mock("@/lib/cost/budget-ledger-supabase", () => ({ getTenantSpentTodayUsd: async () => 0 }));
vi.mock("@/domains/account", () => ({ getTenant: async () => { if (t.fail) throw new Error("flicker"); return { daily_budget_usd: t.budget }; } }));
import { dailyCapReason } from "@/lib/cost/daily-cap";
describe("the day's budget", () => { it("refuses paid work when it cannot be read, and honours a zero the operator set", async () => {
  const ask = () => dailyCapReason("t", new Date(), 1, 0.01); t.fail = true; const unread = await ask(); t.fail = false; t.budget = 0; const off = await ask(); t.budget = 50;
  expect([unread?.includes("could not be read") ?? false, off?.includes("budget for this kind of work is spent") ?? false, await ask()], "unreadable refuses, zero refuses, a real budget allows").toEqual([true, true, null]); }); });
