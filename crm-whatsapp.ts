import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function waPhone(value: any) {
 let p=String(value||'').replace(/\D/g,'');
 if(p.length===10||p.length===11)p='55'+p;
 return /^[1-9][0-9]{9,14}$/.test(p)?'+'+p:'';
}
function waEmail(v: any){return String(v||'').trim().toLowerCase();}
function paidOrder(o: any){return ['pago','paid','approved','delivered','shipped'].includes(String(o.status||'').toLowerCase());}
function sameContact(a: any,o: any){
 const p=waPhone(a.telefone),e=waEmail(a.email);
 return Boolean((p&&p===waPhone(o.cliente_telefone))||(e&&e===waEmail(o.cliente_email))||(a.id&&String(a.id)===String(o.cliente_id)&&a.kind==='client'));
}
function cartConverted(c: any,orders: any[]){
 const when=Date.parse(c.data_criacao||'');
 return !!(c.recuperado||c.ignorado)||orders.some(o=>paidOrder(o)&&sameContact(c,o)&&(!Number.isFinite(when)||String(o.data||'').slice(0,10)>=String(c.data_criacao).slice(0,10)));
}
function supportedTemplate(t: any){
 const body=(t.components||[]).find((c:any)=>c.type==='BODY')?.text||'';
 const variables=[...body.matchAll(/\{\{([^}]+)\}\}/g)].map((m:any)=>m[1]);
 const extra=(t.components||[]).some((c:any)=>!['BODY','FOOTER'].includes(c.type)&&!(c.type==='HEADER'&&c.format==='IMAGE'));
 return !!body&&!extra&&variables.every((v:string)=>v==='1');
}
function templateText(t: any,name: string){return String((t.components||[]).find((c:any)=>c.type==='BODY')?.text||'').replace(/\{\{1\}\}/g,String(name||'').trim().split(/\s+/)[0]||'cliente');}
function audienceRows(clients:any[],carts:any[],orders:any[],preferences:any[],recent:any[],segment:string){
 const prefs=new Map(preferences.map(p=>[p.phone,p]));
 const sources:any[]=[];
 if(segment!=='buyers') carts.slice().sort((a,b)=>String(b.data_criacao).localeCompare(String(a.data_criacao))).forEach(c=>{
  if(!cartConverted(c,orders))sources.push({...c,source_kind:'cart',source_id:String(c.id),name:c.nome||'Cliente',kind:'cart'});
 });
 if(segment!=='carts')clients.forEach(c=>{
  const bought=orders.some(o=>paidOrder(o)&&sameContact({...c,kind:'client'},o));
  if(segment==='all'||bought)sources.push({...c,source_kind:'client',source_id:String(c.id),name:c.nome||'Cliente',kind:'client',bought});
 });
 const seen=new Set();return sources.flatMap(s=>{
  const phone=waPhone(s.telefone);if(!phone||seen.has(phone))return [];seen.add(phone);
  const pref:any=prefs.get(phone);const busy=recent.some(m=>m.phone===phone);
  const reason=pref?.status==='blocked'?'Não receber':pref?.status!=='granted'?'Autorização pendente':busy?'Acionado nas últimas 24h':'';
  return [{phone,name:s.name,email:s.email||'',source_kind:s.source_kind,source_id:s.source_id,
   total:Number(s.total||0),date:s.data_criacao||s.created_at||'',eligible:!reason,reason,consent:pref?.status||'pending'}];
 });
}
async function verifyYCloud(raw:Uint8Array,header:string,secret:string,now=Date.now()){
 if(!secret||!header)return false;
 const fields=header.split(',').map(s=>s.trim().split('=')),ts=fields.filter(([k])=>k==='t'),sig=fields.filter(([k])=>k==='s');
 if(ts.length!==1||!/^\d{1,12}$/.test(ts[0][1])||Math.abs(now/1000-Number(ts[0][1]))>300)return false;
 const prefix=new TextEncoder().encode(ts[0][1]+'.'),bytes=new Uint8Array(prefix.length+raw.length);bytes.set(prefix);bytes.set(raw,prefix.length);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes));
 return sig.some(([,hex])=>{if(!/^[0-9a-fA-F]{64}$/.test(hex||''))return false;let diff=0;for(let i=0;i<32;i++)diff|=expected[i]^parseInt(hex.slice(i*2,i*2+2),16);return diff===0;});
}

