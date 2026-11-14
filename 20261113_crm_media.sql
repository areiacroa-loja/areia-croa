-- Campaign artwork only. Private customer files must not use this bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('crm-campaign-media','crm-campaign-media',true,5242880,array['image/png','image/jpeg'])
on conflict(id) do nothing;

alter table public.crm_wa_campaigns add column if not exists image_url text;
create table if not exists public.crm_wa_template_media (
 waba_id text not null,
 template_name text not null,
 language text not null,
 image_url text not null,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 primary key(waba_id,template_name,language)
);
alter table public.crm_wa_template_media enable row level security;
revoke all on public.crm_wa_template_media from anon,authenticated;
grant select on public.crm_wa_template_media to authenticated;
grant all on public.crm_wa_template_media to service_role;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='crm_wa_template_media' and policyname='Staff can read campaign artwork') then
  create policy "Staff can read campaign artwork" on public.crm_wa_template_media for select to authenticated using (true);
 end if;
end $$;
-- No client upload/update policy: authenticated Edge Function validates every file.
create or replace function public.crm_wa_prepare_media(p_id uuid,p_owner uuid,p_title text,p_segment text,p_name text,p_language text,p_body text,p_recipients jsonb,p_image text) returns uuid
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.crm_wa_campaigns where id=p_id and owner_id<>p_owner) then raise exception 'Campaign owner mismatch'; end if;
 if exists(select 1 from public.crm_wa_campaigns where id=p_id) then return p_id; end if;
 insert into public.crm_wa_campaigns(id,owner_id,title,segment,template_name,language,template_body,image_url)
 values(p_id,p_owner,p_title,p_segment,p_name,p_language,p_body,p_image);
 insert into public.crm_wa_messages(campaign_id,phone,name,source_kind,source_id)
 select p_id,x.phone,x.name,x.source_kind,x.source_id
 from jsonb_to_recordset(p_recipients) x(phone text,name text,source_kind text,source_id text)
 on conflict(campaign_id,phone) do nothing;
 return p_id;
end $$;
revoke all on function public.crm_wa_prepare_media(uuid,uuid,text,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crm_wa_prepare_media(uuid,uuid,text,text,text,text,text,jsonb,text) to service_role;
