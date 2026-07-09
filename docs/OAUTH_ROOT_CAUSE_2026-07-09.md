# Google OAuth token death, root-cause diagnosis (2026-07-09)

Read-only investigation. No source files were changed. This doc is the deliverable.

## Symptom

Google connectors (`google_gsc`, `google_ga4`, `google_gbp`) keep dying every few days with
`token_expired` / `invalid_grant`. Nightly cron logs show `gsc_auth_transient` and
`token_expired` streaks. The operator says he PUBLISHED the OAuth app in Google Cloud Console,
so the 7-day Testing-mode refresh-token expiry should no longer apply.

Tokens live in Supabase `connector_tokens` (composite PK `tenant_id, provider`), one row per
provider, `payload` jsonb holding `access_token` / `refresh_token` / `expires_at` /
`connected_at` / `last_synced_at` / `auth_failed_at`.

## Full refresh flow (as built)

1. Auth URL is built in `src/lib/connectors/google-auth.ts:232` `buildGoogleAuthUrl`. Every URL
   hardcodes `access_type: "offline"` and `prompt: "consent"` (lines 241-242) and requests
   exactly ONE scope per kind (`SCOPES`, lines 71-75): gsc = `webmasters.readonly`,
   ga4 = `analytics.readonly`, gbp = `business.manage`. There is NO `include_granted_scopes`
   and NO `approval_prompt` anywhere in the repo (grep confirmed).
2. Callback `src/app/api/connectors/google/callback/route.ts:130` exchanges the code, then at
   lines 162-173 PRESERVES the previously-stored refresh token when Google returns none on
   re-consent, then `saveConnectorToken` full-row upserts the payload (line 176).
3. Token persistence: `src/lib/connector-store.ts:667` `saveConnectorToken` is a full-row
   upsert on conflict `tenant_id,provider` (lines 673-681). `updateConnectorToken` (line 774)
   is a read-existing then spread-merge then `saveConnectorToken` (lines 786-791), no row lock.
4. Access-token refresh: `src/lib/connectors/google-auth.ts:293` `refreshGoogleAccessToken`
   posts `grant_type=refresh_token`. It parses the full `GoogleTokenResponse` (line 331) but
   returns ONLY `{ access_token, expires_in }` (line 332). Any `refresh_token` in the response
   is DISCARDED.
5. Persist-after-refresh: `src/lib/connectors/gsc/search-analytics.ts:81`
   `refreshAndPersistGscToken` patches ONLY `access_token` + `expires_at` (lines 88-95). GA4
   (`src/lib/connectors/ga4/data-api.ts:277,351`) and the GSC URL-inspection client
   (`src/lib/connectors/gsc/client.ts:294`) refresh IN MEMORY and do not persist at all.
   No refresh path anywhere writes `refresh_token` back to the row.
6. Auth-failure stamping: `src/lib/connectors/gsc/sync-search-analytics.ts:155`
   `stampGscAuthFailure` and `src/lib/connectors/ga4/sync-url-traffic.ts:143`
   `stampGa4AuthFailure` each do their OWN live `refreshGoogleAccessToken` probe, then set
   `auth_failed_at` ONLY on `invalid_grant`, clear it on success, and leave it unchanged on any
   other error. `getConnectorHealth` (`connector-store.ts:568`) reads `auth_failed_at` to raise
   the "Reconnect Google" prompt.
7. Sync triggers (all can run against the same row near-simultaneously): nightly cron
   `src/lib/connectors/cron-sync.ts:83-84`, on-demand from
   `src/app/(shell)/settings/connectors/actions.ts:921,930,979,985`, and diagnostics
   `src/app/(shell)/diagnostics/connectors/actions.ts:132`.

## Bug-class findings (each class from the task, checked against the code)

- (a) Refresh returns no new refresh_token but code overwrites the stored one with empty/undefined:
  NOT PRESENT / HANDLED. The callback preserves the existing token (route.ts:162-173), and NO
  refresh path writes `refresh_token` at all (see flow 4-5). Ruled out.
- (b) Two concurrent refreshes race and a stale write clobbers a fresh token: PRESENT but LOW
  impact. Cron + on-render sync + the stamp-probe all call `refreshGoogleAccessToken` for the
  same row, and `updateConnectorToken` is an unlocked read-modify-write (connector-store.ts:786-791),
  so `access_token`/`expires_at` can be clobbered last-write-wins. It does NOT brick the grant
  because `refresh_token` is never part of the patch. Worst case is a wasted extra refresh.
- (c) Refresh-token ROTATION not persisted: PRESENT (latent). `refreshGoogleAccessToken` throws
  away any rotated `refresh_token` (google-auth.ts:331-332) and no persist path stores one, so
  if Google ever returns a new refresh token the app keeps using the OLD one. If the old one was
  invalidated by the rotation, the next refresh is `invalid_grant`. Google usually does not
  rotate on the web-server offline flow, so this is a real but lower-probability primary cause.
- (d) Same account connected for multiple providers/tenants, 50-refresh-token cap: PRESENT and
  material. All three providers use ONE `GOOGLE_CLIENT_ID` and one Google account, each with its
  own separate consent and separate refresh token. Google enforces ~50 refresh tokens per
  (client, account); the 51st silently revokes the OLDEST, which can be an ACTIVE token for a
  DIFFERENT provider. That reads as a random provider dying "every few days."
