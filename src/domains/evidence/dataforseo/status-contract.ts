/**
 * status-contract (Slice 6E) - THE one typed DataForSEO task-status taxonomy.
 * Callers consume the returned class; nobody re-creates ranges or parses strings.
 * Verified code by code against https://docs.dataforseo.com/v3/appendix/errors/
 * on 2026-07-25. EXACT codes only: a range is what lets an unproven code authorize
 * a paid repost, so there are none here.
 *
 * ready     20000 "Ok."
 * waiting   20100 "Task Created.", 40601 "Task Handed.", 40602 "Task in Queue.",
 *           and a body carrying no status code at all (null): still on the provider.
 * missing   40401 "Task Not Found.", 40403 "Results Expired." Only these two are
 *           PROVEN dead, so only these two may clear the identity and authorize the
 *           single repost downstream.
 * transient 50000 "Internal Error.", 50001 "Error While Checking the Balance.",
 *           50301 "3rd Party API Service Unavailable.", 50302 "Internal 3rd Party API
 *           Service Unavailable.", 50303 "Update in progress." Provider-side and the
 *           task id survives, so the retry is a FREE collect, never a new charge.
 * blocked   EVERYTHING else, deliberately: it fails closed, keeps the identity, posts
 *           nothing, and shows the operator the raw code. Notably 40400 "Not found.",
 *           40402 "Invalid Path.", 40404 "Not found.", 40405 "Textual
 *           content on the target page is insufficient.", 40406 "Requested page was
 *           not submitted for crawling.", 40407 "Duplicate Host." (a duplicate must
 *           never trigger another post), 40408 "Target URL is invalid."; every 401xx
 *           auth, 402xx payment or limit, 400xx and 405xx malformed-request code;
 *           50100 "Not Implemented." (terminal unsupported, NOT transient); 50304
 *           "This function temporarily unavailable. Please contact support" (the docs
 *           send the operator to support, so a silent free loop would hide it); 50401
 *           "Internal Error - Timeout." and 50402 "Target page took too long to
 *           respond." (live mode only, where any retry is a NEW PAID call, so neither
 *           can be a free retry); and any code the docs do not list at all.
 */

export type TaskStatusClass = "ready" | "waiting" | "missing" | "blocked" | "transient";

const EXACT = new Map<number, TaskStatusClass>([
  [20000, "ready"],
  [20100, "waiting"], [40601, "waiting"], [40602, "waiting"],
  [40401, "missing"], [40403, "missing"],
  [50000, "transient"], [50001, "transient"], [50301, "transient"], [50302, "transient"], [50303, "transient"],
]);

/** Exact documented codes only; anything else fails closed onto "blocked". */
export function classifyTaskStatus(code: number | null): TaskStatusClass {
  if (code === null) return "waiting";
  return EXACT.get(code) ?? "blocked";
}
