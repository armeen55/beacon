#!/usr/bin/env bash
# ============================================================================
# observe-rls-phase1-state.sh
#
# Read-only observation helper for RLS Phase 1 (Stages E0, E0.1, E1.A, E1.B+).
# Prints:
#   • Current Cat-A1 + Cat-A2 policy state (per-table policy list)
#   • Total public.pg_policies row count
#   • is_tenant_member helper grants
#   • Latest write timestamp + row count for each Cat-A1 table
#   • Latest write timestamp + row count for each Cat-A2 table
#   • Route health for /today, /recommendations, /changes, /prompts
#
# This script PERFORMS NO WRITES. It only reads. Safe to run any time
# during the observation window without operator approval.
#
# Requires:
#   • supabase CLI on PATH (or override SUPABASE_BIN env var)
#   • Run from a directory where `supabase db query --linked` works
#     (the repo root has the linked project ref). The script will cd
#     into REPO_ROOT before each supabase call.
#   • curl on PATH (uses /usr/bin/curl explicitly to avoid alias issues)
#
# Usage:
#   bash scripts/observe-rls-phase1-state.sh
#
# Optional env overrides:
#   REPO_ROOT       — defaults to the directory containing supabase/config.toml
#   SUPABASE_BIN    — defaults to `supabase`
#   PROD_HOST       — defaults to https://beacon-eosin.vercel.app
# ============================================================================

set -u
set -o pipefail

REPO_ROOT="${REPO_ROOT:-/Users/armeen/beacon}"
SUPABASE_BIN="${SUPABASE_BIN:-/opt/homebrew/bin/supabase}"
PROD_HOST="${PROD_HOST:-https://beacon-eosin.vercel.app}"
CURL="${CURL:-/usr/bin/curl}"

CAT_A1=(changelog_entries import_runs recommendation_responses results scan_findings)
CAT_A2=(change_outcomes daily_metric_snapshots guardrail_alerts llm_rejections \
  observation_runs page_element_inventory page_snapshots pages \
  prompt_answer_observations raw_poll_chunks recommended_edits url_change_outcomes)

bar() { printf '%s\n' "============================================================================"; }
hdr() { bar; printf '  %s\n' "$1"; bar; }

dbq() {
  local sql="$1"
  ( cd "$REPO_ROOT" && "$SUPABASE_BIN" db query --linked "$sql" 2>&1 )
}

route_check() {
  local path="$1"
  local code bytes
  code=$("$CURL" -sk -o /dev/null -w "%{http_code}" "${PROD_HOST}${path}" --max-time 20 || echo "ERR")
  bytes=$("$CURL" -sk "${PROD_HOST}${path}" --max-time 20 | /usr/bin/wc -c | /usr/bin/tr -d ' ' || echo "?")
  printf '  %-30s HTTP %s   %s bytes\n' "$path" "$code" "$bytes"
}

hdr "1. Helper grants — public.is_tenant_member(text)"
dbq "SELECT array_agg(grantee || ':' || privilege_type ORDER BY grantee) AS grants
     FROM information_schema.routine_privileges
     WHERE routine_schema='public' AND routine_name='is_tenant_member';"

hdr "2. Helper metadata — security/volatility/search_path"
dbq "SELECT p.prosecdef AS security_definer, p.provolatile AS volatility,
            p.proconfig AS config, r.rolname AS owner
     FROM pg_proc p
     JOIN pg_roles r ON r.oid = p.proowner
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='is_tenant_member';"

hdr "3. Total public policy count (baseline = 72)"
dbq "SELECT count(*) AS total_policies FROM pg_policies WHERE schemaname='public';"

join_quoted() {
  # Build a comma-separated SQL list of single-quoted identifiers from
  # arguments. Avoids the IFS-expansion trap that swallowed commas when
  # the prior version interpolated array expansion directly into SQL.
  local out=""
  local item
  for item in "$@"; do
    if [ -z "$out" ]; then out="'$item'"; else out="$out,'$item'"; fi
  done
  printf '%s' "$out"
}

hdr "4. Cat-A1 policy state (expect deny_anon + tenant_authenticated_rw)"
A1_LIST=$(join_quoted "${CAT_A1[@]}")
dbq "SELECT tablename, array_agg(policyname ORDER BY policyname) AS policies
     FROM pg_policies WHERE schemaname='public'
       AND tablename IN ($A1_LIST)
     GROUP BY tablename ORDER BY tablename;"

hdr "5. Cat-A2 policy state"
A2_LIST=$(join_quoted "${CAT_A2[@]}")
dbq "SELECT tablename, array_agg(policyname ORDER BY policyname) AS policies
     FROM pg_policies WHERE schemaname='public'
       AND tablename IN ($A2_LIST,'tenant_members')
     GROUP BY tablename ORDER BY tablename;"

hdr "6. Cat-A1 latest write + row count"
dbq "SELECT 'changelog_entries' AS tbl, count(*) AS rows, NULL::text AS last_ts FROM public.changelog_entries
     UNION ALL
     SELECT 'import_runs', count(*), max(started_at)::text FROM public.import_runs
     UNION ALL
     SELECT 'recommendation_responses', count(*), max(responded_at)::text FROM public.recommendation_responses
     UNION ALL
     SELECT 'results', count(*), max(created_at)::text FROM public.results
     UNION ALL
     SELECT 'scan_findings', count(*), max(detected_at)::text FROM public.scan_findings
     ORDER BY tbl;"

hdr "7. Cat-A2 latest write + row count"
# Column names verified against information_schema at draft time. guardrail_alerts
# has no timestamp column (row count only).
dbq "SELECT 'change_outcomes' AS tbl, count(*) AS rows, max(computed_at)::text AS last_ts FROM public.change_outcomes
     UNION ALL
     SELECT 'daily_metric_snapshots', count(*), max(date)::text FROM public.daily_metric_snapshots
     UNION ALL
     SELECT 'guardrail_alerts', count(*), '(no timestamp column)'::text FROM public.guardrail_alerts
     UNION ALL
     SELECT 'llm_rejections', count(*), max(rejected_at)::text FROM public.llm_rejections
     UNION ALL
     SELECT 'observation_runs', count(*), max(completed_at)::text FROM public.observation_runs
     UNION ALL
     SELECT 'page_element_inventory', count(*), max(observed_at)::text FROM public.page_element_inventory
     UNION ALL
     SELECT 'page_snapshots', count(*), max(fetched_at)::text FROM public.page_snapshots
     UNION ALL
     SELECT 'pages', count(*), max(last_observed_at)::text FROM public.pages
     UNION ALL
     SELECT 'prompt_answer_observations', count(*), max(observed_at)::text FROM public.prompt_answer_observations
     UNION ALL
     SELECT 'raw_poll_chunks', count(*), max(created_at)::text FROM public.raw_poll_chunks
     UNION ALL
     SELECT 'recommended_edits', count(*), max(created_at)::text FROM public.recommended_edits
     UNION ALL
     SELECT 'url_change_outcomes', count(*), max(recorded_at)::text FROM public.url_change_outcomes
     ORDER BY tbl;"

hdr "8. Route health — production"
route_check "/today"
route_check "/recommendations"
route_check "/changes"
route_check "/prompts"

bar
printf '  Done. This script wrote nothing. All queries are read-only.\n'
bar
