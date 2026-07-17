/**
 * Item 96: local API-spend log. Every tailoring run's estimated cost is
 * recorded in this browser so the Settings page can show "what has this
 * actually cost me" — estimates from lib/pricing rates, not billing data.
 */

export interface CostEntry {
  at: string;
  costUsd: number;
  kind: "tailor" | "batch" | "other";
}

const COST_KEY = "workdayz-cost-log";
const MAX_ENTRIES = 500;

export function recordCost(costUsd: number, kind: CostEntry["kind"] = "tailor"): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  try {
    const log = loadCostLog();
    log.push({ at: new Date().toISOString(), costUsd, kind });
    localStorage.setItem(COST_KEY, JSON.stringify(log.slice(-MAX_ENTRIES)));
  } catch {
    /* storage unavailable */
  }
}

export function loadCostLog(): CostEntry[] {
  try {
    return JSON.parse(localStorage.getItem(COST_KEY) ?? "[]") as CostEntry[];
  } catch {
    return [];
  }
}

export interface CostSummary {
  totalUsd: number;
  runs: number;
  thisMonthUsd: number;
  thisMonthRuns: number;
}

export function summarizeCosts(log: CostEntry[] = loadCostLog(), now = new Date()): CostSummary {
  const monthKey = now.toISOString().slice(0, 7);
  let totalUsd = 0;
  let thisMonthUsd = 0;
  let thisMonthRuns = 0;
  for (const entry of log) {
    totalUsd += entry.costUsd;
    if (entry.at.slice(0, 7) === monthKey) {
      thisMonthUsd += entry.costUsd;
      thisMonthRuns += 1;
    }
  }
  return {
    totalUsd: Math.round(totalUsd * 100) / 100,
    runs: log.length,
    thisMonthUsd: Math.round(thisMonthUsd * 100) / 100,
    thisMonthRuns,
  };
}
