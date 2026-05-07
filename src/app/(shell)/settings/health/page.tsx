// Bundle 1 (2026-05-07) — `force-dynamic` ends the chronic Vercel-deploy
// flake on this route. The shared component (re-exported from
// /diagnostics) reads live Supabase data at render time; prerendering it
// at build time hangs/timeouts intermittently and randomly fails Vercel
// deploys (e.g., T7.8 deploy failed; T7.6 needed one retry). Operator-
// only route anyway — dynamic rendering is the correct semantics.
export const dynamic = "force-dynamic";
export { default } from "../../diagnostics/page";
