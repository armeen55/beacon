/** Canonical tenant-keyed business_config truth; section provenance is current,
 * unmatched legacy JSON is inert. Only successful ordinary reads are cached;
 * concurrent reads share a promise, and invalidation fences late responses. */

import "server-only";
import { z } from "zod";

type ProfileOrigin = "inferred" | "operator_confirmed" | "legacy";

/** One reusable provenance-carrying section shape. */
export type ProfileSection<T> = {
  value: T;
  origin: ProfileOrigin;
  confidence: number | null;
  sourceUrls: string[];
};

export type BusinessType = "local_service" | "content_publisher" | "ecommerce" | "saas" | "other";

type BusinessConstraints = {
  factual: string[];
  legal: string[];
  brand: string[];
  /** Plain-English editorial rules every generation must follow. */
  editorial: string[];
  /** Banned terms hard-rejected by the draft validator. */
  bannedTerms: string[];
  /** First-mention rule for non-English-script terms; null contributes nothing. */
  firstMention: { native: string; transliteration: boolean; englishContext: boolean } | null;
};

/** A competitor the operator named, OR an instruction about a domain Beacon discovered. The three
 *  override fields are OPTIONAL and additive, so every row written before they existed still reads as
 *  a plain named competitor and the jsonb row needs no migration. A row carrying `domain` is an
 *  operator override on discovery (pin it, drop it, or move it to another group); a row without one
 *  is exactly what it always was. */
export type CompetitorRef = {
  name: string;
  evidenceUrls: string[];
  domain?: string;
  action?: "pin" | "exclude" | "correct";
  /** The group the operator moved it to; only ever read beside action "correct". */
  kind?: string;
};

export type BusinessProfile = {
  accountId: string;
  schemaVersion: 2;
  updatedAt: string;
  name: ProfileSection<string>;
  businessType: ProfileSection<BusinessType | null>;
  siteArchetype: ProfileSection<string | null>;
  offerings: ProfileSection<string[]>;
  audiences: ProfileSection<string[]>;
  customerProblems: ProfileSection<string[]>;
  geographicScope: ProfileSection<string[]>;
  differentiators: ProfileSection<string[]>;
  trustClaims: ProfileSection<string[]>;
  importantPages: ProfileSection<string[]>;
  topicsToOwn: ProfileSection<string[]>;
  topicsToExclude: ProfileSection<string[]>;
  constraints: ProfileSection<BusinessConstraints>;
  trustedSourceDomains: ProfileSection<string[]>;
  competitors: ProfileSection<CompetitorRef[]>;
  /** Preserved raw pre-canonical JSON. Inert: runtime never reads it as truth. */
  legacy?: Record<string, unknown>;
};

function section<T>(value: T, origin: ProfileOrigin = "inferred"): ProfileSection<T> {
  return { value, origin, confidence: null, sourceUrls: [] };
}

