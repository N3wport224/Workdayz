import { NextRequest, NextResponse } from "next/server";

/**
 * Fetches a job posting URL to extract title/company/location/description.
 * Server-side to avoid CORS issues and SSRF-guarded to only allow known
 * job board domains. This is a minimal implementation — in production this
 * would use cheerio or puppeteer for full JS-rendered job boards.
 */

const ALLOWED_HOSTS = [
  "myworkdayjobs.com",
  "myworkday.com",
  "linkedin.com",
  "linkedin.cn",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
  "simplyhired.com",
];

function isAllowed(url: URL): boolean {
  return ALLOWED_HOSTS.some((host) => url.hostname.endsWith(host));
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json() as { url: string };
    if (!url) {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    const parsed = new URL(url);
    if (!isAllowed(parsed)) {
      return NextResponse.json({
        error: `URL not allowed. Only these domains are supported: ${ALLOWED_HOSTS.join(", ")}`,
      }, { status: 403 });
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Workdayz/1.0; +https://github.com/N3wport224/Workdayz)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Server returned ${res.status}` }, { status: 502 });
    }

    const html = await res.text();

    // Extract metadata from meta tags and JSON-LD
    const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
      ?? html.match(/<title>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)
      ?? html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);

    // Try JSON-LD
    let jsonLdTitle = "";
    let jsonLdCompany = "";
    let jsonLdLocation = "";
    let jsonLdDescription = "";
    const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (ldMatch) {
      try {
        const parsed = JSON.parse(ldMatch[1]);
        const jobPosting = parsed["@type"] === "JobPosting" ? parsed : undefined;
        if (jobPosting) {
          jsonLdTitle = jobPosting.title ?? "";
          jsonLdCompany = jobPosting.hiringOrganization?.name ?? "";
          jsonLdLocation = jobPosting.jobLocation?.address?.addressLocality ?? "";
          jsonLdDescription = jobPosting.description ?? "";
        }
      } catch { /* not valid JSON-LD */ }
    }

    return NextResponse.json({
      title: jsonLdTitle || titleMatch?.[1]?.trim() || "",
      company: jsonLdCompany || "",
      location: jsonLdLocation || "",
      description: jsonLdDescription || descMatch?.[1]?.trim() || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}