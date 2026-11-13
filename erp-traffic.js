/* Traffic presentation uses each provider's own counts, without mixing funnels. */
(() => {
  'use strict';
  const number = n => Number(n || 0).toLocaleString('pt-BR');
  const escape = v => escHtml(String(v ?? ''));
  const metric = (label, value, note, icon) => `<article class="ac-surface ac-metric"><span class="ac-icon"><i class="ti ti-${icon}" aria-hidden="true"></i></span><div><div class="ac-metric-label">${label}</div><strong>${value}</strong><small>${note}</small></div></article>`;
  function funnel(title, note, stages, tone) {
    const max = Math.max(1, ...stages.map(s => Number(s[1] || 0)));
    return `<section class="ac-surface ac-funnel ${tone}"><h3>${title}</h3><p class="ac-muted">${note}</p><ol>${stages.map(([label, count]) => `<li><div><span>${label}</span><strong>${number(count)}</strong></div><div class="ac-funnel-track"><span style="width:${Math.max(0, Number(count || 0)) / max * 100}%"></span></div></li>`).join('')}</ol></section>`;
  }
  function tracking(p) {
    if (p.utm_campaign) return String(p.utm_campaign).trim();
    return String(p.observacoes || '').match(/campaign=([^|·]+)/)?.[1]?.trim() || '';
  }
  function campaignForOrder(p, campaigns) {
    const raw = tracking(p);
    let decoded = raw;
    try { decoded = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (_) {}
    // IDs take precedence over names; renamed campaigns keep their identity.
    const id = String(p.meta_campaign_id || raw);
    const byId = campaigns.filter(c => id && String(c.campaign_id) === id);
    if (byId.length === 1) return byId[0];
    const byName = campaigns.filter(c => raw && [raw, decoded].includes(String(c.campaign_name).trim()));
    return byName.length === 1 ? byName[0] : null;
  }
  function attribution(orders, campaigns) {
    const matched = new Map(), unmatched = [];
    orders.forEach(p => {
      const c = campaignForOrder(p, campaigns);
      if (!c) { unmatched.push(p); return; }
      const key = String(c.campaign_id);
      const row = matched.get(key) || {...c, orders: 0, revenue: 0};
      row.orders++; row.revenue += Number(p.receita || 0); matched.set(key, row);
    });
    return {matched: [...matched.values()], unmatched};
  }
  // Also available to the regression tests; no network access or side effects.
  window.acCampaignAttribution = attribution;
  window.acCampaignForOrder = campaignForOrder;
  trafegoPedidosMesV10 = function(ym) {
    return pedidosBaseV9().filter(p => {
      if (ym && getMes(p.data) !== ym) return false;
      if (p.via_trafego !== true && p.via_trafego !== 'true') return false;
      const c = campaignForOrder(p, cache.metaCampaignRules || []);
      return !c || tipoCampanhaV10(c) === 'vendas';
    });
  };
  pedidosTrafegoMesV96 = trafegoPedidosMesV10;
  renderAutoV10 = function() {
    const wrap = document.getElementById('v10-source-grid');
    if (!wrap) return;
    const ym = document.getElementById('filter-mes-anuncios')?.value || '';
    const d = resumoAutomaticoV10(ym), rows = metaRowsV10(ym);
    const orders = pedidosBaseV9().filter(p => (!ym || getMes(p.data) === ym));
    const yampi = orders.filter(p => /yampi/i.test(p.origem_dados || p.canal || ''));
    const campaignMap = new Map();
    rows.forEach(c => {if (c.campaign_id) campaignMap.set(String(c.campaign_id), c);});
    (cache.metaCampaignRules || []).forEach(c => campaignMap.set(String(c.campaign_id), c));
    const a = attribution(yampi, [...campaignMap.values()]);
    const sums = key => rows.reduce((s, r) => s + Number(r[key] || 0), 0);
    const brandingShare = d.gastoTotal > 0 ? Math.min(100, Math.max(0, d.gastoBranding / d.gastoTotal * 100)) : 0;
    wrap.classList.add('ac-traffic');
    wrap.innerHTML = `<div class="ac-metrics">${metric('Receita via tráfego', fmtVal(d.receita), `${number(d.compras)} pedidos pagos atribuídos no ERP`, 'cash')}${metric('Investimento total', fmtVal(d.gastoTotal), d.meta ? 'Meta Ads · todo o período selecionado' : 'Aportes manuais', 'speakerphone')}${metric('ROAS de vendas', d.gastoVendas > 0 ? d.roas.toFixed(2) + 'x' : '—', 'Receita do ERP ÷ mídia de vendas', 'chart-line')}${metric('CPA de vendas', d.compras > 0 ? fmtVal(d.cpa) : '—', 'Mídia de vendas ÷ pedidos atribuídos', 'target-arrow')}</div>
      <section class="ac-surface ac-budget"><div class="ac-heading"><div><h3>Destino do investimento</h3><p>Campanhas de vendas e construção de marca</p></div><span class="ac-badge ok">Meta Ads</span></div><div class="ac-budget-bar" role="img" aria-label="Vendas ${escape(fmtVal(d.gastoVendas))}; Branding ${escape(fmtVal(d.gastoBranding))}"><span style="width:${100-brandingShare}%"></span><span style="width:${brandingShare}%"></span></div><div class="ac-budget-legend"><div><i></i><span>Vendas</span><strong>${fmtVal(d.gastoVendas)}</strong><small>Base de ROAS e CPA</small></div><div><i></i><span>Branding</span><strong>${fmtVal(d.gastoBranding)}</strong><small>Incluído no custo total</small></div></div></section>
      <div class="ac-funnels">${funnel('Jornada na loja', 'Shopify · sessões de todos os canais', [['Sessões', d.sessoes], ['Com adição ao carrinho', d.cart], ['Chegaram ao checkout', d.checkout]], 'store')}${funnel('Conversões dos anúncios', 'Meta Ads · eventos na janela de atribuição da Meta', [['Visitas à página de destino', sums('landing_page_views')], ['Adições ao carrinho', d.metaCart], ['Checkouts iniciados', d.metaCheckout], ['Compras atribuídas pela Meta', sums('purchases')]], 'meta')}</div>
      <section class="ac-surface ac-attribution"><div class="ac-heading"><div><h3>Origem das vendas no ERP</h3><p>Pedidos pagos da Yampi vinculados pela UTM de campanha</p></div><span class="ac-badge ${a.unmatched.length?'warn':'ok'}">${number(a.unmatched.length)} sem vínculo confirmado</span></div>${a.matched.length ? `<div class="ac-table-wrap" tabindex="0" role="region" aria-label="Vendas por campanha"><table class="ac-table"><thead><tr><th>Campanha</th><th>Tipo</th><th class="num">Pedidos</th><th class="num">Receita</th></tr></thead><tbody>${a.matched.sort((x,y)=>y.revenue-x.revenue).map(c=>`<tr><td>${escape(c.campaign_name)}</td><td>${tipoCampanhaV10(c)==='vendas'?'Vendas':'Branding'}</td><td class="num">${number(c.orders)}</td><td class="num">${fmtVal(c.revenue)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="ac-note">Ainda não há vínculos de campanha confirmados para este período.</p>'}<p class="ac-note">O vínculo exige o ID exato ou um nome único de campanha na UTM. Sem identificação suficiente, o pedido permanece sem vínculo. Os números da Meta e da loja usam critérios diferentes e não devem ser somados.</p></section>
      <p class="ac-note">O investimento inclui campanhas pausadas que tiveram gasto no período. Toda campanha que não estiver marcada como Vendas conta como Branding.</p>`;
    const warning = document.getElementById('v10-classification-warning');
    if (warning) warning.innerHTML = '';
    renderConnectionsV10();
  };
})();
