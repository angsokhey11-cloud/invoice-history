begin;
create table if not exists private.bb_payment_correction_sync_receipts_v1(
 request_id uuid primary key,
 actor_user_id uuid not null,
 invoice_id text not null,
 intent jsonb not null,
 result jsonb not null,
 completed_at timestamptz not null default now()
);
alter table private.bb_payment_correction_sync_receipts_v1 enable row level security;
revoke all on private.bb_payment_correction_sync_receipts_v1 from public,anon,authenticated;

create or replace function private.bb_replay_local_payment_correction_v1(p_intent jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $f$
declare
 rid uuid := (p_intent->>'requestId')::uuid;
 actor uuid := (p_intent->>'actor')::uuid;
 inv text := p_intent->>'invoiceId';
 old_i jsonb := p_intent->'invoice';
 old_p jsonb := p_intent->'payment';
 old_a jsonb := p_intent->'allocation';
 actual_i jsonb; actual_p jsonb; actual_a jsonb; p jsonb; r jsonb; prior jsonb; prior_intent jsonb;
 prev_sub text; prev_claims text;
begin
 if current_user not in ('postgres','supabase_admin') then raise exception 'Trusted database controller required'; end if;
 if rid is null or actor is null or inv is null or p_intent->>'version' is distinct from 'LOCAL_PAYMENT_INTENT_V1'
 or old_i->>'invoice_id' is distinct from inv or old_p->>'invoice_id' is distinct from inv
 or old_a->>'payment_id' is distinct from old_p->>'payment_id'
 or old_a->>'reversed_at' is not null then raise exception 'Invalid Local correction request'; end if;
 perform pg_advisory_xact_lock(hashtext('BB_LOCAL_PAYMENT_INTENT_'||rid::text));
 select result,intent into prior,prior_intent from private.bb_payment_correction_sync_receipts_v1 where request_id=rid;
 if found then
  if prior_intent is distinct from p_intent then raise exception 'Local request ID reused with a different payload';end if;
  return prior;
 end if;
 if not exists(select 1 from public.app_users u join public.app_user_module_access m using(user_id)
   where u.user_id=actor and u.active and lower(u.role)='admin' and lower(m.module_key)='invoice_history' and m.can_edit)
 then raise exception 'Local correction actor has no current Cloud Admin edit permission';end if;
 select to_jsonb(i) into actual_i from public.invoices i where i.invoice_id=inv for update;
 select to_jsonb(p0) into actual_p from public.payments p0 where payment_id=old_p->>'payment_id' for update;
 select to_jsonb(a) into actual_a from public.bb_bank_balance_allocations a where allocation_id=(old_a->>'allocation_id')::uuid for update;
 if actual_i is null or actual_p is null or actual_a is null
 or (actual_i-'updated_at') is distinct from (old_i-'updated_at')
 or (actual_p-array['updated_at','entered_by_user_id','approved_by_user_id']) is distinct from (old_p-array['updated_at','entered_by_user_id','approved_by_user_id'])
 or actual_a is distinct from old_a then
  raise exception 'Cloud payment or invoice changed after Local snapshot; correction not applied';
 end if;
 -- Run the original audited correction, with its ordinary bank and credit guards active.
 prev_sub:=current_setting('request.jwt.claim.sub',true);
 prev_claims:=current_setting('request.jwt.claims',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 p:=public.bb_sales_history_correct_bank_payment_v1(jsonb_build_object('invoiceId',inv));
 r:=public.bb_sales_history_correct_bank_payment_v1(jsonb_build_object(
  'invoiceId',inv,'apply',true,'token',p->>'token',
  'method',p_intent#>>'{replacement,method}','reason',p_intent#>>'{replacement,reason}',
  'cashAmount',p_intent#>>'{replacement,cashAmount}','bankAmount',p_intent#>>'{replacement,bankAmount}',
  'transactionId',p_intent#>>'{replacement,transactionId}'));
 perform set_config('request.jwt.claim.sub',coalesce(prev_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(prev_claims,''),true);
 if not coalesce((r->>'success')::boolean,false) or nullif(r->>'auditId','') is null
 then raise exception 'Cloud payment correction failed';end if;
 insert into private.bb_payment_correction_sync_receipts_v1(request_id,actor_user_id,invoice_id,intent,result)
 values(rid,actor,inv,p_intent,r);
 return r;
end
$f$;
revoke all on function private.bb_replay_local_payment_correction_v1(jsonb) from public,anon,authenticated;
commit;