/* BIG BROTHER | Invoice History Admin Registered Bank Balance picker.
   Select Use explicitly. Fresh authorized RPC; actual debit only via server
   wallet correction. Existing manual Bank and Invoice History paths preserved. */
(function(){
'use strict';
if(window.BBHistoryRegisteredWalletV1)return;
const $=id=>document.getElementById(id);
const clean=v=>String(v??'').trim();
const num=v=>Number(v)||0;
const money=(n,c)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:c==='KHR'?0:2,maximumFractionDigits:c==='KHR'?0:2});
const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let rows=[],selected=null,seq=0,busy=false;
function current(){try{return typeof currentEditInvoice!=='undefined'?currentEditInvoice:null}catch(_){return null}}
function method(){return clean($('editPaymentMethod')?.value)}
function bankMode(){return ['Bank','Cash + Bank','Partially Paid in Bank'].includes(method())}
function supported(){
 const original=clean(current()?.paymentMethod);
 return ['Cash','Credit'].includes(original)&&!(original==='Cash'&&method()==='Partially Paid in Bank');
}
function customerId(){return clean($('editCustomer')?.dataset?.customerId||current()?.customerId)}
function currency(){return clean($('editCurrency')?.value).toUpperCase()}
function amount(){return method()==='Cash + Bank'?num($('editSplitBankAmount')?.value):
 method()==='Partially Paid in Bank'?num($('editAmountPaid')?.value):
 method()==='Bank'?num($('editGrandTotal')?.textContent):0}
