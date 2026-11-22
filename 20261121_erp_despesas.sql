-- Named financial outflows; inventory purchases are cash outflows, not a second COGS charge.
create table if not exists public.erp_despesas (
 id uuid primary key default gen_random_uuid(),
 nome text not null check(length(trim(nome)) between 1 and 160),
 categoria text not null check(categoria in ('estoque','embalagem','site','frete','marketing','servicos','retirada','outros')),
 data date not null,
 valor numeric(14,2) not null check(valor>0),
 status text not null default 'pago' check(status in ('pago','pendente','cancelado')),
 afeta_lucro boolean not null default false,
 observacoes text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.erp_despesas enable row level security;
grant select,insert,update on public.erp_despesas to authenticated;
revoke all on public.erp_despesas from anon;
drop policy if exists erp_despesas_authenticated on public.erp_despesas;
create policy erp_despesas_authenticated on public.erp_despesas for all to authenticated using(true) with check(true);
create index if not exists erp_despesas_data_idx on public.erp_despesas(data desc);
