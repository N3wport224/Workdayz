// Lenient date parsing + consistent display formatting for the generated
// resume. ATS parsers key off recognizable, uniform date formats, and the
// browser extension's autofill parses the SAME formats — so normalizing the
// display here keeps a resume's dates both ATS-clean and round-trippable.
//
// Accepts the same shapes as the extension's parseDateParts (kept in sync):
// "2021-06", "2021-06-15", "06/2021", "6/2021", "06/21", "June 2021",
// "Jun 2021", "Sept. 2019", "2021". "Present"/"Current" pass through.

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export interface ParsedDate {
  year: number;
  /** 1-12, or undefined when only a year was given. */
  month?: number;
}

function expandTwoDigitYear(yy: number): number {
  const currentYY = new Date().getFullYear() % 100;
  return yy <= currentYY + 1 ? 2000 + yy : 1900 + yy;
}

export function isPresent(raw: string): boolean {
  return /^(present|current|now|ongoing)$/i.test((raw ?? "").trim());
}

export function parseFlexibleDate(raw: string): ParsedDate | null {
  const v = (raw ?? "").trim();
  if (!v || isPresent(v) || /^(to date|n\/?a)$/i.test(v)) return null;
  const mo = (n: number): number | undefined => (n >= 1 && n <= 12 ? n : undefined);

  let m = v.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m) return { year: Number(m[1]), month: mo(Number(m[2])) };
  m = v.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return { year: Number(m[2]), month: mo(Number(m[1])) };
  m = v.match(/^(\d{1,2})[-/.](\d{2})$/);
  if (m) return { year: expandTwoDigitYear(Number(m[2])), month: mo(Number(m[1])) };
  m = v.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (m) {
    const abbr = m[1].toLowerCase().slice(0, 3);
    const idx = MONTH_NAMES.findIndex((name) => name.startsWith(abbr));
    if (idx >= 0) return { year: Number(m[2]), month: idx + 1 };
  }
  m = v.match(/^(\d{4})$/);
  if (m) return { year: Number(m[1]) };
  return null;
}

/** "Aug 2022", or "2022" if only a year, "Present" for present, or the raw
 * text unchanged if it can't be parsed (never mangle what we don't understand). */
export function formatMonthYear(raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (isPresent(v)) return "Present";
  const p = parseFlexibleDate(v);
  if (!p) return v;
  return p.month ? `${MONTH_ABBR[p.month - 1]} ${p.year}` : String(p.year);
}

/** "Aug 2022 – Present" with an en dash; drops an empty side. */
export function formatDateRange(start: string, end: string): string {
  const s = formatMonthYear(start);
  const e = formatMonthYear(end);
  if (s && e) return `${s} – ${e}`;
  return s || e;
}

/** True when a non-empty date string can't be parsed — surfaced in the
 * profile form so the user knows autofill may not fill it. */
export function isUnrecognizedDate(raw: string): boolean {
  const v = (raw ?? "").trim();
  if (!v || isPresent(v)) return false;
  return parseFlexibleDate(v) === null;
}
