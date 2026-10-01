/* Desktop-only, viewport-fitted invoice preview. Never resizes image exports or prints. */
(function(){
'use strict';
const qs=new URLSearchParams(location.search);
if(qs.get('mobileSkin')==='1'||qs.get('mobileScope')==='1')return;
const desktop=()=>window.matchMedia('(min-width: 861px)').matches;
const style=document.createElement('style');
style.id='bb-desktop-fit-preview';
style.textContent='@media(min-width:861px){'+
'#detailModal.show{display:flex!important;align-items:center;justify-content:center;padding:10px 14px!important;overflow:hidden!important}'+
'#detailModal>.modal-card{width:min(1060px,100%)!important;height:calc(100dvh - 20px);max-height:calc(100dvh - 20px);margin:0!important;display:flex!important;flex-direction:column!important;overflow:hidden!important}'+
'#detailModal>.modal-card>.modal-head{flex:0 0 auto;padding:8px 13px!important;min-height:58px;flex-wrap:wrap!important}'+
'#detailModal>.modal-card>.modal-head h2{font-size:17px!important;white-space:nowrap}'+
'#detailModal .bb-preview-header-actions{display:flex!important;flex:1 1 auto;min-width:0;justify-content:flex-end;align-items:center;gap:7px!important;padding:0!important;background:transparent!important}'+
'#detailModal .bb-preview-header-actions .history-action-btn{min-height:34px!important;padding:7px 10px!important;font-size:11px!important;box-shadow:none!important;white-space:nowrap}'+
'#detailModal .bb-preview-header-actions #bbDigitalOriginalBadge{font-size:10px!important;padding:5px 7px!important;white-space:nowrap;grid-column:auto!important}'+
'#detailModal #detailLoading{flex:1;min-height:0}'+
'#detailModal #detailContent{flex:1;min-height:0;flex-direction:column;overflow:hidden}'+
'#detailModal #detailContent[style*="display: block"],#detailModal #detailContent[style*="display:block"]{display:flex!important}'+
'#detailModal .history-invoice-wrap{flex:1 1 auto!important;min-height:0!important;position:relative;overflow:hidden!important;padding:0!important;background:#eef2f7;isolation:isolate}'+
'#detailModal #historyInvoicePrintArea{position:absolute!important;left:50%;top:0;width:794px!important;min-width:794px!important;max-width:794px!important;margin:0!important;transform-origin:top center!important;transform:translateX(-50%) scale(var(--bb-preview-scale,.6))!important}'+
'#detailModal .history-invoice-actions:not(.bb-preview-header-actions){flex:0 0 auto!important;gap:8px!important;padding:8px 16px!important}'+
'#detailModal #bbDigitalOriginalBadge{align-self:center}'+
'}';
document.head.appendChild(style);
let scheduled=0;
let lastScale=1;
function moveActions(){
 if(!desktop())return;
 moveActions();
 const modal=document.getElementById('detailModal');
 const head=modal?.querySelector('.modal-head');
 const actions=modal?.querySelector('.history-invoice-actions');
 const close=head?.querySelector('.close');
 if(!head||!actions||!close)return;
 if(!actions.classList.contains('bb-preview-header-actions')){
  actions.classList.add('bb-preview-header-actions');
  head.insertBefore(actions,close);
 }
}

function fit(){
 scheduled=0;
 if(!desktop())return;
 const modal=document.getElementById('detailModal');
 if(!modal?.classList.contains('show'))return;
 const wrap=modal.querySelector('.history-invoice-wrap');
 const area=document.getElementById('historyInvoicePrintArea');
 const invoice=document.getElementById('historyInvoiceDocument');
 if(!wrap||!area||!invoice)return;
 // Only fit the visible invoice CONTENT; do not shrink because the A4
 // print template keeps hundreds of blank pixels below the signatures.
 const lastContent=invoice.querySelector('.history-final-signature-grid')||invoice.lastElementChild;
 const invoiceRect=invoice.getBoundingClientRect();
 const lastRect=lastContent?.getBoundingClientRect();
 const contentHeight=lastRect?.height
  ? Math.max(440,(lastRect.bottom-invoiceRect.top)/lastScale+38)
  : Math.max(650,invoice.scrollHeight);
 const availableWidth=Math.max(0,wrap.clientWidth-24);
 const availableHeight=Math.max(0,wrap.clientHeight-12);
 if(!availableWidth||!availableHeight)return;
 const factor=Math.min(1,availableWidth/794,availableHeight/contentHeight);
 lastScale=Math.max(.15,factor);
 area.style.setProperty('--bb-preview-scale',String(lastScale));
}
function queueFit(){
 if(scheduled)cancelAnimationFrame(scheduled);
 scheduled=requestAnimationFrame(()=>requestAnimationFrame(fit));
}
function setup(){
 const old=window.renderDetail;
 if(typeof old!=='function'||old.__bbDesktopFit)return false;
 const wrapped=function(invoice){const result=old.apply(this,arguments);queueFit();return result;};
 wrapped.__bbDesktopFit=true;
 window.renderDetail=wrapped;
 moveActions();
 const wrap=document.querySelector('#detailModal .history-invoice-wrap');
 if(wrap&&window.ResizeObserver)new ResizeObserver(queueFit).observe(wrap);
 window.addEventListener('resize',queueFit,{passive:true});
 return true;
}
if(!setup())document.addEventListener('DOMContentLoaded',setup,{once:true});
})();