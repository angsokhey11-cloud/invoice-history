-- Guard-only change. Rejected and financially unposted DCC history is retained.
DO $bb_rejected_dcc$
DECLARE
 v_def text:=pg_get_functiondef('public.bb_sales_history_update_invoice_registered_wallet_v1(jsonb)'::regprocedure);
 v_old constant text:=$old$IF EXISTS(SELECT 1 FROM public.daily_cash_close_invoices WHERE invoice_id=v_id)
  OR EXISTS(SELECT 1 FROM public.daily_cash_request_invoices WHERE invoice_id=v_id)
  OR EXISTS(SELECT 1 FROM public.daily_receivable_cash_collections WHERE invoice_id=v_id)$old$;
 v_new constant text:=$new$IF EXISTS(
    SELECT 1 FROM public.daily_cash_close_invoices ci
    LEFT JOIN public.daily_cash_closes c ON c.close_id=ci.close_id
    WHERE ci.invoice_id=v_id AND (
      lower(btrim(coalesce(c.status,'')))<>'rejected'
      OR EXISTS(SELECT 1 FROM public.cash_vault_ledger l WHERE l.close_id=ci.close_id)
      OR EXISTS(SELECT 1 FROM public.company_deposits d WHERE d.daily_cash_close_id=ci.close_id)
    ))
  OR EXISTS(
    SELECT 1 FROM public.daily_cash_request_invoices ri
    LEFT JOIN public.daily_cash_requests r ON r.request_id=ri.request_id
    WHERE ri.invoice_id=v_id AND (
      lower(btrim(coalesce(r.status,'')))<>'rejected'
      OR EXISTS(SELECT 1 FROM public.cash_vault_ledger l WHERE l.close_id=ri.request_id)
      OR EXISTS(SELECT 1 FROM public.company_deposits d WHERE d.daily_cash_request_id=ri.request_id OR d.daily_cash_close_id=ri.request_id)
    ))
  OR EXISTS(SELECT 1 FROM public.daily_receivable_cash_collections WHERE invoice_id=v_id)$new$;
BEGIN
 IF position(v_new in v_def)>0 THEN RETURN; END IF;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
  RAISE EXCEPTION 'Unexpected registered wallet guard; no change';
 END IF;
 EXECUTE replace(v_def,v_old,v_new);
 IF position(v_new in pg_get_functiondef('public.bb_sales_history_update_invoice_registered_wallet_v1(jsonb)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'Rejected DCC guard verification failed';
 END IF;
END $bb_rejected_dcc$;
