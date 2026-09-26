-- Source revisions are database-owned and monotonic across deletion/reinsertion.
-- Ready locks the exact used fact rows; a refusal rolls back the entire caller transaction.
create sequence public.page_source_fact_revision_seq as bigint;
alter table public.page_source_facts add column source_version bigint;
update public.page_source_facts set source_version = nextval('public.page_source_fact_revision_seq');
alter table public.page_source_facts alter column source_version set not null;
alter sequence public.page_source_fact_revision_seq owned by public.page_source_facts.source_version;
alter table public.page_source_facts add constraint page_source_fact_revision_positive check (source_version > 0);

create function public.assign_page_source_fact_revision() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $function$
begin
  if tg_op = 'INSERT' then
    new.source_version := nextval('public.page_source_fact_revision_seq');
  elsif (to_jsonb(new) - array['source_version','checked_at','updated_at'])
      is distinct from (to_jsonb(old) - array['source_version','checked_at','updated_at']) then
    new.source_version := nextval('public.page_source_fact_revision_seq');
  else
    new.source_version := old.source_version;
  end if;
  return new;
end;
$function$;
revoke all on function public.assign_page_source_fact_revision() from public, anon, authenticated, service_role;
revoke all on sequence public.page_source_fact_revision_seq from public, anon, authenticated, service_role;
create trigger trg_page_source_fact_revision before insert or update on public.page_source_facts
for each row execute function public.assign_page_source_fact_revision();

create function public.guard_ready_source_revisions() returns trigger
language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '2s' as $function$
declare
  p jsonb := new.payload->'proposal';
  used_id text;
  bound jsonb;
  refs jsonb := '[]'::jsonb;
  f public.page_source_facts%rowtype;
  locked integer := 0;
begin
  if new.status <> 'ready' or new.terminal_disposition is not null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'ready' and old.terminal_disposition is null
     and new.tenant_id = old.tenant_id and new.id = old.id
     and new.page_key = old.page_key and new.case_id = old.case_id and new.mutation_key = old.mutation_key
     and new.basis is not distinct from old.basis and new.proposal_version = old.proposal_version
     and (new.payload #- '{proposal,rankingReceipt}') is not distinct from (old.payload #- '{proposal,rankingReceipt}')
     then return new; end if;
  if jsonb_typeof(p) is distinct from 'object' or p->>'tenantId' is distinct from new.tenant_id
     or p->>'id' is distinct from new.id or p->>'status' is distinct from 'ready' then
    raise exception using errcode = '23514', message = 'source_changed';
  end if;
  -- Final publication ledgers include remapped compound/new-page IDs, not unused historical pieces.
  for used_id in
    select distinct id from (
      select jsonb_array_elements_text(coalesce(c->'supportedBy', '[]'::jsonb)) id
        from jsonb_array_elements(coalesce(p->'claims', '[]'::jsonb)) c
      union all
      select jsonb_array_elements_text(coalesce(u->'by', '[]'::jsonb))
        from jsonb_array_elements(coalesce(p->'preservation', '[]'::jsonb)) u
      union all
      select jsonb_array_elements_text(coalesce(p #> '{informationGain,by}', '[]'::jsonb))
      union all
      select jsonb_array_elements_text(coalesce(c->'evidenceKeys', '[]'::jsonb))
        from jsonb_array_elements(coalesce(p #> '{bundle,components}', '[]'::jsonb)) c
    ) ids where id like 'fact-%' order by id
  loop
    if (select count(*) from jsonb_array_elements(coalesce(p->'supportFacts', '[]'::jsonb)) s where s->>'id' = used_id) <> 1 then
      raise exception using errcode = '23514', message = 'source_changed';
    end if;
    select s->'finding' into bound from jsonb_array_elements(p->'supportFacts') s where s->>'id' = used_id;
    if bound->>'tenantId' is distinct from new.tenant_id or nullif(bound->>'page', '') is null
       or nullif(bound->>'statementKey', '') is null or jsonb_typeof(bound->'sourceVersion') is distinct from 'number'
       or (bound->>'sourceVersion') !~ '^[1-9][0-9]*$' then
      raise exception using errcode = '23514', message = 'source_changed';
    end if;
    refs := refs || jsonb_build_array(bound);
  end loop;
  for f in
    select facts.* from public.page_source_facts facts
    join (select distinct r->>'page' page, r->>'statementKey' statement from jsonb_array_elements(refs) r) keys
      on facts.page_key = keys.page and facts.statement_key = keys.statement
    where facts.tenant_id = new.tenant_id
    order by facts.tenant_id, facts.page_key, facts.statement_key for share of facts
  loop
    locked := locked + 1;
    if exists (select 1 from jsonb_array_elements(refs) r where r->>'page' = f.page_key
        and r->>'statementKey' = f.statement_key and (r->>'sourceVersion')::numeric <> f.source_version)
       or (f.claim_state = 'checked' and f.source_read_at is not null and nullif(btrim(f.proposed), '') is not null
         and ((f.page_key like 'topic:%' and p->>'kind' = 'new_page' and p #>> '{recommendedChange,kind}' = 'new_page'
           and f.current_wording = '' and f.page_content_hash is null and f.evidence_basis is not null)
           or (f.page_key not like 'topic:%' and nullif(btrim(f.page_content_hash), '') is not null))
         and f.evidence_basis is not distinct from new.basis and f.rules_version in (4, 5)
         and f.agreement in ('multiple_agree', 'single_source')
         and ((btrim(f.current_wording) = '' and f.verdict = 'page_correct' and f.confidence in ('confirmed', 'likely'))
           or (btrim(f.current_wording) <> '' and f.verdict in ('page_wrong', 'page_imprecise') and f.confidence = 'confirmed'))) is not true
       or not exists (select 1 from jsonb_array_elements(f.sources) s
         where nullif(btrim(s->>'url'), '') is not null and nullif(btrim(s->>'says'), '') is not null
           and s #>> '{support,supported}' = 'true' and s #>> '{support,version}' = '3'
           and s #>> '{support,identity}' ~ '^[a-f0-9]{64}$' and nullif(btrim(s #>> '{support,supportSpan}'), '') is not null) then
      raise exception using errcode = '23514', message = 'source_changed';
    end if;
  end loop;
  if locked <> (select count(*) from (select distinct r->>'page', r->>'statementKey' from jsonb_array_elements(refs) r) natural_keys) then
    raise exception using errcode = '23514', message = 'source_changed';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_ready_source_revisions() from public, anon, authenticated, service_role;
create trigger trg_ready_source_revisions before insert or update on public.change_proposals
for each row execute function public.guard_ready_source_revisions();
