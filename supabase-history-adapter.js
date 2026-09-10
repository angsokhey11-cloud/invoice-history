/* BIG BROTHER — Invoice History Supabase Adapter V1 */
(function(){
  'use strict';
  const URL='https://sjfhlaclgmkwwofzstok.supabase.co';
  const KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
  const SESSION_KEY='BB_SUPABASE_DEV_SESSION_V1';
  let session=null;

  function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch(_){return null}}
  function saveSession(s){session=s||null;try{if(!s){localStorage.removeItem(SESSION_KEY);return;}if(!s.expires_at&&s.expires_in)s.expires_at=Math.floor(Date.now()/1000)+Number(s.expires_in);localStorage.setItem(SESSION_KEY,JSON.stringify(s));}catch(_){}}
  async function parse(r){const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={message:t}}if(!r.ok)throw new Error(d.message||d.error_description||d.error||('Database request failed ('+r.status+')'));return d}
  async function refreshSession(){const s=readSession();if(!s?.refresh_token)throw new Error('Please sign in to BIG BROTHER first from the Clients Editor.');const r=await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token})});const next=await parse(r);saveSession(next);return next}
  async function ensureSession(){session=readSession();if(!session?.access_token)throw new Error('Please sign in to BIG BROTHER first from the Clients Editor.');if(session.expires_at&&Number(session.expires_at)<Math.floor(Date.now()/1000)+30)await refreshSession();return session}
  async function rpc(fn,args={}){await ensureSession();const r=await fetch(URL+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'});return parse(r)}

  async function fetchApi(params={}){
    const action=String(params.action||'');
    if(action==='verifyInvoiceHistoryPrimaryAdmin')return rpc('bb_sales_history_is_admin');
    if(action==='invoiceHistoryRevision'){const d=await rpc('bb_sales_history_revision');return {success:true,revision:String(d||'0')}}
    if(action==='invoiceDetail')return rpc('bb_sales_history_detail',{p_invoice_no:String(params.invoiceNo||'')});
    if(action==='invoiceList')return rpc('bb_sales_history_list',{
      p_invoice_no:String(params.invoiceNo||''),
      p_customer:String(params.customer||''),
      p_date_from:params.dateFrom||null,
      p_date_to:params.dateTo||null,
      p_invoice_type:String(params.invoiceType||'')
    });
    throw new Error('Unsupported Invoice History action: '+action);
  }

  async function historyJsonp(_url,params={}){
    const d=await rpc('bb_sales_history_master');
    const action=String(params.action||'');
    if(action==='getProducts')return d.products||[];
    if(action==='getLocations')return d.locations||[];
    if(action==='getCustomers')return d.customers||[];
    return d;
  }

  async function postHistoryAction(action,_fieldName,payload){
    if(action==='updateInvoice')return rpc('bb_sales_history_update_invoice',{p_payload:payload||{}});
    if(action==='deleteInvoice')return rpc('bb_sales_history_delete_invoice',{p_invoice_no:String(payload?.invoiceNo||'')});
    throw new Error('Unsupported Invoice History write action: '+action);
  }

  async function requirePrimaryAdmin(){
    const d=await rpc('bb_sales_history_is_admin');
    if(d?.authorized)return true;
    alert('Only BIG BROTHER Admin can Edit or Delete invoices.');
    return false;
  }

  window.BBHistoryAdapter={rpc,fetchApi,historyJsonp,postHistoryAction,requirePrimaryAdmin};
})();
