-- Reversible by dropping this function; existing rows, revisions and Ready guard remain intact.
create function public.save_page_source_facts_revision_cas(p_tenant text, p_page text, p_rows jsonb)
returns table(statement_key text, source_version bigint)
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  incoming public.page_source_facts%rowtype;
  prior public.page_source_facts%rowtype;
  item jsonb;
  expected bigint;
  stamp timestamptz := clock_timestamp();
  saved bigint;
begin
  perform set_config('lock_timeout', '2s', true);
  if nullif(btrim(p_tenant), '') is null or nullif(btrim(p_page), '') is null
    or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'invalid source save scope' using errcode = '22023';
  end if;
  if (select count(distinct r->>'statement_key') from jsonb_array_elements(p_rows) r) <> jsonb_array_length(p_rows) then
    raise exception 'duplicate source save identity' using errcode = '22023';
  end if;
  for item in select r from jsonb_array_elements(p_rows) r order by r->>'statement_key' loop
    incoming := jsonb_populate_record(null::public.page_source_facts, item);
    expected := incoming.source_version;
    if incoming.tenant_id is distinct from p_tenant or incoming.page_key is distinct from p_page
      or nullif(btrim(incoming.statement_key), '') is null or left(incoming.statement_key, 1) = '#'
      or nullif(btrim(incoming.subject), '') is null or incoming.current_wording is null
      or incoming.claim_state not in ('owed', 'checked', 'superseded') or incoming.claim_state is null
      or expected is not null and expected <= 0 then
      raise exception 'invalid source save ownership or revision' using errcode = '22023';
    end if;
    -- Also serializes absent-row inserts; ordered row locks coordinate with Ready's FOR SHARE locks.
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_tenant, p_page, incoming.statement_key)::text, 0));
    select f.* into prior from public.page_source_facts f
      where f.tenant_id = p_tenant and f.page_key = p_page and f.statement_key = incoming.statement_key for update;
    if found then
      if expected is null or expected <> prior.source_version then
        raise exception 'source revision changed' using errcode = '40001';
      end if;
      incoming.superseded_at := case when incoming.claim_state = 'superseded' then coalesce(prior.superseded_at, stamp) end;
      if (to_jsonb(incoming) - array['source_version','checked_at','updated_at']) =
        (to_jsonb(prior) - array['source_version','checked_at','updated_at']) then
        statement_key := prior.statement_key; source_version := prior.source_version; return next; continue;
      end if;
      insert into public.page_source_facts select (jsonb_populate_record(null::public.page_source_facts,
        to_jsonb(prior) || jsonb_build_object('statement_key', prior.statement_key || '~src' || prior.source_version,
          'claim_state', 'superseded', 'superseded_at', stamp, 'updated_at', stamp))).*;
      update public.page_source_facts f set
        page_content_hash = incoming.page_content_hash, subject = incoming.subject, current_wording = incoming.current_wording,
        proposed = incoming.proposed, literal = incoming.literal, usage = incoming.usage,
        source_url = incoming.source_url, source_quote = incoming.source_quote, source_class = incoming.source_class,
        sources = incoming.sources, agreement = incoming.agreement, confidence = incoming.confidence, verdict = incoming.verdict,
        also_at = incoming.also_at, note = incoming.note, evidence_basis = incoming.evidence_basis,
        page_locator = incoming.page_locator, source_read_at = incoming.source_read_at,
        claim_state = incoming.claim_state, superseded_at = incoming.superseded_at, rules_version = incoming.rules_version,
        checked_at = coalesce(incoming.checked_at, stamp), updated_at = stamp
      where f.tenant_id = p_tenant and f.page_key = p_page and f.statement_key = incoming.statement_key
      returning f.source_version into saved;
    else
      if expected is not null then raise exception 'source revision absent' using errcode = '40001'; end if;
      incoming.checked_at := coalesce(incoming.checked_at, stamp); incoming.updated_at := stamp;
      incoming.superseded_at := case when incoming.claim_state = 'superseded' then stamp end;
      insert into public.page_source_facts select incoming.* on conflict do nothing returning page_source_facts.source_version into saved;
      if not found then raise exception 'source insert raced' using errcode = '40001'; end if;
    end if;
    statement_key := incoming.statement_key; source_version := saved; return next;
  end loop;
end;
$$;
revoke all on function public.save_page_source_facts_revision_cas(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_page_source_facts_revision_cas(text,text,jsonb) to service_role;
