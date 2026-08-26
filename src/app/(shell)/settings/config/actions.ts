"use server";

import { log } from "@/lib/logger";
import {
  getTenant,
  websiteOf,
  loadBusinessProfile,
  saveBusinessProfile,
  type BusinessType,
  type CompetitorRef,
  type ProfileSection,
} from "@/domains/account";
import { readTrackedQuestions, saveTrackedQuestions } from "@/domains/runtime";
import { competitorOverrideLine, parseCompetitorOverrides, type CompetitorKind } from "@/domains/evidence";
import { currentTenantId } from "@/lib/tenant-context";
import { revalidatePath } from "next/cache";

/** The business types the screen offers. Optional and never gating: research
 *  runs off what the operator sells and wants to be found for, not off a label. */
const BUSINESS_TYPES = new Set<BusinessType>([
  "local_service",
  "content_publisher",
  "ecommerce",
  "saas",
  "other",
]);

/** The canonical, editable view the settings screen renders. Website is
 *  read-only here: the Account owns the one domain. */
export type SetupView = {
  name: string;
  websiteDomain: string;
  businessType: BusinessType | "";
  offeringsText: string;
  audiencesText: string;
  topicsToOwnText: string;
  geographicScopeText: string;
  competitorsText: string;
  competitorRulesText: string;
  editorialRulesText: string;
  bannedTermsText: string;
};

/** One item per line: the operator reads back exactly what I hold. */
const lines = (values: string[]): string => values.join("\n");

export async function loadSetup(): Promise<SetupView> {
  const tenantId = await currentTenantId();
  const [account, profile] = await Promise.all([
    getTenant(tenantId),
    loadBusinessProfile(tenantId),
  ]);
  return {
    name: profile.name.value,
    websiteDomain: account ? websiteOf(account).domain : "",
    businessType: profile.businessType.value ?? "",
    offeringsText: lines(profile.offerings.value),
    audiencesText: lines(profile.audiences.value),
    topicsToOwnText: lines(profile.topicsToOwn.value),
    geographicScopeText: lines(profile.geographicScope.value),
    competitorsText: lines(profile.competitors.value.filter((c) => !c.domain).map((c) => c.name)),
    // Read the operator's discovery rules back as the exact lines they typed.
    competitorRulesText: lines(profile.competitors.value.filter((c) => !!c.domain)
      .map((c) => competitorOverrideLine({ domain: c.domain!, action: c.action ?? "pin", kind: c.kind as CompetitorKind | undefined }))),
    editorialRulesText: lines(profile.constraints.value.editorial),
    bannedTermsText: lines(profile.constraints.value.bannedTerms),
  };
}

/** Operators paste lists the way they think: commas, new lines, or semicolons. */
const splitList = (text: string): string[] =>
  text.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);

const confirmed = <T,>(value: T): ProfileSection<T> => ({
  value,
  origin: "operator_confirmed" as const,
  confidence: 1,
  sourceUrls: [] as string[],
});

/** An optional box left blank means "nothing to add", never "erase what you
 *  have": the stored value AND its provenance carry over untouched. */
function optional<T>(next: T[], prior: ProfileSection<T[]>): ProfileSection<T[]> {
  return next.length > 0 ? confirmed(next) : prior;
}

