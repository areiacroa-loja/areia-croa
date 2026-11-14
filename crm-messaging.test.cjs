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
 assert.equal(c.supportedTemplate({components:[...t.components,{type:'HEADER',format:'IMAGE'}]}),true);assert.equal(c.supportedTemplate({components:[...t.components,{type:'HEADER',format:'VIDEO'}]}),false);
 assert.equal(c.supportedTemplate({components:[]}),false);
});
test('purchase association uses the last sent campaign, seven days and paid phone matches only',()=>{
 const c=context(),phone='+5511999999999',sent={phone,campaign_id:'old',status:'delivered',attempt_at:'2026-11-10T13:00:00Z'};
 const newer={...sent,campaign_id:'new',attempt_at:'2026-11-11T13:00:00Z'};
 const order={id:1,cliente_telefone:'11999999999',status:'pago',data:'2026-11-12',receita:120};
 assert.equal(c.campaignPurchases([sent,newer],[order])[0].campaign_id,'new');
 assert.equal(c.campaignPurchases([sent],[{...order,data:'2026-11-10'}]).length,0);
 assert.equal(c.campaignPurchases([sent],[{...order,data:'2026-11-19'}]).length,0);
 assert.equal(c.campaignPurchases([sent],[{...order,status:'cancelado'}]).length,0);
 assert.equal(c.campaignPurchases([{...sent,status:'accepted'}],[order]).length,0);
 assert.equal(c.campaignPurchases([sent],[{...order,cliente_telefone:'21988888888'}]).length,0);
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
function senderHarness({uncertain=false,approved=true,media=false}={}){
 const campaign={id:'11111111-1111-4111-8111-111111111111',owner_id:'owner',segment:'all',template_name:'novidades',language:'pt_BR',template_body:'Olá {{1}}, novidades na loja!'};
 if(media)campaign.image_url='https://erp.example.test/storage/v1/object/public/crm-campaign-media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png';
 const message={id:'22222222-2222-4222-8222-222222222222',campaign_id:campaign.id,phone:'+5511999999999',name:'Ana Silva',source_kind:'client',source_id:'1',status:'pending'};
 const tables={crm_wa_campaigns:[campaign],crm_wa_messages:[message],crm_wa_preferences:[{phone:message.phone,status:'granted'}],clientes:[{id:1,nome:'Ana Silva',telefone:'11999999999',created_at:'2026-01-01'}],carrinhos_abandonados:[],pedidos:[]};
 const sent=[];let handler;
 const db={auth:{getUser:async token=>({data:{user:token==='valid-user'?{id:'owner'}:null},error:null})},from(table){
  let mode='select',patch,filters=[],single=false,max=Infinity,head=false;
  const q={select(_cols,options){head=!!options?.head;return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,vs){filters.push(r=>vs.includes(r[k]));return q},gte(k,v){filters.push(r=>r[k]>=v);return q},lt(k,v){filters.push(r=>r[k]<v);return q},order(){return q},range(){return q},limit(v){max=v;return q},maybeSingle(){single=true;return q},update(v){mode='update';patch=v;return q},then(resolve,reject){try{const rows=tables[table].filter(r=>filters.every(f=>f(r))).slice(0,max);if(mode==='update')rows.forEach(r=>Object.assign(r,patch));return Promise.resolve({data:head?null:single?rows[0]||null:structuredClone(rows),error:null,count:rows.length}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;
 },rpc:async(_name,{p_id})=>{const m=tables.crm_wa_messages.find(m=>m.id===p_id);if(m.status!=='pending')return {data:false};m.status='sending';m.attempt_at=new Date().toISOString();return {data:true};}};
 const env={SUPABASE_URL:'https://erp.example.test',SUPABASE_SERVICE_ROLE_KEY:'unit-service-only',YCLOUD_API_KEY:'unit-api-only',YCLOUD_WHATSAPP_FROM:'+557588075117'};
 const c=vm.createContext({createClient:()=>db,Deno:{env:{get:k=>env[k]},serve:h=>{handler=h}},Response,Request,URL,AbortSignal,TextEncoder,TextDecoder,crypto,atob,console,fetch:async(url,options)=>{
  if(url.includes('/webhookEndpoints/'))return Response.json({url:env.SUPABASE_URL+'/functions/v1/crm-whatsapp/webhook',status:'active',secret:'whsec_unit_test_only_0123456789'});
  if(url.includes('/whatsapp/templates/'))return Response.json({name:'novidades',language:'pt_BR',status:approved?'APPROVED':'PENDING',components:[...(media?[{type:'HEADER',format:'IMAGE'}]:[]),{type:'BODY',text:campaign.template_body}]});
  if(options.method==='POST'&&url.endsWith('/whatsapp/messages')){sent.push(JSON.parse(options.body));if(uncertain)throw Error('connection interrupted after submission');return Response.json({id:'provider-unit-1'});}
  throw Error('Unexpected URL '+url);
 }});
 vm.runInContext(stripTypeScriptTypes(source.replace(/^import[^\n]*\n/,'')),c);
 return {sent,message,request:handler,invoke:async(token='valid-user',confirm=true)=>{const r=await handler(new Request('https://erp.example.test/functions/v1/crm-whatsapp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'send',id:campaign.id,confirm})}));return {status:r.status,body:await r.json()};}};
}
test('authenticated sending personalizes the official template once; repeating the request does not duplicate it',async()=>{
 const h=senderHarness();assert.equal((await h.invoke()).status,200);assert.equal(h.message.status,'accepted');
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].to,'+5511999999999');assert.equal(h.sent[0].template.components[0].parameters[0].text,'Ana');
 await h.invoke();assert.equal(h.sent.length,1);
});
test('missing login, missing confirmation and unapproved marketing templates never send',async()=>{
 const h=senderHarness();assert.equal((await h.invoke('invalid-user')).status,401);assert.equal((await h.invoke('valid-user',false)).status,400);assert.equal(h.sent.length,0);
 const pending=senderHarness({approved:false});assert.equal((await pending.invoke()).status,400);assert.equal(pending.sent.length,0);
});
test('an uncertain provider response is recorded for review and is never automatically resent',async()=>{
 const h=senderHarness({uncertain:true});await h.invoke();assert.equal(h.message.status,'unknown');await h.invoke();assert.equal(h.sent.length,1);
});

test('CRM preflight supports both store domains and rejects unrelated origins',async()=>{
 const h=senderHarness();
 for(const origin of ['https://areia-croa.vercel.app','https://financeiro.areiacroa.com.br']){
  const r=await h.request(new Request('https://erp.example.test/functions/v1/crm-whatsapp',{method:'OPTIONS',headers:{Origin:origin}}));
  assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
 }
 const r=await h.request(new Request('https://erp.example.test/functions/v1/crm-whatsapp',{method:'OPTIONS',headers:{Origin:'https://foreign.example'}}));
 assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
});

test('image campaigns send the saved photo in the official header with the personalized body',async()=>{
 const h=senderHarness({media:true});const out=await h.invoke();assert.equal(out.status,200);assert.equal(h.sent.length,1);
 const parts=h.sent[0].template.components;assert.equal(parts[0].type,'header');assert.equal(parts[0].parameters[0].type,'image');assert.match(parts[0].parameters[0].image.link,/crm-campaign-media/);assert.equal(parts[1].parameters[0].text,'Ana');
});
test('artwork validation rejects external URLs, oversized files and forged MIME signatures',()=>{
 const begin=source.indexOf('function validImageUrl'),end=source.indexOf('const WEBHOOK_SECRET');
 const c=vm.createContext({URL_BASE:'https://erp.example.test',MEDIA_BUCKET:'crm-campaign-media',URL,atob,Uint8Array});vm.runInContext(stripTypeScriptTypes(source.slice(begin,end)),c);
 const path='/storage/v1/object/public/crm-campaign-media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png';
 assert.equal(c.validImageUrl('https://erp.example.test'+path),true);assert.equal(c.validImageUrl('https://foreign.example'+path),false);assert.equal(c.validImageUrl('https://erp.example.test'+path+'?token=private'),false);assert.equal(c.validImageUrl('https://erp.example.test/storage/v1/object/public/crm-campaign-media/../../private/a.png'),false);
 assert.throws(()=>c.imageBytes(Buffer.from('<script>bad</script>').toString('base64'),'image/png'));assert.throws(()=>c.imageBytes('A'.repeat(6990512),'image/jpeg'));assert.throws(()=>c.imageBytes('YWJj','image/svg+xml'));
});
