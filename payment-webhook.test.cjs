const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const src=fs.readFileSync(__dirname+'/yampi-webhook.ts','utf8');
const helper=src.slice(src.indexOf('function paymentBreakdownV108'),src.indexOf('async function processPaidOrder'));
const ctx={money:n=>Math.round(Number(n||0)*100)/100};vm.createContext(ctx);vm.runInContext(stripTypeScriptTypes(helper),ctx);
test('webhook detects captured card and gross interest',()=>{const r=ctx.paymentBreakdownV108({value_total:180.17,value_products:165,value_discount:8.25,value_shipment:0,value_tax:23.42,transactions:{data:[{status:'paid',installments:6,payment:{data:{alias:'credit_card'}}}]}});assert.equal(r.taxas_origem,'estimado');assert.equal(r.taxas,37.90);assert.equal(r.liquido_gateway,146.77);});
test('failed card attempt cannot override approved Pix',()=>{const r=ctx.paymentBreakdownV108({value_total:166.25,transactions:{data:[{status:'refused',payment:{data:{alias:'credit_card'}}},{status:'paid',payment:{data:{alias:'pix'}}}]}});assert.equal(r.pagamento_metodo,'pix');assert.equal(r.taxa_gateway,2.65);});
test('card without interest data is visibly pending',()=>{const r=ctx.paymentBreakdownV108({value_total:180.17,transactions:{data:[{status:'paid',installments:6,payment:{data:{alias:'credit_card'}}}]}});assert.equal(r.taxas_origem,'pendente');assert.equal(r.taxa_gateway,null);});


test('Yampi card brands and string payment lists identify cards',()=>{for(const r of [{payments:['visa']},{transactions:{data:[{status:'paid',payment:{data:{alias:'mastercard',is_credit_card:true}}}]}}]){const f=ctx.paymentBreakdownV108({...r,value_total:180.17,value_tax:23.42});assert.equal(f.pagamento_metodo,'credit_card');assert.equal(f.taxa_gateway,9.98);}});
