// Regression test for the allowlist bypass: url.hostname.endsWith(host)
// let any domain that merely ends with an allowed string through (e.g.
// "evil-indeed.com" passes .endsWith("indeed.com")), letting a crafted job
// URL redirect the server-side fetch to an attacker-controlled host. The
// fix requires an exact host or a real dot-delimited subdomain.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(url: string): NextRequest {
  return new NextRequest("http://localhost/api/fetch-job", {
    method: "POST",
    body: JSON.stringify({ url }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetch-job allowlist", () => {
  it("rejects a domain that merely ends with an allowed suffix", async () => {
    const res = await POST(request("https://evil-indeed.com/job/1"));
    expect(res.status).toBe(403);
  });

  it("rejects a domain built by prefixing an allowed host", async () => {
    const res = await POST(request("https://attackermyworkdayjobs.com/job/1"));
    expect(res.status).toBe(403);
  });

  it("rejects a non-http(s) protocol", async () => {
    const res = await POST(request("file:///etc/passwd"));
    expect(res.status).toBe(403);
  });

  describe("with fetch mocked", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("<title>A job</title>", { status: 200 })),
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it("accepts a real subdomain of an allowed host", async () => {
      const res = await POST(request("https://acme.myworkdayjobs.com/job/1"));
      expect(res.status).toBe(200);
    });

    it("accepts an exact allowed host with no subdomain", async () => {
      const res = await POST(request("https://indeed.com/job/1"));
      expect(res.status).toBe(200);
    });
  });
});
