/* Presentation only: reads the same canonical orders as the financial summary. */
(()=>{
 function render(){
  const cards=document.getElementById('cards-resumo');if(!cards||typeof pedidosBaseV9!=='function')return;
  let shell=document.getElementById('ac-revenue-trend');
  if(!shell){shell=document.createElement('section');shell.id='ac-revenue-trend';shell.className='ac-revenue-trend';cards.after(shell);}
  const month=document.getElementById('filter-mes')?.value||'';
  const orders=pedidosBaseV9().filter(p=>!month||getMes(p.data)===month);
  const sums=new Map();
  orders.forEach(p=>{const key=String(p.data||'').slice(0,month?10:7);if(!/^\d{4}-\d{2}(?:-\d{2})?$/.test(key))return;sums.set(key,(sums.get(key)||0)+Number(p.receita||0));});
  let keys=[...sums.keys()].sort();
  if(month){const [y,m]=month.split('-').map(Number),days=new Date(y,m,0).getDate();keys=Array.from({length:days},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);}
  else if(keys.length){const start=new Date(keys[0]+'-01T12:00:00Z'),end=new Date(keys.at(-1)+'-01T12:00:00Z');keys=[];for(let d=start;d<=end&&keys.length<240;d.setUTCMonth(d.getUTCMonth()+1))keys.push(d.toISOString().slice(0,7));}
  const series=keys.map(key=>({key,value:sums.get(key)||0})),total=orders.reduce((s,p)=>s+Number(p.receita||0),0);
  const label=k=>month?k.slice(-2):new Date(k+'-01T12:00:00Z').toLocaleDateString('pt-BR',{month:'short',year:'2-digit',timeZone:'UTC'});
  const max=Math.max(...series.map(p=>p.value),1),points=series.map((p,i)=>[54+i*900/Math.max(series.length-1,1),176-p.value/max*140]);
  const line=points.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const ticks=series.filter((p,i)=>i===0||i===series.length-1||i%Math.max(1,Math.ceil(series.length/6))===0);
  const svg=series.length?`<svg viewBox="0 0 1000 220" role="img" aria-label="Receita ${month?'por dia':'por mês'} no período selecionado"><defs><linearGradient id="ac-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#91ab62" stop-opacity=".23"/><stop offset="1" stop-color="#91ab62" stop-opacity="0"/></linearGradient></defs>${[0,.5,1].map(v=>`<line x1="54" x2="954" y1="${176-v*140}" y2="${176-v*140}" stroke="#e8ebe2" stroke-dasharray="4 5"/><text x="0" y="${180-v*140}" fill="#8a9382" font-size="10">${Math.round(max*v).toLocaleString('pt-BR')}</text>`).join('')}<path d="${line} L954,176 L54,176 Z" fill="url(#ac-chart-fill)"/><path d="${line}" fill="none" stroke="#708951" stroke-width="2.5" stroke-linejoin="round"/>${points.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#708951"><title>${label(series[i].key)}: ${fmtVal(series[i].value)}</title></circle>`).join('')}${ticks.map(p=>`<text x="${points[series.indexOf(p)][0]}" y="205" fill="#77816e" font-size="11" text-anchor="middle">${label(p.key)}</text>`).join('')}</svg>`:'<p class="ac-trend-empty">Nenhuma receita registrada neste período.</p>';
  shell.innerHTML=`<div class="ac-trend-header"><div><span>EVOLUÇÃO DO NEGÓCIO</span><h3>Receita ao longo do tempo</h3><p>${month?'Por dia no mês selecionado':'Por mês em todo o histórico'} · valores em reais</p></div><div><small>Receita no período</small><strong>${fmtVal(total)}</strong></div></div>${svg}<details><summary>Ver valores ${month?'por dia':'por mês'}</summary><div class="ac-trend-values">${series.map(p=>`<span>${label(p.key)}<b>${fmtVal(p.value)}</b></span>`).join('')}</div></details>`;
 }
 function init(){const cards=document.getElementById('cards-resumo');if(!cards||cards.dataset.acTrend)return;cards.dataset.acTrend='true';new MutationObserver(render).observe(cards,{childList:true});document.getElementById('filter-mes')?.addEventListener('change',render);render();}
 document.addEventListener('DOMContentLoaded',init);init();
})();
