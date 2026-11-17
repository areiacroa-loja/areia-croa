/* Presentation adapter over the existing ERP; no replacement data model or credentials. */
(() => {
'use strict';
const $=id=>document.getElementById(id),esc=value=>escHtml(String(value??''));
const icon=name=>`<i class="ti ti-${name}" aria-hidden="true"></i>`;
const badge=(text,tone='')=>`<span class="ac-badge ${tone}">${esc(text)}</span>`;
const metric=(label,value,detail,name)=>`<article class="ac-surface ac-metric">${name?`<span class="ac-icon">${icon(name)}</span>`:''}<div><div class="ac-metric-label">${esc(label)}</div><strong>${value}</strong><small>${esc(detail)}</small></div></article>`;
const empty=text=>`<div class="ac-empty">${icon('inbox')}<p>${esc(text)}</p></div>`;
const percent=value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
function summary(month=''){
 const orders=pedidosBaseV9().filter(p=>!month||getMes(p.data)===month);
 const revenue=orders.reduce((s,p)=>s+Number(p.receita||0),0),cost=orders.reduce((s,p)=>s+custoPedidoV9(p),0),ads=gastoAdsTotal(month),profit=revenue-cost-ads;
 return {orders,revenue,cost,ads,profit,margin:revenue>0?profit/revenue*100:0};
}
function renderFinancial(){
 if(!$('panel-dashboard'))return;
 const month=$('filter-mes')?.value||'',d=summary(month),total=summary(),label=periodoLabel(month);
 let root=$('ac-financial');if(!root){root=document.createElement('div');root.id='ac-financial';(document.querySelector('.ac-legacy-summary')||$('meta-home')).before(root);}
 if(cache.financialSyncState!=='ready'){
  const failed=cache.financialSyncState==='error';
  root.innerHTML=`<section class="ac-surface ac-hero" role="status"><div><div class="ac-muted">${esc(label)}</div><h2>${failed?'Lucro ainda não confirmado':'Conferindo o lucro…'}</h2><p>${failed?'Não foi possível carregar todos os custos e gastos de mídia. Tente atualizar para conferir o resultado.':'Aguardando vendas, custos e mídia do Supabase para mostrar o resultado completo.'}</p></div>${failed?'<button class="btn" id="ac-retry-finance">Atualizar resumo</button>':''}</section>`;
  if(failed)$('ac-retry-finance').onclick=()=>carregarTudo().catch(()=>{});return;
 }
 const [year,mo]=month.split('-').map(Number),goal=month?(cache.metas||[]).find(m=>Number(m.ano)===year&&Number(m.mes)===mo):null,target=Number(goal?.faturamento_previsto||0),progress=target>0?d.revenue/target*100:0;
 const segments=[['Custos operacionais',d.cost,'#6e85ae'],['Tráfego pago',d.ads,'#9e8cff'],['Lucro líquido',d.profit,'#5bdbd3']];
 // A negative result cannot be a positive slice of revenue. Keep exact signed figures and explicitly label the alternate denominator.
 const denominator=d.profit<0?Math.max(d.cost+d.ads,1):Math.max(d.revenue,1);
 root.innerHTML=`<section class="ac-surface ac-hero"><div><div class="ac-muted">Lucro líquido ${month?'do mês':'do período'}</div><div class="ac-hero-value ${d.profit<0?'ac-negative':''}">${fmtVal(d.profit)}</div>${badge(d.profit>0?'Positivo':d.profit<0?'Negativo':'Sem resultado',d.profit<0?'error':d.profit>0?'ok':'')} <span class="ac-muted">${esc(label)}</span><small class="ac-finance-confirmed">Vendas, custos e mídia conferidos · ${esc(new Date(cache.financialSyncedAt).toLocaleString('pt-BR',{timeZone:'America/Bahia'}))}</small></div><div class="ac-hero-goal"><div class="ac-muted">Meta de faturamento</div>${target>0?`<div class="ac-goal-value">${percent(progress)} atingida</div><div class="ac-track" role="progressbar" aria-label="Meta de faturamento" aria-valuenow="${Math.min(100,Math.max(0,progress))}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100,Math.max(0,progress))}%"></span></div><div class="ac-between ac-muted"><span>${fmtVal(d.revenue)} de ${fmtVal(target)}</span><span>${progress>=100?'Meta alcançada':'Faltam '+fmtVal(Math.max(0,target-d.revenue))}</span></div>`:`<p>${month?'Nenhuma meta de faturamento neste mês.':'Selecione um mês para acompanhar sua meta.'}</p><button class="btn" data-ac-tab="metas">${icon('target-arrow')} Ver metas</button>`}</div></section>
 <div class="ac-metrics">${metric('Faturamento',fmtVal(d.revenue),label,'chart-bar')}${metric('Custos operacionais',fmtVal(d.cost),'Produtos, frete, taxas e operação','database')}${metric('Tráfego pago',fmtVal(d.ads),label,'speakerphone')}${metric('Margem líquida',percent(d.margin),label,'percentage')}</div>
 <div class="ac-finance-grid"><section class="ac-surface"><h3>Distribuição financeira</h3><p class="ac-muted">${d.profit<0?'Custos e tráfego excederam o faturamento. Barra proporcional às despesas.':'Como o faturamento foi distribuído no período.'}</p><div class="ac-distribution" role="img" aria-label="${esc(segments.map(([n,v])=>n+': '+fmtVal(v)).join('; '))}">${segments.map(([n,v,c])=>`<span title="${esc(n)}: ${fmtVal(v)}" style="width:${Math.max(0,v)/denominator*100}%;background:${c}"></span>`).join('')}</div><div class="ac-legend">${segments.map(([n,v,c])=>`<div><span class="ac-muted"><i class="ac-dot" style="background:${c}"></i>${n}</span><strong class="${v<0?'ac-negative':''}">${fmtVal(v)}</strong><small>${d.revenue>0?percent(v/d.revenue*100)+' do faturamento':'Sem faturamento no período'}</small></div>`).join('')}</div></section>
 <section class="ac-surface"><h3>Resumo do período</h3><p class="ac-muted">Conciliação financeira · ${esc(label)}</p>${[['Receita bruta',d.revenue],['Custos operacionais',-d.cost],['Investimento em anúncios',-d.ads],['Resultado líquido',d.profit]].map(([n,v])=>`<div class="ac-pnl-row"><span>${n}</span><strong class="${v<0?'ac-negative':''}">${v>0?'+ ':''}${fmtVal(v)}</strong></div>`).join('')}</section></div>
 <section class="ac-surface ac-accumulated"><h3>Acumulado geral</h3><p class="ac-muted">Todos os meses · visão histórica independente do filtro acima</p><div class="ac-metrics">${metric('Receita total',fmtVal(total.revenue),'Todos os períodos')}${metric('Custos + tráfego',fmtVal(total.cost+total.ads),'Todos os períodos')}${metric('Resultado',fmtVal(total.profit),'Todos os períodos')}${metric('Pedidos',String(total.orders.length),'Pedidos únicos')}${metric('Margem',percent(total.margin),'Todos os períodos')}</div></section>`;
 root.querySelectorAll('[data-ac-tab]').forEach(b=>b.onclick=()=>trocarAba(b.dataset.acTab));
}
const originalDashboard=renderDashboard;
renderDashboard=function(){const result=originalDashboard();renderFinancial();return result;};
const originalMetaHome=renderMetaHome;
renderMetaHome=function(){const r=originalMetaHome();renderFinancial();return r;};
let page=1,lastHistoryKey='';
function filteredHistory(){
 const month=$('filter-mes-hist')?.value||'',query=($('ac-history-search')?.value||'').trim().toLocaleLowerCase('pt-BR'),sort=$('ac-history-sort')?.value||'desc';
 const key=month+'|'+query+'|'+sort;if(key!==lastHistoryKey){page=1;lastHistoryKey=key;}
 return (Array.isArray(cache.pedidos)?cache.pedidos:pedidosBaseV9()).filter(p=>(!month||getMes(p.data)===month)&&(!query||`${p.referencia||p.id} ${p.cliente_nome||''}`.toLocaleLowerCase('pt-BR').includes(query))).sort((a,b)=>(sort==='asc'?1:-1)*(String(a.data||'').localeCompare(String(b.data||''))||String(a.id).localeCompare(String(b.id))));
}
renderHistorico=function(){
 const list=$('lista-hist');if(!list)return;
 if(!$('ac-history-tools')){const bar=document.createElement('div');bar.id='ac-history-tools';bar.className='ac-filter';bar.innerHTML=`<div><label for="ac-history-search">Buscar pedido ou cliente</label><input id="ac-history-search" type="search" placeholder="Número do pedido ou nome"></div><div><label for="ac-history-sort">Ordenar por data</label><select id="ac-history-sort"><option value="desc">Mais recentes primeiro</option><option value="asc">Mais antigos primeiro</option></select></div><button class="btn" id="ac-history-export">${icon('download')} Exportar esta consulta</button>`;list.before(bar);$('ac-history-search').oninput=renderHistorico;$('ac-history-sort').onchange=renderHistorico;$('ac-history-export').onclick=exportHistory;}
 const rows=filteredHistory(),size=15,pages=Math.max(1,Math.ceil(rows.length/size));page=Math.min(page,pages);
 list.innerHTML=rows.length?`<div class="ac-table-wrap" tabindex="0" role="region" aria-label="Histórico de pedidos, tabela com rolagem horizontal"><table class="ac-table"><thead><tr>${['Pedido','Cliente','Data','UF','Canal','Status','Valor','Lucro','Margem','Ações'].map((n,i)=>`<th scope="col" ${i>=6&&i<=8?'class="num"':''}>${n}</th>`).join('')}</tr></thead><tbody>${rows.slice((page-1)*size,page*size).map(p=>{const profit=lucroPedidoV9(p);return `<tr><td><strong>${esc(p.referencia||'#'+p.id)}</strong></td><td>${esc(p.cliente_nome||'Não informado')}</td><td>${esc(fmtData(p.data))}</td><td>${esc(normalizeUFV6(p.estado)||'—')}</td><td>${esc(p.canal||'Outro')}</td><td>${badge(p.status==='cancelado'?'Cancelado':'Pago',p.status==='cancelado'?'error':'ok')}</td><td class="num">${fmtVal(p.receita)}</td><td class="num ${profit<0?'ac-negative':''}">${p.status==='cancelado'?'—':fmtVal(profit)}</td><td class="num">${p.status!=='cancelado'&&Number(p.receita)>0?percent(profit/Number(p.receita)*100):'—'}</td><td><button class="btn sm" data-ac-order="${esc(p.id)}" aria-label="Detalhar pedido ${esc(p.referencia||p.id)}">${icon('eye')} Detalhes</button></td></tr>`}).join('')}</tbody></table></div><div class="ac-pagination"><span>${rows.length} pedidos · página ${page} de ${pages} · cancelados preservados no histórico</span><div class="ac-actions"><button class="btn sm" id="ac-prev" ${page===1?'disabled':''}>Anterior</button><button class="btn sm" id="ac-next" ${page===pages?'disabled':''}>Próxima</button></div></div>`:empty('Nenhum pedido encontrado para estes filtros.');
 list.querySelectorAll('[data-ac-order]').forEach(b=>b.onclick=()=>abrirModalPedidoV9(b.dataset.acOrder));if($('ac-prev'))$('ac-prev').onclick=()=>{page--;renderHistorico();};if($('ac-next'))$('ac-next').onclick=()=>{page++;renderHistorico();};
};
function exportHistory(){
 const rows=[['Pedido','Cliente','Data','UF','Canal','Status','Valor','Lucro operacional','Margem %'],...filteredHistory().map(p=>[p.referencia||p.id,p.cliente_nome,fmtData(p.data),normalizeUFV6(p.estado),p.canal,p.status||'pago',p.receita,p.status==='cancelado'?'':lucroPedidoV9(p),p.status!=='cancelado'&&Number(p.receita)>0?lucroPedidoV9(p)/Number(p.receita)*100:''])];
 const safe=v=>{const t=String(v??'');return /^[=+@\t\r]/.test(t)?"'"+t:t;};
 const csv=rows.map(r=>r.map(v=>'"'+safe(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='areia-croa-historico.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}
const providers=[
 {id:'shopify',name:'Shopify',icon:'shopping-bag',description:'Tráfego e conversões da loja. O catálogo atual usa a Yampi.',endpoint:'shopify-traffic-sync',fields:['Domínio da loja','Token de acesso'],secrets:['SHOPIFY_STORE_DOMAIN','SHOPIFY_ACCESS_TOKEN']},
 {id:'yampi_catalog',name:'Yampi',icon:'shopping-cart',description:'Catálogo, estoque e pedidos recebidos pelo webhook.',endpoint:'yampi-catalog-sync',fields:['Identificador da loja','Token e chave de acesso'],secrets:['YAMPI_ALIAS','YAMPI_USER_TOKEN','YAMPI_USER_SECRET']},
 {id:'supabase',name:'Supabase',icon:'database',description:'Autenticação e armazenamento dos dados financeiros.',fields:['Projeto','Credenciais do backend'],secrets:[]},
 {id:'meta',name:'Meta Ads',icon:'brand-meta',description:'Campanhas, investimento e métricas de anúncios.',endpoint:'meta-ads-sync',fields:['Conta de anúncios','Token de acesso'],secrets:[]},
 {id:'correios',name:'Correios',icon:'truck-delivery',description:'Cotação e rastreamento. Conector não implementado neste ERP.',fields:['Contrato / identificador','Credenciais da API'],secrets:[]}
];
let selected='yampi_catalog',statusRows=[],events=[],pending=false,confirming=false,dbVerified=false,statusError=false;
const time=v=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Não disponível';
function state(p){if(p.id==='supabase')return {label:dbVerified?'Conectado':'Não verificado',tone:dbVerified?'ok':''};if(p.id==='correios')return {label:'Não configurado',tone:'warn'};const s=statusRows.find(s=>s.provider===p.id);return {label:s?.status==='success'?'Última sincronização OK':s?.status==='error'?'Requer atenção':'Não verificado',tone:s?.status==='success'?'ok':s?.status==='error'?'error':'',row:s};}
async function refreshStatus(){
 if(pending)return;pending=true;renderIntegrations();
 try{const auth=await sb.auth.getUser();if(auth.error||!auth.data?.user)throw new Error('session');const result=await sb.from('integration_sync_status').select('provider,status,last_sync_at,last_success_at,records');if(result.error)throw result.error;statusRows=result.data||[];dbVerified=true;statusError=false;}
 catch{dbVerified=false;statusError=true;}finally{pending=false;renderIntegrations();}
}
function renderIntegrations(){
 const panel=$('panel-integracoes');if(!panel)return;const p=providers.find(x=>x.id===selected),s=state(p);
 panel.innerHTML=`<div class="ac-heading"><div><h2>APIs & Integrações</h2><p>Conexões, sincronizações e configurações em um só lugar.</p></div><button class="btn" id="ac-refresh" ${pending?'disabled':''}>${icon('refresh')} ${pending?'Verificando…':'Atualizar status'}</button></div><div class="ac-surface ac-between" style="margin-bottom:18px"><span><strong>5 serviços</strong><br><small class="ac-muted">Integrações e infraestrutura</small></span><span><strong>${statusRows.filter(r=>providers.some(p=>p.id===r.provider)&&r.status==='success').length} sincronizações com sucesso</strong><br><small class="ac-muted">Conforme último registro do backend</small></span><span>${badge(dbVerified?'Banco verificado':'Banco não verificado',dbVerified?'ok':'warn')}<br><small class="ac-muted">${pending?'Consultando registros…':statusError?'Não foi possível consultar. Verifique sua sessão.':'Status histórico não garante disponibilidade atual.'}</small></span></div>
 <div class="ac-integration-layout"><div><div class="ac-connections">${providers.map(x=>{const st=state(x);return `<article class="ac-surface ac-connection ${selected===x.id?'selected':''}"><div class="ac-connection-head"><span class="ac-icon">${icon(x.icon)}</span><h3>${x.name}</h3></div>${badge(st.label,st.tone)}<p class="ac-muted">${x.description}</p><p class="ac-muted">Último sucesso: ${esc(time(st.row?.last_success_at))}</p><div class="ac-actions"><button class="btn" data-manage="${x.id}" aria-label="Gerenciar ${x.name}">${icon('settings')} Gerenciar</button>${x.endpoint?`<button class="btn" data-sync="${x.id}" ${pending?'disabled':''} aria-label="Sincronizar ${x.name}">${icon('refresh')} Sincronizar</button>`:''}</div></article>`;}).join('')}</div><section class="ac-surface ac-activity"><h3>Atividades de sincronização</h3><p class="ac-muted">Último registro por serviço e ações desta sessão. Nenhum token é exibido.</p>${[...events,...statusRows.filter(r=>providers.some(p=>p.id===r.provider)).map(r=>({name:providers.find(p=>p.id===r.provider).name,message:r.status==='success'?'Sincronização concluída':r.status==='error'?'Falha registrada; consulte o backend.':'Aguardando conclusão',at:r.last_sync_at}))].slice(0,15).map(e=>`<div class="ac-activity-row"><span><strong>${esc(e.name)}</strong> · ${esc(e.message)}</span><time>${esc(time(e.at))}</time></div>`).join('')||empty('Nenhum registro de sincronização disponível.')}</section></div>
 <section class="ac-surface ac-management"><h3>Gerenciar conexão</h3><div class="ac-connection-head" style="margin-top:24px"><span class="ac-icon">${icon(p.icon)}</span><div><h3>${p.name}</h3><span class="ac-muted">${p.description}</span></div></div>${badge(s.label,s.tone)}${p.fields.map((f,i)=>`<div class="field"><label for="ac-config-${i}">${f}</label><input id="ac-config-${i}" readonly value="${i===1?'••••••••••••':p.id==='supabase'?'pqvcwycahczvrbhziubk':'Gerenciado no backend'}" aria-describedby="ac-security-note"></div>`).join('')}<div class="ac-note" id="ac-security-note">${p.id==='correios'?'Este serviço ainda depende de um conector no backend e das credenciais do contrato. Não há cotação ou teste disponível.':'Credenciais não são carregadas neste navegador. A máscara é ilustrativa e não confirma que exista um token. Alterações são feitas no Supabase por um administrador autorizado; o ERP não possui um endpoint seguro de edição.'}</div><div class="ac-actions"><button class="btn" id="ac-test" ${pending?'disabled':''}>${icon('wifi')} Testar conexão</button>${p.id!=='correios'?'<a class="btn primary" href="https://supabase.com/dashboard/project/pqvcwycahczvrbhziubk/functions" target="_blank" rel="noopener noreferrer">Abrir configuração segura</a>':''}</div><p id="ac-test-result" class="ac-muted" role="status" aria-live="polite"></p>${p.endpoint?'<div class="ac-note">A sincronização usa os conectores existentes. Meta e Shopify seguem o período selecionado em Mídia; Yampi sincroniza o catálogo. Os pedidos continuam chegando pelo webhook.</div>':''}</section></div>`;
 $('ac-refresh').onclick=refreshStatus;panel.querySelectorAll('[data-manage]').forEach(b=>b.onclick=()=>{selected=b.dataset.manage;renderIntegrations();panel.querySelector('.ac-management').scrollIntoView({block:'nearest'});});panel.querySelectorAll('[data-sync]').forEach(b=>b.onclick=()=>syncProvider(b.dataset.sync));$('ac-test').onclick=async()=>{if(p.id==='supabase'){await refreshStatus();$('ac-test-result').textContent=dbVerified?'Sessão autenticada e leitura do banco verificadas.':'Falha na verificação. Entre novamente ou verifique a conexão.';}else $('ac-test-result').textContent=p.id==='correios'?'Teste indisponível: conector ainda não implementado.':'Este conector não oferece um teste sem sincronização. Consulte o último resultado ou execute a sincronização pelo botão do serviço.';};
}
function confirmAction(title,message){return new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.className='ac-dialog';dialog.setAttribute('aria-labelledby','ac-confirm-title');dialog.innerHTML=`<h3 id="ac-confirm-title">${esc(title)}</h3><p>${esc(message)}</p><div class="ac-actions"><button class="btn" data-no>Cancelar</button><button class="btn primary" data-yes>Sincronizar</button></div>`;document.body.append(dialog);let done=false;const finish=value=>{if(done)return;done=true;dialog.close();dialog.remove();resolve(value);};dialog.querySelector('[data-no]').onclick=()=>finish(false);dialog.querySelector('[data-yes]').onclick=()=>finish(true);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.showModal();});}
async function syncProvider(id){
 if(pending||confirming)return;const p=providers.find(p=>p.id===id);if(!p?.endpoint)return;
 const month=ymAnunciosV99(),message=id==='yampi_catalog'?'Atualizar produtos, preços e estoque usando o conector Yampi existente?':`Atualizar os dados de ${p.name} do período ${periodoLabel(month)}?`;
 confirming=true;let confirmed=false;try{confirmed=await confirmAction('Sincronizar '+p.name,message);}finally{confirming=false;}if(!confirmed)return;
 if(pending)return;pending=true;renderIntegrations();
 try{
 const {data:{session},error}=await sb.auth.getSession();if(error||!session?.access_token)throw new Error('session');let body={};
 if(id!=='yampi_catalog'){const today=hoje();if(month>today.slice(0,7))throw new Error('future');const [y,m]=month.split('-').map(Number);body={since:month+'-01',until:month===today.slice(0,7)?today:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};}
 await invocarIntegracaoV101(p.endpoint,body,session.access_token);
 if(id==='yampi_catalog'){await carregarProdutosV95(true);renderProdutos();}else await carregarIntegracoesV10();
 events.unshift({name:p.name,message:'Sincronização concluída.',at:new Date().toISOString()});renderDashboard();
 }catch{events.unshift({name:p.name,message:'Não foi possível concluir. Confira sessão, período e registros no backend.',at:new Date().toISOString()});}
 finally{pending=false;await refreshStatus();}
}
function init(){
 const workspace=document.querySelector('.workspace');if(!workspace||$('panel-integracoes'))return;
 document.documentElement.dataset.design='ac-dark';
 document.querySelectorAll('.sidebar-home-logo,.login-logo,.topbar-brand img').forEach(logo=>{logo.src='logo-areia-croa-positive-horizontal.png';logo.alt='AREIA CRÔA';});
 const drawerBrand=document.querySelector('.drawer-header span');if(drawerBrand){const image=document.createElement('img');image.src='logo-areia-croa-positive-horizontal.png';image.alt='AREIA CRÔA';image.className='ac-drawer-logo';drawerBrand.replaceChildren(image);}

 // Shared request guard reuses an in-flight connector call across old and new buttons.
 if(sb.functions?.invoke){const invoke=sb.functions.invoke.bind(sb.functions),running=new Map();sb.functions.invoke=function(name,options){if(!['meta-ads-sync','shopify-traffic-sync','yampi-catalog-sync'].includes(name))return invoke(name,options);const key=name+JSON.stringify(options?.body||{});if(running.has(key))return running.get(key);const task=Promise.resolve().then(()=>invoke(name,options)).finally(()=>running.delete(key));running.set(key,task);return task;};}

 const heading=document.querySelector('#panel-dashboard .dashboard-intro h2');if(heading)heading.textContent='Painel financeiro';const sub=document.querySelector('#panel-dashboard .dashboard-intro p');if(sub)sub.textContent='Tudo que importa para acompanhar sua operação.';
 const advanced=document.createElement('details');advanced.className='ac-legacy-summary';advanced.innerHTML='<summary>Planejamento detalhado e projeções</summary>';$('meta-home').before(advanced);advanced.append($('meta-home'));
 const foot=document.querySelector('.sidebar-foot');foot.querySelector('.sync-dot')?.remove();
 const nav=(id,label,name,cls)=>`<button class="${cls}" data-tab="${id}" onclick="trocarAba('${id}');fecharDrawer()">${icon(name)}<span>${label}</span></button>`;
 foot.insertAdjacentHTML('afterbegin',nav('integracoes','APIs & Integrações','plug','side-nav-item')+nav('configuracoes','Configurações','settings','side-nav-item'));
 const drawer=document.querySelector('.drawer');if(drawer){const menu=document.createElement('div');menu.innerHTML=nav('integracoes','APIs & Integrações','plug','drawer-item')+nav('configuracoes','Configurações','settings','drawer-item');drawer.append(menu);
 const order=['dashboard','vendas','anuncios','produtos','embalagens','clientes','historico','metas','marcos','integracoes','configuracoes'];
 const groups=[['Principal',order.slice(0,7)],['Planejamento',order.slice(7,9)],['',order.slice(9)]];
 groups.forEach(([label,ids])=>{const group=document.createElement('nav');group.setAttribute('aria-label',label||'Conta');if(label){const heading=document.createElement('div');heading.className='sidebar-section-label';heading.textContent=label;group.append(heading);}ids.forEach(id=>{const button=drawer.querySelector('.drawer-item[data-tab="'+id+'"]');if(button)group.append(button);});drawer.append(group);});
 const logout=document.createElement('button');logout.className='drawer-item';logout.innerHTML=icon('logout')+'<span>Sair</span>';logout.onclick=sair;drawer.append(logout);
 }
 // Keep the existing Meta account workspace reachable without adding a second primary navigation group.
 document.querySelectorAll('.side-nav-item[data-tab="conta-meta"],.drawer-item[data-tab="conta-meta"]').forEach(b=>b.remove());
 workspace.insertAdjacentHTML('beforeend','<section class="panel" id="panel-integracoes"></section><section class="panel" id="panel-configuracoes"><div class="ac-heading"><div><h2>Configurações</h2><p>Preferências e regras da sua operação.</p></div></div><section class="ac-surface"><h3>Taxas padrão de pagamento</h3><p class="ac-muted">Pix: 1% + R$ 0,99 · Cartão: 4,99% + R$ 0,99 · Yampi: 2,5% por pedido pago.</p><p class="ac-note">Valores conciliados são preservados. Juros de parcelamento são registrados separadamente. Você pode revisar as taxas ao editar um pedido.</p><div class="ac-actions"><button class="btn" onclick="trocarAba(\'vendas\')">Revisar pedidos</button><button class="btn" onclick="trocarAba(\'conta-meta\')">Conta Meta</button><button class="btn" onclick="trocarAba(\'integracoes\')">Gerenciar integrações</button></div></section></section>');
 const footer=workspace.querySelector('.app-footer-verse');if(footer)workspace.append(footer);
 const change=trocarAba;trocarAba=function(id,...args){const r=change(id,...args);if(id==='integracoes'){if(!pending)refreshStatus();$('page-title').textContent='APIs & Integrações';$('page-kicker').textContent='CONFIGURAÇÕES';}if(id==='configuracoes'){$('page-title').textContent='Configurações';$('page-kicker').textContent='PREFERÊNCIAS';}if(id==='historico')renderHistorico();if(id==='dashboard')renderFinancial();return r;};
 const menu=document.querySelector('.topbar-menu-btn');if(menu){menu.setAttribute('role','button');menu.setAttribute('tabindex','0');menu.setAttribute('aria-label','Abrir menu');menu.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();abrirDrawer();}};}
 document.addEventListener('keydown',e=>{if(e.key==='Escape')fecharDrawer();});
 const accessibleForms=root=>{root.querySelectorAll('label:not([for])').forEach(label=>{const controls=label.parentElement.querySelectorAll('input[id],select[id],textarea[id]');if(controls.length===1)label.htmlFor=controls[0].id;});root.querySelectorAll('.modal-close').forEach(button=>button.setAttribute('aria-label','Fechar janela'));};
 accessibleForms(document);document.querySelectorAll('.modal-box,.modal-content').forEach(modal=>new MutationObserver(()=>accessibleForms(modal)).observe(modal,{childList:true,subtree:true}));
 
 const csv=document.querySelector('.topbar-actions button');if(csv)csv.innerHTML=icon('download')+' Exportar CSV';
 renderFinancial();renderHistorico();renderIntegrations();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
/* Mobile dialogs use one scroll surface and restore the page position on close. */
(() => {
 'use strict';
 const media=matchMedia('(max-width:1099px)');let active=null,locked=false,scrollY=0,returnFocus=null,scheduled=false;
 const getOpen=()=>[...document.querySelectorAll('.modal-overlay,#drawer-overlay')].filter(el=>!el.classList.contains('hidden')&&getComputedStyle(el).display!=='none');
 function viewport(){const v=window.visualViewport;document.documentElement.style.setProperty('--ac-visible-height',Math.round(v&&v.scale<=1.05?v.height:window.innerHeight)+'px');}
 function close(el){if(el.id==='drawer-overlay'){fecharDrawer();return;}const button=el.querySelector('.modal-close');if(button){button.click();return;}const actions={'modal-venda':()=>fecharModalVenda(),'modal-item':()=>fecharModalItem(),'modal-nova-venda':()=>fecharModalNovaVenda()};actions[el.id]?.();}
 function sync(){scheduled=false;viewport();const open=getOpen(),next=open.at(-1)||null;const was=active;active=next;
  if(media.matches&&next&&!locked){scrollY=window.scrollY;returnFocus=document.activeElement;document.body.style.setProperty('--ac-scroll-top',-scrollY+'px');document.documentElement.classList.add('ac-overlay-open');document.body.classList.add('ac-overlay-open');locked=true;}
  if(locked&&(!next||!media.matches)){document.documentElement.classList.remove('ac-overlay-open');document.body.classList.remove('ac-overlay-open');document.body.style.removeProperty('--ac-scroll-top');locked=false;window.scrollTo(0,scrollY);if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
  open.forEach(el=>{const box=el.id==='drawer-overlay'?el.querySelector('.drawer'):el.querySelector('.modal-box,.modal-content,.multi-order-box');if(!box)return;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('tabindex','-1');box.setAttribute('aria-label',el.id==='drawer-overlay'?'Menu principal':box.querySelector('.modal-title,h2,h3')?.textContent||'Janela do ERP');});
  if(next&&next!==was&&media.matches)requestAnimationFrame(()=>{const target=next.querySelector('.modal-close')||next.querySelector('[role="dialog"]');target?.focus({preventScroll:true});});
 }
 function queue(){if(!scheduled){scheduled=true;requestAnimationFrame(sync);}}
 const observed=new WeakSet();function observe(){document.querySelectorAll('.modal-overlay,#drawer-overlay').forEach(el=>{if(observed.has(el))return;observed.add(el);new MutationObserver(queue).observe(el,{attributes:true,attributeFilter:['class','style'],childList:true});});}
 function hints(){document.querySelectorAll('.ac-revenue-trend>svg').forEach(svg=>{const region=document.createElement('div');region.className='ac-chart-scroll';region.setAttribute('tabindex','0');region.setAttribute('role','region');region.setAttribute('aria-label','Gráfico de receita, deslize para ver todo o período');svg.before(region);region.append(svg);});document.querySelectorAll('.ac-table-wrap,.crm-table-scroll').forEach((box,i)=>{if(box.dataset.mobileHint)return;box.dataset.mobileHint='true';const hint=document.createElement('p');hint.className='ac-scroll-hint';hint.id='ac-table-hint-'+i;hint.textContent='Deslize a tabela para os lados para ver todas as colunas e ações.';box.before(hint);box.setAttribute('tabindex','0');box.setAttribute('aria-describedby',hint.id);});}
 function init(){viewport();observe();hints();const exportButton=document.querySelector('.topbar-actions .btn');if(exportButton){exportButton.setAttribute('aria-label','Exportar CSV');exportButton.title='Exportar CSV';}const menu=document.getElementById('topbar-menu-btn');if(menu){menu.setAttribute('aria-controls','drawer-overlay');menu.setAttribute('aria-expanded','false');const drawer=document.getElementById('drawer-overlay');if(drawer)new MutationObserver(()=>menu.setAttribute('aria-expanded',String(!drawer.classList.contains('hidden')))).observe(drawer,{attributes:true,attributeFilter:['class']});}
  new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1))){observe();hints();queue();}}).observe(document.body,{childList:true,subtree:true});sync();
 }
 document.addEventListener('click',event=>{if(active?.id==='drawer-overlay'&&event.target.closest('.drawer-item[data-tab]'))scrollY=0;},true);
 document.addEventListener('keydown',event=>{if(!active||!media.matches)return;if(event.key==='Escape'){event.preventDefault();close(active);return;}if(event.key!=='Tab')return;const targets=[...active.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')].filter(e=>!e.disabled&&e.getClientRects().length);if(!targets.length){event.preventDefault();return;}const first=targets[0],last=targets.at(-1);if(event.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){event.preventDefault();first.focus();}});
 window.addEventListener('resize',queue,{passive:true});window.visualViewport?.addEventListener('resize',viewport,{passive:true});media.addEventListener('change',queue);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
/* Peak Chart by Louis Studios, adapted from the supplied React component.
 * Uses its monotone Steffen interpolation; native SVG, real paid orders, shared period.
 * No demo values, additional runtime, network requests or financial mutations. */
(()=>{
 'use strict';
 function curve(values){
  const data=values.length===1?[values[0],values[0]]:values,n=data.length;
  if(!n)return '';
  const max=Math.max(1,...data),ys=data.map(v=>154-v/max*128),step=636/Math.max(1,n-1),slopes=[];
  for(let i=0;i<n-1;i++)slopes.push((ys[i+1]-ys[i])/step);
  const tangent=[slopes[0]||0];
  for(let i=1;i<n-1;i++){const a=slopes[i-1],b=slopes[i];tangent.push((Math.sign(a)+Math.sign(b))*Math.min(Math.abs(a),Math.abs(b),.25*Math.abs(a+b)));}
  tangent.push(slopes[n-2]||0);
  let path=`M32,${ys[0].toFixed(2)}`;
  for(let i=0;i<n-1;i++){const x=32+i*step;path+=` C${(x+step/3).toFixed(2)},${(ys[i]+tangent[i]*step/3).toFixed(2)} ${(x+step*2/3).toFixed(2)},${(ys[i+1]-tangent[i+1]*step/3).toFixed(2)} ${(x+step).toFixed(2)},${ys[i+1].toFixed(2)}`;}
  return path;
 }
 function renderPeak(){
  const root=document.getElementById('ac-financial'),hero=root?.querySelector('.ac-hero');
  if(!hero||cache.financialSyncState!=='ready'||typeof pedidosBaseV9!=='function')return;
  const month=document.getElementById('filter-mes')?.value||'',orders=pedidosBaseV9().filter(p=>!month||getMes(p.data)===month),sums=new Map();
  orders.forEach(p=>{const key=String(p.data||'').slice(0,month?10:7);if(/^\d{4}-\d{2}(?:-\d{2})?$/.test(key))sums.set(key,(sums.get(key)||0)+Number(p.receita||0));});
  let keys=[...sums.keys()].sort();
  if(month){const [y,m]=month.split('-').map(Number),today=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Bahia'}),days=month===today.slice(0,7)?Number(today.slice(-2)):new Date(y,m,0).getDate();keys=Array.from({length:days},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));}
  else if(keys.length){const start=new Date(keys[0]+'-01T12:00:00Z'),end=new Date(keys.at(-1)+'-01T12:00:00Z');keys=[];for(let date=start;date<=end&&keys.length<240;date.setUTCMonth(date.getUTCMonth()+1))keys.push(date.toISOString().slice(0,7));}
  const vals=keys.map(k=>sums.get(k)||0),total=orders.reduce((s,p)=>s+Number(p.receita||0),0),max=Math.max(1,...vals),peak=vals.length?vals.indexOf(Math.max(...vals)):0;
  const label=k=>month?k.slice(-2)+'/'+month.slice(-2):new Date(k+'-01T12:00:00Z').toLocaleDateString('pt-BR',{month:'short',year:'2-digit',timeZone:'UTC'}),esc=v=>escHtml(String(v));
  let shell=document.getElementById('ac-peak-chart');if(!shell){shell=document.createElement('section');shell.id='ac-peak-chart';shell.className='ac-peak';shell.setAttribute('aria-label','Evolução da receita paga');}hero.after(shell);
  const old=document.getElementById('ac-revenue-trend');if(old)old.hidden=true;
  const line=curve(vals),points=vals.map((v,i)=>({x:32+i*636/Math.max(vals.length-1,1),y:154-v/max*128})),ticks=keys.map((k,i)=>({k,i})).filter(({i})=>i===0||i===keys.length-1||i%Math.max(1,Math.ceil(keys.length/5))===0);
  shell.innerHTML=`<div><div class="ac-peak-head"><div><span class="ac-peak-eyebrow">Performance · receita paga</span><h3>Seu negócio em movimento</h3></div><span class="ac-peak-period">${esc(periodoLabel(month))}</span></div>${vals.length?`<svg viewBox="0 0 700 190" role="group" aria-label="Receita ${month?'por dia':'por mês'}; use Tab para consultar cada ponto"><defs><linearGradient id="ac-peak-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#428aff" stop-opacity=".35"/><stop offset="1" stop-color="#428aff" stop-opacity="0"/></linearGradient></defs>${[0,.5,1].map(v=>`<line class="ac-peak-grid" x1="32" x2="668" y1="${154-v*128}" y2="${154-v*128}" stroke-dasharray="3 6"/>`).join('')}<path d="${line} L668,154 L32,154 Z" fill="url(#ac-peak-fill)"/><path class="ac-peak-line" d="${line}"/>${points.length?`<circle cx="${points[peak].x}" cy="${points[peak].y}" r="5"/>`:''}${points.map((p,i)=>`<rect class="ac-peak-point" data-peak-index="${i}" x="${p.x-318/Math.max(vals.length-1,1)}" y="16" width="${636/Math.max(vals.length-1,1)}" height="143" tabindex="0" role="img" aria-label="${esc(label(keys[i]))}: ${esc(fmtVal(vals[i]))}"><title>${esc(label(keys[i]))}: ${esc(fmtVal(vals[i]))}</title></rect>`).join('')}${ticks.map(({k,i})=>`<text x="${points[i].x}" y="181" text-anchor="middle">${esc(label(k))}</text>`).join('')}</svg>`:'<p class="ac-peak-no-data">Nenhuma receita paga neste período.</p>'}<details><summary>Consultar valores ${month?'por dia':'por mês'}</summary><div>${keys.map((k,i)=>`<span>${esc(label(k))}<b>${fmtVal(vals[i])}</b></span>`).join('')}</div></details></div><aside class="ac-peak-side"><span>Receita no período</span><strong>${fmtVal(total)}</strong><div class="ac-peak-readout" aria-live="polite">${vals.length?'Maior receita · '+esc(label(keys[peak])):'Sem vendas pagas'}<b>${fmtVal(vals[peak]||0)}</b></div><p class="ac-peak-caption">${orders.length} pedidos pagos · mesmo período do resumo financeiro.<br>Toque ou navegue pelos pontos para ver os valores.</p></aside>`;
  const readout=shell.querySelector('.ac-peak-readout'),show=i=>{readout.replaceChildren(document.createTextNode(label(keys[i])));const value=document.createElement('b');value.textContent=fmtVal(vals[i]);readout.append(value);};
  shell.querySelectorAll('[data-peak-index]').forEach(el=>{const i=Number(el.dataset.peakIndex);el.addEventListener('pointerenter',()=>show(i));el.addEventListener('pointerdown',()=>show(i));el.addEventListener('focus',()=>show(i));});
 }
 let pending=false;function queuePeak(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;renderPeak();});}
 function init(){const root=document.getElementById('ac-financial');if(!root)return;new MutationObserver(records=>{if(records.some(r=>r.target===root&&[...r.addedNodes].some(n=>n.nodeType===1&&n.id!=='ac-peak-chart')))queuePeak();}).observe(root,{childList:true});document.getElementById('filter-mes')?.addEventListener('change',queuePeak);queuePeak();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
/* Visible ERP views follow order changes without requiring a page reload.
 * A lightweight revision probe precedes the existing full financial sync.
 * Editing, hidden tabs and CRM campaign composition are never refreshed. */
(()=>{
 'use strict';let busy=false,revision='',lastProbe=0;
 const tab=()=>typeof perfActiveTabV95==='function'?perfActiveTabV95():'dashboard';
 function canRefresh(){const root=document.getElementById('app-root');return root&&!root.classList.contains('hidden')&&!document.hidden&&['dashboard','vendas','metas','historico','anuncios','marcos'].includes(tab())&&![...document.querySelectorAll('.modal-overlay,#drawer-overlay')].some(e=>!e.classList.contains('hidden')&&getComputedStyle(e).display!=='none')&&!(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&document.activeElement?.closest('form,.form-grid,.modal-overlay'));}
 function cachedRevision(){const rows=Array.isArray(cache.pedidos)?cache.pedidos:[];const latest=[...rows].sort((a,b)=>String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||'')))[0];return latest?String(latest.id)+'|'+String(latest.updated_at||''):'';}
 async function check(){
  if(busy||!canRefresh()||Date.now()-lastProbe<15000||cache.financialSyncState!=='ready')return;
  busy=true;lastProbe=Date.now();
  try{
   const {data,error}=await sb.from('pedidos').select('id,updated_at').order('updated_at',{ascending:false,nullsFirst:false}).limit(1);
   if(error)throw error;const row=data?.[0],next=row?String(row.id)+'|'+String(row.updated_at||''):'';
   const before=revision||cachedRevision();
   if(next!==before&&canRefresh()){
    await carregarResumoV95({silent:true});
    const active=tab();if(active!=='dashboard'&&canRefresh())await carregarAbaV95(active,true);
    if(typeof perfSaveV95==='function')perfSaveV95();
    if(cache.financialSyncState==='ready')revision=next;
   }else revision=next;
  }catch(error){console.warn('[ERP auto-refresh] Não foi possível verificar novos pedidos.',error?.message||error);}
  finally{busy=false;}
 }
 setInterval(check,30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
 window.addEventListener('online',check);
})();
/* Stock valuation: prices/costs remain canonical; projections never modify sales. */
function acStockValuation(products,includeInactive=false){
 const numeric=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;};
 const seen=new Set(),rows=[];
 for(const p of products||[]){
  if(!includeInactive&&p.ativo===false)continue;
  const quantity=numeric(p.estoque);if(!quantity||quantity<=0)continue;
  const key=p.yampi_sku_id?'yampi:'+p.yampi_sku_id:'local:'+p.id;if(seen.has(key))continue;seen.add(key);
  const cost=numeric(p.custo),price=numeric(p.preco),hasCost=cost!==null&&cost>0,hasPrice=price!==null&&price>0;
  const invested=hasCost?Math.round(cost*100)*quantity:null,revenue=hasPrice?Math.round(price*100)*quantity:null;
  rows.push({id:p.id,name:String(p.nome||'Produto'),sku:String(p.sku||''),quantity,cost,price,hasCost,hasPrice,invested,revenue,margin:hasCost&&hasPrice?revenue-invested:null,active:p.ativo!==false});
 }
 rows.sort((a,b)=>(b.revenue||0)-(a.revenue||0)||a.name.localeCompare(b.name,'pt-BR'));
 const result={rows,units:0,invested:0,revenue:0,margin:0,missingCost:0,missingPrice:0,completeUnits:0,completeRevenue:0,completeCost:0};
 for(const r of rows){result.units+=r.quantity;result.invested+=r.invested||0;result.revenue+=r.revenue||0;if(!r.hasCost)result.missingCost+=r.quantity;if(!r.hasPrice)result.missingPrice+=r.quantity;if(r.margin!==null){result.margin+=r.margin;result.completeUnits+=r.quantity;result.completeRevenue+=r.revenue;result.completeCost+=r.invested;}}
 return result;
}
(()=>{
 'use strict';let current='catalog',includeInactive=false,query='';
 const esc=v=>escHtml(String(v??'')),money=cents=>fmtVal(cents/100),qty=v=>Number(v).toLocaleString('pt-BR');
 function setTab(next){current=next;const catalog=document.getElementById('ac-stock-catalog'),value=document.getElementById('ac-stock-valuation');if(!catalog||!value)return;catalog.hidden=next!=='catalog';value.hidden=next!=='valuation';document.querySelectorAll('[data-stock-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.stockTab===next)));if(next==='valuation')renderValuation();}
 function renderRows(data){
  const body=document.getElementById('ac-stock-rows');if(!body)return;
  const q=query.toLocaleLowerCase('pt-BR'),rows=data.rows.filter(r=>(r.name+' '+r.sku).toLocaleLowerCase('pt-BR').includes(q));
  body.innerHTML=rows.length?rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong><small>${esc(r.sku||'Sem SKU')}${!r.active?' · Inativo':''}</small></td><td>${qty(r.quantity)}</td><td>${r.hasCost?fmtVal(r.cost):'<span class="ac-stock-warning">Sem custo</span>'}</td><td>${r.hasPrice?fmtVal(r.price):'<span class="ac-stock-warning">Sem preço</span>'}</td><td>${r.invested!==null?money(r.invested):'—'}</td><td>${r.revenue!==null?money(r.revenue):'—'}</td><td class="${r.margin!==null&&r.margin<0?'ac-negative':''}">${r.margin!==null?money(r.margin):'—'}</td><td><button class="btn sm" data-stock-edit="${esc(r.id)}">Revisar</button></td></tr>`).join(''):'<tr><td colspan="8">Nenhum produto com estoque neste filtro.</td></tr>';
  body.querySelectorAll('[data-stock-edit]').forEach(b=>b.onclick=()=>abrirModalProduto(b.dataset.stockEdit));
  const count=document.getElementById('ac-stock-count');if(count)count.textContent=rows.length+' de '+data.rows.length+' SKUs · totais acima consideram todo o estoque selecionado.';
 }
 function renderValuation(){
  const root=document.getElementById('ac-stock-valuation');if(!root)return;
  const data=acStockValuation(cache.produtos||[],includeInactive),partial=data.missingCost>0||data.missingPrice>0;
  const metric=(label,value,detail)=>`<article class="ac-surface ac-metric"><div class="ac-metric-label">${label}</div><strong>${value}</strong><small>${detail}</small></article>`;
  root.innerHTML=`<div class="ac-heading"><div><h3>Quanto vale seu estoque hoje?</h3><p>Custo dos produtos disponíveis e projeção de venda pelo preço cadastrado.</p></div><label class="ac-stock-scope">Incluir produtos inativos com estoque <input id="ac-stock-inactive" type="checkbox" ${includeInactive?'checked':''}></label></div><div class="ac-metrics">${metric('Custo do estoque'+(data.missingCost?' · parcial':''),money(data.invested),'Quantidade × custo de compra cadastrado')}${metric('Faturamento potencial'+(data.missingPrice?' · parcial':''),money(data.revenue),'Quantidade × preço de venda cadastrado')}${metric('Margem bruta potencial'+(partial?' · parcial':''),money(data.margin),qty(data.completeUnits)+' de '+qty(data.units)+' peças com custo e preço informados')}${metric('Peças disponíveis',qty(data.units),data.rows.length+' SKUs '+(includeInactive?'ativos e inativos':'ativos'))}</div>${partial?`<div class="ac-stock-alert" role="status"><strong>Há dados a completar.</strong> ${qty(data.missingCost)} peças sem custo e ${qty(data.missingPrice)} sem preço. Os totais são parciais; peças sem custo não geram margem fictícia. Use “Revisar” para completar os cadastros.</div>`:''}<section class="ac-surface ac-stock-projection"><div><span>Se todas as peças com cadastro completo forem vendidas</span><h3>${money(data.completeRevenue)} em vendas</h3><p>Custo desses produtos: ${money(data.completeCost)} · margem bruta: ${money(data.margin)}${data.completeRevenue>0?' ('+(data.margin/data.completeRevenue*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%)':''}.</p></div><p>Projeção antes de frete, taxas, embalagens, anúncios, impostos e descontos. O estoque é o saldo disponível no cadastro, não o histórico de compras.</p></section><div class="ac-stock-filter"><label for="ac-stock-search">Buscar no detalhamento</label><input id="ac-stock-search" placeholder="Produto ou SKU" value="${esc(query)}"><small id="ac-stock-count"></small></div><div class="ac-table-wrap ac-stock-table" tabindex="0" role="region" aria-label="Valor do estoque por produto, deslize para ver todas as colunas"><table class="ac-table"><thead><tr><th>Produto / SKU</th><th>Peças</th><th>Custo unitário</th><th>Preço unitário</th><th>Custo em estoque</th><th>Venda potencial</th><th>Margem bruta</th><th>Ação</th></tr></thead><tbody id="ac-stock-rows"></tbody></table></div>`;
  renderRows(data);
  root.querySelector('#ac-stock-search').oninput=e=>{query=e.target.value;renderRows(data);};
  root.querySelector('#ac-stock-inactive').onchange=e=>{includeInactive=e.target.checked;renderValuation();};
 }
 function init(){
  const panel=document.getElementById('panel-produtos');if(!panel||document.getElementById('ac-stock-tabs'))return;
  const heading=panel.querySelector('.v106-yampi-status-shell')||panel.querySelector('.page-heading');if(!heading)return;
  const tabs=document.createElement('div');tabs.id='ac-stock-tabs';tabs.className='ac-stock-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Áreas de produtos');tabs.innerHTML='<button class="btn" role="tab" id="ac-stock-tab-catalog" aria-controls="ac-stock-catalog" aria-selected="true" data-stock-tab="catalog">Catálogo</button><button class="btn" role="tab" id="ac-stock-tab-value" aria-controls="ac-stock-valuation" aria-selected="false" data-stock-tab="valuation">Valor do estoque</button>';
  const catalog=document.createElement('div');catalog.id='ac-stock-catalog';catalog.setAttribute('role','tabpanel');catalog.setAttribute('aria-labelledby','ac-stock-tab-catalog');
  [...panel.children].filter(el=>el.matches('.v106-products-toolbar,#lista-produtos,.v106-manual-product')).forEach(el=>catalog.append(el));
  const value=document.createElement('section');value.id='ac-stock-valuation';value.setAttribute('role','tabpanel');value.setAttribute('aria-labelledby','ac-stock-tab-value');value.hidden=true;
  heading.after(tabs);tabs.after(catalog);catalog.after(value);
  tabs.querySelectorAll('button').forEach(b=>{b.onclick=()=>setTab(b.dataset.stockTab);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'catalog':e.key==='End'?'valuation':current==='catalog'?'valuation':'catalog';setTab(next);tabs.querySelector('[data-stock-tab="'+next+'"]').focus();}};});
  const original=renderProdutos;renderProdutos=function(...args){const result=original.apply(this,args);renderValuation();return result;};
  renderValuation();setTab(current);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
/* Neutral white surfaces inherited from legacy modules are converted as they render.
 * Photographs, logos, canvases and SVG artwork keep their original pixels. */
(()=>{
 'use strict';let scheduled=false;
 const rgb=text=>{const m=String(text).match(/^rgba?\(([^)]+)\)/);return m?m[1].split(',').map(Number):null;};
 const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 function normalize(){
  scheduled=false;if(document.documentElement.dataset.design!=='ac-dark')return;
  const scope=document.getElementById('app-root');if(!scope)return;
  const nodes=[...scope.querySelectorAll('div,section,article,header,footer,nav,form,table,thead,tbody,tr,td,th,p,span,small,strong,b,label,button,summary')].filter(e=>e.getClientRects().length&&!e.closest('svg,.ac-award-ticket'));
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(modal=>nodes.push(...modal.querySelectorAll('div,p,span,small,strong,b,label,button')));
  for(const el of nodes){const style=getComputedStyle(el),bg=rgb(style.backgroundColor);if(bg&&bg.slice(0,3).every(v=>v>215)&&(bg.length===3||bg[3]>.95)){el.style.setProperty('background','#152033','important');el.style.setProperty('border-color','#34445d','important');}}
  for(const el of nodes){
   if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
   const color=rgb(getComputedStyle(el).color);if(!color)continue;
   let parent=el,bg=[7,9,15];for(let i=0;parent&&i<14;i++,parent=parent.parentElement){const c=rgb(getComputedStyle(parent).backgroundColor);if(c&&(c.length===3||c[3]>.95)){bg=c;break;}}
   const a=luminance(color),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   if(b<.15&&ratio<4.5){const [r,g,blue]=color;el.style.setProperty('color',g>r*1.18&&g>blue*1.12?'#85e3c2':r>g*1.25?'#ffacbc':'#c0d0e8','important');}
  }
 }
 function queue(){if(scheduled)return;scheduled=true;setTimeout(normalize,120);}
 function init(){const app=document.getElementById('app-root');if(!app)return;new MutationObserver(queue).observe(app,{childList:true,subtree:true});document.addEventListener('click',queue);document.addEventListener('change',queue);queue();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
/* Achievement tickets — geometry adapted from the supplied AdmitOneTicket reference.
 * Five requested tiers, canonical paid-order revenue and no fictional awards. */
const AC_AWARD_TIERS=[{value:25000,color:'silver',name:'Prata',edition:'SILVER'},{value:50000,color:'royal',name:'Azul royal',edition:'ROYAL BLUE'},{value:100000,color:'white',name:'Branco',edition:'WHITE EDITION'},{value:500000,color:'gold',name:'Dourado',edition:'GOLD EDITION'},{value:1000000,color:'black',name:'Black',edition:'BLACK EDITION'}];
function acAwardProgress(total){
 const revenue=Math.max(0,Number(total)||0);let previous=0;
 return AC_AWARD_TIERS.map(tier=>{const reached=revenue>=tier.value,current=!reached&&revenue>=previous,percent=reached?100:current?Math.min(100,Math.max(0,(revenue-previous)/(tier.value-previous)*100)):0;previous=tier.value;return {...tier,reached,current,percent,remaining:Math.max(0,tier.value-revenue)};});
}
(()=>{
 'use strict';
 // Preserve the reference's 741 × 425 frame, rounded corners and perforation notches.
 const shape='M25 0 L541 0 A21 21 0 0 0 583 0 L716 0 A25 25 0 0 1 741 25 L741 400 A25 25 0 0 1 716 425 L583 425 A21 21 0 0 0 541 425 L25 425 A25 25 0 0 1 0 400 L0 25 A25 25 0 0 1 25 0 Z';
 const esc=v=>escHtml(String(v));
 function renderAwards(){
  const list=document.getElementById('marcos-lista'),hero=document.getElementById('marcos-resumo');if(!list||!hero)return;
  const total=pedidosBaseV9().reduce((sum,p)=>sum+Number(p.receita||0),0),tiers=acAwardProgress(total),next=tiers.find(t=>!t.reached),count=tiers.filter(t=>t.reached).length;
  hero.innerHTML=`<section class="ac-award-summary"><div><span class="ac-award-eyebrow">Sua coleção de conquistas</span><div class="ac-award-total">${fmtVal(total)}</div><p>Faturamento acumulado de pedidos pagos · todo o período</p></div><div class="ac-award-next"><span>${count} de ${tiers.length} prêmios conquistados</span><strong>${next?'Próximo: '+fmtVal(next.value):'Coleção completa'}</strong><p>${next?'Faltam '+fmtVal(next.remaining)+' para a edição '+esc(next.name)+'.':'Você alcançou todos os marcos da coleção.'}</p></div></section>`;
  list.innerHTML=tiers.map((tier,index)=>{
   const id='ac-award-'+tier.color,amount=tier.value===1000000?'1 MILHÃO':String(tier.value/1000)+' MIL',status=tier.reached?'Conquista alcançada':tier.current?'Sua próxima conquista':'Próximo patamar';
   return `<article class="ac-award-ticket ac-award-${tier.color} ${tier.reached?'is-earned':tier.current?'is-next':'is-locked'}" aria-label="Prêmio ${esc(tier.name)}, ${esc(fmtVal(tier.value))}, ${status}" data-award-color="${tier.color}"><svg class="ac-award-art" viewBox="0 0 741 425" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--ticket-light)"/><stop offset=".33" stop-color="var(--ticket-mid)"/><stop offset=".55" stop-color="var(--ticket-light)"/><stop offset=".77" stop-color="var(--ticket-dark)"/><stop offset="1" stop-color="var(--ticket-mid)"/></linearGradient><linearGradient id="${id}-shine" x1="0" x2="1"><stop stop-color="#ffffff" stop-opacity="0"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".23"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient><pattern id="${id}-grain" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".6" fill="var(--ticket-ink)" opacity=".12"/><circle cx="4" cy="4" r=".4" fill="#fff" opacity=".3"/></pattern></defs><path d="${shape}" fill="url(#${id}-metal)" stroke="var(--ticket-edge)" stroke-width="2"/><path d="${shape}" fill="url(#${id}-grain)"/><path class="ac-award-shine" d="${shape}" fill="url(#${id}-shine)"/><path d="M562 31 V394" stroke="var(--ticket-ink)" opacity=".28" stroke-width="1.5" stroke-dasharray="5 8"/><path d="M28 24 H519 M28 401 H519" stroke="var(--ticket-ink)" stroke-opacity=".18" fill="none"/></svg><div class="ac-award-main"><div class="ac-award-top"><span>AREIA CRÔA</span><span>PRÊMIO Nº ${String(index+1).padStart(2,'0')}</span></div><p class="ac-award-edition">${esc(tier.edition)}</p><h3 class="ac-award-value">${amount}</h3><p class="ac-award-description">em faturamento acumulado</p><div class="ac-award-bottom"><span class="ac-award-state">${tier.reached?'✓ ':tier.current?'↗ ':'◇ '}${status}</span><span class="ac-award-material">${esc(tier.name)}</span></div></div><div class="ac-award-stub" aria-hidden="true"><span>${tier.reached?'CONQUISTADO':'AREIA CRÔA'}</span><div class="ac-award-barcode"></div><small>${String(tier.value).padStart(7,'0')}</small></div></article><div class="ac-award-progress"><div><span>${tier.reached?'Patamar alcançado':tier.current?'Faltam '+fmtVal(tier.remaining):'Ainda não iniciado'}</span><b>${tier.percent.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</b></div><div class="ac-award-track" role="progressbar" aria-label="Progresso para ${esc(fmtVal(tier.value))}" aria-valuenow="${tier.percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${tier.percent}%"></span></div></div>`;
  }).map((html,index)=>`<div class="ac-award-slot" data-tier="${tiers[index].value}">${html}</div>`).join('');
  if(matchMedia('(hover: hover) and (pointer: fine)').matches&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   list.querySelectorAll('.ac-award-ticket').forEach(card=>{let frame=0;card.addEventListener('pointermove',event=>{const rect=card.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width-.5,y=(event.clientY-rect.top)/rect.height-.5;if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{card.style.transform=`perspective(1200px) rotateX(${-y*7}deg) rotateY(${x*7}deg) translateY(-3px)`;frame=0;});});card.addEventListener('pointerleave',()=>{if(frame)cancelAnimationFrame(frame);frame=0;card.style.transform='';});});
  }
 }
 function init(){if(!document.getElementById('panel-marcos'))return;if(typeof MARCOS_TIERS!=='undefined'&&Array.isArray(MARCOS_TIERS))MARCOS_TIERS.splice(0,MARCOS_TIERS.length,...AC_AWARD_TIERS.map(t=>t.value));renderMarcosV95=renderAwards;renderMarcos=renderAwards;renderAwards();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