export async function saveSetup(data: {
  name: string;
  businessType?: string;
  offeringsText?: string;
  audiencesText?: string;
  topicsToOwnText?: string;
  geographicScopeText?: string;
  competitorsText?: string;
  competitorRulesText?: string;
  editorialRulesText?: string;
  bannedTermsText?: string;
}): Promise<{ success: boolean; error?: string }> {
  const action = "saveSetup";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    const tenantId = await currentTenantId();
    if (!data.name.trim()) {
      return { success: false, error: "Enter your business name." };
    }
    // Research runs on what you sell and what people should find you for; a save
    // with both blank would confirm empty truth and leave research paused.
    if (splitList(data.offeringsText ?? "").length === 0 && splitList(data.topicsToOwnText ?? "").length === 0) {
      return { success: false, error: "Add what your business sells, provides, or publishes, or what people should find you for. The research starts from those answers." };
    }
    // Discovery rules are instructions, so a line I cannot read stops the whole save and says why:
    // half-applying a pin and dropping an exclude would be a quieter lie than refusing.
    const rules = parseCompetitorOverrides(data.competitorRulesText ?? "");
    if (rules.errors.length > 0) return { success: false, error: `Nothing was saved yet. ${rules.errors[0]}` };
    const current = await loadBusinessProfile(tenantId);
    const bt = (data.businessType ?? "").trim() as BusinessType;
    // Rules are sentences, so they split on lines only: a comma inside a rule is part of the rule.
    // AN EMPTIED BOX IS A DELETION, NOT A MISSING ANSWER (operator, 2026-08-26): both boxes read the stored
    // list back for the operator to edit, so `length > 0 ? typed : stored` could only ever ADD. A rule cleared
    // on screen returned on the very next save and went on holding copy nobody had asked to hold, with the
    // settings page showing it the whole time. An ABSENT field is still no answer, which is what stops a
    // partial save from wiping rules it never carried.
    const editorial = data.editorialRulesText == null ? null
      : data.editorialRulesText.split("\n").map((s) => s.trim()).filter(Boolean);
    const banned = data.bannedTermsText == null ? null : splitList(data.bannedTermsText);
    const priorRules = current.constraints.value;
    const namedNow = splitList(data.competitorsText ?? "").map((name) => ({ name, evidenceUrls: [] }));
    const patch: Parameters<typeof saveBusinessProfile>[1] = {
      name: confirmed(data.name.trim()),
      // The three answers research runs on are the operator's exact words,
      // including an intentional clear.
      offerings: confirmed(splitList(data.offeringsText ?? "")),
      audiences: confirmed(splitList(data.audiencesText ?? "")),
      topicsToOwn: confirmed(splitList(data.topicsToOwnText ?? "")),
      geographicScope: optional(splitList(data.geographicScopeText ?? ""), current.geographicScope),
      // Names the operator typed keep the never-erase rule; the rules box is authoritative, because
      // an operator who deletes a pin line means to remove that pin.
      competitors: confirmed<CompetitorRef[]>([
        ...(namedNow.length > 0 ? namedNow : current.competitors.value.filter((c) => !c.domain)),
        ...rules.overrides.map((o) => ({ name: o.domain, evidenceUrls: [], domain: o.domain, action: o.action, kind: o.kind })),
      ]),
      constraints: editorial == null && banned == null ? current.constraints
        : confirmed({ ...priorRules, editorial: editorial ?? priorRules.editorial, bannedTerms: banned ?? priorRules.bannedTerms }),
    };
    // Business type is optional. An unanswered selector never overwrites a
    // stored type with a confirmed blank.
    if (BUSINESS_TYPES.has(bt)) patch.businessType = confirmed<BusinessType | null>(bt);
    const saved = await saveBusinessProfile(tenantId, patch);
    if (!saved.persisted) {
      return { success: false, error: "Your business details could not be saved just now. Try again in a moment." };
    }
    revalidatePath("/", "layout");
    revalidatePath("/settings/config");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    // The operator gets the same plain sentence a failed write gets; the raw
    // exception belongs in the log, never on the screen.
    return { success: false, error: "Your business details could not be saved just now. Try again in a moment." };
  }
}

/** The tracked questions this screen renders. FREE: one narrow read, no model
 *  call and no research, so opening Settings never costs anything. */
export async function loadTrackedQuestions(): Promise<{
  active: { id: string; text: string; version: number; createdAt: string }[];
  count: number; recommended: string[]; unknown?: boolean;
}> {
  return readTrackedQuestions(await currentTenantId());
}

/** Save the tracked set. Unchanged wording keeps its id, so a save never throws
 *  away the measurement history of a question the operator left alone. */
export async function saveTrackedQuestionsAction(
  input: { keepIds: string[]; edits: { id: string; newText: string }[]; additions: string[] },
): Promise<{ ok: true; count: number; added: number; skippedDuplicates: number; skippedBlank: number } | { ok: false; error: string }> {
  const result = await saveTrackedQuestions(await currentTenantId(), input);
  if (result.ok) {
    revalidatePath("/", "layout");
    revalidatePath("/settings/config");
  }
  return result;
}
