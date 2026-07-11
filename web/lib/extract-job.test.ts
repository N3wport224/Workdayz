import { describe, expect, it } from "vitest";
import { extractJobFromHtml, stripHtml } from "./extract-job";

const jsonLdPage = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Operations Analyst",
  "description": "<p>Own the forecast.</p><ul><li>Build dashboards</li></ul>",
  "hiringOrganization": { "@type": "Organization", "name": "Acme Corp" },
  "jobLocation": { "@type": "Place", "address": { "addressLocality": "Austin", "addressRegion": "TX" } }
}
</script>
</head><body>irrelevant</body></html>`;

describe("extractJobFromHtml", () => {
  it("prefers JSON-LD JobPosting data", () => {
    const job = extractJobFromHtml(jsonLdPage);
    expect(job.title).toBe("Senior Operations Analyst");
    expect(job.company).toBe("Acme Corp");
    expect(job.location).toBe("Austin, TX");
    expect(job.description).toContain("Own the forecast.");
    expect(job.description).toContain("Build dashboards");
    expect(job.description).not.toContain("<p>");
  });

  it("falls back to title tag + stripped body", () => {
    const job = extractJobFromHtml(
      "<html><head><title>Engineer - Globex</title></head><body><h1>Engineer</h1><p>Do things &amp; stuff.</p></body></html>",
    );
    expect(job.title).toBe("Engineer - Globex");
    expect(job.description).toContain("Do things & stuff.");
  });

  it("survives malformed JSON-LD blocks", () => {
    const job = extractJobFromHtml(
      `<script type="application/ld+json">{not json}</script><title>Fallback</title><body>text</body>`,
    );
    expect(job.title).toBe("Fallback");
  });
});

describe("stripHtml", () => {
  it("removes scripts and styles entirely", () => {
    expect(stripHtml("<style>.x{}</style>hello<script>evil()</script>")).toBe("hello");
  });

  it("converts block ends to newlines", () => {
    expect(stripHtml("<p>one</p><p>two</p>")).toBe("one\ntwo");
  });
});
