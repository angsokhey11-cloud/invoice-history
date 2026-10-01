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
'#detailModal>.modal-card>.modal-head{flex:0 0 auto;padding:11px 17px!important}'+
'#detailModal #detailLoading{flex:1;min-height:0}'+
'#detailModal #detailContent{flex:1;min-height:0;flex-direction:column;overflow:hidden}'+
'#detailModal #detailContent[style*="display: block"],#detailModal #detailContent[style*="display:block"]{display:flex!important}'+
'#detailModal .history-invoice-wrap{flex:1 1 auto!important;min-height:0!important;position:relative;overflow:hidden!important;padding:0!important;background:#eef2f7;isolation:isolate}'+
'#detailModal #historyInvoicePrintArea{position:absolute!important;left:50%;top:0;width:794px!important;min-width:794px!important;max-width:794px!important;margin:0!important;transform-origin:top center!important;transform:translateX(-50%) scale(var(--bb-preview-scale,.6))!important}'+
'#detailModal .history-invoice-actions{flex:0 0 auto!important;gap:8px!important;padding:8px 16px!important}'+
'#detailModal #bbDigitalOriginalBadge{align-self:center}'+
'}';
document.head.appendChild(style);
let scheduled=0;
function fit(){
 scheduled=0;
 if(!desktop())return;
 const modal=document.getElementById('detailModal');
 if(!modal?.classList.contains('show'))return;
 const wrap=modal.querySelector('.history-invoice-wrap');
 const area=document.getElementById('historyInvoicePrintArea');
 const invoice=document.getElementById('historyInvoiceDocument');
 if(!wrap||!area||!invoice)return;
 const height=Math.max(1123,invoice.scrollHeight,invoice.offsetHeight);
 const availableWidth=Math.max(0,wrap.clientWidth-24);
 const availableHeight=Math.max(0,wrap.clientHeight-12);
 if(!availableWidth||!availableHeight)return;
 const factor=Math.min(1,availableWidth/794,availableHeight/height);
 area.style.setProperty('--bb-preview-scale',String(Math.max(.15,factor)));
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
 const wrap=document.querySelector('#detailModal .history-invoice-wrap');
 if(wrap&&window.ResizeObserver)new ResizeObserver(queueFit).observe(wrap);
 window.addEventListener('resize',queueFit,{passive:true});
 return true;
}
if(!setup())document.addEventListener('DOMContentLoaded',setup,{once:true});
})();