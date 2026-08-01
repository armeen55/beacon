import "server-only";

/**
 * brand-identity - WHO THIS ACCOUNT IS, in the words an answer would actually use.
 *
 * THE DEFECT THIS CLOSES. The answer-analysis pass asked the model "was this brand
 * mentioned" with an empty brand, because nothing in the run knew the account's own
 * name. Every reading came back "not mentioned" and the AI trend was computed from
 * that, so an account could be named in an answer and Beacon recorded nothing.
 *
 * DERIVED, NEVER STORED: no new surface and no new column. The name is the confirmed
 * BusinessProfile name and the address is the Account's one Website domain, which is
 * all any provisioned account already holds. The signup seed (tenants.business_name)
 * is deliberately NOT read: it is a provisional string a stranger typed, and the
 * Account record itself says it is no name authority.
 */

import { loadBusinessProfile } from "./business-profile";
import { getTenant } from "./tenants/store";
import { websiteOf } from "./tenants/types";

export type BrandIdentity = {
  /** What I call this business out loud: the confirmed name, or the bare domain
   *  when no name is confirmed yet. Empty only when the account holds neither. */
  name: string;
  /** Every written form that still means this business, lowercased, longest first.
   *  Nothing under 3 characters, which would match half the language. */
  forms: string[];
  /** The account's one host, lowercased with www stripped. Empty when no website is on file. */
  host: string;
};

/** PURE. The confirmed name and the account's domain, folded into one identity. */
function identityFrom(confirmedName: string, domain: string): BrandIdentity {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  const label = host.split(".")[0] ?? "";
  const name = confirmedName.trim();
  const forms = new Set<string>();
  if (name.length >= 3) {
    forms.add(name.toLowerCase());
    // "Ritz Builders, Inc." and "Ritz Builders" are one business to a reader.
    const bare = name.toLowerCase().replace(/[,\s]+(inc|llc|ltd|co|corp|corporation|company)\.?$/, "").trim();
    if (bare.length >= 3) forms.add(bare);
  }
  if (host.length >= 3) forms.add(host);
  if (label.length >= 3) forms.add(label);
  return { name: name || host, forms: [...forms].sort((a, b) => b.length - a.length), host };
}

/**
 * THE production read of one account's identity. Both halves are fail-soft on
 * their own: a profile I could not read still leaves the domain, and a domain I
 * could not read still leaves a confirmed name. An identity with no forms at all
 * is the caller's signal to ask nothing rather than ask about nobody.
 */
export async function loadBrandIdentity(tenantId: string): Promise<BrandIdentity> {
  const [account, profile] = await Promise.all([
    getTenant(tenantId).catch(() => null),
    loadBusinessProfile(tenantId).catch(() => null),
  ]);
  return identityFrom(profile?.name.value ?? "", account ? websiteOf(account).domain : "");
}
