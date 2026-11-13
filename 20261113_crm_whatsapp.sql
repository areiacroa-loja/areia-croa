begin;
create table if not exists public.crm_wa_preferences (
 phone text primary key check(phone ~ '^\+[1-9][0-9]{9,14}$'),
 status text not null check(status in ('granted','blocked')),
 evidence text not null check(length(trim(evidence))>=3),
 updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.crm_wa_campaigns (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 title text not null, segment text not null check(segment in ('carts','buyers','all')),
 template_name text not null, language text not null, template_body text not null,
 created_at timestamptz not null default now()
);
create table if not exists public.crm_wa_messages (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.crm_wa_campaigns(id),
 phone text not null, name text not null, source_kind text not null, source_id text not null,
 status text not null default 'pending' check(status in ('pending','sending','accepted','sent','delivered','read','failed','unknown','skipped')),
 provider_id text unique, error text, attempt_at timestamptz, replied_at timestamptz,
 last_event_at timestamptz, price numeric, currency text,
 created_at timestamptz not null default now(), unique(campaign_id,phone)
);
create index if not exists crm_wa_messages_phone_attempt on public.crm_wa_messages(phone,attempt_at desc);
create table if not exists public.crm_wa_inbox (
 provider_id text primary key, phone text not null, body text not null,
 received_at timestamptz not null default now()
);
create table if not exists public.crm_wa_events (
 event_id text primary key, event_type text not null, received_at timestamptz not null default now()
);
-- The existing ERP is a single-store workspace shared by its authenticated users.
-- Only the authenticated function can write campaign/message/inbox records.
alter table public.crm_wa_preferences enable row level security;
alter table public.crm_wa_campaigns enable row level security;
alter table public.crm_wa_messages enable row level security;
alter table public.crm_wa_inbox enable row level security;
alter table public.crm_wa_events enable row level security;
revoke all on public.crm_wa_preferences,public.crm_wa_campaigns,public.crm_wa_messages,public.crm_wa_inbox,public.crm_wa_events from anon,authenticated;
grant select on public.crm_wa_preferences,public.crm_wa_campaigns,public.crm_wa_messages,public.crm_wa_inbox to authenticated;
grant all on public.crm_wa_preferences,public.crm_wa_campaigns,public.crm_wa_messages,public.crm_wa_inbox,public.crm_wa_events to service_role;
drop policy if exists crm_wa_pref_read on public.crm_wa_preferences;
create policy crm_wa_pref_read on public.crm_wa_preferences for select to authenticated using(true);
drop policy if exists crm_wa_campaign_read on public.crm_wa_campaigns;
create policy crm_wa_campaign_read on public.crm_wa_campaigns for select to authenticated using(owner_id=auth.uid());
drop policy if exists crm_wa_message_read on public.crm_wa_messages;
create policy crm_wa_message_read on public.crm_wa_messages for select to authenticated using(exists(select 1 from public.crm_wa_campaigns c where c.id=campaign_id and c.owner_id=auth.uid()));
drop policy if exists crm_wa_inbox_read on public.crm_wa_inbox;
create policy crm_wa_inbox_read on public.crm_wa_inbox for select to authenticated using(true);

create or replace function public.crm_wa_prepare(p_id uuid,p_owner uuid,p_title text,p_segment text,p_name text,p_language text,p_body text,p_recipients jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.crm_wa_campaigns where id=p_id and owner_id<>p_owner) then raise exception 'Campaign owner mismatch'; end if;
 if exists(select 1 from public.crm_wa_campaigns where id=p_id) then return p_id; end if;
 insert into public.crm_wa_campaigns(id,owner_id,title,segment,template_name,language,template_body)
 values(p_id,p_owner,p_title,p_segment,p_name,p_language,p_body);
 insert into public.crm_wa_messages(campaign_id,phone,name,source_kind,source_id)
 select p_id,x.phone,x.name,x.source_kind,x.source_id
 from jsonb_to_recordset(p_recipients) x(phone text,name text,source_kind text,source_id text)
 on conflict(campaign_id,phone) do nothing;
 return p_id;
end $$;
revoke all on function public.crm_wa_prepare(uuid,uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_wa_prepare(uuid,uuid,text,text,text,text,text,jsonb) to service_role;

create or replace function public.crm_wa_claim(p_id uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare m public.crm_wa_messages;
begin
 select * into m from public.crm_wa_messages where id=p_id;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(m.phone,0));
 select * into m from public.crm_wa_messages where id=p_id for update;
 if m.status<>'pending' then return false; end if;
 if not exists(select 1 from public.crm_wa_preferences p where p.phone=m.phone and p.status='granted') then
  update public.crm_wa_messages set status='skipped',error='Sem autorização de contato' where id=p_id; return false;
 end if;
 if exists(select 1 from public.crm_wa_messages x where x.phone=m.phone and x.id<>p_id
   and x.attempt_at>now()-interval '24 hours' and x.status in ('sending','unknown','accepted','sent','delivered','read')) then
  update public.crm_wa_messages set status='skipped',error='Contato já acionado nas últimas 24 horas' where id=p_id; return false;
 end if;
 update public.crm_wa_messages set status='sending',attempt_at=now() where id=p_id;
 return true;
end $$;
revoke all on function public.crm_wa_claim(uuid) from public,anon,authenticated;
grant execute on function public.crm_wa_claim(uuid) to service_role;

-- A single transaction accepts the event and applies its effects. Failed writes
-- roll back the event marker too, so a provider retry is never silently lost.
create or replace function public.crm_wa_accept_event(e jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare inserted_id text; m jsonb; p text; txt text; stamp timestamptz; external_id uuid; newstatus text;
begin
 insert into public.crm_wa_events(event_id,event_type) values(e->>'id',e->>'type')
 on conflict do nothing returning event_id into inserted_id;
 if inserted_id is null then return; end if;
 stamp:=coalesce((e->>'createTime')::timestamptz,now());
 if e->>'type'='whatsapp.message.updated' then
  m:=e->'whatsappMessage'; newstatus:=m->>'status';
  if coalesce(m->>'externalId','') ~ '^[a-fA-F0-9-]{36}$' then external_id:=(m->>'externalId')::uuid; end if;
  if newstatus in ('accepted','sent','delivered','read','failed') then
   update public.crm_wa_messages set
    provider_id=coalesce(provider_id,m->>'id'),status=newstatus,
    last_event_at=stamp,error=case when newstatus='failed' then left(coalesce(m->'error'->>'message','Falha informada pelo WhatsApp'),400) else null end,
    price=coalesce(nullif(m->>'totalPrice','')::numeric,price),currency=coalesce(m->>'currency',currency)
   where (provider_id=m->>'id' or id=external_id)
    and (last_event_at is null or stamp>=last_event_at)
    and not(status='read' and newstatus<>'read')
    and not(status='delivered' and newstatus not in ('delivered','read'));
  end if;
 elsif e->>'type'='whatsapp.inbound_message.received' then
  m:=e->'whatsappInboundMessage';
  p:='+'||regexp_replace(coalesce(m->>'from',''),'[^0-9]','','g');
  txt:=coalesce(m->'text'->>'body',m->'button'->>'text',m->'interactive'->'button_reply'->>'title','[Mensagem de mídia]');
  if p ~ '^\+[1-9][0-9]{9,14}$' and m->>'id' is not null then
   insert into public.crm_wa_inbox(provider_id,phone,body,received_at) values(m->>'id',p,left(txt,4000),stamp) on conflict do nothing;
   update public.crm_wa_messages set replied_at=greatest(coalesce(replied_at,stamp),stamp) where phone=p and attempt_at<=stamp;
   if lower(trim(txt)) ~ '^(sair|stop|parar|cancelar|remover|não quero receber.*|nao quero receber.*)$' then
    insert into public.crm_wa_preferences(phone,status,evidence,updated_at) values(p,'blocked','Saída solicitada pelo WhatsApp',stamp)
    on conflict(phone) do update set status='blocked',evidence=excluded.evidence,updated_at=greatest(crm_wa_preferences.updated_at,excluded.updated_at);
   end if;
  end if;
 elsif e->>'type'='contact.unsubscribe.created' then
  p:='+'||regexp_replace(coalesce(e->'unsubscriberChanged'->>'phoneNumber',''),'[^0-9]','','g');
  if p ~ '^\+[1-9][0-9]{9,14}$' then
   insert into public.crm_wa_preferences(phone,status,evidence,updated_at) values(p,'blocked','Saída registrada pela YCloud',stamp)
   on conflict(phone) do update set status='blocked',evidence=excluded.evidence,updated_at=greatest(crm_wa_preferences.updated_at,excluded.updated_at);
  end if;
 end if;
end $$;
revoke all on function public.crm_wa_accept_event(jsonb) from public,anon,authenticated;
grant execute on function public.crm_wa_accept_event(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
