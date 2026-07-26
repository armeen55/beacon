import "server-only";

/**
 * dataforseo/types — the env contract the DataForSEO boundary reads. The call
 * result vocabulary lives in funnel-boundary.ts (CachedCallResult); the old
 * five-state per-reader vocabulary was deleted with its readers in Slice 6.
 */

/** The env shape the boundary reads. Names only; values never logged. */
export type DataForSeoEnv = {
  login?: string;
  password?: string;
  /** Pre-encoded base64(login:password) — the dashboard "Base64 Format" string.
   *  When present it is used verbatim, bypassing login/password assembly. */
  authB64?: string;
  monthlyCapUsd?: string;
};
