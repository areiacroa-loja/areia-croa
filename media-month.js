/* Monthly media planning. Loaded after the legacy dashboard definitions. */
(() => {
  const validMonth = ym => /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
  const currentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  };
  const planFor = ym => (cache.metas || []).find(m => `${m.ano}-${String(m.mes).padStart(2,'0')}` === ym);
  const budgetFor = ym => Number(planFor(ym)?.investimento_previsto || 0);
  const monthSelect = () => document.getElementById('filter-mes-anuncios');
  let closingError = null, saving = false;

  const populateBase = popularSelectMes;
  popularSelectMes = function() {
    const select = monthSelect(), previous = select?.value;
    const initialized = select?.dataset.mediaInitialized === '1';
    populateBase();
    if (!select) return;
    const months = new Set([currentMonth(), ...[...select.options].map(o=>o.value),
      ...(cache.metas||[]).map(m=>`${m.ano}-${String(m.mes).padStart(2,'0')}`),
      ...(cache.fechamentosInvestimento||[]).map(f=>f.mes),
      ...(cache.metaAdsDaily||[]).map(r=>String(r.data).slice(0,7)),
      ...(cache.shopifyTrafficDaily||[]).map(r=>String(r.data).slice(0,7))]);
    if (validMonth(previous)) months.add(previous);
    select.innerHTML = '<option value="">Todos os meses</option>' + [...months].filter(validMonth).sort().reverse()
      .map(ym=>`<option value="${ym}">${mesLabel(ym)}</option>`).join('');
    select.value = initialized ? previous : currentMonth();
    select.dataset.mediaInitialized = '1';
  };

  window.chooseMediaMonth = function(ym) {
    if (!validMonth(ym)) return;
    const select = monthSelect();
    if (![...select.options].some(o=>o.value===ym)) select.add(new Option(mesLabel(ym), ym));
    select.value = ym; select.dataset.mediaInitialized = '1';
    popularSelectMes(); renderAnuncios();
  };

  carregarFechamentosV99 = async function() {
    try {
      const r = await sb.from('investimento_fechamentos_mensais')
        .select('mes,status,sessoes,observacoes,snapshot,closed_at,created_at,updated_at').order('mes',{ascending:false});
      if (r.error) throw r.error;
      cache.fechamentosInvestimento = r.data || [];
      fechamentoMesSchemaV99 = true; closingError = null;
      return true;
    } catch (error) {
      fechamentoMesSchemaV99 = false; closingError = error;
      console.warn('Não foi possível carregar os fechamentos mensais.', error);
      return false;
    }
  };

  const summaryBase = resumoMesInvestimentoV99;
  resumoMesInvestimentoV99 = function(ym) {
    const d = summaryBase(ym), f = fechamentoV99(ym);
    if (f?.status === 'fechado' && f.snapshot) return {...d, ...f.snapshot, ym, fechado:true, fechamento:f};
    if (!d.sessoes && f?.sessoes) {
      d.sessoes = Number(f.sessoes);
      d.conversao = d.compras/d.sessoes*100; d.custoSessao = d.vendas/d.sessoes;
    }
    return d;
  };

  function renderPlan() {
    const panel = document.getElementById('panel-anuncios');
    if (!panel) return;
    let plan = document.getElementById('media-plan');
    if (!plan) {
      plan = document.createElement('section'); plan.id='media-plan'; plan.className='media-plan';
      panel.querySelector('.toolbar-card').after(plan);
      const ledger = panel.querySelector('.v99-ledger-shell');
      panel.querySelector('.v99-month-shell').after(ledger);
      const group = panel.querySelector('.toolbar-group');
      group.insertAdjacentHTML('beforeend','<label class="media-period-label" for="media-month-picker">Ir para mês</label><input id="media-month-picker" type="month" onchange="chooseMediaMonth(this.value)">');
    }
    const ym = ymAnunciosV99();
    document.getElementById('media-month-picker').value = ym;
    plan.hidden = !validMonth(ym);
    if (plan.hidden) return;
    const d = resumoMesInvestimentoV99(ym), f = fechamentoV99(ym);
    const budget = d.fechado && f?.snapshot ? Number(f.snapshot.orcamento||0) : budgetFor(ym);
    const deposited = d.fechado && f?.snapshot ? Number(f.snapshot.aportes||0) : valorAportesV99(ym);
    const remaining = budget-d.total, pct = budget>0 ? d.total/budget*100 : 0;
    const source = d.fechado && f?.snapshot ? f.snapshot.fonte : (metaTemDadosV10(ym)?'Meta Ads':'Aportes manuais · estimativa');
    plan.innerHTML = `<div class="media-plan-head"><div><div class="media-eyebrow">Seu plano de mídia</div><h3>${escHtml(mesNomeCompleto(ym))}</h3></div><div class="media-plan-actions"><button class="btn" onclick="editMediaBudget()" ${d.fechado?'disabled':''}><i class="ti ti-pencil"></i>Editar orçamento</button><button class="btn primary" onclick="abrirNovoAporteV98()" ${d.fechado?'disabled':''}><i class="ti ti-plus"></i>Registrar aporte</button></div></div>
      <div class="media-plan-grid"><article><span>Orçamento do mês</span><strong>${budget?fmtVal(budget):'Não definido'}</strong><small>Quanto você pretende investir</small></article>
      <article><span>Já aportado</span><strong>${fmtVal(deposited)}</strong><small>Depósitos registrados no CRM</small></article>
      <article><span>Gasto no período</span><strong>${fmtVal(d.total)}</strong><small>${escHtml(source||'Resultado fechado')}</small></article>
      <article class="${remaining<0?'media-exceeded':''}"><span>${remaining<0?'Acima do orçamento':'Disponível no orçamento'}</span><strong>${budget?fmtVal(Math.abs(remaining)):'—'}</strong><small>Orçamento menos gasto · não é saldo Meta</small></article></div>
      <div class="media-progress" role="progressbar" aria-label="Orçamento utilizado" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,Math.round(pct))}"><span style="width:${Math.min(100,pct)}%"></span></div>
      <div class="media-plan-foot"><span>${budget?`${pct.toFixed(0)}% do orçamento utilizado`:'Defina um orçamento para acompanhar o progresso.'}</span><span>${d.fechado?'Fechado · totais preservados':'Aberto · você pode registrar os aportes deste mês'}</span></div>`;
    let warning = document.getElementById('media-closing-warning');
    if (!warning) { warning=document.createElement('div'); warning.id='media-closing-warning'; warning.className='media-notice'; plan.before(warning); }
    warning.hidden=fechamentoMesSchemaV99;
    warning.textContent = fechamentoMesSchemaV99 ? '' : `Não foi possível carregar o fechamento. ${closingError?.code==='PGRST205'||closingError?.code==='42P01'?'A estrutura mensal ainda precisa ser instalada.':'Confira sua conexão e tente novamente.'} Os aportes continuam disponíveis.`;
    const button=document.getElementById('v99-btn-fechar-mes');
    if(button)button.disabled=!fechamentoMesSchemaV99;
    const firstMetric=panel.querySelector('#v99-month-grid .v99-metric span');
    if(firstMetric)firstMetric.textContent='Gasto total';
    const note=document.getElementById('v99-close-note');
    if(note)note.textContent=d.fechado?'Resultado preservado no fechamento. Reabra o mês antes de corrigir aportes ou atualizar os totais.':'Registre os depósitos em “Registrar aporte”. O gasto sincronizado da Meta é usado nos resultados; o aporte não é somado novamente. Você pode mudar de mês sem fechar o anterior.';
  }

  const renderBase = renderAnuncios;
  renderAnuncios = function() { renderBase(); renderPlan(); };

  window.editMediaBudget = function() {
    const ym=ymAnunciosV99();
    if(!validMonth(ym)||mesFechadoV99(ym))return;
    document.getElementById('modal-item-conteudo').innerHTML=`<button class="modal-close" onclick="fecharModalItem()">&times;</button><div class="modal-header"><div><div class="modal-title">Orçamento · ${escHtml(mesLabel(ym))}</div><div class="modal-subtitle">Planeje quanto quer investir em mídia neste mês.</div></div></div><label for="media-budget-value">Orçamento de mídia (R$)</label><input id="media-budget-value" type="number" min="0" step="0.01" value="${budgetFor(ym)}"><div class="form-note">Este planejamento também aparece em Metas. A meta de faturamento será mantida.</div><div class="modal-actions"><button class="btn" onclick="fecharModalItem()">Cancelar</button><button class="btn primary" id="media-budget-save" onclick="saveMediaBudget('${ym}')">Salvar orçamento</button></div>`;
    abrirModalItem();
  };
  window.saveMediaBudget = async function(ym) {
    if(saving||!validMonth(ym)||mesFechadoV99(ym))return;
    const raw=document.getElementById('media-budget-value').value, value=Number(raw);
    if(!raw||!Number.isFinite(value)||value<0){alert('Informe um orçamento válido, igual ou maior que zero.');return;}
    saving=true; const button=document.getElementById('media-budget-save'); button.disabled=true;
    try {
      const [ano,mes]=ym.split('-').map(Number), existing=planFor(ym);
      const row={ano,mes,investimento_previsto:value};
      const r=existing ? await sb.from('metas_mensais').update({investimento_previsto:value}).eq('id',existing.id).select()
        : await sb.from('metas_mensais').upsert({...row,faturamento_previsto:0},{onConflict:'mes,ano'}).select();
      if(r.error)throw r.error;
      if(!r.data?.length)throw new Error('O orçamento não foi salvo. Confira sua permissão de acesso.');
      cache.metas=(cache.metas||[]).filter(m=>!(Number(m.ano)===ano&&Number(m.mes)===mes)).concat(r.data);
      fecharModalItem(); renderAnuncios(); renderDashboard(); perfSaveV95();
    } catch(e){alert('Não foi possível salvar o orçamento: '+e.message);} finally{saving=false;button.disabled=false;}
  };

  const openCloseBase=abrirFecharMesV99;
  abrirFecharMesV99=async function(ym=ymAnunciosV99()) {
    if(!validMonth(ym)){alert('Selecione um mês para fechar.');return;}
    if(ym>currentMonth()){alert('Um mês futuro ainda não pode ser fechado.');return;}
    if(!await carregarFechamentosV99()){renderAnuncios();return;}
    openCloseBase(ym);
    const subtitle=document.querySelector('#modal-item-conteudo .modal-subtitle');
    if(subtitle)subtitle.textContent='Confira os valores antes de fechar. O resultado será preservado até você reabrir o mês.';
  };
  salvarFechamentoMesV10=async function(ym) {
    if(saving||!validMonth(ym)||ym>currentMonth())return;
    const raw=document.getElementById('v99-close-sessoes')?.value||'0';
    const sessoes=Number(raw);
    if(!Number.isSafeInteger(sessoes)||sessoes<0){alert('Informe um número inteiro de sessões, igual ou maior que zero.');return;}
    saving=true;
    try {
      const d=resumoMesInvestimentoV99(ym);
      const snapshot={total:d.total,vendas:d.vendas,branding:d.branding,receita:d.receita,compras:d.compras,sessoes,
        roas:d.roas,cpa:d.cpa,conversao:sessoes?d.compras/sessoes*100:0,custoSessao:sessoes?d.vendas/sessoes:0,
        orcamento:budgetFor(ym),aportes:valorAportesV99(ym),fonte:metaTemDadosV10(ym)?'Meta Ads':'Aportes manuais · estimativa'};
      const r=await sb.from('investimento_fechamentos_mensais').upsert({mes:ym,status:'fechado',sessoes,snapshot,
        observacoes:document.getElementById('v99-close-obs')?.value.trim()||null,
        closed_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'mes'}).select('mes');
      if(r.error)throw r.error;
      if(!r.data?.length)throw new Error('O fechamento não foi salvo. Confira sua permissão de acesso.');
      if(!await carregarFechamentosV99())throw new Error('O fechamento foi enviado, mas não foi possível recarregar a confirmação. Atualize a página.');
      fecharModalItem();renderAnuncios();perfSaveV95();
    }catch(e){alert('Não foi possível concluir o fechamento: '+e.message);}finally{saving=false;}
  };
  reabrirMesV99=async function(ym) {
    if(saving||!validMonth(ym)||!confirm(`Reabrir ${mesLabel(ym)}? Você poderá corrigir os lançamentos e fechar novamente.`))return;
    saving=true;
    try {
      const r=await sb.from('investimento_fechamentos_mensais').update({status:'aberto',snapshot:null,closed_at:null,updated_at:new Date().toISOString()}).eq('mes',ym).select('mes');
      if(r.error)throw r.error;
      if(!r.data?.length)throw new Error('O mês não foi reaberto. Atualize a página e confira sua permissão.');
      await carregarFechamentosV99();renderAnuncios();perfSaveV95();
    }catch(e){alert('Não foi possível reabrir o mês: '+e.message);}finally{saving=false;}
  };

  function blocked(ym) {
    if(mesFechadoV99(ym)){alert('Este mês está fechado. Reabra o mês antes de alterar os aportes.');return true;}
    return false;
  }
  const openDeposit=abrirNovoAporteV98;
  abrirNovoAporteV98=function(){
    if(blocked(ymAnunciosV99()))return;
    openDeposit();
    const note=document.querySelector('#modal-item-conteudo .form-note');
    if(note)note.textContent='Aporte é o dinheiro depositado na plataforma. Quando há dados da Meta, o resultado usa o gasto real, sem somar o depósito novamente. Sem dados da Meta, os aportes são usados como estimativa.';
  };
  const saveDeposit=salvarAporteV98;
  salvarAporteV98=async function(id=''){
    const previous=(cache.aportes||[]).find(a=>String(a.id)===String(id));
    const date=document.getElementById('v98-aporte-data')?.value;
    if(!date){alert('Informe a data do aporte.');return;}
    if(blocked(date.slice(0,7))||(previous&&blocked(previous.data.slice(0,7))))return;
    await saveDeposit(id);
  };
  const deleteDeposit=deletarAporteV98;
  deletarAporteV98=async function(id){
    const a=(cache.aportes||[]).find(a=>String(a.id)===String(id));
    if(a&&blocked(a.data.slice(0,7)))return;
    return deleteDeposit(id);
  };

  popularSelectMes();
})();

