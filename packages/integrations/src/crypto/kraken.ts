// KrakenProvider — CryptoProvider implementation backed by Kraken's REST API
// (https://docs.kraken.com/rest/). Fetch-based; no SDK.
//
// Auth: API key + secret (HMAC-SHA512). Not OAuth.
//   API-Key:  <public api key>
//   API-Sign: base64( hmac_sha512( secret, path + sha256(nonce + postdata) ) )
// Every private request needs a fresh incrementing `nonce` in the post body.
// Tokens never expire; rotated only if the user regenerates them on Kraken.
//
// Quirks:
// - Kraken uses legacy asset codes: "XXBT" for BTC, "ZUSD" for USD, etc.
//   We normalise to the ticker the user expects (BTC, USD, GBP).
// - Ticker prices are per-pair (e.g. XBTUSD). Not every asset has a GBP pair,
//   so portfolio native fiat is USD for consistency — callers convert onward
//   if they want GBP.

import { createHash, createHmac } from "node:crypto";
import type {
  CryptoProvider,
  CryptoWallet,
  CryptoTransaction,
  CryptoTxType,
  CryptoTxStatus,
  CryptoTxnRange,
  CryptoPortfolio,
  CryptoPortfolioSlice,
  CryptoSendRequest,
  CryptoSendResult,
} from "./provider";

const API_BASE = "https://api.kraken.com";

export type KrakenCredentials = {
  api_key?: string | null;
  api_secret?: string | null;
};

export type KrakenProviderOptions = {
  credentials: KrakenCredentials;
  nativeFiat?: string; // ISO 4217, default "USD"
};

type KrakenResponse<T> = {
  error: string[];
  result: T;
};

type KrakenBalanceResult = Record<string, string>;

type KrakenLedger = {
  refid: string;
  time: number;
  type: string;
  subtype?: string;
  aclass: string;
  asset: string;
  amount: string;
  fee: string;
  balance?: string;
};

type KrakenLedgersResult = {
  ledger: Record<string, KrakenLedger>;
  count: number;
};

type KrakenTickerEntry = {
  // last-trade: [price, lot-volume]
  c: [string, string];
};

export class KrakenProvider implements CryptoProvider {
  readonly providerName = "kraken";

  private readonly apiKey: string;
  private readonly apiSecretB64: string;
  private readonly nativeFiat: string;

  constructor(opts: KrakenProviderOptions) {
    const key = opts.credentials.api_key?.trim();
    const secret = opts.credentials.api_secret?.trim();
    if (!key || !secret) {
      throw new Error("Kraken: api_key and api_secret are required");
    }
    this.apiKey = key;
    this.apiSecretB64 = secret;
    this.nativeFiat = (opts.nativeFiat ?? "USD").toUpperCase();
  }

  async listWallets(): Promise<CryptoWallet[]> {
    const balances = await this.privatePost<KrakenBalanceResult>("/0/private/Balance");

    // Drop zero balances — Kraken leaves dust rows behind after trades.
    const nonZero = Object.entries(balances).filter(([, amt]) => Number(amt) > 0);
    if (nonZero.length === 0) return [];

    // Fetch fiat prices in parallel for every non-fiat asset.
    const prices = await this.fetchPrices(
      nonZero.map(([code]) => normalizeAsset(code)).filter((a) => !isFiat(a)),
    );

    return nonZero.map(([krakenCode, amount]) => {
      const asset = normalizeAsset(krakenCode);
      const fiat = isFiat(asset) ? asset : this.nativeFiat;
      const balanceNum = Number(amount);
      let valueMinor = 0;
      if (isFiat(asset)) {
        // Fiat wallet — balance IS the native value.
        valueMinor = fiatToMinor(amount, asset);
      } else {
        const px = prices.get(asset);
        if (px !== undefined && Number.isFinite(balanceNum)) {
          valueMinor = fiatToMinor((balanceNum * px).toFixed(2), this.nativeFiat);
        }
      }
      return {
        id: `kraken:${krakenCode}`,
        name: `${asset} wallet`,
        asset,
        asset_name: asset,
        balance: amount,
        native_currency: fiat,
        native_value_minor: valueMinor,
        is_fiat: isFiat(asset),
      };
    });
  }

