begin;
create schema if not exists ac_fee_backup;
revoke all on schema ac_fee_backup from public;
create table if not exists ac_fee_backup.snapshots (key text primary key, saved_at timestamptz default now(), value jsonb not null);
alter table ac_fee_backup.snapshots enable row level security;
insert into ac_fee_backup.snapshots(key,value)
select 'fees-v108-before',jsonb_build_object('pedidos',(select jsonb_agg(to_jsonb(p)) from public.pedidos p),'vendas',(select jsonb_agg(to_jsonb(v)) from public.vendas v),'recalcular',pg_get_functiondef('public.ac_recalcular_pedido_v94(bigint)'::regprocedure))
on conflict(key) do nothing;
alter table public.pedidos
 add column if not exists pagamento_metodo text,
 add column if not exists parcelas integer not null default 1,
 add column if not exists juros_parcelamento numeric(12,2) not null default 0,
 add column if not exists taxa_gateway numeric(12,2),
 add column if not exists taxa_yampi numeric(12,2) not null default 0,
 add column if not exists checkout_yampi boolean not null default false,
 add column if not exists taxas_origem text not null default 'legado',
 add column if not exists liquido_gateway numeric(12,2),
 add column if not exists pago_em timestamptz,
 add column if not exists gateway_pedido_id text,
 add column if not exists taxas_revisao text;
create or replace function public.ac_taxas_pedido_v108() returns trigger language plpgsql as $$
begin
 if new.taxas_origem='estimado' then
  new.taxa_gateway=case when new.receita<=0 then 0 when new.pagamento_metodo='pix' then round(new.receita*0.01+0.99,2) when new.pagamento_metodo='credit_card' then round(new.receita*0.0499+0.99,2) else null end;
 end if;
 if new.taxas_origem<>'legado' then
  new.taxa_yampi=case when new.checkout_yampi then round(new.receita*0.025,2) else 0 end;
  new.taxas=coalesce(new.taxa_gateway,0)+coalesce(new.juros_parcelamento,0)+new.taxa_yampi;
  new.liquido_gateway=case when new.taxa_gateway is null then null else new.receita-new.juros_parcelamento-new.taxa_gateway end;
 end if;
 new.custo_total=coalesce(new.custo_produtos,0)+coalesce(new.frete,0)+coalesce(new.custo_embalagens,0)+coalesce(new.taxas,0)+coalesce(new.anuncio,0)+case when new.tem_brinde then coalesce(new.custo_brinde,0) else 0 end;
 new.lucro=coalesce(new.receita,0)-new.custo_total;
 return new;
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='trg_ac_taxas_pedido_v108' and tgrelid='public.pedidos'::regclass) then
  create trigger trg_ac_taxas_pedido_v108 before insert or update on public.pedidos for each row execute function public.ac_taxas_pedido_v108();
 end if;
end $$;
-- Retain the proven freight/product rollup; canonical fees belong to the header.
do $$ declare def text; begin
 select pg_get_functiondef('public.ac_recalcular_pedido_v94(bigint)'::regprocedure) into def;
 if position('taxas=coalesce(x.taxas,p.taxas,0)' in def)>0 then
  def=replace(def,'taxas=coalesce(x.taxas,p.taxas,0)','taxas=case when p.taxas_origem=''legado'' then coalesce(x.taxas,p.taxas,0) else p.taxas end');
  execute def;
 elsif position('p.taxas_origem' in def)=0 then
  raise exception 'Unexpected recalculation function; migration aborted';
 end if;
end $$;
-- Only confirmed webhook orders automatically get checkout commission.
update public.pedidos set checkout_yampi=true,taxas_origem='pendente',taxas_revisao='Meio de pagamento e juros ainda não conciliados'
where taxas_origem='legado' and origem_dados ilike '%yampi%' and status='pago' and coalesce(taxas,0)=0;
notify pgrst,'reload schema';
commit;
