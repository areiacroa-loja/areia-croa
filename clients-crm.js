/* Contact workspace: purchase evidence, cart recovery and dated contact history. */
(function(root) {
  'use strict';
  const text = value => String(value || '').trim();
  const email = value => text(value).toLowerCase();
  const phone = value => { let n=text(value).replace(/\D/g,''); return n && n.length<=11 ? '55'+n : n; };
  const name = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
  const date = value => {
    if(value && typeof value==='object')value=value.date;
    const v=text(value); return v && Number.isFinite(Date.parse(v)) ? v : '';
  };
  const earliest = values => values.filter(date).sort((a,b)=>Date.parse(a)-Date.parse(b))[0] || '';
  const latest = values => values.filter(date).sort((a,b)=>Date.parse(b)-Date.parse(a))[0] || '';
  const money = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const confirmed = order => !/cancel|pend|aguard|recus|reembols|refund|fail|unpaid|waiting|denied|chargeback/i.test(text(order.status));

  function build({clientes=[],pedidos=[],carrinhos=[]}={}) {
    const people=[];
    function find(record) {
      if(record.cliente_id) {
        const match=people.find(p=>p.clientIds.includes(String(record.cliente_id)));
        if(match)return match;
      }
      const e=email(record.email || record.cliente_email), t=phone(record.telefone || record.cliente_telefone);
      const matches=people.filter(p=>(e&&p.emails.includes(e))||(t&&p.phones.includes(t)));
      if(matches.length===1) return matches[0];
      if(matches.length>1)return null;
      const n=name(record.nome || record.cliente_nome);
      if(!n)return null;
      const byName=people.filter(p=>name(p.nome)===n);
      if(byName.length!==1)return null;
      const p=byName[0];
      if(e&&p.emails.length&&!p.emails.includes(e))return null;
      if(t&&p.phones.length&&!p.phones.includes(t))return null;
      return p;
    }
    function get(record, kind) {
      let p=find(record);
      if(!p) {
        p={key:people.length,nome:text(record.nome || record.cliente_nome)||'Contato sem nome',emails:[],phones:[],clientIds:[],clients:[],orders:[],carts:[],cidade:'',estado:'',entry:'',entrySource:''};
        people.push(p);
      }
      const e=email(record.email || record.cliente_email), t=phone(record.telefone || record.cliente_telefone);
      if(e&&!p.emails.includes(e))p.emails.push(e);
      if(t&&!p.phones.includes(t))p.phones.push(t);
      p.cidade ||= text(record.cidade); p.estado ||= text(record.estado);
      if(kind==='client'){p.clients.push(record);p.clientIds.push(String(record.id));}
      if(kind==='order')p.orders.push(record);
      if(kind==='cart')p.carts.push(record);
      return p;
    }
    // Existing contacts establish identity before purchase and cart evidence is linked.
    clientes.forEach(c=>get(c,'client'));
    const seen=new Set();
    pedidos.filter(confirmed).forEach((p,i)=>{
      const key=p.id!=null?'id:'+p.id:p.referencia?'ref:'+p.canal+':'+p.referencia:'row:'+i;
      if(seen.has(key)||!(text(p.cliente_nome)||email(p.cliente_email)||phone(p.cliente_telefone)))return;
      seen.add(key); get(p,'order');
    });
    carrinhos.filter(c=>!c.ignorado).forEach(c=>get(c,'cart'));
    people.forEach(p=>{
      const platform=earliest(p.clients.map(c=>date(c.data_entrada_yampi || c.yampi_created_at)));
      const crm=earliest(p.clients.map(c=>date(c.created_at)));
      const firstCart=earliest(p.carts.map(c=>date(c.data_criacao)));
      const firstOrder=earliest(p.orders.map(o=>date(o.data)));
      if(platform){p.entry=platform;p.entrySource='Cadastro na Yampi';}
      else if(crm){p.entry=crm;p.entrySource='Cadastro no CRM';}
      else if(firstCart){p.entry=firstCart;p.entrySource='Primeiro carrinho registrado';}
      else {p.entry=firstOrder;p.entrySource=firstOrder?'Primeira compra registrada':'Data não disponível';}
      p.lastOrder=latest(p.orders.map(o=>date(o.data)));
      p.total=p.orders.reduce((s,o)=>s+money(o.receita),0);
      p.bought=p.orders.length>0 || p.clients.some(c=>c.tag==='cliente');
      p.openCarts=p.carts.filter(c=>!c.recuperado);
      p.cart= p.openCarts.slice().sort((a,b)=>Date.parse(date(b.data_criacao)||0)-Date.parse(date(a.data_criacao)||0))[0] || null;
      // The old webhook tagged checkout signups as abandoned carts too.
      // Only explicit/manual cart tags supplement actual cart records.
      p.taggedCart=!p.carts.length&&p.clients.some(c=>c.tag==='carrinho_abandonado'&&(!/yampi/i.test(c.observacoes||'')||/carrinho abandonado/i.test(c.observacoes||'')))&&!p.bought;
      p.hasCart=!!p.cart||p.taggedCart;
      p.cartTotal=p.openCarts.reduce((s,c)=>s+money(c.total),0);
    });
    return {people,buyers:people.filter(p=>p.bought),abandoned:people.filter(p=>p.hasCart),other:people.filter(p=>!p.bought&&!p.hasCart)};
  }
  function ordered(people, order='newest') {
    return people.slice().sort((a,b)=>{
      if(order==='name')return a.nome.localeCompare(b.nome,'pt-BR');
      const av=Date.parse(a.entry), bv=Date.parse(b.entry);
      if(!Number.isFinite(av)&&!Number.isFinite(bv))return a.nome.localeCompare(b.nome,'pt-BR');
      if(!Number.isFinite(av))return 1;if(!Number.isFinite(bv))return -1;
      return order==='oldest'?av-bv:bv-av;
    });
  }
  function search(people, query) {
    const q=name(query); const digits=text(query).replace(/\D/g,'');
    return !q?people:people.filter(p=>name([p.nome,p.emails.join(' '),p.phones.join(' '),p.cidade,p.estado].join(' ')).includes(q)||(digits.length>=4&&p.phones.some(n=>n.includes(digits))));
  }
  const model={build,ordered,search,confirmed,phone,date};
  if(typeof module==='object'&&module.exports){module.exports=model;return;}
  root.ClientCRM=model;
  if(typeof document==='undefined')return;

  const esc = value => escHtml(String(value ?? ''));
  const currency = value => fmtVal(value);
  const dateLabel = value => value ? new Date(value).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '—';
  // Date-only order records are business dates, without a UTC timezone shift.
  const businessDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'') ? value.split('-').reverse().join('/') : dateLabel(value);
  let data=model.build(), loading=false, loadError='', ready=false, offset={buyers:0,abandoned:0,other:0};
  const pageSize=12;
  function mounted() {
    const panel=document.getElementById('panel-clientes');
    if(!panel || document.getElementById('crm-contact-workspace'))return panel;
    const heading=panel.querySelector('.page-heading');
    heading.querySelector('p').textContent='Relacionamento com quem compra e com quem ainda pode comprar.';
    heading.querySelector('.page-eyebrow').textContent='Relacionamento';
    heading.insertAdjacentHTML('beforeend','<div class="crm-heading-actions"><button class="btn" onclick="refreshClientCRM()"><i class="ti ti-refresh"></i>Atualizar</button><button class="btn primary" onclick="openCRMContactForm()"><i class="ti ti-plus"></i>Novo contato</button></div>');
    const details=document.createElement('details'); details.id='crm-contact-form';details.className='crm-contact-form';
    const summary=document.createElement('summary');summary.textContent='Cadastrar ou editar contato';details.append(summary);
    const oldNodes=[...panel.children].filter(e=>e!==heading&&e!==details&&e.id!=='grid-clientes'&&!e.querySelector('#busca-clientes')&&!e.classList.contains('divider'));
    oldNodes.forEach(e=>details.append(e));
    panel.insertBefore(details,panel.querySelector('.divider'));
    panel.querySelectorAll(':scope>.divider').forEach(e=>e.remove());
    const legacyToolbar=document.getElementById('busca-clientes').closest('div').parentElement;
    legacyToolbar.hidden=true;
    document.getElementById('grid-clientes').hidden=true;
    const workspace=document.createElement('div');workspace.id='crm-contact-workspace';
    workspace.innerHTML=`<div id="crm-contact-stats" class="crm-contact-stats"></div><div class="crm-contact-toolbar"><div class="crm-search"><i class="ti ti-search"></i><input id="crm-contact-query" type="search" aria-label="Buscar contatos" placeholder="Buscar nome, e-mail ou telefone" oninput="filterClientCRM()"></div><label>Ordenar por<select id="crm-contact-sort" onchange="filterClientCRM()"><option value="newest">Entrada mais recente</option><option value="oldest">Entrada mais antiga</option><option value="name">Nome (A–Z)</option></select></label><button class="btn" onclick="exportClientCRM()"><i class="ti ti-download"></i>Exportar lista</button></div><p id="crm-contact-feedback" role="status"></p><div id="crm-buyers-block"></div><div id="crm-carts-block"></div><details class="crm-other-contacts"><summary id="crm-other-summary">Outros contatos</summary><div id="crm-other-block"></div></details>`;
    panel.insertBefore(workspace,details);
    return panel;
  }
  function contactCell(p) {
    return `<div class="crm-contact-cell"><span class="crm-contact-avatar">${esc(iniciais(p.nome))}</span><div><button class="crm-contact-name" onclick="openClientCRMProfile(${p.key})">${esc(p.nome)}</button><small>${esc(p.emails[0] || p.phones[0] || 'Contato não informado')}</small>${p.bought&&p.hasCart?'<span class="crm-mini-label">Cliente com carrinho em aberto</span>':''}</div></div>`;
  }
  function entryCell(p){return `<time>${businessDate(p.entry)}</time><small>${esc(p.entrySource)}</small>`;}
  function rows(people,kind) {
    return people.map(p=>`<tr><td>${contactCell(p)}</td><td>${entryCell(p)}</td>${kind==='buyers'?`<td>${businessDate(p.lastOrder)}<small>${p.orders.length?`${p.orders.length} pedido${p.orders.length===1?'':'s'}`:'Compra informada no cadastro'}</small></td><td class="crm-money">${p.orders.length?currency(p.total):'—'}</td>`:kind==='abandoned'?`<td>${businessDate(date(p.cart?.data_criacao))}<small>${p.cart?`${p.openCarts.length} carrinho${p.openCarts.length===1?'':'s'} em aberto`:'Sinalizado no cadastro'}</small></td><td class="crm-money">${p.cart?currency(p.cartTotal):'—'}</td>`:'<td>Contato cadastrado<small>Sem compra ou carrinho confirmado</small></td>'}<td><button class="btn sm" onclick="openClientCRMProfile(${p.key})">Ver contato<i class="ti ti-chevron-right"></i></button></td></tr>`).join('');
  }
  function block(kind,people,title,description) {
    const position=Math.min(offset[kind],Math.max(0,Math.ceil(people.length/pageSize)-1));offset[kind]=position;
    const current=people.slice(position*pageSize,(position+1)*pageSize);
    return `<section class="crm-contact-block"><div class="crm-block-heading"><div><h3><span class="crm-block-icon ${kind}"><i class="ti ${kind==='buyers'?'ti-shopping-bag':kind==='abandoned'?'ti-shopping-cart':'ti-address-book'}"></i></span>${title}<span class="crm-count">${people.length}</span></h3><p>${description}</p></div></div>${current.length?`<div class="crm-table-scroll"><table><thead><tr><th>Contato</th><th>Entrada</th>${kind==='buyers'?'<th>Última compra</th><th>Total comprado</th>':kind==='abandoned'?'<th>Último carrinho</th><th>Valor em aberto</th>':'<th>Situação</th>'}<th><span class="crm-sr-only">Ações</span></th></tr></thead><tbody>${rows(current,kind)}</tbody></table></div><div class="crm-pagination"><span>${position*pageSize+1}–${position*pageSize+current.length} de ${people.length} contatos</span><div><button class="btn sm" ${position===0?'disabled':''} onclick="pageClientCRM('${kind}',-1)">Anterior</button><button class="btn sm" ${(position+1)*pageSize>=people.length?'disabled':''} onclick="pageClientCRM('${kind}',1)">Próxima</button></div></div>`:`<div class="crm-empty"><i class="ti ${kind==='abandoned'?'ti-shopping-cart-off':'ti-users'}"></i><strong>${loading?'Carregando contatos…':loadError?'Não foi possível carregar esta lista.':'Nenhum contato nesta lista'}</strong><span>${loading?'Consultando os dados sincronizados.':loadError?'Use Atualizar para tentar novamente.':'Altere a busca ou cadastre um novo contato.'}</span></div>`}</section>`;
  }
  renderClientes=function() {
    if(!mounted())return;
    data=model.build({clientes:cache.clientes,pedidos:cache.pedidos,carrinhos:cache.carrinhosAbandonados});
    const q=document.getElementById('crm-contact-query').value, sort=document.getElementById('crm-contact-sort').value;
    const filtered=kind=>model.ordered(model.search(data[kind],q),sort);
    const totalCarts=data.abandoned.reduce((s,p)=>s+p.cartTotal,0);
    document.getElementById('crm-contact-stats').innerHTML=`<article><span>Quem já comprou</span><strong>${data.buyers.length}</strong><small>Contatos com compra registrada</small></article><article><span>Carrinhos abandonados</span><strong>${data.abandoned.length}</strong><small>Contatos para recuperação</small></article><article><span>Valor em aberto</span><strong>${currency(totalCarts)}</strong><small>Soma dos carrinhos ativos</small></article>`;
    document.getElementById('crm-buyers-block').innerHTML=block('buyers',filtered('buyers'),'Quem já comprou','Histórico de compras e oportunidades de recompra.');
    document.getElementById('crm-carts-block').innerHTML=block('abandoned',filtered('abandoned'),'Carrinhos abandonados','Pessoas que deixaram uma compra em aberto.');
    document.getElementById('crm-other-block').innerHTML=block('other',filtered('other'),'Outros contatos','Cadastros sem compra ou carrinho confirmado.');
    document.getElementById('crm-other-summary').textContent=`Outros contatos (${filtered('other').length})`;
    const feedback=document.getElementById('crm-contact-feedback');
    feedback.textContent=loading?'Atualizando contatos…':loadError||'Ordenação pela data indicada em Entrada. Um cliente pode ter um novo carrinho em aberto.';
    feedback.className=loadError?'crm-feedback-error':'';
  };
  root.filterClientCRM=()=>{offset={buyers:0,abandoned:0,other:0};renderClientes();};
  root.pageClientCRM=(kind,step)=>{offset[kind]+=step;renderClientes();};
  root.openCRMContactForm=(id)=>{
    mounted();const form=document.getElementById('crm-contact-form');form.open=true;
    if(id)editarCliente(id);
    else {editandoClienteId=null;['cli-nome','cli-telefone','cli-email','cli-cidade','cli-obs'].forEach(k=>document.getElementById(k).value='');document.getElementById('cli-tag').value='';}
    form.scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('cli-nome').focus();
  };
  root.openClientCRMProfile=key=>{
    const p=data.people.find(p=>p.key===key);if(!p)return;
    const orders=p.orders.slice().sort((a,b)=>Date.parse(b.data)-Date.parse(a.data));
    const carts=p.openCarts.slice().sort((a,b)=>Date.parse(b.data_criacao)-Date.parse(a.data_criacao));
    const wa=p.phones[0]?'https://wa.me/'+p.phones[0]:'';
    document.getElementById('modal-item-conteudo').innerHTML=`<button class="modal-close" onclick="fecharModalItem()" aria-label="Fechar contato">×</button><div class="crm-profile-heading"><span class="crm-contact-avatar large">${esc(iniciais(p.nome))}</span><div><h2>${esc(p.nome)}</h2><p>${p.bought?'Já comprou':'Contato'}${p.hasCart?' · Carrinho em aberto':''}</p></div></div><div class="crm-profile-info"><div><span>E-mail</span><strong>${esc(p.emails[0]||'Não informado')}</strong></div><div><span>Telefone</span><strong>${esc(p.phones[0]||'Não informado')}</strong></div><div><span>Entrada</span><strong>${businessDate(p.entry)}</strong><small>${esc(p.entrySource)}</small></div><div><span>Cidade</span><strong>${esc([p.cidade,p.estado].filter(Boolean).join(', ')||'Não informada')}</strong></div></div><div class="crm-profile-history"><h3>Compras (${orders.length})</h3>${orders.length?orders.map(o=>`<div><span>${businessDate(o.data)}<small>${esc(o.canal||'')} · Pedido ${esc(o.referencia||o.id)}</small></span><strong>${currency(o.receita)}</strong></div>`).join(''):'<p>Nenhum pedido vinculado a este contato.</p>'}</div><div class="crm-profile-history"><h3>Carrinhos em aberto (${carts.length})</h3>${carts.length?carts.map(c=>`<div><span>${businessDate(date(c.data_criacao))}<small>${esc(produtosResumoV7(c))}</small></span><strong>${currency(c.total)}</strong></div>`).join(''):'<p>Nenhum carrinho aberto vinculado a este contato.</p>'}</div><div class="modal-actions">${p.clientIds.length?`<button class="btn" onclick="fecharModalItem();openCRMContactForm('${esc(p.clientIds[0])}')"><i class="ti ti-pencil"></i>Editar cadastro</button>`:''}${wa?`<a class="btn primary" href="${wa}" target="_blank" rel="noopener"><i class="ti ti-brand-whatsapp"></i>Abrir WhatsApp</a>`:''}<button class="btn" onclick="fecharModalItem()">Fechar</button></div>`;
    abrirModalItem();
  };
  async function allRows(table,order) {
    const rows=[];
    for(let start=0;;start+=500){const r=await sb.from(table).select('*').order(order,{ascending:false}).order('id',{ascending:false}).range(start,start+499);if(r.error)throw r.error;rows.push(...(r.data||[]));if((r.data||[]).length<500)break;}
    return rows;
  }
  async function load(force=true) {
    if(loading)return;
    loading=true;loadError='';renderClientes();
    try {
      const results=await Promise.all([allRows('clientes','created_at'),allRows('pedidos','data'),allRows('carrinhos_abandonados','data_criacao')]);
      [cache.clientes,cache.pedidos,cache.carrinhosAbandonados]=results;ready=true;cartsSchemaV7=true;
      perfV95.loaded.add('clientes');perfV95.loaded.add('carrinhos');perfSaveV95();populateListaClientes();
    } catch(e) {loadError='Não foi possível atualizar os contatos. Tente novamente.';console.warn('CRM contacts failed to refresh',e);throw e;}
    finally {loading=false;renderClientes();}
  }
  const legacyLoad=carregarAbaV95;
  carregarAbaV95=async function(id,force=false){if(id==='clientes')return load(force);return legacyLoad(id,force);};
  root.refreshClientCRM=async()=>{try{await load();}catch{};};
  root.exportClientCRM=()=>{
    const q=document.getElementById('crm-contact-query').value,sort=document.getElementById('crm-contact-sort').value;
    const people=model.ordered(model.search(data.people,q),sort);
    const rows=[['Nome','E-mail','Telefone','Entrada','Fonte da data','Já comprou','Carrinho em aberto','Pedidos','Total comprado','Valor dos carrinhos'],...people.map(p=>[p.nome,p.emails[0]||'',p.phones[0]||'',p.entry,p.entrySource,p.bought?'Sim':'Não',p.hasCart?'Sim':'Não',p.orders.length,p.total,p.cartTotal])];
    const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"').join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='areia-croa-contatos.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  mounted();renderClientes();
  if(perfActiveTabV95()==='clientes')root.refreshClientCRM();
})(typeof window==='undefined'?{}:window);
