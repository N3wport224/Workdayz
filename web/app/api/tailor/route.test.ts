// Item 87: integration tests for the tailor route — request validation, the
// rate guard, and the happy path with Anthropic's API mocked at the fetch
// boundary (no credits burned, no network).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import type { ResumeProfile } from "@/lib/types";

const profile: ResumeProfile = {
  contact: { firstName: "A", lastName: "B", email: "a@b.c", phone: "5", address: "", city: "", state: "", postalCode: "", country: "", linkedin: "", website: "" },
  summary: "Engineer.",
  skills: ["TypeScript"],
  experience: [{ id: "1", company: "Acme", title: "Eng", location: "", startDate: "01/2020", endDate: "Present", bullets: ["Built TypeScript services."] }],
  education: [],
  projects: [],
  certifications: [],
};

const job = { title: "Engineer", company: "Acme", location: "", description: "TypeScript engineer needed. ".repeat(5) };

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tailor", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const claudeReply = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        summary: "Tailored summary.",
        skills: ["TypeScript"],
        bullets: [{ id: "1", original: "Built TypeScript services.", tailored: "Built TS services at scale." }],
        coverLetter: "Letter.",
        fitAnalysis: { strengths: ["x"], gaps: [], verdict: "Fit" },
        variants: [],
      }),
    },
  ],
  usage: { input_tokens: 100, output_tokens: 100 },
};

describe("POST /api/tailor", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(claudeReply), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects a body without profile/job", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
  });

  it("tailors and scores on the happy path (Anthropic mocked)", async () => {
    const res = await POST(request({ profile, job }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("Tailored summary.");
    expect(typeof data.atsScore).toBe("number");
    expect(data.atsBreakdown.matched).toContain("typescript");
  });

  it("enforces the rate guard after too many calls in a minute", async () => {
    let limited = false;
    for (let i = 0; i < 15; i++) {
      const res = await POST(request({ profile, job }));
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
