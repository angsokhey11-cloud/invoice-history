(function paymentCorrection(){
'use strict';
if(window.BBPaymentCorrectionV1)return;window.BBPaymentCorrectionV1=true;
const clean=x=>String(x??'').trim(), num=x=>Number(x)||0;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(amount,c)=> (c==='KHR'?'៛':'$')+num(amount).toLocaleString('en-US',{minimumFractionDigits:c==='KHR'?0:2,maximumFractionDigits:c==='KHR'?0:2});
const $=id=>document.getElementById(id);
const current=()=>{try{return currentEditInvoice||null}catch(_){return null}};
const adapter=()=>window.BBHistoryAdapter||window.BBHistoryAllAdapter||window.BBHistoryMobileAdapter;
const api=(payload)=>adapter().rpc('bb_sales_history_correct_bank_payment_v1',{p_payload:payload});
const style=document.createElement('style');
style.textContent=`
#bbPaymentCorrectionEntry[hidden]{display:none!important}
#bbPaymentCorrectionEntry{grid-column:1/-1;padding:11px;background:#f4f8fd;border:1px solid #ccddef;border-radius:9px;color:#274764;font-size:12px}
#bbPaymentCorrectionEntry button,.bb-pc-dialog button{border:1px solid #c8d9ea;background:#fff;color:#17457a;border-radius:8px;padding:10px 12px;font-size:12px;font-weight:800;cursor:pointer}
#bbPaymentCorrectionEntry button{background:#17457a;color:white;display:block;margin-bottom:5px}
.bb-pc-overlay{position:fixed;inset:0;z-index:2147483000;background:#0c1b32b3;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}
.bb-pc-dialog{box-sizing:border-box;width:min(620px,100%);max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);overflow:auto;border-radius:14px;background:#fff;padding:18px;color:#173653;box-shadow:0 15px 50px #0004;font-family:Arial,'Noto Sans Khmer',sans-serif}
.bb-pc-dialog h2{margin:0;font-size:19px;color:#17457a}
.bb-pc-dialog p{font-size:11px;line-height:1.5;margin:8px 0}
.bb-pc-header,.bb-pc-actions{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
.bb-pc-details{background:#f0f6fc;border:1px solid #d8e6f3;border-radius:9px;padding:10px;margin:12px 0;font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.bb-pc-line{display:flex;justify-content:space-between;gap:10px}
.bb-pc-dialog label{display:block;font-size:11px;color:#345676;font-weight:800;margin:12px 0 4px}
.bb-pc-dialog select,.bb-pc-dialog input:not([type=checkbox]),.bb-pc-dialog textarea{box-sizing:border-box;width:100%;font:inherit;font-size:13px;border:1px solid #c7d8e8;padding:10px;border-radius:7px;background:white;color:#173653}
.bb-pc-dialog [hidden]{display:none!important}
.bb-pc-dialog .bb-pc-primary{background:#17457a;color:white;border-color:#17457a}
.bb-pc-dialog button:disabled{opacity:.45;cursor:default}
.bb-pc-error{color:#ae2929;font-size:12px;line-height:1.5;margin-top:8px;white-space:pre-wrap}
.bb-pc-summary{background:#f0f7f1;padding:10px;border-radius:8px;color:#285c3e;font-size:12px;line-height:1.6;margin:10px 0}
.bb-pc-confirm{display:flex!important;align-items:flex-start;gap:7px;line-height:1.5}
`;
document.head.appendChild(style);
function install(){
 if($('bbPaymentCorrectionEntry'))return;
 const anchor=$('editPaymentMethod')?.closest('.edit-field');if(!anchor)return;
 const entry=document.createElement('div');entry.id='bbPaymentCorrectionEntry';entry.hidden=true;
 entry.innerHTML='<button type="button" id="bbPaymentCorrectionOpen">Correct Payment Method</button>Admin only · Release the incorrectly allocated bank receipt and record the correct payment without changing the sale.';
 anchor.insertAdjacentElement('afterend',entry);
 $('bbPaymentCorrectionOpen').onclick=open;
}
function visibility(){install();const entry=$('bbPaymentCorrectionEntry');if(entry)entry.hidden=clean(current()?.paymentMethod)!=='Bank'}
async function open(){
 if(document.querySelector('.bb-pc-overlay')||!current())return;
 const id=clean(current().invoiceId),a=adapter();
 try{if(!a?.rpc||!await a.requirePrimaryAdmin())return}catch(e){alert(clean(e?.message||e));return}
 const overlay=document.createElement('div');overlay.className='bb-pc-overlay';
 overlay.innerHTML='<section class="bb-pc-dialog" role="dialog" aria-modal="true" aria-label="Correct Payment Method"><div class="bb-pc-header"><h2>Correct Payment Method</h2><button type="button" data-close>Close</button></div><div data-body><p>Checking original bank payment…</p></div></section>';
 document.body.appendChild(overlay);
 const el=s=>overlay.querySelector(s),body=el('[data-body]');let busy=false,closed=false;
 const key=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();e.preventDefault();close()}};
 function close(){if(busy)return;closed=true;document.removeEventListener('keydown',key,true);overlay.remove()}
 el('[data-close]').onclick=close;document.addEventListener('keydown',key,true);
 function fail(e){body.innerHTML='<p class="bb-pc-error">'+esc(e?.message||e)+'</p><p>No changes were submitted.</p>'}
 let d;
 try{d=await api({invoiceId:id});if(closed)return;if(!d?.token)throw Error('Correction preview was not returned.');}
 catch(e){if(!closed)fail(e);return}
 const total=num(d.grandTotal),cur=d.currency;
 body.innerHTML=`<p><b>${esc(d.invoiceNo)}</b> · ${esc(d.invoiceDate)} · ${esc(d.customerId)}</p>
 <div class="bb-pc-details"><div class="bb-pc-line"><span>Invoice total</span><b>${money(total,cur)}</b></div>
 <div>Original receipt: <b>${esc(d.transactionId)}</b></div>
 <div class="bb-pc-line"><span>Available before</span><b>${money(d.remainingBefore,d.bankCurrency)}</b></div>
 <div class="bb-pc-line"><span>Release old bank amount</span><b>${money(d.releaseAmount,d.bankCurrency)}</b></div>
 <div class="bb-pc-line"><span>Available after release*</span><b>${money(d.remainingAfter,d.bankCurrency)}</b></div>
 <p>*Based on the current receipt balance. The server rechecks the allocation at save.</p></div>
 <label for="bbpcMethod">Correct payment method</label><select id="bbpcMethod"><option value="">Choose correct method…</option><option>Cash</option><option>Credit</option><option>Bank</option><option>Cash + Bank</option><option>Partially Paid in Cash</option><option>Partially Paid in Bank</option></select>
 <div data-cash hidden><label for="bbpcCash">Actual cash received (${esc(cur)})</label><input id="bbpcCash" type="number" min="0" step="${cur==='KHR'?'1':'0.01'}"></div>
 <div data-bankamount hidden><label for="bbpcBankAmount">Bank amount (${esc(cur)})</label><input id="bbpcBankAmount" type="number" min="0" step="${cur==='KHR'?'1':'0.01'}"></div>
 <div data-bank hidden><label for="bbpcBank">Select a different registered bank receipt</label><select id="bbpcBank"><option value="">Choose receipt…</option></select><p data-banknote></p></div>
 <div data-summary class="bb-pc-summary" hidden></div>
 <label for="bbpcReason">Correction reason (required)</label><textarea id="bbpcReason" rows="3" maxlength="500" placeholder="Explain why the previous bank balance was incorrect."></textarea>
 <label class="bb-pc-confirm"><input type="checkbox" id="bbpcConfirm"> I verified the actual payment method and amount. Discard other unsaved edits in this invoice form.</label>
 <div data-error class="bb-pc-error" role="alert"></div>
 <p>Only payment records and the invoice payment balance change. Sale date, items, stock and revenue stay unchanged.</p>
 <div class="bb-pc-actions"><button type="button" data-cancel>Cancel</button><button type="button" class="bb-pc-primary" data-apply disabled>Apply Payment Correction</button></div>`;
 const method=el('#bbpcMethod'),bank=el('#bbpcBank'),cash=el('#bbpcCash'),bankAmount=el('#bbpcBankAmount'),reason=el('#bbpcReason'),confirm=el('#bbpcConfirm'),apply=el('[data-apply]'),error=el('[data-error]');
 let loading=false,loaded=false;
 function amounts(){const m=method.value;return {c:m==='Cash'?total:m==='Partially Paid in Cash'?num(cash.value):m==='Cash + Bank'?total-num(bankAmount.value):0,b:m==='Bank'?total: ['Cash + Bank','Partially Paid in Bank'].includes(m)?num(bankAmount.value):0}}
 function bankMode(){return ['Bank','Cash + Bank','Partially Paid in Bank'].includes(method.value)}
 function refresh(){
  const m=method.value,{c,b}=amounts(),out=total-c-b;
  el('[data-cash]').hidden=m!=='Partially Paid in Cash';
  el('[data-bankamount]').hidden=!['Cash + Bank','Partially Paid in Bank'].includes(m);
  el('[data-bank]').hidden=!bankMode();
  const partial=m.startsWith('Partially Paid'),valid=!!m&&c>=0&&b>=0&&out>=-0.000001&&(!partial||(c+b>0&&out>0))&&(m!=='Cash + Bank'||(c>0&&b>0))&&(!bankMode()||b>0);
  const summary=el('[data-summary]');summary.hidden=!m;
  summary.innerHTML=`New cash payment: <b>${money(c,cur)}</b><br>New bank payment: <b>${money(b,cur)}</b><br>New A/R outstanding: <b>${money(Math.max(0,out),cur)}</b>`;
  apply.disabled=busy||loading||!valid||!confirm.checked||reason.value.trim().length<3||(bankMode()&&!bank.value);
 }
 async function loadBank(){
  if(loaded||loading)return;
  loading=true;el('[data-banknote]').textContent='Loading current customer bank receipts…';refresh();
  try{
   const list=await a.rpc('bb_customer_bank_balance_list_v2',{p_customer_id:d.customerId});
   if(closed)return;
   const rows=(Array.isArray(list)?list:[]).filter(x=>clean(x.transaction_id).toUpperCase()!==clean(d.transactionId).toUpperCase()&&num(x.remaining_amount)>0&&clean(x.bank_name));
   bank.innerHTML='<option value="">Choose receipt…</option>'+rows.map(x=>`<option value="${esc(x.transaction_id)}">${esc(x.received_date)} · ${esc(x.bank_name)} · ${money(x.remaining_amount,x.currency)} · ${esc(x.transaction_id)}</option>`).join('');
   el('[data-banknote]').textContent=rows.length?'Server checks customer ownership, available amount and exchange rate before saving.':'No other available receipts with a recorded bank name.';
   loaded=true;
  }catch(e){if(!closed)el('[data-banknote]').textContent='Unable to load receipts: '+clean(e?.message||e)}
  finally{loading=false;if(!closed)refresh()}
 }
 method.onchange=()=>{error.textContent='';confirm.checked=false;refresh();if(bankMode())void loadBank()};
 for(const field of [cash,bankAmount,bank,reason]){field.addEventListener('input',refresh);field.addEventListener('change',refresh)}
 confirm.onchange=refresh;el('[data-cancel]').onclick=close;
 apply.onclick=async()=>{
  if(apply.disabled||busy)return;
  busy=true;error.textContent='';refresh();el('[data-close]').disabled=true;el('[data-cancel]').disabled=true;apply.textContent='Applying…';
  const {c,b}=amounts(),payload={invoiceId:id,token:d.token,apply:true,method:method.value,reason:reason.value.trim(),cashAmount:c,bankAmount:b,transactionId:bankMode()?bank.value:''};
  let r;
  try{r=await api(payload);if(!r?.success)throw Error('Correction result could not be confirmed. Reload Invoice History before retrying.')}
  catch(e){busy=false;error.textContent=clean(e?.message||e);apply.textContent='Apply Payment Correction';el('[data-close]').disabled=false;el('[data-cancel]').disabled=false;refresh();return}
  let backupWarning='';
  try{if(typeof a.syncInvoiceIdToSheet==='function')await a.syncInvoiceIdToSheet(id,'syncInvoiceCorrection')}
  catch(e){backupWarning=' Google Sheet backup sync failed; the Supabase correction is already saved.'}
  busy=false;close();
  if(typeof window.closeEditInvoice==='function')window.closeEditInvoice();
  if(typeof window.loadInvoices==='function')try{await window.loadInvoices({silent:true})}catch(_){}
  alert('Payment corrected successfully. Audit: '+clean(r.auditId)+'.'+backupWarning);
 };
 refresh();
}
function hook(){
 install();const original=window.openEditInvoice;
 if(typeof original==='function'&&!original.__bbPaymentCorrection){
  const wrapped=async function(...args){const out=await original.apply(this,args);visibility();return out};
  wrapped.__bbPaymentCorrection=true;wrapped.__bbHistoryBankWallet=Boolean(original.__bbHistoryBankWallet);wrapped.__bbAddProductWrapped=Boolean(original.__bbAddProductWrapped);window.openEditInvoice=wrapped;
 }
 visibility();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
})();
