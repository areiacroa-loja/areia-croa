const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(__dirname+'/yampi-webhook.ts','utf8');

function clockRetry(){
 const c=vm.createContext({Request,Response,URL,fetch,setTimeout});
 vm.runInContext(stripTypeScriptTypes(source.slice(source.indexOf('async function fetchWithClockSkewRetry'),source.indexOf('const sb ='))),c);
 return c.fetchWithClockSkewRetry;
}
test('transient future JWT rejection retries the exact body before a successful write',async()=>{
 const retry=clockRetry(),bodies=[],waits=[];let calls=0;
 const response=await retry('https://erp.example.test/rest/v1/pedidos',{method:'POST',headers:{Authorization:'Bearer unit-test-only'},body:'{"referencia":"test"}'},async req=>{
  calls++;bodies.push(await req.text());assert.equal(req.headers.get('Authorization'),'Bearer unit-test-only');
  return calls<3?Response.json({code:'PGRST303',message:'JWT issued at future'},{status:401}):Response.json({id:1});
 },async ms=>{waits.push(ms);});
 assert.equal(response.status,200);assert.equal((await response.json()).id,1);assert.equal(calls,3);assert.deepEqual(bodies,Array(3).fill('{"referencia":"test"}'));assert.deepEqual(waits,[500,1500]);
});
test('clock skew retries are bounded and never replay generic auth errors, 5xx or uncertain writes',async()=>{
 const retry=clockRetry();let calls=0;
 const response=await retry('https://erp.example.test',undefined,async()=>{calls++;return Response.json({code:'PGRST303',message:'JWT issued at future'},{status:401});},async()=>{});
 assert.equal(response.status,401);assert.equal(calls,4);assert.equal((await response.json()).code,'PGRST303');
 for(const [status,payload] of [[401,{code:'PGRST301',message:'JWT expired'}],[500,{code:'PGRST303',message:'JWT issued at future'}],[401,{code:'PGRST303',message:'Invalid token'}]]){
  let tries=0;await retry('https://erp.example.test',undefined,async()=>{tries++;return Response.json(payload,{status});},async()=>{});assert.equal(tries,1);
 }
 let tries=0;await assert.rejects(retry('https://erp.example.test',{method:'POST',body:'{}'},async()=>{tries++;throw Error('Connection lost after write');},async()=>{}));assert.equal(tries,1);
});
test('named sales campaigns from Instagram retain traffic evidence without a Meta ID',()=>{
 const c=vm.createContext({});
 vm.runInContext(stripTypeScriptTypes(source.slice(source.indexOf('function isPaidTraffic'),source.indexOf('async function resolveMetaCampaign'))),c);
 for(const campaign of ['HL (VENDAS) SITE 2 — Cópia','HL+%28VENDAS%29+SITE+2'])
  assert.equal(c.isPaidTraffic({utm_source:'ig',utm_medium:'social',utm_campaign:campaign}),true);
 assert.equal(c.isPaidTraffic({utm_source:'ig',utm_medium:'social',utm_content:'link_in_bio'}),false);
 assert.equal(c.isPaidTraffic({utm_source:'ig',utm_medium:'organic',utm_campaign:'HL (VENDAS) SITE 2'}),false);
});
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
 const c=vm.createContext({money:n=>Math.round(Number(n||0)*100)/100,dateOnly:()=> '2026-11-13',cleanPhone:()=>'',isPaidTraffic:()=>true,resolveMetaCampaign:async()=>null,findOrCreateClient:async()=>null,matchProduct:()=>({id:1,nome:'Produto',custo:10}),itemTitle:()=> 'Produto',allocateRevenue:()=>[100],markRecoveredCartForPaidOrder:async()=>null,logEvent:async()=>{},PACKAGING_COST:5,
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
test('ig/social order with an exact known Meta campaign is paid traffic',async()=>{
 const {c,writes}=paidContext();c.isPaidTraffic=()=>false;
 c.resolveMetaCampaign=async()=>({campaign_id:'120001234567890',tipo:'vendas'});
 await c.processPaidOrder({...body,resource:{...body.resource,utm_source:'ig',utm_medium:'social'}});
 const header=writes.find(w=>w.table==='pedidos').row;
 assert.equal(header.via_trafego,true);assert.equal(header.meta_campaign_id,'120001234567890');
});
test('Meta resolver requires an exact ID or unique decoded campaign name',async()=>{
 const resolver=source.slice(source.indexOf('async function resolveMetaCampaign'),source.indexOf('function yampiCancellation'));
 for(const ambiguous of [false,true]){
  const c=vm.createContext({console,sb:{from(){let key;return {select(){return this},eq(k,v){key=k;return this},limit:async()=>({data:key==='campaign_id'?[]:ambiguous?[{campaign_id:'1'},{campaign_id:'2'}]:[{campaign_id:'1'}]})}}}});
  vm.runInContext(stripTypeScriptTypes(resolver),c);const result=await c.resolveMetaCampaign('Ver%C3%A3o+2026');assert.equal(result?.campaign_id,ambiguous?undefined:'1');
 }
});