- (e) `prompt=consent` + `access_type=offline` on EVERY login mints a NEW refresh token per
  login: PRESENT (google-auth.ts:241-242). Combined with (d) and the app's own aggressive
  "Reconnect Google" prompting, this is a vicious cycle: a token dies, the operator reconnects,
  `prompt=consent` mints yet another token toward the 50 cap, and the oldest live token gets
  revoked, killing another provider.
- (f) Providers sharing one payload row/key: NOT PRESENT. Composite PK is `tenant_id,provider`
  and each provider stores a separate row with its own refresh token (connector-store.ts:673-681,
  329-346). Ruled out.

## Ranked root cause

1. HIGH confidence: The OAuth app is "In production" (published) but its SENSITIVE / RESTRICTED
   scopes (`webmasters.readonly`, `analytics.readonly`, `business.manage`) are NOT verified.
   Publishing status and verification status are two different Console settings. Google keeps the
   7-day refresh-token expiry on production-but-unverified apps that use sensitive scopes. The
   "every few days" interval is the tell (it is ~7 days). Not a code bug; a Console verification
   step. Code CANNOT fix it but MUST log lifetime so it is provable in one look.
2. MEDIUM confidence: refresh-token churn against the 50-per-account cap, caused by hardcoded
   `prompt=consent` (google-auth.ts:241) plus three providers on one client/account plus the
   reconnect vicious cycle. This kills a provider the operator did NOT just touch, looking random.
3. MEDIUM-LOW confidence: rotated refresh tokens silently discarded (google-auth.ts:331-332). A
   real latent brick if Google ever rotates; cheap to make safe.
4. LOW confidence: concurrent-refresh race wasting refreshes and occasionally tripping rate
   limits that then log as `gsc_auth_transient`. Annoyance, not the death.

## Exact code changes to fix

- FIRST (verification, not code): confirm in Google Cloud Console that the OAuth consent screen
  is not only "In production" but that verification for the three sensitive scopes is COMPLETE.
  If verification is pending or was never submitted, that is cause #1 and no code change stops it.
- `src/lib/connectors/google-auth.ts:241-242` `buildGoogleAuthUrl`: stop forcing a new refresh
  token on every login. Add `include_granted_scopes: "true"` and drop `prompt: "consent"` in
  favor of `prompt: "select_account"` (or make `prompt=consent` conditional on the caller having
  NO stored refresh token for that provider). This stops the churn in cause #2. Keep
  `access_type: "offline"`.
- `src/lib/connectors/google-auth.ts:293-333` `refreshGoogleAccessToken`: change the return type
  to include `refresh_token?: string` and return `data.refresh_token` when Google sends one.
- `src/lib/connectors/gsc/search-analytics.ts:88-95` `refreshAndPersistGscToken` and the GA4 /
  GSC-client refresh sites (`ga4/data-api.ts:277,351` and `gsc/client.ts:294`): when the refresh
  response carries a new `refresh_token`, persist it via `updateConnectorToken` alongside
  `access_token`/`expires_at`. Closes cause #3.
- Optional hardening for cause #2 exhaustion: at the callback (route.ts, after a successful save),
  or in a small maintenance pass, call Google's token-revocation endpoint on the PRIOR refresh
  token before minting a replacement, so a reconnect frees a slot instead of consuming one toward
  the 50 cap.
- Optional for cause #4: dedupe concurrent refreshes for a (tenant, provider) with an in-process
  single-flight guard so cron + on-render + stamp-probe share one refresh result.

## Traceable diagnostics plan (make the next death attributable in one look)

Log the following at refresh time (in `refreshGoogleAccessToken` and at each call site), never
printing the token itself:

- `refresh_fp`: first 8 hex of `sha256(refresh_token)`. Lets you see WHICH refresh token was
  used and detect silently changing tokens (rotation or a new consent replacing the row).
- `issued_at` and computed `age_days = now - connected_at` at the moment of `invalid_grant`. If
  ages cluster at ~7 days, that proves cause #1 (unverified sensitive scopes). If deaths
  correlate with reconnect events / a rising token count instead, that points at cause #2.
- Full Google error body on failure, specifically `error_description` (not just the `error`
  code). `refreshGoogleAccessToken` already logs `body.slice(0,500)` at google-auth.ts:321-325,
  but the stamp paths only regex `invalid_grant`; surface `error_description` at the stamp call
  sites too so "Token has been expired or revoked" is captured verbatim.
- `provider`, `trigger` (cron vs shell-render vs stamp-probe vs on-demand), and a per-request id,
  so the concurrency (cause #4) and cross-provider kills (cause #2) are visible in one grep.
- A mint ledger: on every successful callback save, log `provider` + `refresh_fp` + `connected_at`.
  Watching `refresh_fp` values accumulate for the one account is how you SEE the 50-cap approach
  and prove cause #2, and it also shows exactly when an old provider token was displaced.
- Persist `refresh_fp` and `issued_at` onto the payload at callback time so a later death can be
  compared to the mint record without reconstructing history.
