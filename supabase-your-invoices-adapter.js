/* BIG BROTHER — Sales Support Your Invoices Supabase Adapter V1 */
(function(){
  'use strict';
  const URL='https://sjfhlaclgmkwwofzstok.supabase.co';
  const KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
  const SESSION_KEY='BB_SUPABASE_DEV_SESSION_V1';
  let session=null;

  function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch(_){return null}}
  function saveSession(s){session=s||null;try{if(!s){localStorage.removeItem(SESSION_KEY);return;}if(!s.expires_at&&s.expires_in)s.expires_at=Math.floor(Date.now()/1000)+Number(s.expires_in);localStorage.setItem(SESSION_KEY,JSON.stringify(s));}catch(_){}}
  async function parse(r){const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={message:t}}if(!r.ok)throw new Error(d.message||d.error_description||d.error||('Database request failed ('+r.status+')'));return d}
  async function refreshSession(){const s=readSession();if(!s?.refresh_token)throw new Error('Please sign in to BIG BROTHER Dashboard first.');const r=await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token}),cache:'no-store'});const next=await parse(r);saveSession(next);return next}
  async function ensureSession(){session=readSession();if(!session?.access_token)throw new Error('Please sign in to BIG BROTHER Dashboard first.');if(session.expires_at&&Number(session.expires_at)<Math.floor(Date.now()/1000)+30)await refreshSession();return session}
  async function rpc(fn,args={}){await ensureSession();const call=()=>fetch(URL+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'});let r=await call();if(r.status===401){await refreshSession();r=await call()}return parse(r)}

  async function fetchApi(params={}){
    const action=String(params.action||'');
    if(action==='verifyInvoiceHistoryPrimaryAdmin')return {success:true,authorized:false,readOnly:true};
    if(action==='invoiceHistoryRevision'){
      const d=await rpc('bb_sales_support_your_invoices_revision');
      return {success:true,revision:String(d||'0')};
    }
    if(action==='invoiceDetail')return rpc('bb_sales_support_your_invoices_detail',{p_invoice_no:String(params.invoiceNo||'')});
    if(action==='invoiceList')return rpc('bb_sales_support_your_invoices_list',{
      p_invoice_no:String(params.invoiceNo||''),
      p_customer:String(params.customer||''),
      p_date_from:params.dateFrom||null,
      p_date_to:params.dateTo||null,
      p_invoice_type:String(params.invoiceType||'')
    });
    throw new Error('Unsupported Your Invoices action: '+action);
  }

  async function historyJsonp(_url,params={}){
    const d=await rpc('bb_sales_support_your_invoices_master');
    const action=String(params.action||'');
    if(action==='getProducts')return d.products||[];
    if(action==='getLocations')return d.locations||[];
    if(action==='getCustomers')return d.customers||[];
    return d;
  }

  async function postHistoryAction(){
    throw new Error('Your Invoices is read-only. Invoice changes are not allowed from this function.');
  }

  async function requirePrimaryAdmin(){
    alert('Your Invoices is a read-only Sales Support function.');
    return false;
  }

  async function accessProfile(){return rpc('bb_current_access_profile');}

  window.BBYourInvoicesAdapter={rpc,fetchApi,historyJsonp,postHistoryAction,requirePrimaryAdmin,ensureSession,accessProfile};
})();
