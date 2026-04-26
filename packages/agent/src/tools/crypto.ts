// Brain-level crypto tools. Read-only; back a CryptoProvider (Coinbase today;
// Binance/Kraken pluggable) behind the @jarvis/integrations resolver.
// Trading and withdrawals must route through needs_approval — never here.

import { z } from "zod";
import { getCryptoProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const RANGE_ENUM = [
  "today",
  "yesterday",
  "week",
  "month",
  "mtd",
  "last_7d",
  "last_30d",
  "last_90d",
  "ytd",
  "all_time",
] as const;

export const cryptoWalletsTool = defineTool({
  name: "crypto_wallets",
  description:
    "List the user's crypto wallets with current balance and fiat value. Balances are decimal strings (keep as-is — do NOT round). Fiat values are minor units with currency code. Use for 'what crypto do I hold', 'my BTC balance', 'show me my wallets'.",
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const crypto = await getCryptoProvider(ctx.supabase, ctx.userId);
    return {
      provider: crypto.providerName,
      wallets: await crypto.listWallets(),
    };
  },
});

export const cryptoPortfolioTool = defineTool({
  name: "crypto_portfolio",
  description:
    "Total crypto portfolio value in fiat with per-asset breakdown sorted largest first. Each slice has the asset ticker, crypto balance (decimal string), fiat value (minor units), and percentage of total. Fiat wallets excluded. Use for 'what's my crypto worth', 'portfolio breakdown', 'am I up'.",
  schema: z.object({
    native_currency: z.string().length(3).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      native_currency: {
        type: "string",
        description:
          "ISO 4217 fiat currency code (USD, GBP, EUR). Defaults to the user's Coinbase reporting currency.",
      },
    },
  },
  async run(input, ctx) {
    const crypto = await getCryptoProvider(ctx.supabase, ctx.userId);
    return {
      provider: crypto.providerName,
      portfolio: await crypto.getPortfolio({ native_currency: input.native_currency }),
    };
  },
});

export const cryptoTransactionsTool = defineTool({
  name: "crypto_transactions",
  description:
    "List recent crypto transactions across all wallets, newest first. Types: buy, sell, send, receive, trade, fiat_deposit, fiat_withdrawal, staking_reward. Amounts are signed decimal strings (negative = outflow). Use for 'recent crypto activity', 'when did I buy BTC', 'show my staking rewards'.",
  schema: z.object({
    wallet_id: z.string().optional(),
    range: z.enum(RANGE_ENUM).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      wallet_id: {
        type: "string",
        description:
          "Specific wallet id from crypto_wallets. Omit to sweep all non-empty wallets.",
      },
      range: {
        type: "string",
        enum: [...RANGE_ENUM],
        description: "Time range. Defaults to 'last_30d'.",
      },
      limit: { type: "number", description: "Max results, 1–500. Default 200." },
    },
  },
  async run(input, ctx) {
    const crypto = await getCryptoProvider(ctx.supabase, ctx.userId);
    return {
      provider: crypto.providerName,
      transactions: await crypto.listTransactions({
        wallet_id: input.wallet_id,
        range: input.range,
        limit: input.limit,
      }),
    };
  },
});