/* Present the daily workflow first; keep advanced reports available on demand. */
(() => {
  function simplifyMedia() {
    const panel = document.getElementById('panel-anuncios');
    if (!panel) return;
    const heading = panel.querySelector('.page-heading');
    if (heading) {
      const title = heading.querySelector('h2'), description = heading.querySelector('p');
      if (title) title.textContent = 'Investimento em mídia';
      if (description) description.textContent = 'Controle o orçamento e os aportes de cada mês.';
      const eyebrow = title?.previousElementSibling;
      if (eyebrow && !eyebrow.querySelector('button')) eyebrow.hidden = true;
    }
    const ledger = panel.querySelector('.v99-ledger-shell');
    if (ledger) {
      const title = ledger.querySelector('h3'), description = ledger.querySelector('.section-header p');
      if (title) title.textContent = 'Histórico de aportes';
      if (description) description.textContent = 'Depósitos feitos na plataforma de anúncios.';
    }
    const labels = {'Dados automáticos':'Indicadores detalhados','Campanhas Meta':'Campanhas da Meta','Carrinhos abandonados':'Carrinhos abandonados'};
    panel.querySelectorAll('.section-shell').forEach(section => {
      const title = section.querySelector('h3')?.textContent.trim();
      if (!labels[title] || section.parentElement.tagName === 'DETAILS') return;
      const details = document.createElement('details'); details.className='crm-details';
      const summary = document.createElement('summary'); summary.textContent=labels[title];
      section.before(details); details.append(summary,section);
    });
  }
  const originalRender = renderAnuncios;
  renderAnuncios = function() { originalRender(); simplifyMedia(); };
  document.addEventListener('DOMContentLoaded', simplifyMedia);
  simplifyMedia();
})();

// Load the contact workspace after legacy globals are available.
(() => {
  if(typeof document.createElement!=='function')return;
  const script=document.createElement('script');script.src='clients-crm.js';script.defer=true;
  document.head.append(script);
})();

// Add the revenue view using the existing canonical financial data.
(() => {
  if(typeof document.createElement!=='function')return;
  const script=document.createElement('script');script.src='brand-dashboard.js';script.defer=true;
  document.head.append(script);
})();
