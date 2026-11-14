const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const code=html.slice(html.indexOf('let resumoSyncV108=null;'),html.indexOf('function toggleBrindeV107'));
function harness(previousSpend,{fail=false,gate=Promise.resolve()}={}){
 const cache={metaAdsDaily:[{spend:previousSpend}],pedidos:[{receita:1}],financialSyncState:undefined},calls=[],renders=[];
 const fixtures={pedidos:[{id:1,receita:32192.18}],anuncios:[],metas_mensais:[],pedido_fretes:[]};
 const c={cache,Date,console,Promise,Error,pedidosSchemaV8:false,
  sb:{from(table){calls.push(table);const q={select(){return q},order(){return q},then(resolve,reject){return Promise.resolve({data:fixtures[table],error:null}).then(resolve,reject);}};return q;}},
  carregarIntegracoesV10:async()=>{calls.push('meta');await gate;if(fail)return false;cache.metaAdsDaily=[{spend:4503.66}];return true;},
  carregarAportesV98:async()=>{calls.push('aportes');cache.aportes=[];return true;},carregarFechamentosV99:async()=>{calls.push('fechamentos');cache.fechamentosInvestimento=[];return true;},
  renderDashboard:()=>renders.push({state:cache.financialSyncState,spend:cache.metaAdsDaily[0].spend}),
  perfStatusV95:()=>{},popularSelectMes:()=>{},perfActiveTabV95:()=> 'dashboard',perfSaveV95:()=>{}
 };vm.createContext(c);vm.runInContext(code,c);return {c,cache,calls,renders};
}
test('cold and warm devices refresh every financial source and converge to the same profit',async()=>{
 for(const old of [0,2917.92,4503.66]){const h=harness(old);await h.c.carregarResumoV95({silent:true});assert.equal(h.cache.financialSyncState,'ready');assert.ok(Math.abs(h.cache.pedidos[0].receita-18853.03-h.cache.metaAdsDaily[0].spend-8835.49)<1e-8);assert.equal(h.calls.filter(v=>v==='meta').length,1);assert.ok(h.calls.includes('aportes'));assert.ok(h.calls.includes('fechamentos'));assert.deepEqual(h.renders.map(r=>r.state),['loading','ready']);}
});
test('profit is not confirmed before media finishes, and concurrent refreshes share one request',async()=>{
 let release;const gate=new Promise(r=>release=r),h=harness(2917.92,{gate});const first=h.c.carregarResumoV95(),second=h.c.carregarResumoV95();
 await Promise.resolve();assert.equal(h.cache.financialSyncState,'loading');assert.equal(h.renders.some(r=>r.state==='ready'),false);assert.equal(h.calls.filter(v=>v==='meta').length,1);
 release();await Promise.all([first,second]);assert.equal(h.cache.financialSyncState,'ready');
});
test('failed media refresh never presents cached advertising costs as confirmed profit and allows retry',async()=>{
 const h=harness(2917.92,{fail:true});await assert.rejects(h.c.carregarResumoV95());assert.equal(h.cache.financialSyncState,'error');assert.equal(h.renders.some(r=>r.state==='ready'),false);
 await assert.rejects(h.c.carregarResumoV95());assert.equal(h.calls.filter(v=>v==='meta').length,2);
});