function eligible(row){
 const inv=currency(),bank=clean(row.currency).toUpperCase();
 if(clean(row.invoice_currency||bank).toUpperCase()!==inv)return false;
 if(bank!==inv&&num(row.approved_exchange_rate)>1&&
   Math.abs(num($('editExchangeRate')?.value)-num(row.approved_exchange_rate))>0.000001)return false;
 return true;
}
function equivalent(row){
 const bank=clean(row.currency).toUpperCase(),inv=currency();
 if(bank===inv)return num(row.remaining_amount);
 const rate=num(row.approved_exchange_rate)>1?num(row.approved_exchange_rate):num($('editExchangeRate')?.value);
 return rate>1?(bank==='KHR'?num(row.remaining_amount)/rate:num(row.remaining_amount)*rate):0;
}
function message(s,warning=false){
 const area=$('bbInvoiceBankStatus');
 if(area){area.textContent=s;area.style.color=warning?'#a73f24':'#536f89'}
}
function reset(){
 selected=null;
 const pick=$('bbInvoiceBankSelected');
 if(pick){pick.textContent='';pick.hidden=true}
}
function date(v){
 const m=clean(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
 return m?m[3]+'-'+month[Number(m[2])-1]+'-'+m[1]:clean(v);
}
function install(){
 if($('bbInvoiceBankWallet'))return;
 const anchor=$('editBankTransactionRow');if(!anchor)return;
 const styles=document.createElement('style');
 styles.textContent=[
  '#bbInvoiceBankWallet{grid-column:1/-1;min-width:0;border:1px solid #cbddec;border-radius:11px;padding:12px;background:#f7fbff;color:#24466b}',
  '#bbInvoiceBankWallet[hidden],#bbInvoiceBankSelected[hidden]{display:none!important}',
  '#bbInvoiceBankWallet .bb-wallet-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}',
  '#bbInvoiceBankWallet h4{margin:0;font-size:13px;color:#144a81;font-weight:800}',
  '#bbInvoiceBankWallet .bb-wallet-btn{padding:8px 12px;border:1px solid #bed2e9;border-radius:8px;color:#1456a2;background:#e9f4ff;font-size:12px;font-weight:800;cursor:pointer}',
  '#bbInvoiceBankWallet .bb-wallet-btn:disabled{opacity:.45;cursor:default}',
  '#bbInvoiceBankWallet .bb-wallet-use{background:#1c61af;border-color:#1c61af;color:white}',
  '#bbInvoiceBankStatus{font-size:12px;line-height:1.55;margin:7px 0;color:#536f89}',
  '#bbInvoiceBankWallet .bb-wallet-row{background:white;padding:10px;border:1px solid #dce7f1;border-radius:9px;margin:7px 0;display:flex;align-items:center;justify-content:space-between;gap:10px}',
  '#bbInvoiceBankWallet .bb-wallet-info strong{display:block;overflow-wrap:anywhere;font-size:12px}',
  '#bbInvoiceBankWallet .bb-wallet-info small{display:block;color:#637d94;line-height:1.5;font-size:11px;margin-top:3px}',
  '#bbInvoiceBankSelected{font-size:12px;padding:9px;color:#1a663f;background:#e8f7ed;border:1px solid #b3dbc0;border-radius:8px}',
  '@media(max-width:560px){#bbInvoiceBankWallet .bb-wallet-row{align-items:stretch;flex-direction:column}#bbInvoiceBankWallet .bb-wallet-use{width:100%}}'
 ].join('\n');
 document.head.appendChild(styles);
 const panel=document.createElement('div');
 panel.id='bbInvoiceBankWallet';panel.className='edit-field edit-span-2';panel.hidden=true;
 panel.innerHTML='<div class="bb-wallet-head"><h4>Use Registered Bank Balance</h4><button type="button" class="bb-wallet-btn" id="bbInvoiceBankRefresh">⟳ Refresh Bank</button></div>'+
  '<p id="bbInvoiceBankStatus">Select Bank payment to view this customer’s available balance.</p>'+
  '<div id="bbInvoiceBankRows"></div><div id="bbInvoiceBankSelected" hidden></div>';
 anchor.insertAdjacentElement('afterend',panel);
 $('bbInvoiceBankRefresh')?.addEventListener('click',()=>{void load(true)});
 $('editBankReference')?.addEventListener('input',()=>{
   if(selected&&clean($('editBankReference').value).toUpperCase()!==selected.id)reset()
 });
 $('editBankPayment')?.addEventListener('input',()=>{
   if(selected&&selected.bankName&&clean($('editBankPayment').value).toLowerCase()!==selected.bankName.toLowerCase())reset()
 });
 for(const id of ['editCustomer','editCurrency','editExchangeRate']){
  $(id)?.addEventListener('change',()=>{reset();void load(true)});
 }
 for(const id of ['editAmountPaid','editSplitBankAmount','editDiscount']){
  $(id)?.addEventListener('input',()=>{if(selected&&Math.abs(amount()-selected.amount)>0.000001)reset();render()});
 }
 $('editItemsBody')?.addEventListener('input',()=>{
   if(selected&&Math.abs(amount()-selected.amount)>0.000001)reset();render()
 });
}
function visible(){
 const box=$('bbInvoiceBankWallet');if(!box)return false;
 const show=!!current()&&bankMode();
 box.hidden=!show;
 if(!show){reset();return false}
 if(!supported())message('Original Bank/split payments cannot be reassigned here. Use an audited reversal. Original Cash and Credit invoices can use available registered balances.',true);
 return true;
}
function render(){
 const target=$('bbInvoiceBankRows');
 if(!target)return;
 target.replaceChildren();
 if(!visible()||!supported())return;
 const requested=amount(),cur=currency();
 if(requested<=0){message('Enter a Bank amount first. Then click Use on an available receipt.');return}
 if(!rows.length&&!busy){message('No registered bank balance available for this customer. Check Bank Register or refresh.');return}
 for(const item of rows){
  const bank=clean(item.currency).toUpperCase(),remaining=num(item.remaining_amount),equiv=equivalent(item);
  const allowed=eligible(item)&&equiv+0.000001>=requested;
  const line=document.createElement('div');line.className='bb-wallet-row';
  const info=document.createElement('div');info.className='bb-wallet-info';
  const heading=document.createElement('strong');heading.textContent=clean(item.transaction_id);
  const detail=document.createElement('small');
  detail.textContent='Received '+date(item.received_date)+' · '+bank+' '+money(remaining,bank)+' available'+
   (bank!==cur?' (≈ '+cur+' '+money(equiv,cur)+')':'')+
   (item.bank_name?' · '+item.bank_name:' · Bank name not recorded')+
   (allowed?'':' · Insufficient / currency or rate mismatch');
  info.append(heading,detail);line.append(info);
  const use=document.createElement('button');use.type='button';use.className='bb-wallet-btn bb-wallet-use';
  use.textContent=selected?.id===clean(item.transaction_id).toUpperCase()?'✓ Selected':'Use';
  use.disabled=!allowed;
  use.onclick=()=>choose(item);
  line.append(use);target.append(line);
 }
 if(selected){
  const pick=$('bbInvoiceBankSelected');
  if(pick){
   pick.hidden=false;
   pick.textContent='✓ '+selected.id+' selected for '+cur+' '+money(selected.amount,cur)+
     '. Save Changes will debit this registered bank balance exactly once.'
  }
 }
}
function choose(item){
 if(!visible()||!supported()||!eligible(item)||amount()>equivalent(item)+0.000001)return;
 const id=clean(item.transaction_id).toUpperCase();
 $('editBankReference').value=id;
 if(clean(item.bank_name))$('editBankPayment').value=clean(item.bank_name);
 selected={id,bankName:clean(item.bank_name),amount:amount(),
    invoiceId:clean(current()?.invoiceId),customerId:customerId()};
 message(item.bank_name?'Registered bank receipt selected. Confirm the amount and save.':
   'Registered receipt selected. The receiving Bank name was not saved: enter the real bank name above before saving.');
 render();
}
async function load(){
 install();
 if(!visible()||!supported())return;
 const invoice=current(),customer=customerId();
 if(!customer){message('Choose an exact Customer first.',true);return}
 const adapter=window.BBHistoryAdapter||window.BBHistoryAllAdapter||window.BBHistoryMobileAdapter;
 if(typeof adapter?.rpc!=='function'){message('Bank service unavailable. Refresh Invoice History.',true);return}
 const token=++seq,invoiceId=clean(invoice.invoiceId);
 rows=[];busy=true;
 const button=$('bbInvoiceBankRefresh');if(button)button.disabled=true;
 message('Checking live bank balances for this customer…');render();
 try{
  const data=await adapter.rpc('bb_customer_bank_balance_list_v2',{p_customer_id:customer});
  if(token!==seq||invoiceId!==clean(current()?.invoiceId)||customer!==customerId())return;
  if(!Array.isArray(data))throw new Error('Unexpected bank balance response');
  rows=data.filter(v=>v&&typeof v.transaction_id==='string'&&num(v.remaining_amount)>0);
  message(rows.length?'Available registered receipts — oldest first. Click Use to select a bank balance.':
    'No available registered bank balance for this customer.');
 }catch(e){
  if(token!==seq)return;
  rows=[];message('Bank balance refresh failed: '+clean(e?.message||e)+'. Existing invoice is unchanged.',true);
 }finally{
  if(token===seq){busy=false;if(button)button.disabled=false;render()}
 }
}
function hook(){
 if(typeof window.openEditInvoice==='function'&&!window.openEditInvoice.__bbHistoryBankWallet){
  const orig=window.openEditInvoice;
  const wrapped=async function(...args){++seq;rows=[];reset();const value=await orig.apply(this,args);visible();if(bankMode())void load();return value};
  wrapped.__bbHistoryBankWallet=true;wrapped.__bbAddProductWrapped=Boolean(orig.__bbAddProductWrapped);window.openEditInvoice=wrapped;
 }
 if(typeof window.closeEditInvoice==='function'&&!window.closeEditInvoice.__bbHistoryBankWallet){
  const orig=window.closeEditInvoice;
  const wrapped=function(...args){++seq;rows=[];reset();return orig.apply(this,args)};
  wrapped.__bbHistoryBankWallet=true;window.closeEditInvoice=wrapped;
 }
 if(typeof window.handleEditPaymentMethodChange==='function'&&!window.handleEditPaymentMethodChange.__bbHistoryBankWallet){
  const orig=window.handleEditPaymentMethodChange;
  const wrapped=function(...args){reset();const value=orig.apply(this,args);visible();if(bankMode())void load();return value};
  wrapped.__bbHistoryBankWallet=true;window.handleEditPaymentMethodChange=wrapped;
 }
 if(typeof window.buildEditPayload==='function'&&!window.buildEditPayload.__bbHistoryBankWallet){
  const orig=window.buildEditPayload;
  const wrapped=function(...args){
   const payload=orig.apply(this,args);
   if(payload&&selected&&supported()&&
      clean(payload.invoiceId)===selected.invoiceId&&
      clean(payload.customerId)===selected.customerId&&
      clean(payload.transactionId).toUpperCase()===selected.id&&
      Math.abs(amount()-selected.amount)<=0.000001){
     payload.useRegisteredBankBalance=true;
     payload.registeredBankTransactionId=selected.id;
   }
   return payload;
  };
  wrapped.__bbHistoryBankWallet=true;wrapped.__bbAddProductWrapped=Boolean(orig.__bbAddProductWrapped);window.buildEditPayload=wrapped;
 }
}
function boot(){install();hook();setTimeout(hook,450);setTimeout(hook,1250)}
window.BBHistoryRegisteredWalletV1={refresh:load};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();