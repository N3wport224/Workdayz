"use client";

import type { AtsScoreBreakdown } from "@/lib/types";

function scoreColor(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-rose-500";
}

export function AtsScoreMeter({
  ats,
  onMissingKeywordClick,
}: {
  ats: AtsScoreBreakdown;
  onMissingKeywordClick?: (keyword: string) => void;
}) {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold">ATS Match Score</h3>
        <span className="text-2xl font-bold">{ats.score}/100</span>
      </div>
      <div className="h-2 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden mb-3">
        <div
          className={`h-full ${scoreColor(ats.score)}`}
          style={{ width: `${ats.score}%` }}
        />
      </div>
      {ats.notes ? <p className="text-sm mb-3 opacity-80">{ats.notes}</p> : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-medium mb-1">Matched keywords ({ats.matchedKeywords.length})</p>
          <div className="flex flex-wrap gap-1">
            {ats.matchedKeywords.map((k) => (
              <span
                key={k}
                className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="font-medium mb-1">Missing keywords ({ats.missingKeywords.length})</p>
          <div className="flex flex-wrap gap-1">
            {ats.missingKeywords.map((k) =>
              onMissingKeywordClick ? (
                <button
                  key={k}
                  type="button"
                  onClick={() => onMissingKeywordClick(k)}
                  title="Click to add an emphasis instruction for the next rewrite"
                  className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 text-xs hover:bg-rose-500/30 cursor-pointer"
                >
                  {k} +
                </button>
              ) : (
                <span key={k} className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 text-xs">
                  {k}
                </span>
              ),
            )}
          </div>
          {onMissingKeywordClick && ats.missingKeywords.length ? (
            <p className="text-xs opacity-50 mt-1">Click a keyword to emphasize it in the next rewrite.</p>
          ) : null}
        </div>
      </div>
      {ats.formattingIssues.length ? (
        <div className="mt-3 text-sm">
          <p className="font-medium mb-1">Formatting suggestions</p>
          <ul className="list-disc list-inside opacity-80 space-y-0.5">
            {ats.formattingIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
