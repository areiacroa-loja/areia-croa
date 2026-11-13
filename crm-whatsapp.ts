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
 const extra=(t.components||[]).some((c:any)=>c.type!=='BODY'&&c.type!=='FOOTER');
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

const URL_BASE=Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(URL_BASE,SERVICE_KEY,{auth:{persistSession:false}});
const WABA=Deno.env.get('YCLOUD_WABA_ID')||'1861122401153826';
const FROM=Deno.env.get('YCLOUD_WHATSAPP_FROM')||'';
const API_KEY=Deno.env.get('YCLOUD_API_KEY')||'';
const WEBHOOK_SECRET=Deno.env.get('YCLOUD_WEBHOOK_SECRET')||'';
const cors={'Access-Control-Allow-Origin':'https://areia-croa.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
function result(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});}
function checked(r:any){if(r.error)throw Error('Não foi possível salvar ou consultar o CRM.');return r.data;}
async function allRows(table:string,columns='*'){
 const out:any[]=[];for(let start=0;;start+=500){const rows=checked(await db.from(table).select(columns).order('id').range(start,start+499))||[];out.push(...rows);if(rows.length<500)return out;}
}
async function yc(path:string,method='GET',body?:any){
 if(!API_KEY)throw Error('Conexão do WhatsApp ainda não configurada.');
 const response=await fetch('https://api.ycloud.com/v2'+path,{method,headers:{'X-API-Key':API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 const payload=await response.json().catch(()=>null);
 if(!response.ok){const e:any=Error('YCloud recusou a solicitação ('+response.status+').');e.httpStatus=response.status;throw e;}
 return payload;
}
async function templates(){
 const out:any[]=[];for(let page=1;page<=50;page++){
  const p=await yc('/whatsapp/templates?filter.wabaId='+WABA+'&limit=100&page='+page);
  const rows=p.items||[];out.push(...rows);if(rows.length<100)return out.map(t=>({...t,supported:supportedTemplate(t)}));
 }throw Error('Muitos modelos. Refine a conta no provedor.');
}
async function template(name:string,language:string){
 if(!/^[a-z0-9_]{1,512}$/.test(name||'')||!/^\w{2,10}$/.test(language||''))throw Error('Modelo inválido.');
 const t=await yc('/whatsapp/templates/'+WABA+'/'+encodeURIComponent(name)+'/'+encodeURIComponent(language));
 if(!supportedTemplate(t))throw Error('Este modelo usa mídia ou variáveis ainda não suportadas. Use texto com o primeiro nome em {{1}}.');
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
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return result({error:'Método não permitido'},405);
 try {
  if(new URL(req.url).pathname.endsWith('/webhook')){
   const raw=new Uint8Array(await req.arrayBuffer());if(raw.length>1048576)return result({error:'Payload grande demais'},413);
   if(!await verifyYCloud(raw,req.headers.get('YCloud-Signature')||'',WEBHOOK_SECRET))return result({error:'Assinatura inválida'},401);
   const e=JSON.parse(new TextDecoder().decode(raw));if(typeof e.id!=='string'||typeof e.type!=='string')return result({error:'Evento inválido'},400);
   const m=e.whatsappMessage,i=e.whatsappInboundMessage;
   if((m&&m.wabaId&&m.wabaId!==WABA)||(m&&m.from&&waPhone(m.from)!==waPhone(FROM))||(i&&i.to&&waPhone(i.to)!==waPhone(FROM)))return result({ignored:true});
   checked(await db.rpc('crm_wa_accept_event',{e}));return result({ok:true});
  }
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  const {data:{user},error}=await db.auth.getUser(token);if(error||!user)return result({error:'Entre no ERP para continuar.'},401);
  const b=await req.json();
  if(b.action==='status'){
   const [ts,phones]=await Promise.all([templates(),yc('/whatsapp/phoneNumbers?limit=100')]);
   const sender=(phones.items||[]).find((p:any)=>waPhone(p.phoneNumber)===waPhone(FROM));
   return result({configured:!!API_KEY,from:FROM,webhook_ready:!!WEBHOOK_SECRET,sender_status:sender?.status||'Consultar no provedor',templates:ts});
  }
  if(b.action==='audience')return result({rows:await getAudience(b.segment||'carts')});
  if(b.action==='history')return result(await history(user.id));
  if(b.action==='create_template'){
   const name=String(b.name||'').trim(),body=String(b.body||'').trim();
   if(!/^[a-z][a-z0-9_]{2,119}$/.test(name)||body.length<15||body.length>1024)throw Error('Informe um nome válido e uma mensagem de 15 a 1024 caracteres.');
   if([...body.matchAll(/\{\{([^}]+)\}\}/g)].some(m=>m[1]!=='1'))throw Error('Use apenas {{1}} para o primeiro nome.');
   const component:any={type:'BODY',text:body};
   if(body.includes('{{1}}'))component.example={body_text:[['Ana']]};
   const created=await yc('/whatsapp/templates','POST',{wabaId:WABA,name,language:'pt_BR',category:'MARKETING',components:[component]});
   return result({name:created.name,status:created.status});
  }
  if(b.action==='preference'){
   if(!['granted','blocked'].includes(b.status)||typeof b.evidence!=='string'||b.evidence.trim().length<3)throw Error('Informe onde e quando o contato autorizou as mensagens.');
   const phone=waPhone(b.phone);if(!(await getAudience('all')).some(r=>r.phone===phone))throw Error('Contato não encontrado no CRM.');
   checked(await db.from('crm_wa_preferences').upsert({phone,status:b.status,evidence:b.evidence.trim().slice(0,1000),updated_at:new Date().toISOString(),updated_by:user.id}));return result({ok:true});
  }
  if(b.action==='prepare'){
   if(!/^[a-f0-9-]{36}$/i.test(b.id||'')||!Array.isArray(b.selected)||!b.selected.length||b.selected.length>250)throw Error('Selecione de 1 a 250 contatos.');
   const existing=checked(await db.from('crm_wa_campaigns').select('id').eq('id',b.id).eq('owner_id',user.id).maybeSingle());if(existing)return result({id:existing.id});
   const t=await template(b.template_name,b.language),aud=await getAudience(b.segment),wanted=new Set(b.selected);
   const selected=aud.filter(r=>wanted.has(r.phone)&&r.eligible);
   if(selected.length!==wanted.size)throw Error('O público mudou ou contém contatos sem autorização. Atualize a lista antes de preparar.');
   const title=String(b.title||'').trim().slice(0,120);if(!title)throw Error('Dê um nome à campanha.');
   checked(await db.rpc('crm_wa_prepare',{p_id:b.id,p_owner:user.id,p_title:title,p_segment:b.segment,p_name:t.name,p_language:t.language,p_body:(t.components||[]).find((c:any)=>c.type==='BODY').text,
    p_recipients:selected.map(r=>({phone:r.phone,name:r.name,source_kind:r.source_kind,source_id:r.source_id}))}));
   return result({id:b.id,count:selected.length,template_status:t.status});
  }
  if(b.action==='send'){
   if(b.confirm!==true)throw Error('Revise e confirme o disparo.');
   if(!WEBHOOK_SECRET)throw Error('O retorno de mensagens ainda não foi configurado.');
   const c=await ownerCampaign(b.id,user.id),t=await template(c.template_name,c.language);
   if(t.status!=='APPROVED')throw Error('A Meta ainda não aprovou este modelo.');
   if((t.components||[]).find((x:any)=>x.type==='BODY')?.text!==c.template_body)throw Error('O modelo mudou. Prepare uma nova campanha para revisar o texto.');
   const pending=checked(await db.from('crm_wa_messages').select('*').eq('campaign_id',c.id).eq('status','pending').order('id').limit(3))||[];
   const audience=await getAudience(c.segment);let attempted=0;
   for(const m of pending){
    const match=audience.find(a=>a.phone===m.phone&&a.eligible&&a.source_kind===m.source_kind&&a.source_id===m.source_id);
    if(!match){checked(await db.from('crm_wa_messages').update({status:'skipped',error:'Contato saiu do público, já comprou ou está bloqueado.'}).eq('id',m.id).eq('status','pending'));continue;}
    if(!checked(await db.rpc('crm_wa_claim',{p_id:m.id})))continue;
    attempted++;
    const hasVariable=/\{\{1\}\}/.test(c.template_body);
    let sent:any;
    try {
     sent=await yc('/whatsapp/messages','POST',{from:FROM,to:m.phone,type:'template',externalId:m.id,
      template:{name:c.template_name,language:{code:c.language},...(hasVariable?{components:[{type:'body',parameters:[{type:'text',text:String(match.name).trim().split(/\s+/)[0]||'cliente'}]}]}:{})}});
    }catch(e:any){
     const state=e.httpStatus&&e.httpStatus<500?'failed':'unknown';
     checked(await db.from('crm_wa_messages').update({status:state,error:state==='unknown'?'Resposta de envio incerta. Confira no provedor; não haverá reenvio automático.':e.message}).eq('id',m.id).eq('status','sending'));continue;
    }
    if(!sent?.id){checked(await db.from('crm_wa_messages').update({status:'unknown',error:'O provedor não retornou um identificador. Confira antes de reenviar.'}).eq('id',m.id).eq('status','sending'));continue;}
    checked(await db.from('crm_wa_messages').update({provider_id:sent.id}).eq('id',m.id));
    checked(await db.from('crm_wa_messages').update({status:'accepted'}).eq('id',m.id).eq('status','sending'));
   }
   const remaining=await db.from('crm_wa_messages').select('id',{count:'exact',head:true}).eq('campaign_id',c.id).eq('status','pending');checked(remaining);
   return result({attempted,remaining:remaining.count||0});
  }
  return result({error:'Ação desconhecida'},400);
 }catch(e:any){return result({error:e.message||'Não foi possível concluir esta operação.'},400);}
});
