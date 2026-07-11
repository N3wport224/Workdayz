// Pure HTML → job-posting extraction. Workday career sites (and most job
// boards) embed a JSON-LD JobPosting block, which gives clean structured
// data; otherwise fall back to stripping tags.

export interface ExtractedJob {
  title: string;
  company: string;
  location: string;
  description: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findJsonLdJobPosting(html: string): Record<string, unknown> | null {
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of blocks) {
    try {
      const parsed = JSON.parse(match[1]);
      const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [])];
      for (const candidate of candidates) {
        const type = candidate?.["@type"];
        if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
          return candidate as Record<string, unknown>;
        }
      }
    } catch {
      /* malformed block — try the next one */
    }
  }
  return null;
}

export function extractJobFromHtml(html: string): ExtractedJob {
  const ld = findJsonLdJobPosting(html);
  if (ld) {
    const org = ld.hiringOrganization as Record<string, unknown> | undefined;
    const loc = ld.jobLocation as Record<string, unknown> | Record<string, unknown>[] | undefined;
    const firstLoc = Array.isArray(loc) ? loc[0] : loc;
    const address = firstLoc?.address as Record<string, unknown> | undefined;
    const locality = [address?.addressLocality, address?.addressRegion]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(", ");
    return {
      title: typeof ld.title === "string" ? ld.title : "",
      company: typeof org?.name === "string" ? org.name : "",
      location: locality,
      description: typeof ld.description === "string" ? stripHtml(ld.description) : "",
    };
  }

  const titleMatch =
    html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return {
    title: titleMatch ? decodeEntities(titleMatch[1]).trim() : "",
    company: "",
    location: "",
    description: stripHtml(html).slice(0, 30_000),
  };
}
