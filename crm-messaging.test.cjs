const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const ui=require('./crm-messaging.js');
const source=fs.readFileSync(__dirname+'/crm-whatsapp.ts','utf8');
const helpers=source.slice(source.indexOf('function waPhone'),source.indexOf('const URL_BASE'));
function context(){const c=vm.createContext({crypto:globalThis.crypto,TextEncoder,Date,Uint8Array});vm.runInContext(stripTypeScriptTypes(helpers),c);return c;}
const cart={id:7,nome:'Ana Silva',telefone:'11999999999',email:'ana@example.test',data_criacao:'2026-11-12T10:00:00Z',total:100};
test('campaign audience deduplicates phones, requires explicit consent and excludes converted carts',()=>{
 const c=context(),client={id:1,nome:'Ana',telefone:'5511999999999',email:'ana@example.test'};
 const pref=[{phone:'+5511999999999',status:'granted'}];
 const old=[{cliente_email:'ana@example.test',status:'pago',data:'2026-11-01'}];
 assert.equal(c.audienceRows([client],[cart],old,pref,[],'all').length,1);
 assert.equal(c.audienceRows([client],[cart],old,[],[],'carts')[0].eligible,false);
 assert.equal(c.audienceRows([client],[cart],old,[{phone:pref[0].phone,status:'blocked'}],[],'all')[0].reason,'Não receber');
 assert.equal(c.audienceRows([client],[cart],old,pref,[{phone:pref[0].phone}],'all')[0].eligible,false);
 const fresh=[{cliente_email:'ana@example.test',status:'pago',data:'2026-11-12'}];
 assert.equal(c.audienceRows([client],[cart],fresh,pref,[],'carts').length,0);
 assert.equal(c.audienceRows([client],[cart],fresh,pref,[],'buyers').length,1);
});
test('cancelled orders do not recover carts; name-only matches never suppress another customer',()=>{
 const c=context();assert.equal(c.cartConverted(cart,[{cliente_email:cart.email,status:'cancelado',data:'2026-11-13'}]),false);
 assert.equal(c.cartConverted(cart,[{cliente_nome:cart.nome,cliente_email:'other@example.test',status:'pago',data:'2026-11-13'}]),false);
 assert.equal(c.cartConverted({...cart,recuperado:true},[]),true);
});
test('only text models with the supported first-name variable can be sent',()=>{
 const c=context(),t={components:[{type:'BODY',text:'Olá {{1}}, novidade na loja!'}]};
 assert.equal(c.supportedTemplate(t),true);assert.equal(c.templateText(t,'Ana Silva'),'Olá Ana, novidade na loja!');
 assert.equal(c.supportedTemplate({components:[{type:'BODY',text:'Olá {{2}}'}]}),false);
 assert.equal(c.supportedTemplate({components:[...t.components,{type:'HEADER',format:'IMAGE'}]}),false);
 assert.equal(c.supportedTemplate({components:[]}),false);
});
test('webhook signatures cover the exact body and reject stale, malformed and forged requests',async()=>{
 const c=context(),now=Date.now(),t=String(Math.floor(now/1000)),raw=new TextEncoder().encode('{"id":"evt-1","type":"whatsapp.message.updated"}'),secret='test-only-secret';
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const input=new TextEncoder().encode(t+'.'+new TextDecoder().decode(raw));
 const hex=Buffer.from(await crypto.subtle.sign('HMAC',key,input)).toString('hex');
 assert.equal(await c.verifyYCloud(raw,`t=${t},s=${hex}`,secret,now),true);
 assert.equal(await c.verifyYCloud(new TextEncoder().encode('{}'),`t=${t},s=${hex}`,secret,now),false);
 assert.equal(await c.verifyYCloud(raw,`t=${t},s=${hex}`,secret,now+400000),false);
 assert.equal(await c.verifyYCloud(raw,`t=${t},t=${t},s=${hex}`,secret,now),false);
 assert.equal(await c.verifyYCloud(raw,'sha256='+hex,secret,now),false);
});
test('campaign totals separate provider acceptance from delivery, replies and uncertain results',()=>{
 assert.deepEqual(ui.totals([{status:'pending'},{status:'accepted'},{status:'delivered',replied_at:'now'},{status:'unknown'},{status:'failed'},{status:'skipped'}]),{total:6,pending:1,accepted:2,delivered:1,replied:1,failed:2});
 assert.equal(ui.preview('Olá {{1}}!','Ana Silva'),'Olá Ana!');assert.equal(ui.filterRows([{name:'João',phone:'+5511999999999'}],'joao').length,1);
});
test('backend validates the login before campaign actions and never accepts a browser API credential',()=>{
 assert.ok(source.indexOf('db.auth.getUser(token)')<source.indexOf("b.action==='send'"));
 assert.match(source,/Deno.env.get\('YCLOUD_API_KEY'\)/);assert.doesNotMatch(source,/b\.api_key|b\.apiKey/);
 assert.match(source,/t.status!=='APPROVED'/);assert.match(source,/crm_wa_claim/);assert.match(source,/status:'unknown'/);
 new vm.Script(stripTypeScriptTypes(source.replace(/^import[^\n]*\n/,'')));
});
test('signature reconciliation only trusts the fixed active endpoint belonging to this ERP',async()=>{
 const code=source.slice(source.indexOf('async function signingSecret'),source.indexOf('async function templates'));
 for(const good of [true,false]){
  let calls=0;const c=vm.createContext({URL_BASE:'https://erp.example.test',WEBHOOK_ID:'fixed-endpoint',webhookCache:null,Date,yc:async path=>{calls++;assert.equal(path,'/webhookEndpoints/fixed-endpoint');return {url:good?'https://erp.example.test/functions/v1/crm-whatsapp/webhook':'https://another.example.test/webhook',status:'active',secret:'whsec_test_only_01234567890123456789'};}});
  vm.runInContext(stripTypeScriptTypes(code),c);
  if(good){assert.match(await c.signingSecret(),/^whsec_/);await c.signingSecret();assert.equal(calls,1);}else await assert.rejects(c.signingSecret());
 }
});