/** A fully empty profile for an account with no confirmed truth yet. */
export function emptyBusinessProfile(accountId: string, now = ""): BusinessProfile {
  return {
    accountId,
    schemaVersion: 2,
    updatedAt: now,
    name: section(""),
    businessType: section<BusinessType | null>(null),
    siteArchetype: section<string | null>(null),
    offerings: section<string[]>([]),
    audiences: section<string[]>([]),
    customerProblems: section<string[]>([]),
    geographicScope: section<string[]>([]),
    differentiators: section<string[]>([]),
    trustClaims: section<string[]>([]),
    importantPages: section<string[]>([]),
    topicsToOwn: section<string[]>([]),
    topicsToExclude: section<string[]>([]),
    constraints: section<BusinessConstraints>({
      factual: [], legal: [], brand: [], editorial: [], bannedTerms: [], firstMention: null,
    }),
    trustedSourceDomains: section<string[]>([]),
    competitors: section<CompetitorRef[]>([]),
  };
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Canonical rows are shape-filled; legacy rows use the one-time migration's mapping. */
export function profileFromRow(accountId: string, raw: Record<string, unknown>): BusinessProfile {
  if (raw.schemaVersion === 2) {
    const empty = emptyBusinessProfile(accountId);
    const merged = { ...empty, ...(raw as Partial<BusinessProfile>) } as BusinessProfile;
    merged.accountId = accountId;
    merged.schemaVersion = 2;
    return merged;
  }
  // Legacy mapping (data-preserving; full original kept under `legacy`).
  const legacySection = <T>(value: T): ProfileSection<T> => ({
    value, origin: "legacy", confidence: null, sourceUrls: [],
  });
  const bt = raw.businessType;
  const businessType: BusinessType | null =
    bt === "local_service" || bt === "content_publisher" || bt === "ecommerce" || bt === "saas" || bt === "other"
      ? bt : null;
  const fm = raw.firstMention as BusinessConstraints["firstMention"] | undefined;
  const profile = emptyBusinessProfile(accountId);
  profile.name = legacySection(typeof raw.name === "string" ? raw.name : "");
  profile.businessType = legacySection<BusinessType | null>(businessType);
  profile.siteArchetype = legacySection<string | null>(raw.contentSiteMode === true ? "content_site" : null);
  profile.offerings = legacySection([...new Set([...strArr(raw.services), ...strArr(raw.serviceTerms)])]);
  profile.geographicScope = legacySection([...new Set([...strArr(raw.locations), ...strArr(raw.locationTerms)])]);
  profile.importantPages = legacySection(strArr(raw.keyPages));
  profile.constraints = legacySection<BusinessConstraints>({
    factual: [], legal: [], brand: [],
    editorial: strArr(raw.contentRules),
    bannedTerms: strArr(raw.flaggedTerms),
    firstMention: fm && typeof fm === "object" ? fm : null,
  });
  profile.trustedSourceDomains = legacySection(strArr(raw.authoritativeSourceDomains));
  profile.competitors = legacySection(
    strArr(raw.primaryCompetitors).map((name) => ({ name, evidenceUrls: [] })),
  );
  profile.legacy = raw;
  return profile;
}

// ── Persistence (injected; production = Supabase) ──────────────────────────

type BusinessProfileRepository = {
  load(accountId: string): Promise<Record<string, unknown> | null>;
  save(accountId: string, profile: BusinessProfile): Promise<{ ok: boolean; reason?: string }>;
};

const supabaseRepository: BusinessProfileRepository = {
  async load(accountId) {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    const { data, error } = await getSupabaseAdmin()
      .from("business_config")
      .select("data")
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.data as Record<string, unknown>) ?? null;
  },
  async save(accountId, profile) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
      const { error } = await getSupabaseAdmin()
        .from("business_config")
        .upsert(
          { id: accountId, data: profile as unknown as Record<string, unknown>, updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );
      if (error) return { ok: false, reason: error.message.slice(0, 300) };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message.slice(0, 300) : "unknown" };
    }
  },
};

let repository: BusinessProfileRepository = supabaseRepository;

/** Tests inject an in-memory repository; pass null to restore production. */
export function setBusinessProfileRepositoryForTests(repo: BusinessProfileRepository | null): void {
  repository = repo ?? supabaseRepository;
}

/** Missing rows and failures are never cached. */
const _loaded = new Map<string, BusinessProfile>();
const _inFlight = new Map<string, Promise<BusinessProfile>>();

/** Test seam: seed a loaded profile (patch over empty) for an account. */
export function seedBusinessProfileForTests(
  accountId: string,
  patch: Partial<BusinessProfile>,
): void {
  _loaded.set(accountId, { ...emptyBusinessProfile(accountId), ...patch, accountId });
}

export function __resetBusinessProfileCacheForTests(): void {
  _loaded.clear();
  _inFlight.clear();
}

/** Invalidate only this account after a durable external write. */
export function invalidateBusinessProfileCache(accountId: string): void {
  _loaded.delete(accountId);
  _inFlight.delete(accountId);
}

const strings = z.array(z.string()), sectionOf = <T extends z.ZodType>(value: T) => z.object({ value, origin: z.enum(["inferred", "operator_confirmed", "legacy"]), confidence: z.number().nullable(), sourceUrls: strings });
const firstMention = z.object({ native: z.string(), transliteration: z.boolean(), englishContext: z.boolean() }).nullable();
const constraints = z.object({ factual: strings, legal: strings, brand: strings, editorial: strings, bannedTerms: strings, firstMention });
const profileRow = z.object({ accountId: z.string(), schemaVersion: z.literal(2), updatedAt: z.string(),
  name: sectionOf(z.string()), businessType: sectionOf(z.enum(["local_service", "content_publisher", "ecommerce", "saas", "other"]).nullable()), siteArchetype: sectionOf(z.string().nullable()),
  offerings: sectionOf(strings), audiences: sectionOf(strings), customerProblems: sectionOf(strings), geographicScope: sectionOf(strings), differentiators: sectionOf(strings), trustClaims: sectionOf(strings),
  importantPages: sectionOf(strings), topicsToOwn: sectionOf(strings), topicsToExclude: sectionOf(strings), constraints: sectionOf(constraints), trustedSourceDomains: sectionOf(strings),
  competitors: sectionOf(z.array(z.object({ name: z.string(), evidenceUrls: strings, domain: z.string().optional(), action: z.enum(["pin", "exclude", "correct"]).optional(), kind: z.string().optional() }))), legacy: z.record(z.string(), z.unknown()).optional() });
