(function(){
'use strict';
const el=id=>document.getElementById(id);
function paymentFields(prefix,p={}){
 const method=p.pagamento_metodo||'unknown';
 return `<div class="modal-section-label">Taxas do pagamento</div><div class="form-grid col3" id="${prefix}-fees"><div><label>Meio de pagamento</label><select id="${prefix}-method"><option value="unknown">Não informado / revisar</option><option value="pix" ${method==='pix'?'selected':''}>Pix · 1% + R$ 0,99</option><option value="credit_card" ${method==='credit_card'?'selected':''}>Cartão · 4,99% + R$ 0,99</option></select></div><div><label>Parcelas</label><input id="${prefix}-installments" type="number" min="1" max="12" value="${Number(p.parcelas||1)}"></div><div><label>Juros cobrados do cliente (R$)</label><input id="${prefix}-interest" type="number" min="0" step="0.01" value="${Number(p.juros_parcelamento||0).toFixed(2)}"></div><div><label>Checkout Yampi · 2,5%</label><select id="${prefix}-yampi"><option value="yes" ${p.checkout_yampi?'selected':''}>Sim</option><option value="no" ${!p.checkout_yampi?'selected':''}>Não</option></select></div><div><label>Taxa do gateway</label><select id="${prefix}-mode"><option value="auto" ${p.taxas_origem==='estimado'?'selected':''}>Calcular pelo padrão</option><option value="reported" ${p.taxas_origem!=='estimado'?'selected':''}>Valor informado / conciliado</option></select></div><div><label>Gateway informado (R$)</label><input id="${prefix}-gateway" type="number" min="0" step="0.01" value="${p.taxa_gateway===null||p.taxa_gateway===undefined?'':Number(p.taxa_gateway).toFixed(2)}" placeholder="Informe para conciliar"></div></div><div class="v107-freight-note" id="${prefix}-fee-summary" aria-live="polite"></div>`;
}
window.collectTaxasInputV108=function(prefix,gross,canal,p=null){
 const method=el(prefix+'-method')?.value||'unknown';
 const interest=Number(el(prefix+'-interest')?.value||0),yampi=el(prefix+'-yampi')?.value==='yes';
 const mode=el(prefix+'-mode')?.value||'auto',value=el(prefix+'-gateway')?.value;
 const gateway=mode==='reported'&&value!==''&&value!==undefined?Number(value):null;
 if(p?.taxas_origem==='legado'&&method==='unknown'&&interest===0&&!yampi&&gateway===null&&mode==='reported')return {pagamento_metodo:null,parcelas:p.parcelas||1,juros_parcelamento:0,checkout_yampi:false,taxa_gateway:null,taxa_yampi:0,taxas:Number(p.taxas||0),liquido_gateway:null,taxas_origem:'legado',taxas_revisao:p.taxas_revisao||null};
 const f=PaymentFees.calculate({gross,interest,method,yampi,gateway});
 let source=f.pending?'pendente':mode==='reported'?'informado':'estimado';
 if(p?.taxas_origem==='csv'&&mode==='reported'&&method===p.pagamento_metodo&&interest===Number(p.juros_parcelamento)&&gateway===Number(p.taxa_gateway)&&yampi===p.checkout_yampi)source='csv';
 return {pagamento_metodo:f.method,parcelas:Math.max(1,Math.trunc(Number(el(prefix+'-installments')?.value||1))),juros_parcelamento:f.interest,checkout_yampi:yampi,taxa_gateway:f.gateway,taxa_yampi:f.yampi,taxas:f.total??PaymentFees.money(f.interest+f.yampi),liquido_gateway:f.netGateway,taxas_origem:source,taxas_revisao:f.pending?'Informe o meio de pagamento ou o gateway para concluir as taxas':null};
};
function wire(prefix,gross,p,update){
 const refresh=()=>{try{const f=collectTaxasInputV108(prefix,gross(),null,p);const box=el(prefix+'-fee-summary');if(box)box.textContent=`Gateway: ${f.taxa_gateway===null?'pendente':fmtVal(f.taxa_gateway)} · Juros repassados: ${fmtVal(f.juros_parcelamento)} · Yampi: ${fmtVal(f.taxa_yampi)} · Total: ${fmtVal(f.taxas)}${f.taxas_revisao?' · '+f.taxas_revisao:''}`;el(prefix+'-gateway').disabled=el(prefix+'-mode').value==='auto';if(update)update(f);}catch(e){el(prefix+'-fee-summary').textContent=e.message;}};
 el(prefix+'-fees').addEventListener('input',refresh);el(prefix+'-fees').addEventListener('change',refresh);refresh();return refresh;
}
const oldNew=modalNovaVendaHTMLV9;
modalNovaVendaHTMLV9=function(){return oldNew().replace('<div class="traffic-origin-box"',paymentFields('fee-new',{checkout_yampi:true,taxas_origem:'estimado'})+'<div class="traffic-origin-box"');};
const oldPreview=atualizarPreviewV9;
atualizarPreviewV9=function(){
 if(el('fee-new-fees')){try{const rec=(window.__novaVendaItensV9||[]).reduce((s,i)=>s+Number(i.receita||0),0);const f=collectTaxasInputV108('fee-new',rec);if(el('v-taxa')){el('v-taxa').value=f.taxas.toFixed(2);el('v-taxa').readOnly=true;el('v-taxa').previousElementSibling.textContent='Taxas totais (R$)';}if(el('fee-new-fee-summary'))el('fee-new-fee-summary').textContent=`Gateway: ${f.taxa_gateway===null?'pendente':fmtVal(f.taxa_gateway)} · Juros: ${fmtVal(f.juros_parcelamento)} · Yampi: ${fmtVal(f.taxa_yampi)}${f.taxas_revisao?' · '+f.taxas_revisao:''}`;}catch(e){el('fee-new-fee-summary').textContent=e.message;}}
 return oldPreview();
};
const oldOpenNew=abrirModalNovaVenda;
abrirModalNovaVenda=async function(){const r=await oldOpenNew();if(el('fee-new-fees')){wire('fee-new',()=>(window.__novaVendaItensV9||[]).reduce((s,i)=>s+Number(i.receita||0),0),null,atualizarPreviewV9);el('v-canal')?.addEventListener('change',()=>{el('fee-new-yampi').value=el('v-canal').value==='Yampi'?'yes':'no';atualizarPreviewV9();});}return r;};
const oldEdit=abrirEditarPedidoV96;
abrirEditarPedidoV96=function(id){oldEdit(id);const p=pedidosBaseV9().find(x=>String(x.id)===String(id));if(!p)return;const content=el('modal-item-conteudo'),actions=content.querySelector('.modal-actions');actions.insertAdjacentHTML('beforebegin',paymentFields('fee-edit',p));wire('fee-edit',()=>Number(p.receita||0),p);};
const oldDetail=abrirModalPedidoV9;
abrirModalPedidoV9=function(id){oldDetail(id);const p=pedidosBaseV9().find(x=>String(x.id)===String(id));if(!p)return;const total=el('modal-venda-conteudo').querySelector('.modal-total');total.insertAdjacentHTML('beforebegin',`<div class="modal-section-label">Detalhamento das taxas</div><div class="modal-row"><span>Gateway (${escHtml(p.pagamento_metodo||'não informado')})</span><span>${p.taxa_gateway===null||p.taxa_gateway===undefined?'Pendente':fmtVal(p.taxa_gateway)}</span></div><div class="modal-row"><span>Juros repassados ao processador</span><span>${fmtVal(p.juros_parcelamento||0)}</span></div><div class="modal-row"><span>Comissão Yampi (2,5%)</span><span>${fmtVal(p.taxa_yampi||0)}</span></div><div class="v107-freight-note">${escHtml(p.taxas_revisao||('Origem das taxas: '+(p.taxas_origem||'legado')))}. A comissão Yampi é cobrada semanalmente e já está incluída no custo do pedido.</div>`);};
const oldDashboard=renderDashboard;
renderDashboard=function(){const r=oldDashboard();const box=el('cards-resumo');if(box){el('fee-pending-warning')?.remove();const pending=pedidosBaseV9().filter(p=>p.taxas_origem==='pendente'||p.taxas_revisao);if(pending.length)box.insertAdjacentHTML('beforebegin',`<div id="fee-pending-warning" class="v107-freight-note">${pending.length} pedido(s) com taxas a revisar. O lucro desses pedidos ainda pode mudar. Abra o pedido para conferir.</div>`);}return r;};
})();
