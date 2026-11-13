begin;
alter table public.pedidos
  add column if not exists yampi_order_id text,
  add column if not exists meta_campaign_id text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text;

-- Existing webhook notes contain the original values; never overwrite a stored UTM.
update public.pedidos set
  yampi_order_id=coalesce(yampi_order_id,substring(observacoes from 'Yampi order_id=([0-9]+)')),
  utm_source=coalesce(utm_source,nullif(trim(substring(observacoes from 'source=([^|·]+)')),'')),
  utm_medium=coalesce(utm_medium,nullif(trim(substring(observacoes from 'medium=([^|·]+)')),'')),
  utm_campaign=coalesce(utm_campaign,nullif(trim(substring(observacoes from 'campaign=([^|·]+)')),'')),
  utm_content=coalesce(utm_content,nullif(trim(substring(observacoes from 'content=([^|·]+)')),'')),
  utm_term=coalesce(utm_term,nullif(trim(substring(observacoes from 'term=([^|·]+)')),''))
where lower(coalesce(origem_dados,'')) like '%yampi%';

-- Exact known IDs are paid campaigns even when the originating medium is social.
update public.pedidos p set meta_campaign_id=c.campaign_id,via_trafego=true
from public.meta_campaign_classification c
where p.utm_campaign=c.campaign_id and lower(coalesce(p.origem_dados,'')) like '%yampi%';
update public.vendas v set via_trafego=true
from public.pedidos p where v.pedido_id=p.id and p.meta_campaign_id is not null;

-- Preserve campaigns explicitly marked as sales. Everything else is branding.
update public.meta_campaign_classification
set tipo='branding',updated_at=now() where tipo is distinct from 'vendas';

-- Replay only a definitive latest cancellation already verified by the webhook.
-- Both the order reference and Yampi ID must identify the existing paid order.
with latest as (
  select distinct on (resource_id) resource_id,reference,received_at,status,metadata
  from public.yampi_webhook_events where event like 'order.%'
  order by resource_id,received_at desc,event_key desc
)
update public.pedidos p set status='cancelado',
  observacoes=concat_ws(' · ',p.observacoes,'Cancelamento Yampi confirmado; evento recebido em '||e.received_at::text)
from latest e
where p.referencia=e.reference and p.yampi_order_id=e.resource_id and p.status='pago'
  and lower(coalesce(p.origem_dados,'')) like '%yampi%'
  and e.status='ignored_order_not_paid' and e.metadata->>'order_status_alias'='cancelled';
commit;
