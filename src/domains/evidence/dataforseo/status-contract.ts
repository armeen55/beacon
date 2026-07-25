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
 *           Service Unavailable.", 50303 "Update in progress. Please try after a few
 *           minutes." Provider-side and the task id survives, so the retry is a FREE
 *           collect, never a new charge. These five are the ONLY codes the docs mark
 *           temporary that we act on automatically.
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
 *           DELIBERATE DEVIATION, stated plainly: the docs describe 50304, 50401 and
 *           50402 as temporary. We still refuse them automatically for the reasons
 *           above; an operator sees the raw code instead of a silent loop or a bill.
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

/** THE context-aware policy for a PAID response (Standard task POST or Live).
 *  ONE decision point. Callers never re-derive it from codes, from numeric
 *  ranges (there are none anywhere in this file), or from the status TEXT, which
 *  is provider prose and is parsed nowhere in the codebase.
 *  THE POLICY, in four rules:
 *   1. Only an exact 40401/40403 in the body of a FREE Task GET ever authorizes
 *      repost_once. That decision lives on the collect path, not here.
 *   2. The same 40401/40403 arriving on a fresh POST or Live response is
 *      "blocked": a reply to a task we just posted cannot prove that task is
 *      missing, and reposting there would buy the same work twice.
 *   3. BOTH the top-level and the task-level status are judged, never only one.
 *      A top-level 20000 is the neutral successful-envelope wrapper and is
 *      ignored. A retryable release needs at least one non-success status
 *      PRESENT and EVERY non-success status present to be one of the five exact
 *      documented temporary codes (50000/50001/50301/50302/50303), carrying a
 *      provider-REPORTED cost of exactly 0. A reported zero is the only proof we
 *      were not charged.
 *   4. Any code the docs do not list fails closed onto "blocked", and so does any
 *      CONFLICTING pair (a terminal, auth, payment or unknown status sitting
 *      beside a temporary one) and a rejected paid response carrying no
 *      non-success status at all: neither proves the failure was temporary.
 *  The three outcomes:
 *    retry_free_release - REPORTED cost 0 AND only exact temporary server failure:
 *      refund the reservation and release for a later clean attempt (nothing was
 *      created, so nothing can duplicate).
 *    blocked - REPORTED cost 0 but the outcome is terminal, malformed, unknown,
 *      or a collect-only code on the wrong context: refund, then hold the row
 *      DURABLY so nothing automatic ever retries it.
 *    uncertain - the cost is not a reported zero (any other number, or null
 *      because the provider reported nothing): we may have been charged, so keep
 *      the reservation and quarantine. */
export type PaidResponseAction = "retry_free_release" | "blocked" | "uncertain";
export function classifyPaidResponse(topCode: number | null, taskCode: number | null, providerCost: number | null): PaidResponseAction {
  if (providerCost !== 0) return "uncertain";
  const present = [topCode, taskCode]
    .filter((c): c is number => c !== null)
    .map(classifyTaskStatus)
    .filter((c) => c !== "ready");
  return present.length > 0 && present.every((c) => c === "transient") ? "retry_free_release" : "blocked";
}
