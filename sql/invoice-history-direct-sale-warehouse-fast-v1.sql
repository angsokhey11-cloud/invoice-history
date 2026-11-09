-- BIG BROTHER Invoice History: fast Warehouse catalog for Direct Sale
-- Applied to BIG BROTHER DEV Supabase on 09-Nov-2026.
-- Source copy for Local Brain database schema parity.
-- Preserves existing Admin authorization, batch-sale branch and product output schema.
-- Run ONLY against the correct Local Brain DB after reviewing local schema dependencies.

CREATE OR REPLACE FUNCTION public.bb_sales_history_edit_product_catalog(p_invoice_id text, p_customer_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invoice public.invoices%rowtype;
  v_customer_id text;
  v_movement_id text;
  v_products jsonb;
begin
  if not public.bb_is_admin()
     or not public.bb_has_module_access('invoice_history','edit')
  then
    raise exception 'Only BIG BROTHER Admin can edit Invoice History';
  end if;

  select * into v_invoice
  from public.invoices i
  where i.invoice_id=trim(coalesce(p_invoice_id,''));

  if not found then raise exception 'Invoice was not found'; end if;

  v_customer_id:=coalesce(
    nullif(trim(coalesce(p_customer_id,'')),''),
    v_invoice.customer_id
  );

  select s.stock_movement_id into v_movement_id
  from public.sales_stock_sync s
  where s.invoice_id=v_invoice.invoice_id;

  if v_invoice.batch_id is not null then
    with rows as (
      select
        'EXACT'::text entry_type,p.product_code,p.product_name,
        coalesce(p.barcode,'') barcode,coalesce(p.unit,'') unit_name,
        upper(coalesce(p.item_type,'PRODUCT')) item_type,
        coalesce(p.track_stock,true) track_stock,
        coalesce(cpp.price_usd,p.price_usd,0) price_usd,
        coalesce(cpp.price_khr,p.price_khr,0) price_khr,
        (
          greatest(coalesce(bi.pending_qty_snapshot,0),0)
          + coalesce((
              select sum(a.qty) from public.stock_activity a
              where a.movement_id=v_movement_id
                and upper(coalesce(a.movement_type,''))='BATCH_SALE'
                and upper(coalesce(a.flow,''))='OUTFLOW'
                and a.product_code=p.product_code
            ),0)
        )::numeric available_qty,
        (
          greatest(coalesce(bi.purchased_pending_qty_snapshot,0),0)
          + coalesce((
              select sum(a.qty) from public.stock_activity a
              where a.movement_id=v_movement_id
                and upper(coalesce(a.movement_type,''))='BATCH_SALE'
                and upper(coalesce(a.flow,''))='OUTFLOW'
                and upper(coalesce(a.from_bucket,''))='BATCH_PENDING'
                and a.product_code=p.product_code
            ),0)
        )::numeric purchased_available_qty,
        (
          greatest(coalesce(bi.zero_cost_pending_qty_snapshot,0),0)
          + coalesce((
              select sum(a.qty) from public.stock_activity a
              where a.movement_id=v_movement_id
                and upper(coalesce(a.movement_type,''))='BATCH_SALE'
                and upper(coalesce(a.flow,''))='OUTFLOW'
                and upper(coalesce(a.from_bucket,''))='BATCH_ZERO_COST'
                and a.product_code=p.product_code
            ),0)
        )::numeric zero_cost_available_qty
      from public.stock_batch_items bi
      join public.products p
        on p.product_code=bi.product_code
       and p.active=true
       and coalesce(p.track_stock,true)=true
       and upper(coalesce(p.item_type,'PRODUCT'))='PRODUCT'
      left join public.customer_product_prices cpp
        on cpp.customer_id=v_customer_id
       and cpp.product_code=p.product_code
       and cpp.active=true
      where bi.batch_id=v_invoice.batch_id

      union all

      select
        'EXACT',p.product_code,p.product_name,
        coalesce(p.barcode,''),coalesce(p.unit,''),
        'SERVICE',false,
        coalesce(cpp.price_usd,p.price_usd,0),
        coalesce(cpp.price_khr,p.price_khr,0),
        null::numeric,null::numeric,null::numeric
      from public.products p
      left join public.customer_product_prices cpp
        on cpp.customer_id=v_customer_id
       and cpp.product_code=p.product_code
       and cpp.active=true
      where p.active=true
        and (
          upper(coalesce(p.item_type,'PRODUCT'))='SERVICE'
          or coalesce(p.track_stock,true)=false
        )
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'entryType',entry_type,'productCode',product_code,'productName',product_name,
        'barcode',barcode,'unit',unit_name,'itemType',item_type,'trackStock',track_stock,
        'priceUSD',price_usd,'priceKHR',price_khr,'availableQty',available_qty,
        'purchasedAvailableQty',purchased_available_qty,
        'zeroCostAvailableQty',zero_cost_available_qty
      )
      order by case when item_type='SERVICE' then 1 else 0 end,product_name,product_code
    ),'[]'::jsonb)
    into v_products
    from rows;
  else
    -- Direct Sale: build the complete physical Warehouse balance ONCE.
    -- The old path evaluated the full stock ledger 4-6 times per product,
    -- causing statement timeouts as sales history grew.
    with warehouse_stock as materialized (
      select b.product_code, b.warehouse_purchased, b.warehouse_zero_cost
      from public.bb_stock_balance_zero_cost_v1_internal() b
    ),
    original_sale as materialized (
      select a.product_code,
        coalesce(sum(a.qty),0)::numeric as total_out,
        coalesce(sum(a.qty) filter (where upper(coalesce(a.from_bucket,''))='WAREHOUSE_GOOD'),0)::numeric as purchased_out,
        coalesce(sum(a.qty) filter (where upper(coalesce(a.from_bucket,''))='WAREHOUSE_ZERO_COST'),0)::numeric as zero_cost_out
      from public.stock_activity a
      where a.movement_id=v_movement_id
        and upper(coalesce(a.movement_type,''))='DIRECT_SALE'
        and upper(coalesce(a.flow,''))='OUTFLOW'
      group by a.product_code
    ),
    rows as (
      select
        'EXACT'::text entry_type,p.product_code,p.product_name,
        coalesce(p.barcode,'') barcode,coalesce(p.unit,'') unit_name,
        upper(coalesce(p.item_type,'PRODUCT')) item_type,
        coalesce(p.track_stock,true) track_stock,
        coalesce(cpp.price_usd,p.price_usd,0) price_usd,
        coalesce(cpp.price_khr,p.price_khr,0) price_khr,
        (coalesce(w.warehouse_purchased,0)+coalesce(w.warehouse_zero_cost,0)+coalesce(os.total_out,0))::numeric available_qty,
        (coalesce(w.warehouse_purchased,0)+coalesce(os.purchased_out,0))::numeric purchased_available_qty,
        (coalesce(w.warehouse_zero_cost,0)+coalesce(os.zero_cost_out,0))::numeric zero_cost_available_qty
      from public.products p
      left join warehouse_stock w on w.product_code=p.product_code
      left join original_sale os on os.product_code=p.product_code
      left join public.customer_product_prices cpp
        on cpp.customer_id=v_customer_id
       and cpp.product_code=p.product_code
       and cpp.active=true
      where p.active=true
        and coalesce(p.track_stock,true)=true
        and upper(coalesce(p.item_type,'PRODUCT'))='PRODUCT'
        and (coalesce(w.warehouse_purchased,0)+coalesce(w.warehouse_zero_cost,0)+coalesce(os.total_out,0))>0.000001

      union all

      select
        'EXACT',p.product_code,p.product_name,
        coalesce(p.barcode,''),coalesce(p.unit,''),
        'SERVICE',false,
        coalesce(cpp.price_usd,p.price_usd,0),
        coalesce(cpp.price_khr,p.price_khr,0),
        null::numeric,null::numeric,null::numeric
      from public.products p
      left join public.customer_product_prices cpp
        on cpp.customer_id=v_customer_id
       and cpp.product_code=p.product_code
       and cpp.active=true
      where p.active=true
        and (
          upper(coalesce(p.item_type,'PRODUCT'))='SERVICE'
          or coalesce(p.track_stock,true)=false
        )
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'entryType',entry_type,'productCode',product_code,'productName',product_name,
        'barcode',barcode,'unit',unit_name,'itemType',item_type,'trackStock',track_stock,
        'priceUSD',price_usd,'priceKHR',price_khr,'availableQty',available_qty,
        'purchasedAvailableQty',purchased_available_qty,
        'zeroCostAvailableQty',zero_cost_available_qty
      )
      order by case when item_type='SERVICE' then 1 else 0 end,product_name,product_code
    ),'[]'::jsonb)
    into v_products
    from rows;
  end if;

  return jsonb_build_object(
    'success',true,'invoiceId',v_invoice.invoice_id,
    'batchId',coalesce(v_invoice.batch_id,''),
    'customerId',coalesce(v_customer_id,''),
    'products',v_products
  );
end;
$function$;
