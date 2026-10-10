begin;
alter table public.clientes add column if not exists data_entrada_yampi date;
alter table public.clientes add column if not exists yampi_customer_id text;
comment on column public.clientes.data_entrada_yampi is 'Original customer creation date reported by Yampi; independent of CRM import date.';
with source as (
  select metadata->>'cliente_id' as cliente_id,
    min(substring(event_key from '[0-9]{4}-[0-9]{2}-[0-9]{2}'))::date as entry_date,
    min(resource_id) as customer_id
  from public.yampi_webhook_events
  where event='customer.created'
    and metadata->>'cliente_id' is not null
    and substring(event_key from '[0-9]{4}-[0-9]{2}-[0-9]{2}') is not null
  group by metadata->>'cliente_id'
)
update public.clientes c set
  data_entrada_yampi=case when c.data_entrada_yampi is null or s.entry_date<c.data_entrada_yampi then s.entry_date else c.data_entrada_yampi end,
  yampi_customer_id=coalesce(c.yampi_customer_id,s.customer_id)
from source s where c.id::text=s.cliente_id;
notify pgrst,'reload schema';
commit;