const legacyRow = z.object({ name: z.string(), businessType: z.string(), contentSiteMode: z.boolean(), services: strings, serviceTerms: strings, locations: strings, locationTerms: strings,
  keyPages: strings, contentRules: strings, flaggedTerms: strings, firstMention, authoritativeSourceDomains: strings, primaryCompetitors: strings }).partial();
/** Strict callers read the row directly; ordinary readers retain fail-soft caching. */
export async function loadBusinessProfile(accountId: string, options: { failClosed?: true } = {}): Promise<BusinessProfile> {
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("loadBusinessProfile(): accountId is required.");
  }
  const cached = !options.failClosed && _loaded.get(accountId);
  if (cached) return cached;
  const inFlight = !options.failClosed && _inFlight.get(accountId);
  if (inFlight) return inFlight;
  const p: Promise<BusinessProfile> = Promise.resolve().then(async () => {
    try {
      const raw = await repository.load(accountId);
      if (!raw) { if (options.failClosed) throw new Error("profile_read_unavailable"); return emptyBusinessProfile(accountId); }
      if (options.failClosed) {
        const readable = raw.schemaVersion === 2
          ? profileRow.safeParse(raw).success && raw.accountId === accountId
          : (raw.schemaVersion == null || raw.schemaVersion === 1) && legacyRow.safeParse(raw).success && Object.keys(legacyRow.shape).some(key => key in raw);
        if (!readable) throw new Error("profile_read_unavailable");
      }
      const profile = profileFromRow(accountId, raw);
      if (!options.failClosed && _inFlight.get(accountId) === p) _loaded.set(accountId, profile);
      return profile;
    } catch (error) {
      if (options.failClosed) throw error;
      return emptyBusinessProfile(accountId);
    } finally {
      if (_inFlight.get(accountId) === p) _inFlight.delete(accountId);
    }
  });
  if (!options.failClosed) _inFlight.set(accountId, p);
  return p;
}

type SaveBusinessProfileResult = {
  profile: BusinessProfile;
  persisted: boolean;
  persistError?: string;
};

/**
 * Save canonical section updates for an account. Single durable write path
 * (the account's own row). Never writes a domain: the Account row owns the
 * Website identity.
 */
export async function saveBusinessProfile(
  accountId: string,
  patch: Partial<Omit<BusinessProfile, "accountId" | "schemaVersion" | "legacy">>,
): Promise<SaveBusinessProfileResult> {
  const current = await loadBusinessProfile(accountId);
  // A save must never merge over a FAILED read: spreading a patch over an empty
  // base born from a transient error would permanently blank every field the
  // form does not display. An uncached base is ambiguous (failed OR genuinely
  // absent), so re-check the row directly: a row that EXISTS while our base is
  // uncached means the earlier read failed (refuse); a confirmed-absent row is
  // the legitimate first save and proceeds on the empty base.
  if (_loaded.get(accountId) !== current) {
    try {
      const raw = await repository.load(accountId);
      if (raw) return { profile: current, persisted: false, persistError: "profile_read_unavailable" };
    } catch {
      return { profile: current, persisted: false, persistError: "profile_read_unavailable" };
    }
  }
  const updated: BusinessProfile = {
    ...current,
    ...patch,
    accountId,
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
  };
  const saved = await repository.save(accountId, updated);
  if (saved.ok) _loaded.set(accountId, updated);
  return { profile: updated, persisted: saved.ok, persistError: saved.reason };
}

// ── Pure derived helpers ───────────────────────────────────────────────────

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Geographic term matcher from the profile; never-match when unset. Pure. */
export function locationRegexFrom(profile: BusinessProfile): RegExp {
  const terms = profile.geographicScope.value;
  if (terms.length === 0) return /(?!)/g;
  return new RegExp(`\\b(${terms.map(escapeRe).join("|")})\\b`, "gi");
}

/** Offering term matcher from the profile; never-match when unset. Pure. */
export function serviceRegexFrom(profile: BusinessProfile): RegExp {
  const terms = profile.offerings.value;
  if (terms.length === 0) return /(?!)/g;
  return new RegExp(
    `\\b(${terms.map((t) => escapeRe(t).replace(/\s+/g, "[\\s-]?")).join("|")})\\b`,
    "gi",
  );
}
