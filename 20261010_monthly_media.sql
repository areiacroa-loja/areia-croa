-- Monthly media closing; no existing business rows are changed.
begin;
create table if not exists public.investimento_fechamentos_mensais (
  mes text primary key check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'aberto' check (status in ('aberto','fechado')),
  sessoes bigint not null default 0 check (sessoes >= 0),
  observacoes text,
  snapshot jsonb,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.investimento_fechamentos_mensais enable row level security;
-- Same authenticated CRM audience as investimento_aportes; anonymous access denied.
revoke all on public.investimento_fechamentos_mensais from anon;
grant select, insert, update on public.investimento_fechamentos_mensais to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
    and tablename='investimento_fechamentos_mensais' and policyname='crm_monthly_media') then
    create policy crm_monthly_media on public.investimento_fechamentos_mensais
      for all to authenticated using (true) with check (true);
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