  async listTransactions(opts: {
    wallet_id?: string;
    range?: CryptoTxnRange;
    limit?: number;
  }): Promise<CryptoTransaction[]> {
    const { from } = resolveRange(opts.range ?? "last_30d");
    const maxItems = Math.min(opts.limit ?? 200, 500);

    // Ledgers endpoint accepts `start` (unix seconds). Results are unordered
    // across assets; we sort newest-first after merging.
    const result = await this.privatePost<KrakenLedgersResult>("/0/private/Ledgers", {
      start: Math.floor(from.getTime() / 1000).toString(),
    });

    // Kraken splits trades into two ledger entries (one per leg). Group by
    // refid so a buy shows as one crypto row instead of two.
    type Grouped = {
      refid: string;
      time: number;
      type: string;
      entries: Array<{ id: string; ledger: KrakenLedger }>;
    };
    const byRef = new Map<string, Grouped>();
    for (const [id, led] of Object.entries(result.ledger ?? {})) {
      const key = led.refid || id;
      let g = byRef.get(key);
      if (!g) {
        g = { refid: key, time: led.time, type: led.type, entries: [] };
        byRef.set(key, g);
      }
      g.entries.push({ id, ledger: led });
    }

    // Price cache per asset so we can convert a crypto-leg to fiat.
    const cryptoAssets = new Set<string>();
    for (const g of byRef.values()) {
      for (const e of g.entries) {
        const a = normalizeAsset(e.ledger.asset);
        if (!isFiat(a)) cryptoAssets.add(a);
      }
    }
    const prices = await this.fetchPrices([...cryptoAssets]);

    const txns: CryptoTransaction[] = [];
    for (const g of byRef.values()) {
      // Prefer the crypto leg if present — that's what the user thinks of
      // as the transaction ("bought 0.1 BTC"), not the cash side.
      const cryptoLeg = g.entries.find((e) => !isFiat(normalizeAsset(e.ledger.asset)));
      const fiatLeg = g.entries.find((e) => isFiat(normalizeAsset(e.ledger.asset)));
      const primary = cryptoLeg ?? g.entries[0];
      if (!primary) continue;
      const led = primary.ledger;
      const asset = normalizeAsset(led.asset);

      let nativeAmountMinor = 0;
      let nativeCurrency = this.nativeFiat;
      if (fiatLeg) {
        const fAsset = normalizeAsset(fiatLeg.ledger.asset);
        nativeAmountMinor = fiatToMinorSigned(fiatLeg.ledger.amount, fAsset);
        nativeCurrency = fAsset;
      } else if (isFiat(asset)) {
        nativeAmountMinor = fiatToMinorSigned(led.amount, asset);
        nativeCurrency = asset;
      } else {
        const px = prices.get(asset);
        const n = Number(led.amount);
        if (px !== undefined && Number.isFinite(n)) {
          nativeAmountMinor = fiatToMinorSigned((n * px).toFixed(2), this.nativeFiat);
        }
      }

      txns.push({
        id: primary.id,
        wallet_id: `kraken:${led.asset}`,
        type: mapLedgerType(led.type, led.subtype),
        asset,
        amount: led.amount,
        native_currency: nativeCurrency,
        native_amount_minor: nativeAmountMinor,
        created: new Date(led.time * 1000).toISOString(),
        description: g.type,
        counterparty: null,
        status: "completed" as CryptoTxStatus,
      });
    }

    txns.sort((a, b) => (a.created < b.created ? 1 : -1));
    return txns.slice(0, maxItems);
  }

