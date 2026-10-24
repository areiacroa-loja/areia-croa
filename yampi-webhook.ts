import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YAMPI_WEBHOOK_SECRET = Deno.env.get("YAMPI_WEBHOOK_SECRET") || "";
const PACKAGING_COST = 5; // V10.7: embalagem padrão definida pela operação

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function money(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function digits(v: unknown) {
  return String(v ?? "").replace(/\D/g, "");
}

function cleanPhone(v: unknown) {
  const d = digits(v);
  if (!d) return null;
  if (d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function normName(v: unknown) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(unico|único|p|m|g|gg|pp)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemTitle(item: any) {
  return (
    item?.sku?.data?.title ||
    item?.product?.data?.name ||
    item?.name ||
    item?.item_sku ||
    `Produto Yampi ${item?.product_id ?? ""}`
  );
}

function matchProduct(item: any, products: any[]) {
  const skuObj = item?.sku?.data || item?.sku || {};
  const skuId = Number(
    skuObj?.id ??
    item?.sku_id ??
    item?.item_sku_id ??
    0
  ) || 0;
  const productId = Number(
    item?.product?.data?.id ??
    item?.product_id ??
    skuObj?.product_id ??
    0
  ) || 0;
  const code = String(
    skuObj?.sku ??
    item?.item_sku ??
    item?.sku_code ??
    ""
  ).trim().toLowerCase();

  if (skuId) {
    const bySkuId = products.find((p) => Number(p?.yampi_sku_id || 0) === skuId);
    if (bySkuId) return bySkuId;
  }

  if (code) {
    const byCode = products.find(
      (p) => String(p?.sku || "").trim().toLowerCase() === code
    );
    if (byCode) return byCode;
  }

  if (productId) {
    const sameProduct = products.filter(
      (p) => Number(p?.yampi_product_id || 0) === productId && p?.ativo !== false
    );
    if (sameProduct.length === 1) return sameProduct[0];
  }

  // Compatibilidade para histórico antigo ainda sem vínculo Yampi.
  const target = normName(itemTitle(item));
  if (!target) return null;
  const exact = products.find((p) => normName(p.nome) === target);
  if (exact) return exact;

  const candidates = products
    .map((p) => ({ p, n: normName(p.nome) }))
    .filter((x) => x.n.length >= 5 && (target.includes(x.n) || x.n.includes(target)))
    .sort((a, b) => Math.abs(a.n.length - target.length) - Math.abs(b.n.length - target.length));
  return candidates[0]?.p || null;
}

function isPaidTraffic(r: any) {
  const source = String(r?.utm_source || "").toLowerCase();
  const medium = String(r?.utm_medium || "").toLowerCase();
  const campaign = String(r?.utm_campaign || "").toLowerCase();
  const blob = `${source} ${medium} ${campaign}`;
  if (/\b(organic|direct|referral)\b/.test(medium)) return false;
  return /\b(cpc|ppc|paid|paid_social|ads?|meta|facebook|instagram|google)\b/.test(blob);
}

function dateOnly(v: any) {
  const s = typeof v === "string" ? v : v?.date;
  const m = String(s || "").match(/\d{4}-\d{2}-\d{2}/);
  return m?.[0] || new Date().toISOString().slice(0, 10);
}

function base64(bytes: ArrayBuffer) {
  let binary = "";
  const u8 = new Uint8Array(bytes);
  for (const b of u8) binary += String.fromCharCode(b);
  return btoa(binary);
}

function safeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function verifyYampi(rawBody: string, signature: string | null) {
  if (!YAMPI_WEBHOOK_SECRET) return null; // modo de configuração: não processa vendas
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(YAMPI_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return safeEqual(base64(signed), signature);
}

// Keep the original business date without changing the CRM registration timestamp.
function yampiContactDate(value: any): string | null {
  const raw = typeof value === "string" ? value : value?.date;
  const match = String(raw || "").match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const date = new Date(match[1] + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

async function findOrCreateClient(
  customer: any,
  shipping: any,
  desiredTag: "cliente" | "carrinho_abandonado" | null = "cliente",
  sourceNote = "Yampi",
  platformCreated: string | null = null,
) {
  const rawName = String(
    customer?.name ||
    customer?.generic_name ||
    shipping?.receiver ||
    customer?.first_name ||
    ""
  ).trim();
  const name = rawName || "Cliente Yampi";
  const email = String(customer?.email || "").trim().toLowerCase() || null;
  const phone = cleanPhone(customer?.phone?.full_number || customer?.phone || customer?.phone_number || "");
  const city = [shipping?.city, shipping?.state || shipping?.uf].filter(Boolean).join(", ") || null;
  const customerId = customer?.id != null ? String(customer.id) : null;
  const customerCreated = yampiContactDate(customer?.created_at) || platformCreated;

  // Sem nome, e-mail ou telefone não há uma pessoa identificável para colocar no CRM.
  if (!rawName && !email && !phone) return null;

  const { data: existingRows, error: qErr } = await sb
    .from("clientes")
    .select("id,nome,telefone,email,cidade,observacoes,tag,data_entrada_yampi,yampi_customer_id")
    .limit(10000);
  if (qErr) throw qErr;

  const existing = (customerId && (existingRows || []).find((c: any) => String(c.yampi_customer_id || "") === customerId)) || (existingRows || []).find((c: any) => {
    const samePhone = phone && cleanPhone(c.telefone) === phone;
    const sameEmail = email && String(c.email || "").trim().toLowerCase() === email;
    return Boolean(samePhone || sameEmail);
  });

  if (existing) {
    const patch: Record<string, any> = {};
    if (customerId && !existing.yampi_customer_id) patch.yampi_customer_id = customerId;
    if (customerCreated && (!existing.data_entrada_yampi || customerCreated < existing.data_entrada_yampi)) patch.data_entrada_yampi = customerCreated;
    if ((!existing.nome || existing.nome === "Cliente Yampi") && name) patch.nome = name;
    if (!existing.telefone && phone) patch.telefone = phone;
    if (!existing.email && email) patch.email = email;
    if (!existing.cidade && city) patch.cidade = city;

    // Compra aprovada sempre promove o lead para Cliente.
    // Eventos de lead nunca rebaixam quem já comprou.
    if (desiredTag === "cliente") {
      if (existing.tag !== "cliente") patch.tag = "cliente";
    } else if (desiredTag === "carrinho_abandonado" && (!existing.tag || existing.tag === "carrinho_abandonado")) {
      patch.tag = "carrinho_abandonado";
    }

    const oldObs = String(existing.observacoes || "").trim();
    if (sourceNote && !oldObs.toLowerCase().includes(sourceNote.toLowerCase())) {
      patch.observacoes = oldObs ? `${oldObs} · ${sourceNote}` : sourceNote;
    }

    if (Object.keys(patch).length) {
      const { error } = await sb.from("clientes").update(patch).eq("id", existing.id);
      if (error) throw error;
    }
    return existing.id;
  }

  const { data, error } = await sb
    .from("clientes")
    .insert({
      nome: name || email || phone || "Cliente Yampi",
      telefone: phone,
      email,
      cidade: city,
      observacoes: sourceNote || "Importado automaticamente da Yampi",
      tag: desiredTag,
      data_entrada_yampi: customerCreated,
      yampi_customer_id: customerId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function firstCustomerAddress(customer: any) {
  return (
    customer?.addresses?.data?.[0] ||
    customer?.address?.data ||
    customer?.address ||
    null
  );
}

function customerFromResource(r: any) {
  const nested = r?.customer?.data || r?.customer || {};
  const tracking = r?.tracking_data || {};
  return {
    ...nested,
    name: nested?.name || nested?.generic_name || tracking?.name || null,
    generic_name: nested?.generic_name || nested?.name || tracking?.name || null,
    email: nested?.email || tracking?.email || null,
    phone: nested?.phone || tracking?.phone || null,
  };
}

function cartItemsFromResource(r: any) {
  const nested = r?.items?.data;
  const raw = Array.isArray(nested)
    ? nested
    : nested && typeof nested === 'object'
      ? [nested]
      : Array.isArray(r?.items)
        ? r.items
        : [];
  return raw.map((item: any) => {
    const skuObj = item?.sku?.data || item?.sku || {};
    const sku = String(
      skuObj?.sku ??
      item?.item_sku ??
      item?.sku_code ??
      ""
    ).trim() || null;
    const yampiSkuId = Number(
      skuObj?.id ??
      item?.sku_id ??
      item?.item_sku_id ??
      0
    ) || null;
    return {
      nome: itemTitle(item),
      sku,
      yampi_sku_id: yampiSkuId,
      quantidade: Math.max(1, Number(item?.quantity || 1)),
      preco: money(item?.price ?? item?.price_sale ?? item?.value ?? 0),
    };
  });
}

function cartAddressText(a: any) {
  if (!a) return null;
  if (a?.full_address) return String(a.full_address);
  const parts = [
    a?.street,
    a?.number,
    a?.complement,
    a?.neighborhood,
    a?.city,
    a?.state || a?.uf,
    a?.zipcode || a?.zip_code,
  ].filter((x) => x !== null && x !== undefined && String(x).trim() !== '');
  return parts.length ? parts.join(', ') : null;
}

async function upsertAbandonedCartFromResource(r: any, source = 'Yampi cart.reminder') {
  const customer = customerFromResource(r);
  const address =
    r?.address?.data ||
    r?.address ||
    r?.shipping_address?.data ||
    r?.shipping_address ||
    firstCustomerAddress(customer) ||
    {};
  const idExternal = String(r?.id ?? r?.token ?? '').trim();
  if (!idExternal) throw new Error('Carrinho Yampi sem id/token');

  const products = cartItemsFromResource(r);
  const total = money(r?.totalizers?.total ?? r?.value_total ?? r?.total ?? 0);
  const shipment = money(r?.totalizers?.shipment ?? r?.shipment_cost ?? 0);
  const createdRaw = r?.created_at?.date || r?.created_at || r?.updated_at?.date || r?.updated_at || new Date().toISOString();
  const state = String(address?.state || address?.uf || '').trim().toUpperCase() || null;
  const city = String(address?.city || '').trim() || null;
  const name = String(customer?.name || customer?.generic_name || address?.receiver || '').trim() || null;
  const email = String(customer?.email || r?.tracking_data?.email || '').trim().toLowerCase() || null;
  const phone = cleanPhone(customer?.phone?.full_number || customer?.phone || r?.tracking_data?.phone || '');

  const row = {
    id_externo: idExternal,
    data_criacao: createdRaw,
    tipo_abandono: 'Carrinho abandonado',
    total,
    frete: shipment,
    canal: 'Yampi',
    nome: name,
    email,
    telefone: phone,
    endereco: cartAddressText(address),
    cidade: city,
    estado: state,
    produtos: products,
    quantidade_itens: products.reduce((s: number, x: any) => s + Number(x.quantidade || 1), 0),
    status_pagamento: 'Pendente',
    ignorado: false,
    observacoes: source,
  };

  const { error } = await sb
    .from('carrinhos_abandonados')
    .upsert(row, { onConflict: 'id_externo' });
  if (error) throw error;
  return { id_externo: idExternal, total, itens: row.quantidade_itens };
}

async function processLeadEvent(body: any) {
  const event = String(body?.event || "");
  const r = body?.resource || {};
  const customer = event === "customer.created" ? r : customerFromResource(r);
  const shipping =
    r?.shipping_address?.data ||
    r?.shipping_address ||
    firstCustomerAddress(customer) ||
    {};

  const note =
    event === "cart.reminder"
      ? "Yampi · carrinho abandonado"
      : event === "order.created"
        ? "Yampi · pedido criado / aguardando pagamento"
        : "Yampi · cliente identificado no checkout";

  const clienteId = await findOrCreateClient(
    customer,
    shipping,
    event === "cart.reminder" ? "carrinho_abandonado" : null,
    note,
    event === "customer.created" ? yampiContactDate(r?.created_at || body?.time) : null,
  );

  let cartResult: any = null;
  if (event === "cart.reminder") {
    cartResult = await upsertAbandonedCartFromResource(r, "Yampi · cart.reminder");
  }

  const resourceId = r?.id != null ? String(r.id) : null;
  const reference =
    r?.number != null ? String(r.number) :
    r?.token != null ? String(r.token) :
    resourceId;
  const eventKey = `${event}:${resourceId || reference || "unknown"}:${body?.time || ""}`;

  await logEvent(eventKey, {
    event,
    resource_id: resourceId,
    reference,
    status: "processed_lead",
    error_message: null,
    metadata: {
      merchant: body?.merchant?.alias || null,
      cliente_id: clienteId,
      email: customer?.email || r?.tracking_data?.email || null,
      cart_total: event === "cart.reminder" ? money(r?.totalizers?.total ?? r?.value_total) : null,
      cart_id_externo: cartResult?.id_externo || null,
    },
  });

  return {
    ok: true,
    processed: true,
    kind: "lead",
    event,
    cliente_id: clienteId,
    cart: cartResult,
  };
}

function allocateRevenue(items: any[], orderTotal: number) {
  if (!items.length) return [];
  const weights = items.map((i) => Math.max(0, money(i?.price) * Math.max(1, Number(i?.quantity || 1))));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const each = Math.floor((orderTotal / items.length) * 100) / 100;
    const out = items.map(() => each);
    out[out.length - 1] = money(orderTotal - each * (items.length - 1));
    return out;
  }
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < items.length; i++) {
    if (i === items.length - 1) out.push(money(orderTotal - used));
    else {
      const part = money(orderTotal * (weights[i] / sum));
      out.push(part);
      used += part;
    }
  }
  return out;
}

async function logEvent(eventKey: string, row: Record<string, any>) {
  try {
    await sb.from("yampi_webhook_events").upsert({ event_key: eventKey, ...row }, { onConflict: "event_key" });
  } catch (_) {
    // log nunca pode impedir o recebimento da venda
  }
}


async function triggerCatalogSync(productId: number) {
  if (!productId) throw new Error("Evento de produto Yampi sem resource.id");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/yampi-catalog-sync`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ product_id: productId }),
  });

  const text = await res.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok || payload?.ok === false) {
    throw new Error(
      payload?.error ||
      payload?.message ||
      text.slice(0, 300) ||
      `Falha ao sincronizar produto ${productId}`
    );
  }
  return payload || { ok: true };
}

async function resolveProductEventId(body: any, client = sb) {
 const r=body?.resource||{};
 if(body?.event!== 'product.inventory.updated') {const id=Number(r?.id||0); if(!Number.isSafeInteger(id)||id<=0)throw new Error('Evento de produto Yampi sem resource.id valido');return id;}
 const explicitId=Number(r?.product_id||r?.product?.data?.id||r?.sku?.data?.product_id||0);
 if(Number.isSafeInteger(explicitId)&&explicitId>0)return explicitId;
 const sku=String(r?.spreadsheet?.data?.sku||r?.sku?.data?.sku||'').trim();
 if(!sku)throw new Error('Evento de estoque Yampi sem SKU para identificar o produto');
 const {data,error}=await client.from('yampi_catalog_skus').select('yampi_product_id').eq('sku',sku).limit(2);
 if(error)throw error;
 const ids=[...new Set((data||[]).map((row: any)=>Number(row.yampi_product_id)))].filter(id=>Number.isSafeInteger(id)&&id>0);
 if(ids.length!==1)throw new Error('SKU de estoque Yampi sem vinculo unico no catalogo: '+sku);
 return ids[0];
}

async function processProductEvent(body: any) {
  const event = String(body?.event || "");
  const r = body?.resource || {};
  const productId = await resolveProductEventId(body);

  if (event === "product.deleted") {
    const now = new Date().toISOString();

    const { error: p1 } = await sb
      .from("yampi_catalog")
      .update({ ativo: false, estoque: 0, estoque_total: 0, synced_at: now })
      .eq("yampi_product_id", productId);
    if (p1) throw p1;

    const { error: p2 } = await sb
      .from("yampi_catalog_skus")
      .update({ ativo: false, estoque: 0, synced_at: now })
      .eq("yampi_product_id", productId);
    if (p2) throw p2;

    const { error: p3 } = await sb
      .from("produtos")
      .update({ ativo: false, estoque: 0, yampi_synced_at: now })
      .eq("yampi_product_id", productId)
      .eq("origem_catalogo", "yampi");
    if (p3) throw p3;

    return { ok: true, processed: true, kind: "catalog", event, product_id: productId, deleted: true };
  }

  const result = await triggerCatalogSync(productId);
  return { ok: true, processed: true, kind: "catalog", event, product_id: productId, sync: result };
}


async function markRecoveredCartForPaidOrder(
  customer: any,
  reference: string,
  orderCreatedRaw: any,
) {
  try {
    const email = String(customer?.email || "").trim().toLowerCase();
    const phone = cleanPhone(customer?.phone?.full_number || customer?.phone || customer?.phone_number || "");
    if (!email && !phone) return null;

    const { data: rows, error } = await sb
      .from("carrinhos_abandonados")
      .select("id,id_externo,data_criacao,email,telefone,total,recuperado,ignorado,observacoes")
      .eq("recuperado", false)
      .eq("ignorado", false)
      .order("data_criacao", { ascending: false })
      .limit(500);
    if (error) throw error;

    const orderDate = new Date(
      orderCreatedRaw?.date ||
      orderCreatedRaw ||
      new Date().toISOString()
    );
    const orderMs = Number.isNaN(orderDate.getTime()) ? Date.now() : orderDate.getTime();
    const minMs = orderMs - 1000 * 60 * 60 * 24 * 30;
    const maxMs = orderMs + 1000 * 60 * 60 * 24;

    const matches = (rows || []).filter((c: any) => {
      const sameEmail = email && String(c?.email || "").trim().toLowerCase() === email;
      const samePhone = phone && cleanPhone(c?.telefone || "") === phone;
      if (!sameEmail && !samePhone) return false;
      const t = new Date(c?.data_criacao || 0).getTime();
      return !Number.isNaN(t) && t >= minMs && t <= maxMs;
    });

    if (!matches.length) return null;
    const cart = matches[0]; // mais recente antes/próximo da compra
    const note = `Recuperado automaticamente pelo pedido ${reference}`;
    const oldObs = String(cart?.observacoes || "").trim();
    const observacoes = oldObs.toLowerCase().includes(note.toLowerCase())
      ? oldObs
      : (oldObs ? `${oldObs} · ${note}` : note);

    const { error: upErr } = await sb
      .from("carrinhos_abandonados")
      .update({
        recuperado: true,
        recuperado_em: new Date().toISOString(),
        status_pagamento: "Pago / convertido",
        observacoes,
      })
      .eq("id", cart.id);
    if (upErr) throw upErr;

    return { id: cart.id, id_externo: cart.id_externo };
  } catch (e) {
    console.warn("Falha ao marcar carrinho recuperado", e);
    return null; // nunca bloqueia a venda por falha no carrinho
  }
}


function yampiOrderLooksPaid(r: any) {
  const status = r?.status?.data || r?.status || {};
  const alias = String(status?.alias || '').trim().toLowerCase();
  const name = String(status?.name || '').trim().toLowerCase();
  const blocked = /cancel|refund|refus|chargeback|estorn/.test(`${alias} ${name}`);
  if (blocked) return false;

  const rawTx = r?.transactions?.data ?? r?.transactions ?? [];
  const txs = Array.isArray(rawTx) ? rawTx : (rawTx && typeof rawTx === 'object' ? [rawTx] : []);
  const txPaid = txs.some((t: any) => {
    const st = String(t?.status || '').trim().toLowerCase();
    return st === 'paid' || st === 'approved' || t?.captured === true;
  });

  return (
    alias === 'paid' ||
    alias === 'approved' ||
    /pagamento aprovado|payment approved/.test(name) ||
    txPaid
  );
}

async function logIgnoredOrderEvent(body: any, reason: string) {
  const r = body?.resource || {};
  const event = String(body?.event || '');
  const eventKey = `${event}:${r?.id || 'unknown'}:${body?.time || ''}`;
  await logEvent(eventKey, {
    event,
    resource_id: r?.id ? String(r.id) : null,
    reference: r?.number ? String(r.number) : (r?.id ? String(r.id) : null),
    status: 'ignored_order_not_paid',
    error_message: null,
    metadata: {
      merchant: body?.merchant?.alias || null,
      reason,
      order_status_alias: r?.status?.data?.alias || r?.status?.alias || null,
      order_status_name: r?.status?.data?.name || r?.status?.name || null,
    },
  });
}


function paymentBreakdownV108(r: any) {
 const total=money(r.value_total ?? r.buyer_value_total);
 const raw=r?.transactions?.data ?? r?.transactions ?? [];
 const txs=(Array.isArray(raw)?raw:[raw]).filter((t:any)=>t&&(t.captured===true||['paid','approved'].includes(String(t.status||'').toLowerCase())));
 const payments=r?.payments?.data ?? r?.payments ?? [];
 const aliases=[r.payment_method,...txs.flatMap((t:any)=>[t.payment?.data?.alias,t.payment?.alias,t.payment_method,t.payment_method_type]),...(Array.isArray(payments)?payments:[]).map((p:any)=>typeof p==='string'?p:(p.alias||p.name))].filter(Boolean).map(String).join(' ').toLowerCase();
 const method=/pix/.test(aliases)?'pix':(/credit.card|credito|crédito|visa|mastercard|master_card|amex|american.express|elo|hipercard|diners|discover|aura|jcb/.test(aliases)||txs.some((t:any)=>t.payment?.data?.is_credit_card===true||t.payment?.is_credit_card===true))?'credit_card':'unknown';
 const installments=Math.max(1,...txs.map((t:any)=>Number(t.installments)||1));
 const explicit=r.value_interest ?? r.value_tax;
 const derived=r.value_products!=null&&r.value_discount!=null&&r.value_shipment!=null?money(Math.max(0,total-money(r.value_products)+money(r.value_discount)-money(r.value_shipment))):null;
 const interest=method==='pix'?0:money(explicit ?? derived ?? 0);
 const complete=method!=='unknown'&&!(method==='credit_card'&&installments>1&&explicit==null&&derived==null);
 const gateway=complete?money(total*(method==='pix'?0.01:0.0499)+0.99):null;
 return {pagamento_metodo:method,parcelas:installments,juros_parcelamento:interest,taxa_gateway:gateway,taxa_yampi:money(total*0.025),checkout_yampi:true,taxas_origem:complete?'estimado':'pendente',liquido_gateway:gateway==null?null:money(total-interest-gateway),taxas:money((gateway||0)+interest+money(total*0.025)),taxas_revisao:complete?null:'Pagamento/juros não identificados no webhook'};
}

async function processPaidOrder(body: any) {
  const r = body?.resource || {};
  if (!r?.id) throw new Error("Payload Yampi sem resource.id");

  const reference = String(r.number || r.id);
  const eventKey = `${body.event}:${r.id}:${body.time || ""}`;
  const customer = r?.customer?.data || {};
  const shipping = r?.shipping_address?.data || {};
  const items = Array.isArray(r?.items?.data) ? r.items.data : [];
  if (!items.length) throw new Error("Pedido aprovado sem itens no payload");

  const orderTotal = money(r.value_total ?? r.buyer_value_total);
  if (orderTotal <= 0) throw new Error("Pedido aprovado com value_total inválido");

  const data = dateOnly(r?.created_at || body?.time);
  const frete = money(r.value_shipment ?? r.shipment_cost);
  const estado = String(shipping?.state || "").trim().toUpperCase() || null;
  const cidade = String(shipping?.city || "").trim() || null;
  const clienteNome = String(customer?.name || customer?.generic_name || shipping?.receiver || "Cliente Yampi").trim();
  const clienteEmail = String(customer?.email || "").trim().toLowerCase() || null;
  const clienteTelefone = cleanPhone(customer?.phone?.full_number || customer?.phone || "");
  const viaTrafego = isPaidTraffic(r);
  const qtdTotal = items.reduce((s: number, i: any) => s + Math.max(1, Number(i?.quantity || 1)), 0);
  const utm = [
    r.utm_source ? `source=${r.utm_source}` : "",
    r.utm_medium ? `medium=${r.utm_medium}` : "",
    r.utm_campaign ? `campaign=${r.utm_campaign}` : "",
    r.utm_content ? `content=${r.utm_content}` : "",
  ].filter(Boolean).join(" | ");
  const obs = [`Yampi order_id=${r.id}`, utm].filter(Boolean).join(" · ");

  const clienteId = await findOrCreateClient(customer, shipping, "cliente", "Yampi · compra aprovada");
  const { data: products, error: prodErr } = await sb.from("produtos").select("id,nome,custo,preco,estoque,yampi_product_id,yampi_sku_id,sku,ativo,origem_catalogo");
  if (prodErr) throw prodErr;

  const enriched = items.map((item: any) => {
    const p = matchProduct(item, products || []);
    const qty = Math.max(1, Number(item?.quantity || 1));
    const fallbackCost = money(item?.price_cost) * qty;
    const cost = p ? money(p.custo) * qty : fallbackCost;
    return { item, product: p, qty, cost: money(cost), title: p?.nome || itemTitle(item) };
  });
  const custoProdutos = money(enriched.reduce((s: number, x: any) => s + x.cost, 0));


  const { data: existingOrders, error: exErr } = await sb
    .from("pedidos")
    .select("*")
    .eq("referencia", reference)
    .order("id", { ascending: true })
    .limit(1);
  if (exErr) throw exErr;

  let pedidoId: number;
  const existing = existingOrders?.[0];

  if (existing && !String(existing.origem_dados || "").toLowerCase().includes("yampi")) {
    await logEvent(eventKey, {
      event: body.event,
      resource_id: String(r.id),
      reference,
      status: "skipped_existing_non_yampi",
      error_message: "Pedido com a mesma referência já existe e não foi criado pela integração Yampi.",
      metadata: { merchant: body?.merchant?.alias || null, value_total: orderTotal },
    });
    return { ok: true, skipped: true, reason: "existing_non_yampi", reference };
  }

  const calculatedFees=paymentBreakdownV108(r);
  const keepReconciled=existing&&['csv','informado'].includes(existing.taxas_origem)&&Math.abs(Number(existing.receita)-orderTotal)<0.015;
  const feeFields=keepReconciled?Object.fromEntries(['pagamento_metodo','parcelas','juros_parcelamento','taxa_gateway','taxa_yampi','checkout_yampi','taxas_origem','liquido_gateway','taxas','taxas_revisao'].map(k=>[k,existing[k]])):calculatedFees;
  const accountingTotal=keepReconciled?Number(existing.receita):orderTotal;
  const revenues=allocateRevenue(items,accountingTotal);
  const header = {
    referencia: reference,
    data,
    canal: "Yampi",
    cliente_nome: clienteNome || null,
    cliente_email: clienteEmail,
    cliente_telefone: clienteTelefone,
    estado,
    cidade,
    receita: accountingTotal,
    custo_produtos: custoProdutos,
    frete: existing ? existing.frete : 0,
    custo_embalagens: existing?.custo_embalagens ?? PACKAGING_COST,
    ...feeFields,
    anuncio: 0,
    itens: qtdTotal,
    via_trafego: viaTrafego,
    status: "pago",
    origem_dados: "Yampi webhook",
    observacoes: obs || null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    pedidoId = existing.id;
    const { error } = await sb.from("pedidos").update(header).eq("id", pedidoId);
    if (error) throw error;
  } else {
    const { data: inserted, error } = await sb
      .from("pedidos")
      .upsert({ ...header, created_at: new Date().toISOString() }, { onConflict: "referencia" })
      .select("id")
      .single();
    if (error) throw error;
    pedidoId = inserted.id;
  }

  for (let idx = 0; idx < enriched.length; idx++) {
    const x = enriched[idx];
    const itemId = x.item?.id ?? `${idx + 1}`;
    const origemRef = `YAMPI:${r.id}:${itemId}`;
    const row = {
      data,
      produto_id: x.product?.id ?? null,
      produto_nome: x.title,
      canal: "Yampi",
      obs: obs || null,
      receita: revenues[idx] ?? 0,
      custo_prod: x.cost,
      custo_emb: 0, // V10.7: custo fica no cabeçalho do pedido
      frete: 0,     // V10.7: custo fica no cabeçalho do pedido
      taxa: idx===0 ? feeFields.taxas : 0,
      anuncio: 0,
      cliente_id: clienteId,
      estado,
      cidade,
      via_trafego: viaTrafego,
      pedido_id: pedidoId,
      pedido_ref: reference,
      origem_ref: origemRef,
      quantidade: x.qty,
      item_ordem: idx + 1,
      itens_no_pedido: enriched.length,
    };

    const { data: oldRows, error: oldErr } = await sb
      .from("vendas")
      .select("id")
      .eq("origem_ref", origemRef)
      .limit(1);
    if (oldErr) throw oldErr;

    if (oldRows?.[0]) {
      const { error } = await sb.from("vendas").update(row).eq("id", oldRows[0].id);
      if (error) throw error;
    } else {
      const { error } = await sb.from("vendas").insert(row);
      if (error) throw error;
    }
  }

  const {error:recalcError}=await sb.rpc('ac_recalcular_pedido_v94',{p_id:pedidoId});
  if(recalcError)throw recalcError;
  const recoveredCart = await markRecoveredCartForPaidOrder(
    customer,
    reference,
    r?.created_at || body?.time,
  );

  await logEvent(eventKey, {
    event: body.event,
    resource_id: String(r.id),
    reference,
    status: "processed",
    error_message: null,
    metadata: {
      merchant: body?.merchant?.alias || null,
      value_total: orderTotal,
      items: enriched.length,
      via_trafego: viaTrafego,
      recovered_cart_id: recoveredCart?.id_externo || null,
      finance: feeFields,
    },
  });

  return {
    ok: true,
    processed: true,
    reference,
    pedido_id: pedidoId,
    recovered_cart: recoveredCart,
  };
}

async function recoverYampiOrder(input: any) {
  const orderId = Number(input?.order_id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return json({ok:false,error:"invalid_order_id"},400);
  const alias = (Deno.env.get("YAMPI_ALIAS") || "").trim();
  const token = (Deno.env.get("YAMPI_USER_TOKEN") || "").trim();
  const secret = (Deno.env.get("YAMPI_USER_SECRET_KEY") || "").trim();
  if (!alias || !token || !secret) return json({ok:false,error:"yampi_secrets_not_configured"},503);
  const url = new URL("https://api.dooki.com.br/v2/" + encodeURIComponent(alias) + "/orders/" + orderId);
  url.searchParams.set("include", "customer,items,items.sku,shipping_address,status,transactions");
  const res = await fetch(url, {headers:{"Accept":"application/json","User-Token":token,"User-Secret-Key":secret},signal:AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error("Yampi order lookup HTTP " + res.status);
  const payload = await res.json();
  const r = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
  if (Number(r?.id) !== orderId) throw new Error("Yampi returned an unexpected order");
  if (!input?.reference || String(r.number) !== String(input.reference)) return json({ok:false,error:"reference_mismatch"},409);
  if (!yampiOrderLooksPaid(r)) return json({ok:false,error:"order_not_paid"},409);
  if (!Array.isArray(r?.items?.data) && Array.isArray(r?.items)) r.items = {data:r.items};
  if (!r?.customer?.data && r?.customer && !Array.isArray(r.customer)) r.customer = {data:r.customer};
  if (!r?.shipping_address?.data && r?.shipping_address && !Array.isArray(r.shipping_address)) r.shipping_address = {data:r.shipping_address};
  if (!Array.isArray(r?.items?.data) || !r.items.data.length) throw new Error("Yampi order without expanded items");
  const total = money(r.value_total ?? r.buyer_value_total);
  if (total <= 0 || money(input?.expected_total) !== total) return json({ok:false,error:"total_mismatch",total},409);
  const {data: existing, error} = await sb.from("pedidos").select("id,referencia,origem_dados").eq("referencia",String(r.number)).limit(2);
  if (error) throw error;
  if (existing?.length > 1) return json({ok:false,error:"duplicate_existing_reference"},409);
  if (input?.commit !== true) return json({ok:true,dry_run:true,order_id:orderId,reference:String(r.number),total,items:r.items.data.length,existing_order_id:existing?.[0]?.id || null,finance:paymentBreakdownV108(r),finance_keys:Object.keys(r).filter(k=>/value|payment|transaction|paid/.test(k))});
  const result = await processPaidOrder({event:"order.paid",time:"recovery:"+orderId,merchant:{alias},resource:r});
  return json({...result,recovered_from_api:true});
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, service: "Areia Croa Yampi webhook", secret_configured: Boolean(YAMPI_WEBHOOK_SECRET) });
  }
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const rawBody = await req.text();
  // Recuperacao administrativa: somente a service role existente pode chamar.
  const adminAuthorization = req.headers.get("X-CRM-Recovery-Authorization") || req.headers.get("Authorization") || "";
  let configuredSecretKeys: string[] = [];
  try { configuredSecretKeys = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")).filter((key): key is string => typeof key === "string" && key.length > 0); } catch {}
  const adminApiKey = req.headers.get("apikey") || "";
  const isAdminRecovery = (SUPABASE_SERVICE_ROLE_KEY && safeEqual(adminAuthorization, "Bearer " + SUPABASE_SERVICE_ROLE_KEY)) || configuredSecretKeys.some((key) => safeEqual(adminApiKey, key));
  if (isAdminRecovery) {
    try {
      const input = JSON.parse(rawBody);
      if (input?.action !== "recover_order") return json({ok:false,error:"unsupported_admin_action"},400);
      return await recoverYampiOrder(input);
    } catch (e) {
      console.error("Yampi administrative recovery error", e);
      return json({ok:false,error:"recovery_error",message:String(e?.message || e)},500);
    }
  }

  const signature = req.headers.get("X-Yampi-Hmac-SHA256");

  const verified = await verifyYampi(rawBody, signature);
  if (verified === null) {
    // Permite cadastrar/testar a URL antes de inserir a chave secreta do webhook.
    // Nenhum dado é gravado neste modo.
    return json({ ok: true, setup_mode: true, message: "Configure YAMPI_WEBHOOK_SECRET no Supabase para ativar o processamento." });
  }
  if (!verified) return json({ ok: false, error: "invalid_yampi_signature" }, 401);

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const event = String(body?.event || "");

  try {
    // V8: não depende apenas de order.paid.
    // A Yampi também pode sinalizar mudança de status; se o payload já mostra pagamento
    // aprovado/capturado, processamos a venda de forma idempotente.
    const isOrderEvent = ["order.paid", "order.status.updated", "order.updated", "order.created"].includes(event);
    if (isOrderEvent && yampiOrderLooksPaid(body?.resource || {})) {
      const result = await processPaidOrder(body);
      return json({ ...result, accepted_event: event });
    }

    if (event === "order.status.updated" || event === "order.updated") {
      await logIgnoredOrderEvent(body, "Evento de pedido recebido, mas o payload não indica pagamento aprovado/capturado.");
      return json({ ok: true, ignored: true, event, reason: "order_not_paid" });
    }

    // Cria/atualiza o perfil na aba Clientes mesmo sem compra.
    if (event === "customer.created" || event === "order.created" || event === "cart.reminder") {
      const result = await processLeadEvent(body);
      return json(result);
    }

    // Catálogo automático: qualquer criação/alteração/estoque sincroniza o SKU real.
    if (
      event === "product.created" ||
      event === "product.updated" ||
      event === "product.inventory.updated" ||
      event === "product.deleted"
    ) {
      const result = await processProductEvent(body);

      const r = body?.resource || {};
      const eventKey = `${event}:${r?.id || "unknown"}:${body?.time || ""}`;
      await logEvent(eventKey, {
        event,
        resource_id: r?.id ? String(r.id) : null,
        reference: r?.id ? String(r.id) : null,
        status: event === "product.deleted" ? "catalog_deleted" : "catalog_synced",
        error_message: null,
        metadata: { merchant: body?.merchant?.alias || null },
      });

      return json(result);
    }

    return json({ ok: true, ignored: true, event: event || null });
  } catch (e) {
    const r = body?.resource || {};
    const eventKey = `${body?.event || "unknown"}:${r?.id || "unknown"}:${body?.time || ""}`;
    await logEvent(eventKey, {
      event: body?.event || null,
      resource_id: r?.id ? String(r.id) : null,
      reference: r?.number ? String(r.number) : (r?.id ? String(r.id) : null),
      status: "error",
      error_message: String(e?.message || e),
      metadata: { merchant: body?.merchant?.alias || null },
    });
    console.error("Yampi webhook error", e);
    return json({ ok: false, error: "processing_error", message: String(e?.message || e) }, 500);
  }
});
