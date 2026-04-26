// ShopifyProvider — CommerceProvider implementation backed by Shopify's
// Admin REST API.
//
// Uses a custom-app admin API access token (shpat_...) plus the merchant's
// shop domain (e.g. myshop.myshopify.com). Custom apps are simpler than
// full OAuth for a solo merchant: the merchant installs their own custom
// app in Shopify admin → Apps and sales channels → Develop apps, grants
// the read scopes (orders, products, inventory), then pastes the token.

import type {
  CommerceProvider,
  Order,
  OrderStatus,
  Product,
  InventoryLevel,
  SalesRange,
  SalesSummary,
} from "./provider";

export type ShopifyCredentials = {
  shop_domain?: string | null; // e.g. "myshop.myshopify.com"
  admin_access_token?: string | null;
};

export type ShopifyProviderOptions = {
  credentials: ShopifyCredentials;
};

const API_VERSION = "2025-01";

export class ShopifyProvider implements CommerceProvider {
  readonly providerName = "shopify";

  private readonly shop: string;
  private readonly token: string;

  constructor(opts: ShopifyProviderOptions) {
    if (!opts.credentials.shop_domain || !opts.credentials.admin_access_token) {
      throw new Error(
        "Shopify integration missing credentials.shop_domain/admin_access_token",
      );
    }
    this.shop = normalizeShop(opts.credentials.shop_domain);
    this.token = opts.credentials.admin_access_token;
  }

  async listOrders(opts: {
    limit: number;
    sinceDays?: number;
    status?: OrderStatus;
  }): Promise<Order[]> {
    const params: Record<string, string> = {
      limit: Math.min(opts.limit, 250).toString(),
      status: "any",
      fields:
        "id,order_number,name,email,customer,total_price,currency,created_at,fulfillment_status,financial_status,cancelled_at,line_items",
    };
    if (opts.sinceDays !== undefined) {
      params.created_at_min = new Date(
        Date.now() - opts.sinceDays * 86_400_000,
      ).toISOString();
    }
    const json = await this.get<{ orders: ShopifyOrder[] }>(`/orders.json`, params);
    const mapped = json.orders.map(toOrder);
    return opts.status ? mapped.filter((o) => o.status === opts.status) : mapped;
  }

  async listProducts(opts: {
    limit: number;
    status?: "active" | "draft" | "archived";
  }): Promise<Product[]> {
    const params: Record<string, string> = {
      limit: Math.min(opts.limit, 250).toString(),
      fields: "id,title,handle,status,variants,created_at",
    };
    if (opts.status) params.status = opts.status;
    const json = await this.get<{ products: ShopifyProduct[] }>(`/products.json`, params);
    return json.products.map((p) => ({
      id: String(p.id),
      title: p.title,
      handle: p.handle ?? null,
      status: (p.status as Product["status"]) ?? "active",
      total_inventory:
        p.variants?.reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0) ?? null,
      price_cents: p.variants?.[0]?.price
        ? Math.round(Number(p.variants[0].price) * 100)
        : null,
      currency: null,
      created: p.created_at ?? new Date().toISOString(),
    }));
  }

  async listLowInventory(opts: {
    threshold: number;
    limit: number;
  }): Promise<InventoryLevel[]> {
    // REST Admin API doesn't have a direct low-stock query; enumerate
    // recent product variants and filter client-side. Works for stores
    // with up to a few thousand SKUs — beyond that we'd page further.
    const json = await this.get<{ products: ShopifyProduct[] }>(`/products.json`, {
      limit: "250",
      fields: "id,title,variants",
    });
    const low: InventoryLevel[] = [];
    for (const p of json.products) {
      for (const v of p.variants ?? []) {
        const qty = v.inventory_quantity ?? 0;
        if (qty <= opts.threshold) {
          low.push({
            product_id: String(p.id),
            title: v.title && v.title !== "Default Title" ? `${p.title} — ${v.title}` : p.title,
            sku: v.sku ?? null,
            available: qty,
            location: null,
          });
        }
        if (low.length >= opts.limit) break;
      }
      if (low.length >= opts.limit) break;
    }
    return low;
  }

  async listSales(range: SalesRange): Promise<SalesSummary[]> {
    const { from, to } = resolveRange(range);
    const params: Record<string, string> = {
      status: "any",
      limit: "250",
      created_at_min: from.toISOString(),
      created_at_max: to.toISOString(),
      fields: "total_price,currency,financial_status",
    };
    const json = await this.get<{ orders: ShopifyOrder[] }>(`/orders.json`, params);
    const perCurrency = new Map<
      string,
      { gross: number; refunded: number; count: number }
    >();
    for (const o of json.orders) {
      const cur = o.currency ?? "USD";
      const bucket = perCurrency.get(cur) ?? { gross: 0, refunded: 0, count: 0 };
      const gross = Math.round(Number(o.total_price ?? 0) * 100);
      bucket.gross += gross;
      bucket.count += 1;
      if (o.financial_status === "refunded") bucket.refunded += gross;
      perCurrency.set(cur, bucket);
    }
    return [...perCurrency.entries()].map(([currency, b]) => ({
      currency,
      gross_cents: b.gross,
      net_cents: b.gross - b.refunded,
      order_count: b.count,
      range,
      from: from.toISOString(),
      to: to.toISOString(),
    }));
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(
      `https://${this.shop}/admin/api/${API_VERSION}${path}`,
    );
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": this.token,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Shopify ${path} failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }
}

