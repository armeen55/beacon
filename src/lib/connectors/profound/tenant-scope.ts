/**
 * Profound tenant scope (2026-06-26) — the hard-coded, verified-live scoping for
 * the Iranopedia AEO build. The Profound account is a BORROWED hackathon
 * instance ("Frontier Models" / "Profound Marketing Engineer Hackathon") that
 * tracks AI companies as brands (ChatGPT is the `is_owned` asset). So:
 *   - global brand visibility / SoV is about openai.com/ChatGPT → NOT Iranopedia,
 *   - Agent Analytics (bots / referrals / domains) is NOT available on this key.
 * The ONLY tenant-true signal is the "Iranopedia" TOPIC's prompts + their
 * citations/answers/fanouts. We scope every call to that topic and decide
 * ownership by the tenant's real DOMAIN + brand name — never by the tracked
 * asset.
 *
 * For now this is hard-coded per the operator ("hardcode these for profound …
 * later this becomes native tenant config"). Values verified live 2026-06-26 via
 * GET /v1/org/categories + /topics (and the stored connector token).
 */

export type ProfoundTenantScope = {
  tenantId: string;
  /** Profound category (workspace bucket) the topic lives in. */
  categoryId: string;
  /** The tenant's TOPIC inside that category — every report/answer call filters
   *  to this so a multi-topic borrowed category never leaks other tenants. */
  topicId: string;
  /** Human label of the topic ("Iranopedia"). */
  topicLabel: string;
  /** The tenant's real site domain — ownership of a citation is decided by this. */
  ownedDomain: string;
  /** Brand aliases counted as an "own mention" in an answer's mentions[]. */
  ownedMentionAliases: string[];
  /** Borrowed account → Agent Analytics (bots/referrals/domains) MUST NOT be
   *  called. Always false here; native tenants can flip it on later. */
  agentAnalyticsEnabled: boolean;
};

/**
 * Hackathon noise filter. The borrowed workspace seeds the Iranopedia topic with
 * AI-company SENTIMENT prompts ("Evaluate the Frontier Models company ChatGPT on
 * Iranopedia"). Those are about the tracked AI brands, not Iranopedia AEO —
 * exclude them so the prompt intelligence is real Persian/Iran questions only.
 */
export function isProfoundNoisePrompt(prompt: string): boolean {
  return /^\s*Evaluate the Frontier Models company\b/i.test(prompt ?? "");
}

const SCOPES: Readonly<Record<string, ProfoundTenantScope>> = {
  "tenant-iranopedia": {
    tenantId: "tenant-iranopedia",
    categoryId: "7943f355-67f3-4792-b172-981db56ef33c",
    topicId: "0e181fec-5fad-4419-a492-d8263836eb12",
    topicLabel: "Iranopedia",
    ownedDomain: "iranopedia.com",
    ownedMentionAliases: ["Iranopedia", "iranopedia.com"],
    agentAnalyticsEnabled: false,
  },
};

/** The hard-scoped Profound config for a tenant, or null when the tenant has no
 *  prompt-intelligence scope configured (feature is off for them). */
export function getProfoundTenantScope(tenantId: string): ProfoundTenantScope | null {
  return SCOPES[tenantId] ?? null;
}
