/* BIG BROTHER — invoice history: credit-only, duplicate-safe digital originals. */
(function(){
'use strict';
const HOST='https://sjfhlaclgmkwwofzstok.supabase.co';
const KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
const BUCKET='bb-real-invoices';
const api=()=>window.BBHistoryAdapter||window.BBHistoryMobileAdapter||window.BBHistoryAllAdapter;
let active=null,serial=0,busy=false;
const button=()=>document.getElementById('bbSaveDigitalOriginal');
const badge=()=>document.getElementById('bbDigitalOriginalBadge');
function eligibleLocal(invoice){
 return invoice&&String(invoice.paymentMethod||'').trim().toLowerCase()==='credit'&&Number(invoice.outstanding||0)>0&&invoice.invoiceId;
}
function showStatus(value){
 const b=badge();if(!b)return;
 b.textContent=value||'';b.hidden=!value;
}
async function refresh(invoice){
 active=invoice||null;
 const request=++serial,btn=button();
 if(!btn)return;
 btn.hidden=true;btn.disabled=true;showStatus('');
 if(!eligibleLocal(invoice))return;
 try{
  const check=await api().rpc('bb_real_invoice_digital_status',
   {p_invoice_id:String(invoice.invoiceId)});
  if(request!==serial||active?.invoiceId!==invoice.invoiceId)return;
  if(check.hasImage){
   showStatus(check.source==='history_capture'?'✅ Digital Original Saved':'✅ Invoice Picture Already Uploaded');
  }else if(check.eligible){
   btn.hidden=false;btn.disabled=busy;
  }
 }catch(e){if(request===serial){console.warn('Original status:',e);showStatus('Invoice image status unavailable. Try reopening this invoice.')}}
}
async function auth(){
 const s=await api().ensureSession();
 if(!s?.access_token)throw Error('Please sign in again.');
 return s.access_token;
}
async function storageRequest(path,blob){
 const token=await auth();
 const response=await fetch(HOST+path,{
  method:'POST',
  headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'image/png','x-upsert':'false'},
  body:blob
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.message||data.error||'Private invoice image upload failed');
}
async function deleteOrphan(path,id){
 try{
  const status=await api().rpc('bb_real_invoice_digital_status',{p_invoice_id:id});
  if(status.hasImage)return; // Never delete a registered image even if the response was interrupted.
  const token=await auth();
  await fetch(HOST+'/storage/v1/object/'+BUCKET+'/'+path,{
   method:'DELETE',headers:{apikey:KEY,Authorization:'Bearer '+token}
  });
 }catch(error){console.warn('Unregistered temporary image cleanup:',error)}
}
async function save(){
 if(busy||!active||!eligibleLocal(active))return;
 const btn=button(),invoiceId=String(active.invoiceId);
 busy=true;btn.disabled=true;const original=btn.textContent;
 btn.textContent='⏳ Checking invoice…';
 let uploadedPath='';
 try{
  // Never use stale cached image or status to override an existing paper picture.
  const freshStatus=await api().rpc('bb_real_invoice_digital_status',{p_invoice_id:invoiceId});
  if(!freshStatus.eligible){
   if(active?.invoiceId===invoiceId)await refresh(active);
   throw Error(freshStatus.hasImage?'This invoice already has a picture. Digital save is blocked.':'Only unpaid credit invoices can have a Digital Original.');
  }
  // Capture the server's latest actual invoice, rather than any stale device preview.
  const result=await api().rpc('bb_sales_history_detail_by_id',{p_invoice_id:invoiceId});
  const invoice=result?.invoice;
  if(!invoice||String(invoice.invoiceId)!==invoiceId||!eligibleLocal(invoice)){
   throw Error('Invoice has changed. Reopen its latest credit invoice detail.');
  }
  // Existing Invoice History renderer and image generator are the only image source.
  if(active?.invoiceId!==invoiceId||!document.getElementById('detailModal')?.classList.contains('show'))
   throw Error('Invoice preview is no longer open.');
  window.renderDetail(invoice);
  if(!window.confirm('Save this CREDIT invoice preview as its Digital Original?\n\nUse this only when there is NO paper invoice. After saving, it will leave Pending Scan. An existing paper photo can never be overwritten here.'))return;
  btn.textContent='⏳ Capturing invoice…';
  const blob=await window.createHistoryInvoiceImage();
  if(blob.type!=='image/png'||!blob.size)throw Error('Could not create the invoice PNG.');
  const path=invoiceId+'/'+crypto.randomUUID()+'.png';
  btn.textContent='⏳ Uploading securely…';
  await storageRequest('/storage/v1/object/'+BUCKET+'/'+path,blob);
  uploadedPath=path;
  const saved=await api().rpc('bb_real_invoice_register_digital',
   {p_invoice_id:invoiceId,p_storage_path:path});
  if(!saved?.success)throw Error('Could not register the digital original.');
  uploadedPath='';
  ++serial; // Ignore any status check started before the successful registration.
  if(active?.invoiceId===invoiceId){
   btn.hidden=true;
   showStatus('✅ Digital Original Saved');
  }
 }catch(error){
  if(uploadedPath)await deleteOrphan(uploadedPath,invoiceId);
  alert(error.message||'Could not save the Digital Original.');
  if(active?.invoiceId===invoiceId)await refresh(active);
 }finally{
  busy=false;
  if(btn){btn.textContent=original;btn.disabled=false}
 }
}
window.BBDigitalOriginal={refresh,save};
})();