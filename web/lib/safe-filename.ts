/**
 * Collapses a user-supplied string into a safe ASCII filename fragment.
 * Contact names go straight into the Content-Disposition header — quotes,
 * newlines, or exotic characters there produce a malformed header (and some
 * clients will refuse the download entirely).
 */
export function safeFilenamePart(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "") // strip non-ASCII after decomposition
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}
