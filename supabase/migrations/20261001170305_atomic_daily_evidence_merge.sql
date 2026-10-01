-- One candidate merges into its tenant's existing daily bank; unrelated kinds remain exact.
create function public.merge_daily_evidence(p_scope_key text, p_tenant_id text, p_candidate jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  tenant_slug text;
  bank jsonb;
  stored_name text;
  item jsonb;
  prior jsonb;
  candidate_day date;
  prior_day date;
  parsed_time timestamptz;
begin
  if p_tenant_id is null or btrim(p_tenant_id) = '' or jsonb_typeof(p_candidate) is distinct from 'object' then
    raise exception using errcode = '23514', message = 'invalid_daily_evidence';
  end if;
  select t.slug into tenant_slug from public.tenants t where t.id::text = p_tenant_id;
  if tenant_slug is null or btrim(tenant_slug) = '' or p_scope_key is distinct from 'daily-evidence::tenant:' || tenant_slug then
    raise exception using errcode = '23514', message = 'invalid_daily_evidence_scope';
  end if;
  -- The unique insert serializes a virgin scope; existing scopes share the same row lock.
  insert into public.json_store_blobs(scope_key, store_name, content)
    values (p_scope_key, 'daily-evidence', '[]'::jsonb) on conflict (scope_key) do nothing;
  select b.content, b.store_name into bank, stored_name from public.json_store_blobs b
    where b.scope_key = p_scope_key for update;
  if stored_name is distinct from 'daily-evidence' or jsonb_typeof(bank) is distinct from 'array' then
    raise exception using errcode = '23514', message = 'invalid_daily_evidence_bank';
  end if;
  for item in select value from jsonb_array_elements(bank || jsonb_build_array(p_candidate)) loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'tenant_id') is distinct from 'string' or item->>'tenant_id' is distinct from p_tenant_id
       or jsonb_typeof(item->'kind') is distinct from 'string'
       or item->>'kind' not in ('clarity-signals','gsc-signals','gsc-decay','ga4-values','ga4-split','ga4-revenue')
       or jsonb_typeof(item->'watermark') is distinct from 'string' or item->>'watermark' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(item->'computedAt') is distinct from 'string'
       or item->>'computedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
       or jsonb_typeof(item->'payload') not in ('array','object') or not item ? 'payload' then
      raise exception using errcode = '23514', message = 'invalid_daily_evidence_row';
    end if;
    candidate_day := (item->>'watermark')::date;
    parsed_time := (item->>'computedAt')::timestamptz;
    if not isfinite(candidate_day) or not isfinite(parsed_time) or to_char(candidate_day, 'YYYY-MM-DD') <> item->>'watermark' then
      raise exception using errcode = '23514', message = 'invalid_daily_evidence_date';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(bank)) <> (select count(distinct value->>'kind') from jsonb_array_elements(bank)) then
    raise exception using errcode = '23514', message = 'duplicate_daily_evidence_kind';
  end if;
  select value into prior from jsonb_array_elements(bank) where value->>'kind' = p_candidate->>'kind';
  candidate_day := (p_candidate->>'watermark')::date;
  prior_day := (prior->>'watermark')::date;
  -- The first complete record wins a day; an older computation never replaces a newer bank.
  if prior is null or candidate_day > prior_day then
    select coalesce(jsonb_agg(value order by position), '[]'::jsonb) into bank
      from jsonb_array_elements(bank) with ordinality entries(value, position)
      where value->>'kind' <> p_candidate->>'kind';
    bank := bank || jsonb_build_array(p_candidate);
    update public.json_store_blobs set content = bank, updated_at = clock_timestamp() where scope_key = p_scope_key;
  end if;
  return jsonb_build_object('scope_key', p_scope_key, 'content', bank);
end;
$$;
revoke all on function public.merge_daily_evidence(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.merge_daily_evidence(text, text, jsonb) to service_role;
