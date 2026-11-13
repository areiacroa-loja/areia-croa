begin;
alter table public.pedidos
  add column if not exists yampi_order_id text,
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

-- Preserve campaigns explicitly marked as sales. Everything else is branding.
update public.meta_campaign_classification
set tipo='branding',updated_at=now() where tipo is distinct from 'vendas';
commit;
