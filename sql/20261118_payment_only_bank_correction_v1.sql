begin;
create or replace function public.bb_sales_history_correct_bank_payment_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 v_id text:=trim(coalesce(p_payload->>'invoiceId',''));
 v_method text:=trim(coalesce(p_payload->>'method',''));
 v_reason text:=trim(coalesce(p_payload->>'reason',''));
 v_tid text:=upper(trim(coalesce(p_payload->>'transactionId','')));
 v_apply boolean:=coalesce((p_payload->>'apply')::boolean,false);
 i public.invoices%rowtype;
 p public.payments%rowtype;
 a public.bb_bank_balance_allocations%rowtype;
 old_reg public.bb_verified_bank_transactions%rowtype;
 new_reg public.bb_verified_bank_transactions%rowtype;
 v_old jsonb; v_new jsonb; v_token text;
 v_remaining numeric; v_cash numeric:=0; v_bank numeric:=0; v_paid numeric; v_out numeric; v_tol numeric; v_rate numeric;
 v_count integer; v_ledger numeric; v_expected_bank numeric; v_bank_name text;
 v_payment_id text; v_audit_id text; v_admin text; v_status text; v_lock text;
begin
 if auth.uid() is null or not public.bb_is_admin() or not public.bb_has_module_access('invoice_history','edit')
 then raise exception 'Admin Invoice History edit permission is required'; end if;
 select * into i from public.invoices where invoice_id=v_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 v_tol:=case when i.currency='KHR' then 0.5 else 0.005 end;
 if i.payment_method<>'Bank' or i.status<>'Paid' or i.grand_total<=0
 or abs(i.amount_paid-i.grand_total)>v_tol or abs(i.outstanding)>v_tol
 or abs(i.change_amount)>v_tol or coalesce(i.reversal_amount,0)<>0
 or i.currency not in ('USD','KHR') or i.exchange_rate<=0 or i.migration_review_required
 then raise exception 'Only unreversed, fully paid original Bank invoices with a registered balance are supported'; end if;
 perform 1 from public.payments where invoice_id=v_id for update;
 select count(*) into v_count from public.payments where invoice_id=v_id;
 if v_count<>1 then raise exception 'Multiple or later payments exist; use the related accounting workflow first'; end if;
 select * into p from public.payments where invoice_id=v_id;
 if lower(coalesce(p.payment_source,''))<>'invoice' or p.payment_method<>'Bank'
 or p.customer_id is distinct from i.customer_id or p.currency<>i.currency
 or abs(p.amount-i.grand_total)>v_tol or p.migration_review_required
 then raise exception 'Original bank payment does not reconcile to the invoice'; end if;
 select count(*) into v_count from public.bb_bank_balance_allocations where payment_id=p.payment_id and reversed_at is null;
 if v_count<>1 then raise exception 'Exactly one original active bank allocation is required; multi-source or manual bank payments are not supported'; end if;
 select * into a from public.bb_bank_balance_allocations where payment_id=p.payment_id and reversed_at is null for update;
 if a.payment_source<>'INVOICE' or a.invoice_currency<>i.currency or abs(a.applied_invoice_amount-p.amount)>v_tol
 or upper(trim(coalesce(p.transaction_id,'')))<>upper(trim(a.transaction_id))
 then raise exception 'Bank allocation does not reconcile to this payment'; end if;
 -- The same lock as the existing bank usage trigger, taken in stable order.
 for v_lock in select distinct x from unnest(array[upper(trim(a.transaction_id)),nullif(v_tid,'')]) x where x is not null order by x loop
  perform pg_advisory_xact_lock(hashtext('BB_BANK_TX_'||v_lock));
 end loop;
 select * into old_reg from public.bb_verified_bank_transactions where transaction_id=a.transaction_id for update;
 if not found or old_reg.status not in ('AVAILABLE','USED') then raise exception 'Original bank receipt unavailable or cancelled'; end if;
 if exists(select 1 from public.sales_returns where invoice_id=v_id)
 or exists(select 1 from public.payment_allocations where invoice_id=v_id or payment_id=p.payment_id)
 or exists(select 1 from public.ar_request_allocations where invoice_id=v_id)
 or exists(select 1 from public.ar_payment_requests where payment_id=p.payment_id)
 or exists(select 1 from public.daily_cash_close_invoices where invoice_id=v_id)
 or exists(select 1 from public.daily_cash_request_invoices where invoice_id=v_id)
 or exists(select 1 from public.daily_receivable_cash_collections where invoice_id=v_id or payment_id=p.payment_id)
 or exists(select 1 from public.company_deposits where payment_id=p.payment_id)
 or exists(select 1 from public.telegram_ar_jobs where payment_id=p.payment_id)
 then raise exception 'This invoice/payment has linked collection, deposit, return or A/R history; correct that workflow first'; end if;
 select old_reg.amount-coalesce(sum(applied_bank_amount),0) into v_remaining
 from public.bb_bank_balance_allocations where transaction_id=a.transaction_id and reversed_at is null;
 if v_remaining<-(case when old_reg.currency='KHR' then 0.5 else 0.005 end) then raise exception 'Original bank receipt is overallocated; audit required'; end if;
 v_old:=jsonb_build_object('invoice',to_jsonb(i),'payment',to_jsonb(p),'allocation',to_jsonb(a));
 v_token:=md5(v_old::text);
 if not v_apply then
  return jsonb_build_object('invoiceId',i.invoice_id,'invoiceNo',i.invoice_no,'customerId',i.customer_id,'currency',i.currency,'grandTotal',i.grand_total,'invoiceDate',i.invoice_date,'dueDate',i.due_date,'transactionId',a.transaction_id,'bankCurrency',old_reg.currency,'releaseAmount',a.applied_bank_amount,'remainingBefore',greatest(v_remaining,0),'remainingAfter',v_remaining+a.applied_bank_amount,'token',v_token);
 end if;
 if p_payload->>'token' is distinct from v_token then raise exception 'Invoice payment changed; reopen correction to review current details'; end if;
 if length(v_reason)<3 or length(v_reason)>500 then raise exception 'Enter a correction reason (3–500 characters)'; end if;
 if v_method not in ('Cash','Credit','Bank','Cash + Bank','Partially Paid in Cash','Partially Paid in Bank') then raise exception 'Select a supported replacement payment method'; end if;
 if v_method='Cash' then v_cash:=i.grand_total;
 elsif v_method='Bank' then v_bank:=i.grand_total;
 elsif v_method='Cash + Bank' then
  v_bank:=coalesce((p_payload->>'bankAmount')::numeric,0); v_cash:=i.grand_total-v_bank;
  if v_bank<=0 or v_cash<=0 then raise exception 'Enter a bank amount strictly between zero and invoice total'; end if;
 elsif v_method='Partially Paid in Cash' then
  v_cash:=coalesce((p_payload->>'cashAmount')::numeric,0);
  if v_cash<=0 or v_cash>=i.grand_total then raise exception 'Partial cash must be positive and less than total'; end if;
 elsif v_method='Partially Paid in Bank' then
  v_bank:=coalesce((p_payload->>'bankAmount')::numeric,0);
  if v_bank<=0 or v_bank>=i.grand_total then raise exception 'Partial bank must be positive and less than total'; end if;
 end if;
 if v_cash<>round(v_cash,case when i.currency='KHR' then 0 else 2 end) or v_bank<>round(v_bank,case when i.currency='KHR' then 0 else 2 end) then raise exception 'Invalid currency precision';end if;
 v_paid:=v_cash+v_bank; v_out:=i.grand_total-v_paid;
 if v_out>0 and i.due_date is null then raise exception 'Set a valid due date before reopening receivable';end if;
 if v_bank>0 then
  if v_tid='' or v_tid=upper(trim(a.transaction_id)) then raise exception 'Select a different registered bank receipt'; end if;
  select * into new_reg from public.bb_verified_bank_transactions where transaction_id=v_tid for update;
  if not found or new_reg.status<>'AVAILABLE' then raise exception 'Replacement receipt is not available'; end if;
  if new_reg.invoice_currency is not null and new_reg.invoice_currency<>i.currency then raise exception 'Replacement receipt is not approved for this invoice currency'; end if;
  v_bank_name:=nullif(trim(new_reg.bank_name),'');
  if v_bank_name is null then raise exception 'Replacement receipt requires a recorded receiving bank name';end if;
  v_rate:=case when new_reg.currency=i.currency then 1 when coalesce(new_reg.approved_exchange_rate,0)>1 then new_reg.approved_exchange_rate else i.exchange_rate end;
  if new_reg.currency<>i.currency and (v_rate<=1 or abs(v_rate-i.exchange_rate)>0.000001) then raise exception 'Replacement bank receipt exchange rate does not match the original invoice';end if;
  v_expected_bank:=case when new_reg.currency=i.currency then v_bank when new_reg.currency='KHR' then v_bank*v_rate else v_bank/v_rate end;
  -- Existing payment insert trigger enforces actual ownership, outlet-share limits, FX, receipt capacity and exact allocation.
 end if;
 select coalesce(email,user_id::text) into v_admin from public.app_users where user_id=auth.uid();
 update public.bb_bank_balance_allocations set reversed_at=now() where allocation_id=a.allocation_id and reversed_at is null;
 if not found then raise exception 'Original bank allocation already released'; end if;
 update public.bb_verified_bank_transactions set status='AVAILABLE',used_payment_id=null,used_at=null where transaction_id=a.transaction_id;
 -- The existing wallet guard permits deletion only after its allocation has been reversed.
 delete from public.payments where payment_id=p.payment_id;
 if not found then raise exception 'Original payment is missing';end if;
 if v_cash>0 then
  v_payment_id:=public.bb_next_prefixed_id('public.payments'::regclass,'payment_id','PAY',4);
  insert into public.payments(payment_id,invoice_id,invoice_no_snapshot,payment_date,customer_id,customer_name_snapshot,location_code,salesperson_staff_id,salesperson_name_snapshot,payment_method,currency,exchange_rate,amount,note,payment_source,entered_by_user_id)
  values(v_payment_id,i.invoice_id,i.invoice_no,i.invoice_date,i.customer_id,i.customer_name_snapshot,i.location_code,i.salesperson_staff_id,i.salesperson_name_snapshot,'Cash',i.currency,i.exchange_rate,v_cash,'Payment correction: '||v_reason,'Invoice',auth.uid());
 end if;
 if v_bank>0 then
  v_payment_id:=public.bb_next_prefixed_id('public.payments'::regclass,'payment_id','PAY',4);
  insert into public.payments(payment_id,invoice_id,invoice_no_snapshot,payment_date,customer_id,customer_name_snapshot,location_code,salesperson_staff_id,salesperson_name_snapshot,payment_method,bank_payment,bank_reference,transaction_id,currency,exchange_rate,amount,note,payment_source,entered_by_user_id)
  values(v_payment_id,i.invoice_id,i.invoice_no,i.invoice_date,i.customer_id,i.customer_name_snapshot,i.location_code,i.salesperson_staff_id,i.salesperson_name_snapshot,'Bank',v_bank_name,v_tid,v_tid,i.currency,i.exchange_rate,v_bank,'Payment correction: '||v_reason,'Invoice',auth.uid());
  select count(*),coalesce(sum(applied_bank_amount),0) into v_count,v_ledger from public.bb_bank_balance_allocations where payment_id=v_payment_id and transaction_id=v_tid and reversed_at is null;
  if v_count<>1 or abs(v_ledger-v_expected_bank)>(case when new_reg.currency='KHR' then 0.5 else 0.005 end) then raise exception 'Replacement bank allocation did not reconcile';end if;
 end if;
 v_status:=case when v_out<=0 then 'Paid' when v_paid>0 then 'Processing' else 'Unpaid' end;
 update public.invoices set payment_method=v_method,amount_paid=v_paid,outstanding=v_out,credit_amount=v_out,status=v_status,bank_payment=case when v_bank>0 then v_bank_name end,bank_reference=case when v_bank>0 then v_tid end where invoice_id=v_id;
 select coalesce(sum(amount),0) into v_ledger from public.payments where invoice_id=v_id;
 if abs(v_ledger-v_paid)>v_tol or not exists(select 1 from public.invoices where invoice_id=v_id and amount_paid=v_paid and outstanding=v_out and payment_method=v_method and grand_total=i.grand_total and invoice_date=i.invoice_date)
 then raise exception 'Payment correction failed reconciliation; nothing saved'; end if;
 v_new:=jsonb_build_object('invoice',(select to_jsonb(x) from public.invoices x where invoice_id=v_id),'payments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.payments x where invoice_id=v_id),'releasedAllocation',(select to_jsonb(x) from public.bb_bank_balance_allocations x where allocation_id=a.allocation_id));
 v_audit_id:=public.bb_next_prefixed_id('public.sales_database_edit_history'::regclass,'audit_id','AUD',6);
 insert into public.sales_database_edit_history(audit_id,occurred_at,module,record_id,record_no,action,field_name,old_value,new_value,reason,admin_name_snapshot)
 values(v_audit_id,now(),'Invoice History',v_id,i.invoice_no,'UPDATE','Payment Correction',v_old::text,v_new::text,v_reason,v_admin);
 return jsonb_build_object('success',true,'invoiceId',v_id,'auditId',v_audit_id,'method',v_method,'amountPaid',v_paid,'outstanding',v_out,'releasedAmount',a.applied_bank_amount,'bankCurrency',old_reg.currency);
end;
$fn$;
revoke all on function public.bb_sales_history_correct_bank_payment_v1(jsonb) from public,anon;
grant execute on function public.bb_sales_history_correct_bank_payment_v1(jsonb) to authenticated;
commit;