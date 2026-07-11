import { NextResponse } from "next/server";
import { extractJobFromHtml } from "@/lib/extract-job";

// Server-side fetch of a job posting URL. SSRF-guarded: public http(s) hosts
// only — this route runs on the user's own machine, and must not become a
// proxy into their local network.
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

export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(body.url ?? "");
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "Only http(s) URLs are supported." }, { status: 400 });
  }
  if (BLOCKED_HOST_PATTERNS.some((p) => p.test(parsed.hostname))) {
    return NextResponse.json({ error: "That host isn't allowed." }, { status: 400 });
  }

  try {
    const res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
      headers: {
        // Some career sites serve an empty shell to unknown agents.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `The site responded with ${res.status} — copy/paste the posting instead.` },
        { status: 502 },
      );
    }
    const html = (await res.text()).slice(0, 2_000_000);
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
    return NextResponse.json({ job: { ...job, sourceUrl: parsed.toString() } });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "That site took too long to respond."
        : "Couldn't fetch that URL — copy/paste the posting instead.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
