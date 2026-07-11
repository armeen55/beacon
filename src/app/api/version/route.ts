import { NextResponse } from "next/server";

// Never statically rendered: the answer is the CURRENTLY DEPLOYED build's
// identity, read fresh from the runtime environment on every request.
export const dynamic = "force-dynamic";

/**
 * /api/version (2026-07-12) - deployment identity.
 *
 * Beacon exposes no way to confirm, from outside, which commit is actually live
 * in production, so a given SHA's deployment could not be verified after a push.
 * This is a public, zero-secret, zero-data-read GET that returns the identity
 * Vercel injects into the build's environment. Each field is null when unset
 * (e.g. a local `next start` outside Vercel), never a throw.
 *
 * PUBLIC by design: it reads only build-identity env vars (a commit SHA, a
 * branch ref, a deployment id - all already public facts about a deploy) and
 * touches no tenant data, no secrets, and no store. The auth middleware allows
 * it through the same public-path list that already carries /api/cron.
 */
export function GET(): NextResponse {
  return NextResponse.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    deployedId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  });
}