type ShopifyOrder = {
  id: number;
  order_number?: number;
  name?: string;
  email?: string;
  customer?: { first_name?: string; last_name?: string; email?: string };
  total_price?: string;
  currency?: string;
  created_at?: string;
  fulfillment_status?: string | null;
  financial_status?: string | null;
  cancelled_at?: string | null;
  line_items?: { title: string; quantity: number; price?: string }[];
};

type ShopifyProduct = {
  id: number;
  title: string;
  handle?: string;
  status?: string;
  created_at?: string;
  variants?: ShopifyVariant[];
};

type ShopifyVariant = {
  title?: string;
  sku?: string | null;
  price?: string;
  inventory_quantity?: number;
};

function toOrder(o: ShopifyOrder): Order {
  return {
    id: String(o.id),
    number: o.name ?? (o.order_number ? `#${o.order_number}` : null),
    customer_email: o.email ?? o.customer?.email ?? null,
    customer_name:
      [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") ||
      null,
    total_cents: Math.round(Number(o.total_price ?? 0) * 100),
    currency: o.currency ?? "USD",
    status: mapStatus(o),
    created: o.created_at ?? new Date().toISOString(),
    fulfilled_at:
      o.fulfillment_status === "fulfilled" ? o.created_at ?? null : null,
    line_items: (o.line_items ?? []).map((li) => ({
      title: li.title,
      quantity: li.quantity,
      amount_cents: Math.round(Number(li.price ?? 0) * 100) * li.quantity,
    })),
  };
}

function mapStatus(o: ShopifyOrder): OrderStatus {
  if (o.cancelled_at) return "cancelled";
  if (o.financial_status === "refunded") return "refunded";
  if (o.fulfillment_status === "fulfilled") return "fulfilled";
  if (o.fulfillment_status === "partial") return "partially_fulfilled";
  return "open";
}

function normalizeShop(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return s;
}

function resolveRange(range: SalesRange): { from: Date; to: Date } {
  const now = new Date();
  if (range === "yesterday") {
    const from = new Date(now);
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(0, 0, 0, 0);
    return { from, to };
  }
  const to = now;
  const from = new Date(now);
  switch (range) {
    case "today":
      from.setHours(0, 0, 0, 0);
      break;
    case "week": {
      const day = from.getDay() === 0 ? 6 : from.getDay() - 1;
      from.setDate(from.getDate() - day);
      from.setHours(0, 0, 0, 0);
      break;
    }
    case "month":
    case "mtd":
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      break;
    case "last_30d":
      from.setDate(from.getDate() - 30);
      break;
    case "last_90d":
      from.setDate(from.getDate() - 90);
      break;
    case "ytd":
      from.setMonth(0, 1);
      from.setHours(0, 0, 0, 0);
      break;
    case "all_time":
      from.setFullYear(from.getFullYear() - 20);
      break;
  }
  return { from, to };
}
