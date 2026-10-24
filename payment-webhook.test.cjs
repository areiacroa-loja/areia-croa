const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const src=fs.readFileSync(__dirname+'/yampi-webhook.ts','utf8');
const helper=src.slice(src.indexOf('function paymentBreakdownV108'),src.indexOf('async function processPaidOrder'));
const ctx={money:n=>Math.round(Number(n||0)*100)/100};vm.createContext(ctx);vm.runInContext(stripTypeScriptTypes(helper),ctx);
test('webhook detects captured card and gross interest',()=>{const r=ctx.paymentBreakdownV108({value_total:180.17,value_products:165,value_discount:8.25,value_shipment:0,value_tax:23.42,transactions:{data:[{status:'paid',installments:6,payment:{data:{alias:'credit_card'}}}]}});assert.equal(r.taxas_origem,'estimado');assert.equal(r.taxas,37.90);assert.equal(r.liquido_gateway,146.77);});
test('failed card attempt cannot override approved Pix',()=>{const r=ctx.paymentBreakdownV108({value_total:166.25,transactions:{data:[{status:'refused',payment:{data:{alias:'credit_card'}}},{status:'paid',payment:{data:{alias:'pix'}}}]}});assert.equal(r.pagamento_metodo,'pix');assert.equal(r.taxa_gateway,2.65);});
test('card without interest data is visibly pending',()=>{const r=ctx.paymentBreakdownV108({value_total:180.17,transactions:{data:[{status:'paid',installments:6,payment:{data:{alias:'credit_card'}}}]}});assert.equal(r.taxas_origem,'pendente');assert.equal(r.taxa_gateway,null);});


test('Yampi card brands and string payment lists identify cards',()=>{for(const r of [{payments:['visa']},{transactions:{data:[{status:'paid',payment:{data:{alias:'mastercard',is_credit_card:true}}}]}}]){const f=ctx.paymentBreakdownV108({...r,value_total:180.17,value_tax:23.42});assert.equal(f.pagamento_metodo,'credit_card');assert.equal(f.taxa_gateway,9.98);}});
const procSource=src.slice(src.indexOf('async function processPaidOrder'),src.indexOf('async function recoverYampiOrder'));
test('replayed webhook keeps exact CSV cents in header and line revenues',async()=>{
 const writes=[];const existing={id:7,origem_dados:'Yampi webhook',receita:153.61,taxas_origem:'csv',pagamento_metodo:'pix',parcelas:1,juros_parcelamento:0,taxa_gateway:2.53,taxa_yampi:3.84,checkout_yampi:true,liquido_gateway:151.08,taxas:6.37,frete:20,custo_embalagens:5,taxas_revisao:null};
 const c={money:ctx.money,dateOnly:()=> '2026-10-21',cleanPhone:()=>'',isPaidTraffic:()=>false,findOrCreateClient:async()=>null,matchProduct:()=>({id:1,nome:'Produto',custo:50}),itemTitle:()=> 'Produto',allocateRevenue:(items,total)=>[total],markRecoveredCartForPaidOrder:async()=>null,logEvent:async()=>{},PACKAGING_COST:5,
 sb:{from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return Promise.resolve({data:table==='pedidos'?[existing]:[]})},update(row){writes.push({table,row});return q},insert(row){writes.push({table,row});return q},then(resolve){return Promise.resolve({data:table==='produtos'?[{id:1,nome:'Produto',custo:50}]:[],error:null}).then(resolve)}};return q},rpc:async()=>({error:null})}};
 vm.createContext(c);vm.runInContext(stripTypeScriptTypes(helper+'\n'+procSource),c);
 await c.processPaidOrder({event:'order.paid',resource:{id:10,number:'TEST',value_total:153.62,value_tax:0,payments:['pix'],customer:{data:{}},shipping_address:{data:{}},items:{data:[{id:1,quantity:1}]}}});
 const header=writes.find(w=>w.table==='pedidos').row,line=writes.find(w=>w.table==='vendas').row;
 assert.equal(header.receita,153.61);assert.equal(header.taxas,6.37);assert.equal(header.taxa_gateway,2.53);assert.equal(line.receita,153.61);assert.equal(line.taxa,6.37);assert.equal(header.frete,20);
});
