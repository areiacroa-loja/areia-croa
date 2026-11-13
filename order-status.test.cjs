const fs=require('node:fs'),vm=require('node:vm'),{test}=require('node:test'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const start=html.indexOf('salvarEditarPedidoV96=async function',html.indexOf('<script id="v10-7-frete'));
const code=html.slice(start,html.indexOf('abrirModalPedidoV9=function',start));
function setup({oldStatus='pago',nextStatus='cancelado',conflict=false}={}){
 const calls=[],alerts=[];let closed=false;
 const fields={'ac-order-status':{value:nextStatus},'v96-ped-obs':{value:'Nota original'},'v96-ped-data':{value:'2026-11-13'},'v96-ped-canal':{value:'Yampi'},'v107-ped-frete':{value:'7.33',dataset:{}},'v107-ped-emb':{value:'5'},'v96-ped-cliente':{value:'Cliente'},'v96-ped-tel':{value:''},'v96-ped-cidade':{value:'Salvador'}};
 const c=vm.createContext({cache:{pedidos:[{id:1,status:oldStatus,updated_at:'2026-11-13T10:00:00Z',receita:100,canal:'Yampi'}]},v107Same:(a,b)=>String(a)===String(b),document:{getElementById:id=>fields[id]},normalizeUFV6:()=> 'BA',fretesPedidoV107:()=>[],freteAutomaticoV107:()=>0,collectTaxasInputV108:()=>({}),hoje:()=> '2026-11-13',alert:x=>alerts.push(x),console,
 sb:{from(table){const q={update(row){calls.push({table,row});return q},eq(key,value){calls.push({key,value});return q},select:async()=>({data:conflict?[]:[{id:1}],error:null}),then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q},rpc:async()=>({error:null})},fecharModalItem:()=>{closed=true},carregarResumoV95:async()=>{},carregarVendasV95:async()=>{},renderHistorico:()=>{},renderVendas:()=>{},renderDashboard:()=>{},perfSaveV95:()=>{}});
 vm.runInContext(code,c);return {c,calls,alerts,isClosed:()=>closed};
}
test('manual cancellation keeps amounts and records status history with optimistic concurrency',async()=>{
 const {c,calls,isClosed}=setup();await c.salvarEditarPedidoV96(1);
 const write=calls.find(x=>x.table==='pedidos');assert.equal(write.row.status,'cancelado');assert.equal(write.row.frete,7.33);assert.match(write.row.observacoes,/Nota original.*pago para cancelado/);assert.equal(Object.hasOwn(write.row,'receita'),false);assert.ok(calls.some(x=>x.key==='updated_at'));assert.equal(isClosed(),true);
});
test('stale edits do not claim cancellation or update child items',async()=>{
 const {c,calls,alerts,isClosed}=setup({conflict:true});await c.salvarEditarPedidoV96(1);
 assert.equal(isClosed(),false);assert.equal(alerts.length,1);assert.equal(calls.some(x=>x.table==='vendas'),false);
});
test('cancelled order can be corrected and reopened manually',async()=>{
 const {c,calls}=setup({oldStatus:'cancelado',nextStatus:'pago'});await c.salvarEditarPedidoV96(1);assert.equal(calls[0].row.status,'pago');assert.match(calls[0].row.observacoes,/cancelado para pago/);
});
