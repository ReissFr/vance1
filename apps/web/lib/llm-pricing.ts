// Anthropic list pricing, USD per 1M tokens. Update when Anthropic changes
// their rate card. Cache read is billed at 10% of input, cache write at 125%
// (we don't track cache_creation separately — rolled into input_tokens).
//
// Keyed by the `model_tier` text column on messages ('haiku'|'sonnet'|'opus').

export type ModelTier = "haiku" | "sonnet" | "opus";

interface TierPricing {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
}

const PRICING: Record<ModelTier, TierPricing> = {
  haiku: { input_per_mtok: 1.0, output_per_mtok: 5.0, cache_read_per_mtok: 0.1 },
  sonnet: { input_per_mtok: 3.0, output_per_mtok: 15.0, cache_read_per_mtok: 0.3 },
  opus: { input_per_mtok: 15.0, output_per_mtok: 75.0, cache_read_per_mtok: 1.5 },
};

export function costForTokens(
  tier: string | null | undefined,
  input: number | null | undefined,
  output: number | null | undefined,
  cacheRead: number | null | undefined,
): number {
  const t = (tier ?? "haiku") as ModelTier;
  const p = PRICING[t] ?? PRICING.haiku;
  const inp = Number(input ?? 0);
  const out = Number(output ?? 0);
  const cache = Number(cacheRead ?? 0);
  return (
    (inp / 1_000_000) * p.input_per_mtok +
    (out / 1_000_000) * p.output_per_mtok +
    (cache / 1_000_000) * p.cache_read_per_mtok
  );
}

export function pricingTable(): Array<{
  tier: ModelTier;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
}> {
  return (Object.keys(PRICING) as ModelTier[]).map((tier) => ({
    tier,
    ...PRICING[tier],
  }));
}