  async getPortfolio(opts?: { native_currency?: string }): Promise<CryptoPortfolio> {
    const wallets = await this.listWallets();
    const native = (opts?.native_currency ?? this.nativeFiat).toUpperCase();
    const slices: CryptoPortfolioSlice[] = wallets
      .filter((w) => !w.is_fiat)
      .map((w) => ({
        asset: w.asset,
        balance: w.balance,
        value_minor: w.native_value_minor,
        pct: 0,
      }));
    const total = slices.reduce((s, x) => s + x.value_minor, 0);
    for (const s of slices) s.pct = total === 0 ? 0 : s.value_minor / total;
    slices.sort((a, b) => b.value_minor - a.value_minor);
    return {
      native_currency: native,
      total_value_minor: total,
      by_asset: slices,
    };
  }

  async send(req: CryptoSendRequest): Promise<CryptoSendResult> {
    // Kraken /0/private/Withdraw requires a pre-registered withdrawal key
    // (label) set up manually on kraken.com. The `key` parameter is that
    // label — Kraken looks up the real address server-side. This means
    // Kraken enforces its own whitelist (layer 2). Our whitelist label
    // must match the Kraken-side label exactly.
    //
    // We use `destination_label` as the Kraken key because `destination` is
    // the raw address (which Kraken doesn't accept on this endpoint).
    try {
      const result = await this.privatePost<{ refid: string }>(
        "/0/private/Withdraw",
        {
          asset: toKrakenAsset(req.asset),
          key: req.destination_label,
          amount: req.amount,
        },
      );
      if (!result?.refid) {
        return { status: "failed", error: "Kraken returned no refid" };
      }
      // Withdrawals are asynchronous on Kraken's side; they settle once the
      // chain confirms. Treat as pending.
      return { status: "pending", provider_tx_id: result.refid, raw: result };
    } catch (e) {
      return { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Fetch last-trade price for each asset against this.nativeFiat. Kraken
  // doesn't support arbitrary fiats for every asset; missing pairs are
  // silently dropped from the returned map.
  private async fetchPrices(assets: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (assets.length === 0) return out;

    // One GET per asset, in parallel. Kraken ticker responses use their own
    // normalized pair code as the result key, so batching parses ambiguously;
    // single-pair requests keep the mapping deterministic.
    await Promise.all(
      assets.map(async (asset) => {
        const pair = krakenPair(asset, this.nativeFiat);
        if (!pair) return;
        try {
          const res = await fetch(
            `${API_BASE}/0/public/Ticker?pair=${encodeURIComponent(pair)}`,
          );
          if (!res.ok) return;
          const json = (await res.json()) as KrakenResponse<
            Record<string, KrakenTickerEntry>
          >;
          if (json.error?.length) return;
          const first = Object.values(json.result ?? {})[0];
          const price = first?.c?.[0];
          if (price && Number.isFinite(Number(price))) {
            out.set(asset, Number(price));
          }
        } catch {
          // swallow — missing price just means no fiat value surfaced
        }
      }),
    );
    return out;
  }

  private async privatePost<T>(
    path: string,
    extraBody: Record<string, string> = {},
  ): Promise<T> {
    const nonce = Date.now().toString() + Math.floor(Math.random() * 1000).toString();
    const body = new URLSearchParams({ nonce, ...extraBody });
    const postData = body.toString();

    // message = sha256(nonce + postdata)  (binary)
    const sha256 = createHash("sha256")
      .update(nonce + postData)
      .digest();
    // signature = hmac_sha512( base64_decode(secret), path + sha256 )
    const secretBytes = Buffer.from(this.apiSecretB64, "base64");
    const hmac = createHmac("sha512", secretBytes);
    hmac.update(path);
    hmac.update(sha256);
    const signature = hmac.digest("base64");

    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "API-Key": this.apiKey,
        "API-Sign": signature,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: postData,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Kraken ${path} ${res.status}: ${txt.slice(0, 300)}`);
    }
    const json = (await res.json()) as KrakenResponse<T>;
    if (json.error?.length) {
      throw new Error(`Kraken ${path}: ${json.error.join(", ")}`);
    }
    return json.result;
  }
}

// Kraken asset-code normalisation. Legacy codes prefixed with X (crypto) or Z
// (fiat), four-letter form ("XXBT" = BTC, "ZUSD" = USD). Newer assets have
// no prefix ("ADA", "SOL", "USDC"). XBT is Kraken's own ticker for Bitcoin;
// we expose it as BTC.
const ASSET_ALIASES: Record<string, string> = {
  XXBT: "BTC",
  XBT: "BTC",
  XXDG: "DOGE",
  XDG: "DOGE",
  XETH: "ETH",
  XLTC: "LTC",
  XETC: "ETC",
  XMLN: "MLN",
  XXRP: "XRP",
  XREP: "REP",
  XZEC: "ZEC",
  XXLM: "XLM",
  XXMR: "XMR",
  XTZ: "XTZ",
  ZUSD: "USD",
  ZEUR: "EUR",
  ZGBP: "GBP",
  ZJPY: "JPY",
  ZCAD: "CAD",
  ZAUD: "AUD",
  ZCHF: "CHF",
};

const FIATS = new Set([
  "USD", "GBP", "EUR", "JPY", "CAD", "AUD", "CHF", "KRW", "SGD", "HKD",
  "NZD", "SEK", "DKK", "NOK", "PLN", "CZK", "HUF", "MXN", "BRL", "ZAR",
]);

function normalizeAsset(code: string): string {
  const upper = code.toUpperCase();
  if (ASSET_ALIASES[upper]) return ASSET_ALIASES[upper];
  return upper;
}

function isFiat(asset: string): boolean {
  return FIATS.has(asset);
}

// Inverse of normalizeAsset for endpoints (Withdraw, DepositAddresses) that
// expect Kraken's native code. For assets with no legacy prefix the clean
// ticker works fine.
function toKrakenAsset(asset: string): string {
  if (asset === "BTC") return "XBT";
  if (asset === "DOGE") return "XDG";
  return asset.toUpperCase();
}

// BTC needs Kraken's internal ticker "XBT" for pair lookup; everything else
// uses its clean ticker. Fiats keep their ISO code.
function krakenPair(asset: string, fiat: string): string | null {
  if (!asset || !fiat || isFiat(asset)) return null;
  const a = asset === "BTC" ? "XBT" : asset;
  return `${a}${fiat.toUpperCase()}`;
}

function mapLedgerType(type: string, subtype?: string): CryptoTxType {
  const t = type.toLowerCase();
  const s = subtype?.toLowerCase() ?? "";
  if (t === "trade") return "trade";
  if (t === "deposit") return "fiat_deposit"; // close enough; crypto deposits also land here
  if (t === "withdrawal") return "fiat_withdrawal";
  if (t === "staking" || t === "reward") return "staking_reward";
  if (t === "earn") return "staking_reward";
  if (t === "receive") return "receive";
  if (t === "send" || t === "spend") return "send";
  if (t === "transfer") {
    if (s.includes("spot")) return "other";
    return "other";
  }
  return "other";
}

// Kraken amounts are strings in major units. Most fiat 2dp; zero-decimal list
// mirrors CoinbaseProvider.fiatExponent.
function fiatToMinor(amount: string, currency: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  const exponent = fiatExponent(currency);
  return Math.round(n * 10 ** exponent);
}

function fiatToMinorSigned(amount: string, currency: string): number {
  return fiatToMinor(amount, currency);
}

function fiatExponent(currency: string): number {
  const zero = new Set(["JPY", "KRW", "VND", "CLP", "IDR", "ISK"]);
  if (zero.has(currency.toUpperCase())) return 0;
  return 2;
}

function resolveRange(range: CryptoTxnRange): { from: Date; to: Date } {
  const now = new Date();
  if (range === "yesterday") {
    const from = new Date(now);
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(0, 0, 0, 0);
    return { from, to };
  }
  const to = new Date(now);
  const from = new Date(now);
  switch (range) {
    case "today":
      from.setHours(0, 0, 0, 0);
      break;
    case "week": {
      const day = (from.getDay() + 6) % 7;
      from.setDate(from.getDate() - day);
      from.setHours(0, 0, 0, 0);
      break;
    }
    case "month":
    case "mtd":
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      break;
    case "last_7d":
      from.setDate(from.getDate() - 7);
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
      from.setFullYear(from.getFullYear() - 10);
      break;
  }
  return { from, to };
}
