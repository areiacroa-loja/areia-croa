const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(__dirname+'/yampi-webhook.ts','utf8');
const cancelCode=source.slice(source.indexOf('function yampiCancellation'),source.indexOf('function dateOnly'));
test('only definitive whole-order statuses cancel an order',()=>{
 const c=vm.createContext({});vm.runInContext(stripTypeScriptTypes(cancelCode),c);
 for(const alias of ['cancelled','canceled','refunded','chargeback'])assert.equal(c.yampiCancellation({status:{data:{alias}}}),true);
 for(const alias of ['partially_refunded','refused','paid','waiting_payment'])assert.equal(c.yampiCancellation({status:{data:{alias}}}),false);
});
test('cancellation preserves line items and non-Yampi orders',async()=>{
 for(const origin of ['Yampi webhook','CRM V10.7']){
  const writes=[];const c=vm.createContext({logEvent:async()=>{},sb:{from(table){assert.equal(table,'pedidos');const q={select(){return q},eq(){return q},limit:async()=>({data:[{id:1,status:'pago',origem_dados:origin,observacoes:'original'}]}),update(row){writes.push(row);return q},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q}}});
  vm.runInContext(stripTypeScriptTypes(cancelCode),c);
  await c.processCancelledOrder({event:'order.status.updated',resource:{id:10,number:'123',status:{data:{alias:'cancelled'}}}});
  assert.equal(writes.length,origin==='Yampi webhook'?1:0);
  if(writes.length){assert.equal(writes[0].status,'cancelado');assert.match(writes[0].observacoes,/original/);}
 }
});
function paidContext({status='pago',insertError=null,retryError=null}={}){
 const writes=[];const existing={id:7,status,origem_dados:'Yampi webhook',receita:100,taxas_origem:'estimado',frete:0,custo_embalagens:5};
 const c=vm.createContext({money:n=>Math.round(Number(n||0)*100)/100,dateOnly:()=> '2026-11-13',cleanPhone:()=>'',isPaidTraffic:()=>true,findOrCreateClient:async()=>null,matchProduct:()=>({id:1,nome:'Produto',custo:10}),itemTitle:()=> 'Produto',allocateRevenue:()=>[100],markRecoveredCartForPaidOrder:async()=>null,logEvent:async()=>{},PACKAGING_COST:5,
 sb:{from(table){let op='select';const q={select(){return q},eq(){return q},order(){return q},limit:async()=>({data:table==='pedidos'?[existing]:[]}),update(row){op='update';writes.push({table,op,row});return q},insert(row){op='insert';writes.push({table,op,row});return q},then(resolve){return Promise.resolve({data:table==='produtos'?[{id:1,nome:'Produto',custo:10}]:[],error:table==='vendas'?(op==='insert'?insertError:retryError):null}).then(resolve)}};return q},rpc:async()=>({error:null})}});
 vm.runInContext(stripTypeScriptTypes(source.slice(source.indexOf('function paymentBreakdownV108'),source.indexOf('async function recoverYampiOrder'))),c);
 return {c,writes};
}
const body={event:'order.paid',resource:{id:10,number:'123',value_total:100,payments:['pix'],utm_campaign:'120001234567890',utm_term:'criativo',items:{data:[{id:1,quantity:1}]}}};
test('concurrent insert retries the unique item instead of returning a duplicate error',async()=>{
 const {c,writes}=paidContext({insertError:{code:'23505'}});await c.processPaidOrder(body);
 assert.deepEqual(writes.filter(w=>w.table==='vendas').map(w=>w.op),['insert','update']);
 assert.equal(writes[0].row.utm_campaign,'120001234567890');assert.equal(writes[0].row.utm_term,'criativo');
});
test('failed duplicate retry is not acknowledged as success',async()=>{
 const {c}=paidContext({insertError:{code:'23505'},retryError:{message:'database unavailable'}});
 await assert.rejects(c.processPaidOrder(body),e=>e.message==='database unavailable');
});
test('late paid webhook cannot reopen a manually cancelled order',async()=>{
 const {c,writes}=paidContext({status:'cancelado'});const result=await c.processPaidOrder(body);
 assert.equal(result.reason,'existing_cancelled');assert.equal(writes.length,0);
});
