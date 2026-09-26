/* BIG BROTHER — Invoice History Add Product V1
   Admin Invoice editor: add an exact product safely.
   Backend rebuilds the original sale stock atomically. */
(function(){
'use strict';

const EPS=0.000001;
const clean=v=>String(v==null?'':v).trim();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

let editCatalog=[];
let catalogInvoiceId='';
let catalogCustomerId='';

function adapter(){
  return window.BBHistoryAdapter
    || window.BBHistoryAllAdapter
    || window.BBHistoryMobileAdapter
    || null;
}
async function rpc(name,args={}){
  const a=adapter();
  if(!a||typeof a.rpc!=='function')throw new Error('Invoice History database adapter is unavailable.');
  return a.rpc(name,args);
}

function injectStyle(){
  if(document.getElementById('bbHistoryAddProductStyle'))return;
  const style=document.createElement('style');
  style.id='bbHistoryAddProductStyle';
  style.textContent=`
.edit-add-product{margin-top:16px;border:1px solid #d9e3ef;background:#f7faff;border-radius:10px;padding:11px 12px}
.edit-add-product-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;color:#17457a;font-size:12px;font-weight:900}
.edit-add-product-row{display:grid;grid-template-columns:minmax(220px,1fr) 110px 130px auto;gap:8px;align-items:end}
.edit-add-field label{display:block;margin-bottom:4px;color:#667085;font-size:10px;font-weight:800;text-transform:uppercase}
.edit-add-field input{width:100%;box-sizing:border-box;border:1px solid #cfdbea;border-radius:8px;padding:8px 9px;font:inherit;background:#fff}
.edit-add-button{height:36px;border:0;border-radius:8px;padding:0 14px;background:#17457a;color:#fff;font-weight:900;cursor:pointer;white-space:nowrap}
.edit-add-button:disabled{opacity:.55;cursor:not-allowed}
.edit-add-help{margin-top:7px;color:#718197;font-size:10px;font-weight:700;line-height:1.4}
.edit-added-badge{display:inline-block;margin-left:6px;padding:2px 6px;border-radius:999px;background:#e8f4ff;color:#17457a;font-size:9px;font-weight:900}
.edit-remove-added{border:0;border-radius:7px;background:#fff0ef;color:#b42318;padding:6px 8px;font-weight:900;cursor:pointer}
.edit-items-table .edit-action-col{width:56px;text-align:center}
@media(max-width:720px){
  .edit-add-product-row{grid-template-columns:1fr 1fr}
  .edit-add-product-row .edit-add-product-main{grid-column:1/-1}
  .edit-add-button{width:100%}
}
`;
  document.head.appendChild(style);
}

function ensureUi(){
  injectStyle();
  if(document.getElementById('editAddProductBox'))return;

  const wrap=document.querySelector('#editModal .edit-items-wrap');
  if(!wrap)return;

  const box=document.createElement('div');
  box.id='editAddProductBox';
  box.className='edit-add-product';
  box.innerHTML=`
    <div class="edit-add-product-title">
      <span>＋ Add Product</span>
      <span id="editAddProductStockLabel" style="font-size:10px;color:#718197"></span>
    </div>
    <div class="edit-add-product-row">
      <div class="edit-add-field edit-add-product-main">
        <label>Product keyword / code</label>
        <input id="editAddProductSearch" list="editAddProductOptions" autocomplete="off" placeholder="Type product name or code">
        <datalist id="editAddProductOptions"></datalist>
      </div>
      <div class="edit-add-field">
        <label>QTY</label>
        <input id="editAddProductQty" type="number" min="0" step="0.01" inputmode="decimal" value="1">
      </div>
      <div class="edit-add-field">
        <label>Unit Price</label>
        <input id="editAddProductPrice" type="number" min="0" step="0.01" inputmode="decimal">
      </div>
      <button id="editAddProductBtn" class="edit-add-button" type="button">+ Add</button>
    </div>
    <div id="editAddProductHelp" class="edit-add-help">Choose a product from live stock. Existing invoice products are kept unchanged until Save Changes.</div>
  `;
  wrap.parentNode.insertBefore(box,wrap);

  const headRow=wrap.querySelector('thead tr');
  if(headRow&&!headRow.querySelector('.edit-action-col')){
    const th=document.createElement('th');
    th.className='edit-action-col';
    th.textContent='';
    headRow.appendChild(th);
  }

  document.getElementById('editAddProductSearch').addEventListener('input',syncSelectedProductPrice);
  document.getElementById('editAddProductBtn').addEventListener('click',addProduct);
  document.getElementById('editItemsBody').addEventListener('click',event=>{
    const btn=event.target.closest?.('[data-edit-remove-added]');
    if(!btn)return;
    const index=Number(btn.dataset.editRemoveAdded);
    if(!Number.isInteger(index)||!currentEditInvoice?.items?.[index]?._historyAdded)return;
    syncRowsToState();
    currentEditInvoice.items.splice(index,1);
    renderEditRows();
    refreshCatalogOptions();
    if(typeof window.recalcEditInvoice==='function')window.recalcEditInvoice();
  });
}

function currentCustomerId(){
  try{
    if(typeof window.syncEditCustomerSelection==='function'){
      return clean(window.syncEditCustomerSelection());
    }
  }catch(_){}
  return clean(document.getElementById('editCustomer')?.dataset?.customerId||currentEditInvoice?.customerId);
}

async function loadCatalog(force=false){
  ensureUi();
  if(!currentEditInvoice?.invoiceId)return [];

  const invoiceId=clean(currentEditInvoice.invoiceId);
  const customerId=currentCustomerId();

  if(!force&&catalogInvoiceId===invoiceId&&catalogCustomerId===customerId&&editCatalog.length){
    refreshCatalogOptions();
    return editCatalog;
  }

  const btn=document.getElementById('editAddProductBtn');
  const help=document.getElementById('editAddProductHelp');
  if(btn)btn.disabled=true;
  if(help)help.textContent='Loading products from live stock…';

  try{
    const data=await rpc('bb_sales_history_edit_product_catalog',{
      p_invoice_id:invoiceId,
      p_customer_id:customerId||null
    });
    editCatalog=Array.isArray(data?.products)?data.products:[];
    catalogInvoiceId=invoiceId;
    catalogCustomerId=customerId;
    refreshCatalogOptions();
    if(help){
      help.textContent=(data?.batchId
        ? 'Batch '+data.batchId+': only products available in this Batch are shown.'
        : 'Direct Sale: products are loaded from current Warehouse stock.')+
        ' Stock will be rebuilt only when you save.';
    }
    return editCatalog;
  }catch(error){
    editCatalog=[];
    refreshCatalogOptions();
    if(help)help.textContent=error?.message||String(error);
    throw error;
  }finally{
    if(btn)btn.disabled=false;
  }
}

function itemCode(item){
  return clean(item?.exactProductCode||item?.productCode);
}

function syncRowsToState(){
  if(!currentEditInvoice||!Array.isArray(currentEditInvoice.items))return;
  currentEditInvoice.items.forEach((item,index)=>{
    const row=document.querySelector('#editItemsBody tr[data-edit-index="'+index+'"]');
    if(!row)return;
    const qty=row.querySelector('.edit-item-qty');
    const price=row.querySelector('.edit-item-price');
    if(qty)item.qty=Math.max(0,num(qty.value));
    if(price){
      const v=Math.max(0,num(price.value));
      item.price=v;
      item.unitPrice=v;
    }
  });
}

function refreshCatalogOptions(){
  const list=document.getElementById('editAddProductOptions');
  const label=document.getElementById('editAddProductStockLabel');
  if(!list)return;

  const used=new Set((currentEditInvoice?.items||[])
    .filter(x=>num(x?.qty)>EPS)
    .map(itemCode)
    .filter(Boolean));

  const available=editCatalog.filter(p=>!used.has(clean(p.productCode)));
  list.innerHTML=available.map(p=>{
    const remaining=num(p.availableQty);
    const text=clean(p.productName)+' — '+clean(p.productCode)+' · Available '+remaining.toLocaleString('en-US',{maximumFractionDigits:3});
    return '<option value="'+esc(p.productCode)+'" label="'+esc(text)+'"></option>';
  }).join('');

  if(label)label.textContent=available.length+' product'+(available.length===1?'':'s')+' available';
}

function findCatalogProduct(input){
  const q=clean(input).toLowerCase();
  if(!q)return null;

  let matches=editCatalog.filter(p=>
    clean(p.productCode).toLowerCase()===q
    || clean(p.productName).toLowerCase()===q
  );
  if(matches.length===1)return matches[0];

  matches=editCatalog.filter(p=>
    clean(p.productCode).toLowerCase().includes(q)
    || clean(p.productName).toLowerCase().includes(q)
  );
  return matches.length===1?matches[0]:null;
}

function priceForProduct(product){
  const currency=clean(document.getElementById('editCurrency')?.value||currentEditInvoice?.currency||'USD').toUpperCase();
  return currency==='KHR'?num(product?.priceKHR):num(product?.priceUSD);
}

function syncSelectedProductPrice(){
  const input=document.getElementById('editAddProductSearch');
  const price=document.getElementById('editAddProductPrice');
  const product=findCatalogProduct(input?.value);
  if(!product)return;
  if(price)price.value=String(priceForProduct(product));
}

function buildDirectAllocation(product,qty){
  qty=Math.max(0,num(qty));
  if(qty<=EPS)return [];

  let purchased=Math.max(0,num(product?.purchasedAvailableQty));
  let zero=Math.max(0,num(product?.zeroCostAvailableQty));
  const out=[];

  // Match Invoice Generator default: Purchased first.
  const pTake=Math.min(qty,purchased);
  if(pTake>EPS)out.push({source:'PURCHASED',qty:pTake});

  const remain=qty-pTake;
  const zTake=Math.min(remain,zero);
  if(zTake>EPS)out.push({source:'ZERO_COST',qty:zTake});

  if(qty-(pTake+zTake)>EPS)return [];
  return out;
}

async function addProduct(){
  try{
    await loadCatalog(false);

    const search=document.getElementById('editAddProductSearch');
    const qtyInput=document.getElementById('editAddProductQty');
    const priceInput=document.getElementById('editAddProductPrice');
    const query=clean(search?.value);
    const product=findCatalogProduct(query);

    if(!product){
      alert('Please choose one exact Product from the Add Product list.');
      search?.focus();
      return;
    }

    const code=clean(product.productCode);
    if((currentEditInvoice?.items||[]).some(x=>itemCode(x)===code&&num(x.qty)>EPS)){
      alert(product.productName+' is already on this invoice. Edit its QTY instead.');
      return;
    }

    const qty=Math.max(0,num(qtyInput?.value));
    if(qty<=0){
      alert('QTY must be greater than 0.');
      qtyInput?.focus();
      return;
    }

    if(qty>num(product.availableQty)+EPS){
      alert(product.productName+': QTY '+qty+' exceeds available stock '+num(product.availableQty)+'.');
      return;
    }

    let price=Math.max(0,num(priceInput?.value));
    if(!clean(priceInput?.value))price=priceForProduct(product);

    const isBatch=!!clean(currentEditInvoice?.batchId||currentEditInvoice?.batchNumber);
    const allocation=isBatch?null:buildDirectAllocation(product,qty);
    if(!isBatch&&(!Array.isArray(allocation)||!allocation.length)){
      alert(product.productName+': current Warehouse stock cannot cover this QTY.');
      return;
    }

    syncRowsToState();
    currentEditInvoice.items=currentEditInvoice.items||[];
    currentEditInvoice.items.push({
      lineId:'',
      _historyAdded:true,
      entryType:'EXACT',
      exactProductCode:code,
      productCode:code,
      productName:clean(product.productName)||code,
      productBarcode:clean(product.barcode),
      barcode:clean(product.barcode),
      unit:clean(product.unit),
      qty,
      price,
      unitPrice:price,
      stockAllocation:allocation,
      _editCatalogProduct:product
    });

    renderEditRows();
    refreshCatalogOptions();
    if(search)search.value='';
    if(qtyInput)qtyInput.value='1';
    if(priceInput)priceInput.value='';

    if(typeof window.recalcEditInvoice==='function')window.recalcEditInvoice();

    const index=currentEditInvoice.items.length-1;
    const row=document.querySelector('#editItemsBody tr[data-edit-index="'+index+'"] .edit-item-qty');
    row?.focus();
    row?.select?.();
  }catch(error){
    alert(error?.message||String(error));
  }
}

function renderEditRows(){
  const body=document.getElementById('editItemsBody');
  if(!body||!currentEditInvoice)return;

  const items=Array.isArray(currentEditInvoice.items)?currentEditInvoice.items:[];
  body.innerHTML=items.map((item,index)=>{
    const added=item?._historyAdded===true;
    const barcode=item.productBarcode||item.barcode||'';
    const price=num(item.price??item.unitPrice);
    return '<tr data-edit-index="'+index+'">'+
      '<td>'+esc(itemCode(item))+(added?'<span class="edit-added-badge">NEW</span>':'')+'</td>'+
      '<td><strong>'+esc(item.productName||itemCode(item))+'</strong>'+
        (barcode?'<br><small>Barcode: '+esc(barcode)+'</small>':'')+
        (item.productNote?'<br><small>Note: '+esc(item.productNote)+'</small>':'')+
        (item.unit?'<br><small>Unit: '+esc(item.unit)+'</small>':'')+
      '</td>'+
      '<td><input class="edit-item-qty" type="number" min="0" step="0.01" value="'+esc(num(item.qty))+'" oninput="recalcEditInvoice()"></td>'+
      '<td><input class="edit-item-price" type="number" min="0" step="0.01" value="'+esc(price)+'" oninput="recalcEditInvoice()"></td>'+
      '<td class="money edit-item-total">0.00</td>'+
      '<td class="edit-action-col">'+(added?'<button type="button" class="edit-remove-added" data-edit-remove-added="'+index+'" title="Remove added product">×</button>':'')+'</td>'+
    '</tr>';
  }).join('');

  if(typeof window.recalcEditInvoice==='function')window.recalcEditInvoice();
}

function patchExistingRows(){
  ensureUi();
  const rows=[...document.querySelectorAll('#editItemsBody tr')];
  rows.forEach(tr=>{
    if(tr.querySelector('.edit-action-col'))return;
    const td=document.createElement('td');
    td.className='edit-action-col';
    tr.appendChild(td);
  });
}

function patchBuildPayload(){
  if(typeof window.buildEditPayload!=='function'||window.buildEditPayload.__bbAddProductWrapped)return;
  const original=window.buildEditPayload;

  const wrapped=function(){
    const payload=original.apply(this,arguments);
    if(!payload||!Array.isArray(payload.items)||!currentEditInvoice)return payload;

    for(const item of currentEditInvoice.items||[]){
      if(!item?._historyAdded)continue;
      const code=itemCode(item);
      const payloadItem=payload.items.find(x=>!clean(x.lineId)&&clean(x.productCode)===code);
      if(!payloadItem)continue;

      const catalogProduct=item._editCatalogProduct||editCatalog.find(p=>clean(p.productCode)===code);
      const batch=!!clean(currentEditInvoice.batchId||currentEditInvoice.batchNumber);
      if(!batch){
        const alloc=buildDirectAllocation(catalogProduct,payloadItem.qty);
        payloadItem.stockAllocation=alloc;
      }
    }
    return payload;
  };
  wrapped.__bbAddProductWrapped=true;
  window.buildEditPayload=wrapped;
}

function patchSaveWarning(){
  if(typeof window.saveEditedInvoice!=='function'||window.saveEditedInvoice.__bbAddProductWrapped)return;
  // Existing save routine already sends the rebuilt item set.
  // Marking this only prevents repeated wrapping by other loaders.
  window.saveEditedInvoice.__bbAddProductWrapped=true;
}

function patchOpen(){
  if(typeof window.openEditInvoice!=='function'||window.openEditInvoice.__bbAddProductWrapped)return;
  const original=window.openEditInvoice;
  const wrapped=async function(){
    editCatalog=[];
    catalogInvoiceId='';
    catalogCustomerId='';
    const result=await original.apply(this,arguments);
    ensureUi();
    patchExistingRows();
    try{await loadCatalog(true)}catch(_){}
    return result;
  };
  wrapped.__bbAddProductWrapped=true;
  window.openEditInvoice=wrapped;
}

function patchCustomerChange(){
  const input=document.getElementById('editCustomer');
  if(!input||input.dataset.bbAddProductWatch==='1')return;
  input.dataset.bbAddProductWatch='1';
  input.addEventListener('change',()=>{catalogCustomerId='';loadCatalog(true).catch(()=>{})});
}

function boot(){
  ensureUi();
  patchOpen();
  patchBuildPayload();
  patchSaveWarning();
  patchCustomerChange();

  setTimeout(()=>{patchOpen();patchBuildPayload();patchCustomerChange()},250);
  setTimeout(()=>{patchOpen();patchBuildPayload();patchCustomerChange()},1200);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();

window.BB_INVOICE_HISTORY_ADD_PRODUCT_BUILD='20260926-v1';
})();