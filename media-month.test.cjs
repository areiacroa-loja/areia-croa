const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/media-month.js','utf8');
function setup(){
  const select={value:'',dataset:{},options:[],add(o){this.options.push(o)},set innerHTML(s){this.options=[...s.matchAll(/value="([^"]*)"/g)].map(m=>({value:m[1]}));}};
  const fields={'filter-mes-anuncios':select,'v99-close-sessoes':{value:'100'},'v99-close-obs':{value:'Teste'},'v98-aporte-data':{value:'2026-09-10'},'media-budget-value':{value:'600'},'media-budget-save':{}};
  const writes=[],alerts=[];let dbError=null, rows=[];
  const noop=()=>{};
  const c={console,Date,Number,Set,Option:function(text,value){this.text=text;this.value=value},
    cache:{metas:[{id:1,ano:2026,mes:9,investimento_previsto:500,faturamento_previsto:3000}],aportes:[],fechamentosInvestimento:[]},
    document:{getElementById:id=>fields[id]||null,querySelector:()=>null},
    popularSelectMes:()=>{select.innerHTML='<option value=""></option><option value="2026-09"></option>';},
    fechamentoMesSchemaV99:true,carregarFechamentosV99:noop,renderAnuncios:noop,
    resumoMesInvestimentoV99:()=>({total:150,vendas:150,branding:0,receita:450,compras:3,sessoes:0,roas:3,cpa:50}),
    fechamentoV99:ym=>c.cache.fechamentosInvestimento.find(f=>f.mes===ym),
    mesFechadoV99:ym=>c.fechamentoV99(ym)?.status==='fechado',
    ymAnunciosV99:()=>select.value,mesLabel:x=>x,
    abrirFecharMesV99:noop,salvarFechamentoMesV10:noop,reabrirMesV99:noop,
    abrirNovoAporteV98:noop,salvarAporteV98:()=>writes.push('deposit'),deletarAporteV98:()=>writes.push('delete'),
    valorAportesV99:()=>400,metaTemDadosV10:()=>true,
    fecharModalItem:noop,renderDashboard:noop,perfSaveV95:noop,
    alert:m=>alerts.push(m),confirm:()=>true,
    sb:{from(table){let row=null;const q={select(){return q},order(){return Promise.resolve({data:rows,error:dbError})},
      upsert(data){row=data;writes.push({table,data});rows=[data];return q},
      update(data){row=data;writes.push({table,data});rows=[data];return q},eq(){return q},
      then(resolve){return Promise.resolve({data:row?[row]:rows,error:dbError}).then(resolve)}};return q;}}
  };
  c.window=c;vm.createContext(c);vm.runInContext(source,c);
  return {c,select,fields,writes,alerts,setError:e=>dbError=e};
}
test('current month is available without transactions; all-month selection is preserved',()=>{
  const {c,select}=setup(),d=new Date(),ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  assert.equal(select.value,ym);assert.ok(select.options.some(o=>o.value===ym));
  select.value='';c.popularSelectMes();assert.equal(select.value,'');
  c.chooseMediaMonth('2027-02');assert.equal(select.value,'2027-02');
});
test('closing persists spend once, deposits separately, and manual sessions',async()=>{
  const {c,writes}=setup();await c.salvarFechamentoMesV10('2026-09');
  const row=writes[0].data;assert.equal(row.snapshot.total,150);assert.equal(row.snapshot.aportes,400);
  assert.equal(row.sessoes,100);assert.equal(row.snapshot.conversao,3);assert.equal(row.snapshot.orcamento,500);
  assert.equal(c.resumoMesInvestimentoV99('2026-09').total,150);
});
test('closed snapshot remains stable and blocks editing deposits',async()=>{
  const {c,writes,alerts}=setup();c.cache.fechamentosInvestimento=[{mes:'2026-09',status:'fechado',snapshot:{total:90,sessoes:50}}];
  assert.equal(c.resumoMesInvestimentoV99('2026-09').total,90);
  await c.salvarAporteV98();assert.equal(writes.length,0);assert.match(alerts[0],/fechado/);
});
test('budget updates preserve the revenue target',async()=>{
  const {c,writes}=setup();await c.saveMediaBudget('2026-09');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].data)),{investimento_previsto:600});
});
test('failed closing does not claim success or close the modal',async()=>{
  const {c,setError,alerts}=setup();let closed=false;c.fecharModalItem=()=>closed=true;
  setError({message:'Permission denied'});await c.salvarFechamentoMesV10('2026-09');
  assert.equal(closed,false);assert.match(alerts[0],/Permission denied/);
});
test('invalid sessions and future closing are rejected without writes',async()=>{
  const {c,fields,writes}=setup();fields['v99-close-sessoes'].value='1.5';await c.salvarFechamentoMesV10('2026-09');
  assert.equal(writes.length,0);fields['v99-close-sessoes'].value='10';await c.salvarFechamentoMesV10('9999-12');assert.equal(writes.length,0);
});
