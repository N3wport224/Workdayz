import { lookup } from "node:dns/promises";
import { NextResponse } from "next/server";
import { extractJobFromCxs, extractJobFromHtml, workdayCxsUrl } from "@/lib/extract-job";

// Server-side fetch of a job posting URL. SSRF-guarded: public http(s) hosts
// only — this route runs on the user's own machine, and must not become a
// proxy into their local network. Every redirect hop is re-validated, and
// hostnames are also checked against their DNS-resolved addresses.
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local / cloud metadata
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // IPv6 ULA
  /^\[?fe80:/i, // IPv6 link-local
  /\.(local|internal|lan)$/i,
];

function isPrivateIp(address: string): boolean {
  // node:dns usually reports IPv4-mapped IPv6 as plain IPv4; normalize anyway.
  const ip = address.replace(/^::ffff:/i, "");
  return BLOCKED_HOST_PATTERNS.some((p) => p.test(ip)) || ip === "::";
}

/** Blocks obviously-internal hostnames AND public hostnames that resolve to
 * private/link-local addresses. Unresolvable hosts are blocked too. */
async function hostIsBlocked(hostname: string): Promise<boolean> {
  const bareHost = hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (BLOCKED_HOST_PATTERNS.some((p) => p.test(hostname) || p.test(bareHost))) return true;
  try {
    const addresses = await lookup(bareHost, { all: true });
    return addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address));
  } catch {
    return true;
  }
}

function badUrl(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(body.url ?? "");
  } catch {
    return badUrl("That doesn't look like a valid URL.");
  }

  // A Workday careers HOME page (no /job/ in the path) can never yield a
  // posting — say so instead of failing with a generic extraction error.
  if (/\.myworkdayjobs\.com$/i.test(url.hostname) && !/\/job\//i.test(url.pathname)) {
    return badUrl(
      "That's the careers site home page — open the specific posting and paste ITS URL (it will contain /job/).",
    );
  }

  try {
    // Workday career sites render client-side, so their HTML shell often has
    // no description — but the posting is public JSON on the SAME host.
    // Try that first; any failure falls through to the generic HTML path.
    const cxsUrl = workdayCxsUrl(url.toString());
    if (cxsUrl && !(await hostIsBlocked(url.hostname))) {
      try {
        const cxsRes = await fetch(cxsUrl, {
          signal: AbortSignal.timeout(10_000),
          redirect: "manual", // same-host JSON endpoint should not redirect
          headers: {
            Accept: "application/json",
            // Workday's edge filters non-browser agents.
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          },
        });
        if (cxsRes.ok) {
          const job = extractJobFromCxs(await cxsRes.json(), url.hostname);
          if (job && job.description.length >= 100) {
            return NextResponse.json({ job: { ...job, sourceUrl: url.toString() } });
          }
        }
      } catch {
        /* fall through to HTML extraction */
      }
    }

    // Follow redirects manually so every hop's host gets validated — a public
    // URL must not be able to bounce this request onto localhost or a
    // metadata endpoint.
    let response: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return badUrl("Only http(s) URLs are supported.");
      }
      if (await hostIsBlocked(url.hostname)) {
        return badUrl("That host isn't allowed.");
      }
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10_000),
        redirect: "manual",
        headers: {
          // Some career sites serve an empty shell to unknown agents.
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return NextResponse.json(
            { error: "The site redirected without a destination — copy/paste the posting instead." },
            { status: 502 },
          );
        }
        url = new URL(location, url);
        continue;
      }
      response = res;
      break;
    }

    if (!response) {
      return NextResponse.json(
        { error: "Too many redirects — copy/paste the posting instead." },
        { status: 502 },
      );
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: `The site responded with ${response.status} — copy/paste the posting instead.` },
        { status: 502 },
      );
    }
    const html = (await response.text()).slice(0, 2_000_000);
    const job = extractJobFromHtml(html);
    if (!job.description || job.description.length < 100) {
      return NextResponse.json(
        {
          error:
            "Couldn't extract a job description from that page (it may render client-side) — copy/paste the posting text instead.",
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ job: { ...job, sourceUrl: url.toString() } });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "That site took too long to respond."
        : "Couldn't fetch that URL — copy/paste the posting instead.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
