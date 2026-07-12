import { describe, expect, it } from "vitest";
import {
  companyFromWorkdayHost,
  extractJobFromCxs,
  extractJobFromHtml,
  stripHtml,
  workdayCxsUrl,
} from "./extract-job";

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

describe("workdayCxsUrl", () => {
  it("maps a locale-prefixed posting URL to the CXS endpoint", () => {
    expect(
      workdayCxsUrl(
        "https://acme.wd5.myworkdayjobs.com/en-US/AcmeCareers/job/USA-TX-Austin/Senior-Ops-Analyst_JR-12345",
      ),
    ).toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/AcmeCareers/job/Senior-Ops-Analyst_JR-12345");
  });

  it("maps a URL without a locale segment", () => {
    expect(workdayCxsUrl("https://acme.wd1.myworkdayjobs.com/Careers/job/Remote/Engineer_R100")).toBe(
      "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/job/Engineer_R100",
    );
  });

  it("returns null for non-Workday and non-posting URLs", () => {
    expect(workdayCxsUrl("https://boards.greenhouse.io/acme/jobs/1")).toBeNull();
    expect(workdayCxsUrl("https://acme.wd5.myworkdayjobs.com/en-US/AcmeCareers")).toBeNull();
    expect(workdayCxsUrl("https://acme.wd5.myworkdayjobs.com/careers/job/")).toBeNull();
    expect(workdayCxsUrl("not a url")).toBeNull();
  });
});

describe("companyFromWorkdayHost", () => {
  it("prettifies the tenant subdomain", () => {
    expect(companyFromWorkdayHost("acme-corp.wd5.myworkdayjobs.com")).toBe("Acme Corp");
    expect(companyFromWorkdayHost("example.com")).toBe("");
  });
});

describe("extractJobFromCxs", () => {
  it("parses the jobPostingInfo shape and strips description HTML", () => {
    const job = extractJobFromCxs(
      {
        jobPostingInfo: {
          title: "Senior Ops Analyst",
          jobDescription: "<p>Own the forecast.</p><ul><li>Ship weekly</li></ul>",
          location: "Austin, TX",
        },
      },
      "acme.wd5.myworkdayjobs.com",
    );
    expect(job).not.toBeNull();
    expect(job!.title).toBe("Senior Ops Analyst");
    expect(job!.company).toBe("Acme");
    expect(job!.location).toBe("Austin, TX");
    expect(job!.description).toContain("Own the forecast.");
    expect(job!.description).not.toContain("<p>");
  });

  it("prefers an explicit hiringOrganization name", () => {
    const job = extractJobFromCxs(
      {
        jobPostingInfo: { title: "T", jobDescription: "d", location: "" },
        hiringOrganization: { name: "Acme Corporation" },
      },
      "acme.wd5.myworkdayjobs.com",
    );
    expect(job!.company).toBe("Acme Corporation");
  });

  it("returns null on unexpected shapes", () => {
    expect(extractJobFromCxs({}, "x")).toBeNull();
    expect(extractJobFromCxs({ jobPostingInfo: { title: "T" } }, "x")).toBeNull();
    expect(extractJobFromCxs(null, "x")).toBeNull();
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
