/**
 * Smart formatting utilities for autofill values.
 * Normalizes phone numbers, addresses, names, and other fields
 * to match Workday's expected formats.
 */

/** Formats a phone number to E.164 or common US format */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return value; // return as-is if unrecognized
}

/** Normalizes a name to Title Case */
export function formatName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => {
      // Handle hyphenated names: "jean-pierre" → "Jean-Pierre"
      return part
        .split("-")
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join("-");
    })
    .join(" ");
}

/** Normalizes an address line */
export function formatAddress(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(\d+)(st|nd|rd|th)\b/i, "$1$2") // preserve "1st", "2nd"
    .replace(/\b(\w+)\b/g, (word) => {
      const lower = word.toLowerCase();
      // Common address abbreviations
      const abbrs: Record<string, string> = {
        "st": "St",
        "st.": "St",
        "ave": "Ave",
        "ave.": "Ave",
        "blvd": "Blvd",
        "blvd.": "Blvd",
        "rd": "Rd",
        "rd.": "Rd",
        "dr": "Dr",
        "dr.": "Dr",
        "ln": "Ln",
        "ct": "Ct",
        "pl": "Pl",
        "way": "Way",
        "apt": "Apt",
        "ste": "Ste",
        "unit": "Unit",
      };
      return abbrs[lower] ?? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
}

/** Formats a ZIP/postal code */
export function formatPostalCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  if (digits.length === 5) {
    return digits;
  }
  return value.toUpperCase().trim();
}

/** Formats a URL (adds https:// if missing) */
export function formatUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/** Formats a LinkedIn URL to a clean profile URL */
export function formatLinkedIn(value: string): string {
  const trimmed = value.trim();
  // Extract just the profile path
  const match = trimmed.match(
    /linkedin\.com\/(?:in|pub|company)\/([^/?]+)/i,
  );
  if (match) {
    return `https://linkedin.com/in/${match[1]}`;
  }
  return formatUrl(trimmed);
}

/** Formats a currency amount */
export function formatCurrency(value: string): string {
  const digits = value.replace(/[^0-9.]/g, "");
  const num = parseFloat(digits);
  if (isNaN(num)) return value;
  return num % 1 === 0
    ? `$${num.toLocaleString("en-US")}`
    : `$${num.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

/** Detects and formats common date input patterns */
export function formatDateInput(value: string): string {
  // Already in MM/YYYY format
  if (/^\d{2}\/\d{4}$/.test(value)) return value;
  // Already in YYYY format
  if (/^\d{4}$/.test(value)) return value;
  // Try to parse and reformat
  const parsed = parseFlexibleDate(value);
  if (parsed) {
    return parsed.month
      ? `${String(parsed.month).padStart(2, "0")}/${parsed.year}`
      : String(parsed.year);
  }
  return value;
}

interface ParsedDate {
  year: number;
  month?: number;
}

function parseFlexibleDate(raw: string): ParsedDate | null {
  const v = raw.trim();
  if (!v) return null;

  // 2021-06 or 2021-06-15
  let m = v.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };

  // 06/2021
  m = v.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return { year: Number(m[2]), month: Number(m[1]) };

  // June 2021
  const MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  m = v.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (m) {
    const abbr = m[1].toLowerCase().slice(0, 3);
    const idx = MONTH_NAMES.findIndex((name) => name.startsWith(abbr));
    if (idx >= 0) return { year: Number(m[2]), month: idx + 1 };
  }

  // Just a year
  m = v.match(/^(\d{4})$/);
  if (m) return { year: Number(m[1]) };

  return null;
}