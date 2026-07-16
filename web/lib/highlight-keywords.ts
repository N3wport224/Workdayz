/**
 * Splits a block of text into segments marked by which ATS keyword list they
 * hit, so the apply page can render the job description with matched keywords
 * highlighted green and missing ones amber. Pure — React-free — so it's unit
 * testable.
 */

export interface HighlightSegment {
  text: string;
  kind: "plain" | "matched" | "missing";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Longest keywords first so "project management" wins over "project";
 * boundaries are non-alphanumeric so "ml" can't match inside "html".
 */
export function segmentByKeywords(
  text: string,
  matched: string[],
  missing: string[],
): HighlightSegment[] {
  if (!text) return [];

  const entries: { keyword: string; kind: "matched" | "missing" }[] = [
    ...matched.filter((k) => k.trim()).map((k) => ({ keyword: k.trim(), kind: "matched" as const })),
    ...missing.filter((k) => k.trim()).map((k) => ({ keyword: k.trim(), kind: "missing" as const })),
  ].sort((a, b) => b.keyword.length - a.keyword.length);

  if (entries.length === 0) return [{ text, kind: "plain" }];

  const kindByKeyword = new Map(entries.map((e) => [e.keyword.toLowerCase(), e.kind]));
  const pattern = new RegExp(
    `(?<![A-Za-z0-9])(${entries.map((e) => escapeRegExp(e.keyword)).join("|")})(?![A-Za-z0-9])`,
    "gi",
  );

  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index), kind: "plain" });
    }
    segments.push({
      text: match[0],
      kind: kindByKeyword.get(match[0].toLowerCase()) ?? "plain",
    });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), kind: "plain" });
  }
  return segments;
}
