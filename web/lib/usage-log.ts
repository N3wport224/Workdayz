// Lifetime AI-spend tracking, client-side only. Every tailoring run records
// its estimated cost so the user can see roughly what the tool has cost them
// across all sessions in this browser.

import { estimateCostUsd, type UsageTotals } from "./pricing";

const KEY = "workdayz.usage.v1";

export interface UsageLog {
  runs: number;
  totalCostUsd: number;
}

export function loadUsageLog(): UsageLog {
  if (typeof window === "undefined") return { runs: 0, totalCostUsd: 0 };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { runs: 0, totalCostUsd: 0 };
    const parsed = JSON.parse(raw) as Partial<UsageLog>;
    return {
      runs: typeof parsed.runs === "number" && parsed.runs >= 0 ? parsed.runs : 0,
      totalCostUsd:
        typeof parsed.totalCostUsd === "number" && parsed.totalCostUsd >= 0
          ? parsed.totalCostUsd
          : 0,
    };
  } catch {
    return { runs: 0, totalCostUsd: 0 };
  }
}

/** Record one model call. Returns this run's estimated cost (null when the
 * model's rates are unknown) and the updated lifetime log. */
export function recordUsage(usage: UsageTotals): { runCostUsd: number | null; log: UsageLog } {
  const runCostUsd = estimateCostUsd(usage);
  const log = loadUsageLog();
  log.runs += 1;
  if (runCostUsd !== null) log.totalCostUsd += runCostUsd;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* storage full/blocked — the estimate is best-effort */
  }
  return { runCostUsd, log };
}