// A purchase after a message is an association, never proof of causation.
// Date-only orders are matched only on a later day: same-day ordering is unknown.
function campaignPurchases(messages:any[],orders:any[]){
 const touches=messages.filter(m=>['sent','delivered','read'].includes(m.status)&&m.attempt_at&&waPhone(m.phone));
 return orders.filter(paidOrder).flatMap(o=>{
  const phone=waPhone(o.cliente_telefone),raw=String(o.data||'');if(!phone||!raw)return [];
  const dayOnly=/^\d{4}-\d{2}-\d{2}$/.test(raw),when=Date.parse(dayOnly?raw+'T23:59:59-03:00':raw);if(!Number.isFinite(when))return [];
  const candidates=touches.filter(m=>{const sent=Date.parse(m.attempt_at);const day=new Date(sent-3*3600000).toISOString().slice(0,10);return m.phone===phone&&when>=sent&&when-sent<=7*86400000&&(!dayOnly||raw>day);}).sort((a,b)=>Date.parse(b.attempt_at)-Date.parse(a.attempt_at));
  if(!candidates.length)return [];const m=candidates[0];
  return [{order_id:o.id,reference:o.referencia||o.id,name:o.cliente_nome||m.name,phone,date:o.data,revenue:Number(o.receita||0),campaign_id:m.campaign_id,campaign_title:m.crm_wa_campaigns?.title||'',attempt_at:m.attempt_at}];
 });
}
const URL_BASE=Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(URL_BASE,SERVICE_KEY,{auth:{persistSession:false}});
const WABA=Deno.env.get('YCLOUD_WABA_ID')||'1861122401153826';
const FROM=Deno.env.get('YCLOUD_WHATSAPP_FROM')||'';
const API_KEY=Deno.env.get('YCLOUD_API_KEY')||'';
const MEDIA_BUCKET='crm-campaign-media';
function validImageUrl(value:any){try{const url=new URL(value);return url.origin===URL_BASE&&!url.search&&!url.hash&&/^\/storage\/v1\/object\/public\/crm-campaign-media\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg)$/.test(url.pathname);}catch{return false;}}
function imageHeader(t:any){return (t.components||[]).some((c:any)=>c.type==='HEADER'&&c.format==='IMAGE');}
function imageBytes(base64:any,mime:any){
 if(!['image/png','image/jpeg'].includes(mime)||typeof base64!=='string'||base64.length>6990510||!base64||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('Escolha uma imagem PNG ou JPG de até 5 MB.');
 let bytes;try{bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}catch{throw Error('Arquivo de imagem inválido.');}
 if(!bytes.length||bytes.length>5242880)throw Error('A imagem deve ter até 5 MB.');
 const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if((mime==='image/png'&&!png)||(mime==='image/jpeg'&&!jpg))throw Error('O conteúdo do arquivo não corresponde a uma imagem PNG ou JPG.');return bytes;
}
const WEBHOOK_SECRET=(Deno.env.get('YCLOUD_WEBHOOK_SECRET')||'').trim();
const WEBHOOK_ID=Deno.env.get('YCLOUD_WEBHOOK_ID')||'6af79e06a9e8a64e618a7918';
let webhookCache:{secret:string,time:number}|null=null;
const ORIGINS=new Set(['https://areia-croa.vercel.app','https://financeiro.areiacroa.com.br']);
function corsFor(origin:string){return {...(ORIGINS.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};}
function result(data:any,status=200,origin=''){return new Response(JSON.stringify(data),{status,headers:{...corsFor(origin),'Content-Type':'application/json'}});}
function checked(r:any){if(r.error)throw Error('Não foi possível salvar ou consultar o CRM.');return r.data;}
async function allRows(table:string,columns='*'){
 const out:any[]=[];for(let start=0;;start+=500){const rows=checked(await db.from(table).select(columns).order('id').range(start,start+499))||[];out.push(...rows);if(rows.length<500)return out;}
}
async function yc(path:string,method='GET',body?:any){
 if(!API_KEY)throw Error('Conexão do WhatsApp ainda não configurada.');
 const response=await fetch('https://api.ycloud.com/v2'+path,{method,headers:{'X-API-Key':API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 const payload=await response.json().catch(()=>null);
 if(!response.ok){const detail=String(payload?.error?.whatsappApiError?.error_user_msg||payload?.error?.message||'').split(API_KEY).join('[credencial]').slice(0,500);const e:any=Error('YCloud ('+response.status+'): '+(detail||'Não foi possível concluir a solicitação.'));e.httpStatus=response.status;throw e;}
 return payload;
}
async function signingSecret(){
 if(webhookCache&&Date.now()-webhookCache.time<300000)return webhookCache.secret;
 // The authenticated provider API is authoritative for this endpoint. Never
 // return this value to the browser or accept a request-supplied endpoint ID.
 const endpoint=await yc('/webhookEndpoints/'+WEBHOOK_ID);
 if(endpoint.url!==URL_BASE+'/functions/v1/crm-whatsapp/webhook'||endpoint.status!=='active'||typeof endpoint.secret!=='string'||endpoint.secret.length<20)throw Error('Retorno do WhatsApp ainda não está ativo para este ERP.');
 webhookCache={secret:endpoint.secret,time:Date.now()};return endpoint.secret;
}
async function templates(){
 const media=checked(await db.from('crm_wa_template_media').select('template_name,language,image_url').eq('waba_id',WABA))||[];
 const out:any[]=[];for(let page=1;page<=50;page++){
  const p=await yc('/whatsapp/templates?filter.wabaId='+WABA+'&limit=100&page='+page);
  const rows=p.items||[];out.push(...rows);if(rows.length<100)return out.map(t=>({...t,supported:supportedTemplate(t),image_url:media.find((m:any)=>m.template_name===t.name&&m.language===t.language)?.image_url||''}));
 }throw Error('Muitos modelos. Refine a conta no provedor.');
}
async function template(name:string,language:string){
 if(!/^[a-z0-9_]{1,512}$/.test(name||'')||!/^\w{2,10}$/.test(language||''))throw Error('Modelo inválido.');
 const t=await yc('/whatsapp/templates/'+WABA+'/'+encodeURIComponent(name)+'/'+encodeURIComponent(language));
 if(!supportedTemplate(t))throw Error('Use um modelo de texto ou imagem PNG/JPG, com o primeiro nome em {{1}}. Vídeos e botões ainda não estão disponíveis.');
 return t;
}
async function getAudience(segment:string){
 if(!['carts','buyers','all'].includes(segment))throw Error('Público inválido.');
 const [clients,carts,orders,prefs,recents]=await Promise.all([
  allRows('clientes','id,nome,email,telefone,created_at'),allRows('carrinhos_abandonados','id,nome,email,telefone,data_criacao,total,recuperado,ignorado'),
  allRows('pedidos','id,cliente_email,cliente_telefone,data,status'),db.from('crm_wa_preferences').select('*').then(checked),
  db.from('crm_wa_messages').select('phone').gte('attempt_at',new Date(Date.now()-86400000).toISOString()).in('status',['sending','unknown','accepted','sent','delivered','read']).then(checked)
 ]);
 return audienceRows(clients,carts,orders,prefs||[],recents||[],segment);
}
async function ownerCampaign(id:string,uid:string){
 const row=checked(await db.from('crm_wa_campaigns').select('*').eq('id',id).eq('owner_id',uid).maybeSingle());
 if(!row)throw Error('Campanha não encontrada.');return row;
}
async function history(uid:string){
 // A crash or an uncertain HTTP response must not silently allow a resend.
 checked(await db.from('crm_wa_messages').update({status:'unknown',error:'Envio interrompido. Confira no provedor antes de tentar novamente.'}).eq('status','sending').lt('attempt_at',new Date(Date.now()-900000).toISOString()));
 const campaigns=checked(await db.from('crm_wa_campaigns').select('*,crm_wa_messages(*)').eq('owner_id',uid).order('created_at',{ascending:false}).limit(40));
 const inbox=checked(await db.from('crm_wa_inbox').select('*').order('received_at',{ascending:false}).limit(50));
 return {campaigns,inbox};
}
async function analytics(uid:string){
 const messages:any[]=[];
 for(let start=0;;start+=500){const rows=checked(await db.from('crm_wa_messages').select('*,crm_wa_campaigns!inner(title,owner_id)').eq('crm_wa_campaigns.owner_id',uid).order('id').range(start,start+499))||[];messages.push(...rows);if(rows.length<500)break;}
 const orders=messages.some(m=>['sent','delivered','read'].includes(m.status))?await allRows('pedidos','id,referencia,cliente_nome,cliente_telefone,data,status,receita'):[];
 return {messages,purchases:campaignPurchases(messages,orders)};
}
Deno.serve(async req=>{
 const origin=req.headers.get('Origin')||'';
 const reply=(data:any,status=200)=>result(data,status,origin);
 if(origin&&!ORIGINS.has(origin))return reply({error:'Domínio não autorizado.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsFor(origin)});
 if(req.method!=='POST')return reply({error:'Método não permitido'},405);
 try {
  if(new URL(req.url).pathname.endsWith('/webhook')){
   const raw=new Uint8Array(await req.arrayBuffer());if(raw.length>1048576)return reply({error:'Payload grande demais'},413);
   const signature=req.headers.get('YCloud-Signature')||'';
   // Prefer a cached authoritative secret; support the configured secret on a
   // cold start, then reconcile through the provider if it does not match.
   let verified=await verifyYCloud(raw,signature,webhookCache?.secret||WEBHOOK_SECRET);
   if(!verified)verified=await verifyYCloud(raw,signature,await signingSecret());
   if(!verified)return reply({error:'Assinatura inválida'},401);
   const e=JSON.parse(new TextDecoder().decode(raw));if(typeof e.id!=='string'||typeof e.type!=='string')return reply({error:'Evento inválido'},400);
   const m=e.whatsappMessage,i=e.whatsappInboundMessage;
   if((m&&m.wabaId&&m.wabaId!==WABA)||(m&&m.from&&waPhone(m.from)!==waPhone(FROM))||(i&&i.to&&waPhone(i.to)!==waPhone(FROM)))return reply({ignored:true});
   checked(await db.rpc('crm_wa_accept_event',{e}));return reply({ok:true});
  }
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  const {data:{user},error}=await db.auth.getUser(token);if(error||!user)return reply({error:'Entre no ERP para continuar.'},401);
  const b=await req.json();
  if(b.action==='status'){
   const [ts,phones,webhookReady]=await Promise.all([templates(),yc('/whatsapp/phoneNumbers?limit=100'),signingSecret().then(()=>true).catch(()=>false)]);
   const sender=(phones.items||[]).find((p:any)=>waPhone(p.phoneNumber)===waPhone(FROM));
   return reply({configured:!!API_KEY,from:FROM,webhook_ready:webhookReady,sender_status:sender?.status||'Consultar no provedor',templates:ts});
  }
  if(b.action==='audience')return reply({rows:await getAudience(b.segment||'carts')});
  if(b.action==='history')return reply(await history(user.id));
  if(b.action==='analytics')return reply(await analytics(user.id));
  if(b.action==='upload_image'){
   const bytes=imageBytes(b.base64,b.mime),path=user.id+'/'+crypto.randomUUID()+(b.mime==='image/png'?'.png':'.jpg');
   checked(await db.storage.from(MEDIA_BUCKET).upload(path,bytes,{contentType:b.mime,upsert:false}));
   return reply({url:URL_BASE+'/storage/v1/object/public/'+MEDIA_BUCKET+'/'+path});
  }
  if(b.action==='create_template'){
   let name=String(b.name||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,110);
   if(name&&!/^[a-z]/.test(name))name='campanha_'+name;
   const body=String(b.body||'').replace(/\r\n/g,'\n').replace(/\\(?=\r?$)/gm,'').replace(/https\\:\/\//g,'https://').trim();
   if(!/^[a-z][a-z0-9_]{2,119}$/.test(name)||body.length<15||body.length>1024)throw Error('Informe um nome válido e uma mensagem de 15 a 1024 caracteres.');
   if([...body.matchAll(/\{\{([^}]+)\}\}/g)].some(m=>m[1]!=='1'))throw Error('Use apenas {{1}} para o primeiro nome.');
   const component:any={type:'BODY',text:body};
   if(body.includes('{{1}}'))component.example={body_text:[['Ana']]};
   if(b.image_url&&!validImageUrl(b.image_url))throw Error('Envie a foto pelo campo de imagem antes de cadastrar o modelo.');
   const components=b.image_url?[{type:'HEADER',format:'IMAGE',example:{header_url:[b.image_url]}},component]:[component];
   const created=await yc('/whatsapp/templates','POST',{wabaId:WABA,name,language:'pt_BR',category:'MARKETING',components});
   if(b.image_url)checked(await db.from('crm_wa_template_media').upsert({waba_id:WABA,template_name:name,language:'pt_BR',image_url:b.image_url,created_by:user.id}));
   return reply({name:created.name,status:created.status});
  }
  if(b.action==='preference'){
   if(!['granted','blocked'].includes(b.status)||typeof b.evidence!=='string'||b.evidence.trim().length<3)throw Error('Informe onde e quando o contato autorizou as mensagens.');
   const phone=waPhone(b.phone);if(!(await getAudience('all')).some(r=>r.phone===phone))throw Error('Contato não encontrado no CRM.');
   checked(await db.from('crm_wa_preferences').upsert({phone,status:b.status,evidence:b.evidence.trim().slice(0,1000),updated_at:new Date().toISOString(),updated_by:user.id}));return reply({ok:true});
  }
  if(b.action==='prepare'){
   if(!/^[a-f0-9-]{36}$/i.test(b.id||'')||!Array.isArray(b.selected)||!b.selected.length||b.selected.length>250)throw Error('Selecione de 1 a 250 contatos.');
   const existing=checked(await db.from('crm_wa_campaigns').select('id').eq('id',b.id).eq('owner_id',user.id).maybeSingle());if(existing)return reply({id:existing.id});
   const t=await template(b.template_name,b.language),aud=await getAudience(b.segment),wanted=new Set(b.selected);
   const image=imageHeader(t)?b.image_url:null;if(imageHeader(t)&&!validImageUrl(image))throw Error('Escolha a foto que será enviada com este modelo.');
   const selected=aud.filter(r=>wanted.has(r.phone)&&r.eligible);
   if(selected.length!==wanted.size)throw Error('O público mudou ou contém contatos sem autorização. Atualize a lista antes de preparar.');
   const title=String(b.title||'').trim().slice(0,120);if(!title)throw Error('Dê um nome à campanha.');
   checked(await db.rpc('crm_wa_prepare_media',{p_id:b.id,p_owner:user.id,p_title:title,p_segment:b.segment,p_name:t.name,p_language:t.language,p_body:(t.components||[]).find((c:any)=>c.type==='BODY').text,p_image:image,
    p_recipients:selected.map(r=>({phone:r.phone,name:r.name,source_kind:r.source_kind,source_id:r.source_id}))}));
   return reply({id:b.id,count:selected.length,template_status:t.status});
  }
  if(b.action==='send'){
   if(b.confirm!==true)throw Error('Revise e confirme o disparo.');
   await signingSecret();
   const c=await ownerCampaign(b.id,user.id),t=await template(c.template_name,c.language);
   if(t.status!=='APPROVED')throw Error('A Meta ainda não aprovou este modelo.');
   if(imageHeader(t)&&!validImageUrl(c.image_url))throw Error('Esta campanha não tem uma foto válida. Prepare uma nova campanha com imagem.');
   if((t.components||[]).find((x:any)=>x.type==='BODY')?.text!==c.template_body)throw Error('O modelo mudou. Prepare uma nova campanha para revisar o texto.');
   const pending=checked(await db.from('crm_wa_messages').select('*').eq('campaign_id',c.id).eq('status','pending').order('id').limit(3))||[];
   const audience=await getAudience(c.segment);let attempted=0;
   for(const m of pending){
    const match=audience.find(a=>a.phone===m.phone&&a.eligible&&a.source_kind===m.source_kind&&a.source_id===m.source_id);
    if(!match){checked(await db.from('crm_wa_messages').update({status:'skipped',error:'Contato saiu do público, já comprou ou está bloqueado.'}).eq('id',m.id).eq('status','pending'));continue;}
    if(!checked(await db.rpc('crm_wa_claim',{p_id:m.id})))continue;
    attempted++;
    const hasVariable=/\{\{1\}\}/.test(c.template_body);
    const components:any[]=[];
    if(imageHeader(t))components.push({type:'header',parameters:[{type:'image',image:{link:c.image_url}}]});
    if(hasVariable)components.push({type:'body',parameters:[{type:'text',text:String(match.name).trim().split(/\s+/)[0]||'cliente'}]});
    let sent:any;
    try {
     sent=await yc('/whatsapp/messages','POST',{from:FROM,to:m.phone,type:'template',externalId:m.id,
      template:{name:c.template_name,language:{code:c.language},...(components.length?{components}:{})}});
    }catch(e:any){
     const state=e.httpStatus&&e.httpStatus<500?'failed':'unknown';
     checked(await db.from('crm_wa_messages').update({status:state,error:state==='unknown'?'Resposta de envio incerta. Confira no provedor; não haverá reenvio automático.':e.message}).eq('id',m.id).eq('status','sending'));continue;
    }
    if(!sent?.id){checked(await db.from('crm_wa_messages').update({status:'unknown',error:'O provedor não retornou um identificador. Confira antes de reenviar.'}).eq('id',m.id).eq('status','sending'));continue;}
    checked(await db.from('crm_wa_messages').update({provider_id:sent.id}).eq('id',m.id));
    checked(await db.from('crm_wa_messages').update({status:'accepted'}).eq('id',m.id).eq('status','sending'));
   }
   const remaining=await db.from('crm_wa_messages').select('id',{count:'exact',head:true}).eq('campaign_id',c.id).eq('status','pending');checked(remaining);
   return reply({attempted,remaining:remaining.count||0});
  }
  return reply({error:'Ação desconhecida'},400);
 }catch(e:any){return reply({error:e.message||'Não foi possível concluir esta operação.'},400);}
});
