/* BIG BROTHER — Invoice History All Locations Supabase Adapter V1 */
(function(){
  'use strict';
  const URL='https://sjfhlaclgmkwwofzstok.supabase.co';
  const KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
  const SESSION_KEY='BB_SUPABASE_DEV_SESSION_V1';
  let session=null;

  function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch(_){return null}}
  function saveSession(s){session=s||null;try{if(!s){localStorage.removeItem(SESSION_KEY);return}if(!s.expires_at&&s.expires_in)s.expires_at=Math.floor(Date.now()/1000)+Number(s.expires_in);localStorage.setItem(SESSION_KEY,JSON.stringify(s))}catch(_){}}
  async function parse(r){const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={message:t}}if(!r.ok)throw new Error(d.message||d.error_description||d.error||('Database request failed ('+r.status+')'));return d}
  async function refreshSession(){const s=readSession();if(!s?.refresh_token)throw new Error('Please sign in to BIG BROTHER first.');const r=await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token}),cache:'no-store'});const next=await parse(r);saveSession(next);return next}
  async function ensureSession(){session=readSession();if(!session?.access_token)throw new Error('Please sign in to BIG BROTHER first.');if(session.expires_at&&Number(session.expires_at)<Math.floor(Date.now()/1000)+30)await refreshSession();return session}
  async function rpc(fn,args={}){await ensureSession();const call=()=>fetch(URL+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'});let r=await call();if(r.status===401){await refreshSession();r=await call()}return parse(r)}

  async function fetchApi(params={}){
    const action=String(params.action||'');
    if(action==='verifyInvoiceHistoryPrimaryAdmin')return rpc('bb_invoice_history_all_is_admin');
    if(action==='invoiceHistoryRevision'){const d=await rpc('bb_invoice_history_all_revision');return {success:true,revision:String(d||'0')}}
    if(action==='invoiceDetail'){
      const invoiceId=String(params.invoiceId||'').trim();
      if(invoiceId)return rpc('bb_invoice_history_all_detail_by_id',{p_invoice_id:invoiceId});
      return rpc('bb_invoice_history_all_detail',{p_invoice_no:String(params.invoiceNo||'')});
    }
    if(action==='invoiceList')return rpc('bb_invoice_history_all_list',{
      p_invoice_no:String(params.invoiceNo||''),
      p_customer:String(params.customer||''),
      p_date_from:params.dateFrom||null,
      p_date_to:params.dateTo||null,
      p_invoice_type:String(params.invoiceType||'')
    });
    throw new Error('Unsupported Invoice History action: '+action);
  }

  async function historyJsonp(_url,params={}){
    const d=await rpc('bb_invoice_history_all_master');
    const action=String(params.action||'');
    if(action==='getProducts')return d.products||[];
    if(action==='getLocations')return d.locations||[];
    if(action==='getCustomers')return d.customers||[];
    return d;
  }

  const SHEET_BACKUP_ENDPOINT='https://script.google.com/macros/s/AKfycbxnlB1T6sbqdItYfyXa6wYquXN6URbJhvWJOkE_cM57wsSWK0_uFEsK_DuWr_caQVgd/exec';
  const SHEET_SYNC_QUEUE_KEY='BB_INVOICE_HISTORY_SHEET_SYNC_QUEUE_V1';
  const SHEET_SYNC_CATCHUP_KEY='BB_INVOICE_HISTORY_SHEET_CATCHUP_20260924_2';
  const SHEET_SYNC_CATCHUP_IDS=[
    'BB-20260924-123109-371',
    'BB-20260924-154852-677'
  ];

  function clean(v){return String(v==null?'':v).trim()}
  function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
  function toUsd(value,invoice){
    const amount=num(value);
    const currency=clean(invoice?.currency).toUpperCase();
    const rate=num(invoice?.exchangeRate);
    return currency==='KHR'&&rate>0?amount/rate:amount;
  }
  function sessionEmail(){
    try{
      const s=readSession();
      return clean(s?.user?.email||'');
    }catch(_){return''}
  }
  function sheetPayload(invoice){
    const items=Array.isArray(invoice?.items)?invoice.items:[];
    return {
      invoiceNo:clean(invoice?.invoiceNo),
      invoiceDate:clean(invoice?.invoiceDate),
      customerName:clean(invoice?.customer),
      customerPhone:clean(invoice?.phone),
      customerAddress:clean(invoice?.address),
      items:items.map(item=>({
        lineId:clean(item?.lineId),
        productCode:clean(item?.productCode),
        productName:clean(item?.productName),
        unit:clean(item?.unit),
        qty:num(item?.qty),
        unitPrice:toUsd(item?.unitPrice??item?.price,invoice),
        amount:toUsd(item?.amount??item?.total,invoice)
      })),
      productCount:items.length,
      totalQty:items.reduce((sum,item)=>sum+num(item?.qty),0),
      subtotalUSD:toUsd(invoice?.subtotal,invoice),
      discountUSD:toUsd(invoice?.discount,invoice),
      totalUSD:toUsd(invoice?.grandTotal,invoice),
      paidUSD:toUsd(invoice?.amountPaid,invoice),
      receivableUSD:toUsd(invoice?.creditAmount??invoice?.outstanding,invoice),

      /* Raw transaction values for the Google Sales Database.
         These stay in the invoice's original currency. */
      subtotal:num(invoice?.subtotal),
      discount:num(invoice?.discount),
      grandTotal:num(invoice?.grandTotal),
      amountPaid:num(invoice?.amountPaid),
      outstanding:num(invoice?.outstanding),
      creditAmount:num(invoice?.creditAmount??invoice?.outstanding),
      status:clean(invoice?.status),
      dueDate:clean(invoice?.dueDate),
      bankPayment:clean(invoice?.bankPayment),
      bankReference:clean(invoice?.bankReference),
      batchNumber:clean(invoice?.batchNumber||invoice?.batchId),
      customerId:clean(invoice?.customerId),
      salespersonStaffId:clean(invoice?.salespersonStaffId),

      paymentMethod:clean(invoice?.paymentMethod),
      transactionId:clean(invoice?.bankReference),
      salesman:clean(invoice?.salesperson),
      location:clean(invoice?.locationCode),
      note:clean(invoice?.note),
      supabaseInvoiceId:clean(invoice?.invoiceId),
      createdBy:sessionEmail(),
      invoiceCurrency:clean(invoice?.currency),
      exchangeRate:num(invoice?.exchangeRate)
    };
  }
  function readSheetQueue(){
    try{
      const q=JSON.parse(localStorage.getItem(SHEET_SYNC_QUEUE_KEY)||'[]');
      return Array.isArray(q)?q:[];
    }catch(_){return[]}
  }
  function writeSheetQueue(q){
    try{localStorage.setItem(SHEET_SYNC_QUEUE_KEY,JSON.stringify(q.slice(-100)))}catch(_){}
  }
  function queueSheetSync(job){
    const id=clean(job?.invoice?.supabaseInvoiceId);
    if(!id)return;
    const q=readSheetQueue().filter(x=>clean(x?.invoice?.supabaseInvoiceId)!==id);
    q.push(job);
    writeSheetQueue(q);
  }
  function removeSheetSync(invoiceId){
    const id=clean(invoiceId);
    writeSheetQueue(readSheetQueue().filter(x=>clean(x?.invoice?.supabaseInvoiceId)!==id));
  }
  async function sendSheetSync(invoice,action='syncInvoiceCorrection'){
    const body={
      action,
      invoice:sheetPayload(invoice)
    };
    queueSheetSync(body);
    await fetch(SHEET_BACKUP_ENDPOINT,{
      method:'POST',
      mode:'no-cors',
      cache:'no-store',
      keepalive:true,
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:JSON.stringify(body)
    });
    removeSheetSync(body.invoice.supabaseInvoiceId);
    return true;
  }
  async function retrySheetQueue(){
    for(const job of readSheetQueue()){
      try{
        await fetch(SHEET_BACKUP_ENDPOINT,{
          method:'POST',
          mode:'no-cors',
          cache:'no-store',
          keepalive:true,
          headers:{'Content-Type':'text/plain;charset=UTF-8'},
          body:JSON.stringify(job)
        });
        removeSheetSync(job?.invoice?.supabaseInvoiceId);
      }catch(_){}
    }
  }
  async function detailById(invoiceId){
    return rpc('bb_invoice_history_all_detail_by_id',{p_invoice_id:String(invoiceId||'').trim()});
  }
  async function syncInvoiceIdToSheet(invoiceId,action='syncInvoiceCorrection'){
    const id=clean(invoiceId);
    if(!id)return false;
    const detail=await detailById(id);
    if(!detail?.invoice)throw new Error('Corrected invoice detail was not returned.');
    await sendSheetSync(detail.invoice,action);
    return true;
  }
  async function catchUpPriorCorrections(){
    try{
      if(localStorage.getItem(SHEET_SYNC_CATCHUP_KEY)==='done')return;
    }catch(_){}
    let ok=true;
    for(const id of SHEET_SYNC_CATCHUP_IDS){
      try{
        await syncInvoiceIdToSheet(id,'repairInvoiceBackup');
      }catch(error){
        ok=false;
        console.warn('BIG BROTHER Google Sheet catch-up failed:',id,error);
      }
    }
    if(ok){
      try{localStorage.setItem(SHEET_SYNC_CATCHUP_KEY,'done')}catch(_){}
    }
  }

  async function postHistoryAction(action,_fieldName,payload){
    if(action==='updateInvoice'){
      const result=await rpc('bb_sales_history_update_invoice',{p_payload:payload||{}});
      const invoiceId=clean(result?.invoiceId||payload?.invoiceId);
      try{
        await syncInvoiceIdToSheet(invoiceId,'syncInvoiceCorrection');
        result.googleSheetSynced=true;
      }catch(error){
        result.googleSheetSynced=false;
        result.googleSheetSyncError=error?.message||String(error);
        console.warn('BIG BROTHER Google Sheet correction sync queued:',error);
      }
      return result;
    }
    if(action==='deleteInvoice')return rpc('bb_sales_history_delete_invoice',{p_invoice_no:String(payload?.invoiceNo||'')});
    throw new Error('Unsupported Invoice History write action: '+action);
  }

  async function requirePrimaryAdmin(){
    const d=await rpc('bb_invoice_history_all_is_admin');
    if(d?.authorized)return true;
    alert('Only BIG BROTHER Admin can Edit or Delete invoices.');
    return false;
  }

  window.BBHistoryAllAdapter={rpc,fetchApi,historyJsonp,postHistoryAction,requirePrimaryAdmin,ensureSession,syncInvoiceIdToSheet,retrySheetQueue,catchUpPriorCorrections};
  setTimeout(()=>{retrySheetQueue().catch(()=>{});catchUpPriorCorrections().catch(()=>{});},1200);
})();
