/** PRODUCT - the two rule boxes on Settings are the operator's exact words, INCLUDING when they empty one. Live, the account held ZERO banned terms while a card was refused as though it held one, and the box that would have proved it could only ever ADD: `banned.length > 0 ? typed : stored` saved the stored list straight back, so a rule deleted on screen returned on the very next save and went on holding copy nobody had asked to hold. An ABSENT field is still no answer, which is what stops a partial save from wiping rules it never carried. Driven through the real profile repository seam, so the merge that reaches storage is what is asserted. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant-context", async () => ({ ...(await vi.importActual<typeof import("@/lib/tenant-context")>("@/lib/tenant-context")), currentTenantId: vi.fn(async () => "t") }));
import { setBusinessProfileRepositoryForTests, __resetBusinessProfileCacheForTests } from "@/domains/account/business-profile";
import type { BusinessProfile } from "@/domains/account";
import { saveSetup } from "@/app/(shell)/settings/config/actions";
const sec = <T,>(value: T) => ({ value, origin: "operator_confirmed" as const, confidence: 1, sourceUrls: [] });
/** The smallest save the screen can make: research refuses outright without one of these two answers. */
const base = { name: "Example", offeringsText: "guides", topicsToOwnText: "guides" };
let saved: BusinessProfile | null = null;
const rulesOf = (): { editorial: readonly string[]; bannedTerms: readonly string[] } =>
  ({ editorial: saved?.constraints.value.editorial ?? ["NEVER SAVED"], bannedTerms: saved?.constraints.value.bannedTerms ?? ["NEVER SAVED"] });
describe("the rule boxes on Settings", () => {
  beforeEach(() => { saved = null; __resetBusinessProfileCacheForTests();
    setBusinessProfileRepositoryForTests({ load: async () => ({ schemaVersion: 2, name: sec("Example"),
      constraints: sec({ factual: [], legal: [], brand: [], firstMention: null, editorial: ["Keep it short"], bannedTerms: ["Farsi"] }) }) as never,
      save: async (_id: string, p: BusinessProfile) => { saved = p; return { ok: true }; } }); });
  afterEach(() => { setBusinessProfileRepositoryForTests(null); __resetBusinessProfileCacheForTests(); });
  it("an emptied box leaves the operator holding zero of that rule, and never touches the other box", async () => {
    expect(await saveSetup({ ...base, bannedTermsText: "", editorialRulesText: "Keep it short" })).toEqual({ success: true });
    expect(rulesOf()).toEqual({ editorial: ["Keep it short"], bannedTerms: [] }); });
  it("a save that never carries the rule boxes leaves both rules exactly as they were", async () => {
    expect(await saveSetup({ ...base })).toEqual({ success: true });
    expect(rulesOf()).toEqual({ editorial: ["Keep it short"], bannedTerms: ["Farsi"] }); });
  it("words the operator types still land", async () => {
    expect(await saveSetup({ ...base, bannedTermsText: "cheap, spammy", editorialRulesText: "Never say cheap" })).toEqual({ success: true });
    expect(rulesOf()).toEqual({ editorial: ["Never say cheap"], bannedTerms: ["cheap", "spammy"] }); });});
