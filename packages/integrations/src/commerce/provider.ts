// CommerceProvider — capability interface for any user's online storefront.
//
// Read-only for the first cut. Destructive ops (fulfil order, refund,
// cancel) route through the task-approval flow later, not direct brain calls.
//
// Must be implementable on: Shopify (live), BigCommerce (future),
// WooCommerce (future).

export type OrderStatus =
  | "open"
  | "fulfilled"
  | "partially_fulfilled"
  | "cancelled"
  | "refunded";

export type Order = {
  id: string;
  number: string | null;
  customer_email: string | null;
  customer_name: string | null;
  total_cents: number;
  currency: string;
  status: OrderStatus;
  created: string;
  fulfilled_at: string | null;
  line_items: { title: string; quantity: number; amount_cents: number }[];
};

export type Product = {
  id: string;
  title: string;
  handle: string | null;
  status: "active" | "draft" | "archived";
  total_inventory: number | null;
  price_cents: number | null;
  currency: string | null;
  created: string;
};

export type InventoryLevel = {
  product_id: string;
  title: string;
  sku: string | null;
  available: number;
  location: string | null;
};

export type SalesRange =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "mtd"
  | "last_30d"
  | "last_90d"
  | "ytd"
  | "all_time";

export type SalesSummary = {
  currency: string;
  gross_cents: number;
  net_cents: number;
  order_count: number;
  range: SalesRange;
  from: string;
  to: string;
};

export interface CommerceProvider {
  readonly providerName: string;

  listOrders(opts: {
    limit: number;
    sinceDays?: number;
    status?: OrderStatus;
  }): Promise<Order[]>;

  listProducts(opts: {
    limit: number;
    status?: "active" | "draft" | "archived";
  }): Promise<Product[]>;

  // Low-stock inventory across the store. `threshold` is the "running low"
  // cutoff — items at or below it are returned.
  listLowInventory(opts: { threshold: number; limit: number }): Promise<InventoryLevel[]>;

  // Sales aggregate for a range, per currency. Multi-currency stores exist.
  listSales(range: SalesRange): Promise<SalesSummary[]>;
}
