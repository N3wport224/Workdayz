// Cost estimation for the AI features. Client-safe (no server imports).
// Prices are USD per million tokens, cached from Anthropic's published
// pricing (2026-06) — treat outputs as ESTIMATES, not invoices. Sonnet 5 has
// intro pricing ($2/$10) through 2026-08-31; we use the standard rate to
// estimate conservatively.

interface ModelRates {
  inputPerMTok: number;
  outputPerMTok: number;
}

const RATES: Record<string, ModelRates> = {
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
};

export interface UsageTotals {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/** Estimated cost in USD, or null when the model's rates aren't known
 * (e.g. a custom ANTHROPIC_MODEL override). */
export function estimateCostUsd(usage: UsageTotals): number | null {
  const rates = Object.entries(RATES).find(([prefix]) => usage.model.startsWith(prefix))?.[1];
  if (!rates) return null;
  const input =
    (usage.inputTokens * rates.inputPerMTok +
      (usage.cacheCreationTokens ?? 0) * rates.inputPerMTok * 1.25 +
      (usage.cacheReadTokens ?? 0) * rates.inputPerMTok * 0.1) /
    1_000_000;
  const output = (usage.outputTokens * rates.outputPerMTok) / 1_000_000;
  return input + output;
}

export function formatUsd(value: number): string {
  return value < 0.01 ? `<$0.01` : `$${value.toFixed(2)}`;
}
