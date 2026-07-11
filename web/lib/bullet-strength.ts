// Local heuristics for resume bullet quality — no LLM, instant feedback.

const WEAK_OPENERS = new Set([
  "responsible", "worked", "helped", "assisted", "participated", "involved",
  "tasked", "duties", "various", "was", "were", "did",
]);

export interface BulletAnalysis {
  rating: "strong" | "ok" | "weak";
  tips: string[];
}

export function analyzeBullet(bullet: string): BulletAnalysis {
  const text = bullet.trim();
  const tips: string[] = [];
  if (!text) return { rating: "weak", tips: ["Empty bullet."] };

  const words = text.split(/\s+/);
  const firstWord = words[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";

  const startsWeak = WEAK_OPENERS.has(firstWord);
  if (startsWeak) {
    tips.push(`Starts with "${words[0]}" — lead with a strong action verb (Led, Built, Reduced...).`);
  }

  const hasNumber = /\d/.test(text);
  if (!hasNumber) {
    tips.push("No quantified result — add a number, %, $, or scale if truthful.");
  }

  if (words.length < 6) {
    tips.push("Very short — say what you did AND the outcome.");
  } else if (words.length > 32) {
    tips.push("Long — tighten to one outcome per bullet (under ~30 words).");
  }

  const rating: BulletAnalysis["rating"] =
    tips.length === 0 ? "strong" : tips.length === 1 && hasNumber ? "ok" : tips.length === 1 ? "ok" : "weak";

  return { rating, tips };
}
