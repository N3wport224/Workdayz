// Route-level tests for the bullet ranker. The deterministic path must work
// with no API key at all (that's the point of it), and the opt-in semantic path
// must degrade to the free ranking rather than 500 when anything goes wrong.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: createMock };
  }
  return { default: MockAnthropic };
});

import { POST } from "./route";

const JD = "Kubernetes platform engineer. Terraform, CI/CD pipelines, observability required.";

const EXPERIENCE = [
  {
    id: "r1",
    title: "Engineer",
    company: "Acme",
    bullets: ["Filed paperwork", "Owned Kubernetes clusters", "Built CI/CD pipelines"],
  },
];

function request(body: unknown): Request {
  return new Request("http://localhost/api/rank-bullets", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// The semantic path's cost guard is module-level state keyed on Date.now().
// Advancing past the 60s window between tests clears it through the real expiry
// path, so no test can silently inherit a spent budget and assert "keyword"
// for the wrong reason.
let clock = Date.UTC(2026, 0, 1);

beforeEach(() => {
  createMock.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  clock += 61_000;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("validation", () => {
  it("rejects malformed JSON", async () => {
    const res = await POST(request("{not json"));
    expect(res.status).toBe(400);
  });

  it("rejects a missing job description", async () => {
    const res = await POST(request({ experience: EXPERIENCE }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("job description");
  });

  it("rejects a whitespace-only job description", async () => {
    const res = await POST(request({ jobDescription: "   ", experience: EXPERIENCE }));
    expect(res.status).toBe(400);
  });

  it("rejects an oversized job description with 413", async () => {
    const res = await POST(request({ jobDescription: "x".repeat(60_001), experience: EXPERIENCE }));
    expect(res.status).toBe(413);
  });

  it("rejects empty experience", async () => {
    const res = await POST(request({ jobDescription: JD, experience: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects non-array experience without throwing", async () => {
    const res = await POST(request({ jobDescription: JD, experience: "nope" }));
    expect(res.status).toBe(400);
  });
});

describe("deterministic ranking (default)", () => {
  it("ranks with no API key present", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(request({ jobDescription: JD, jobTitle: "Platform Engineer", experience: EXPERIENCE }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.method).toBe("keyword");
    expect(data.roles).toHaveLength(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("puts the relevant bullets ahead of the filler", async () => {
    const res = await POST(request({ jobDescription: JD, jobTitle: "Platform Engineer", experience: EXPERIENCE }));
    const { roles } = await res.json();
    const order = roles[0].ranked.map((b: { index: number }) => b.index);
    expect(order.indexOf(0)).toBe(order.length - 1); // "Filed paperwork" last
  });

  it("does not call the model unless semantic is explicitly true", async () => {
    for (const semantic of [undefined, false, "true", 1]) {
      createMock.mockReset();
      await POST(request({ jobDescription: JD, experience: EXPERIENCE, semantic }));
      expect(createMock).not.toHaveBeenCalled();
    }
  });

  it("clamps maxKeep into a sane range", async () => {
    const many = [{ id: "r1", title: "E", company: "A", bullets: Array.from({ length: 30 }, (_, i) => `Bullet ${i}`) }];
    const res = await POST(request({ jobDescription: JD, experience: many, maxKeep: 9999 }));
    const { roles } = await res.json();
    expect(roles[0].selected.length).toBeLessThanOrEqual(20);
  });

  it("treats maxKeep 0 as at least 1", async () => {
    const res = await POST(request({ jobDescription: JD, experience: EXPERIENCE, maxKeep: 0 }));
    const { roles } = await res.json();
    expect(roles[0].selected.length).toBeGreaterThanOrEqual(1);
  });

  it("synthesizes ids for experience entries that lack them", async () => {
    const res = await POST(
      request({ jobDescription: JD, experience: [{ title: "E", company: "A", bullets: ["Owned Kubernetes clusters"] }] }),
    );
    const { roles } = await res.json();
    expect(roles[0].roleId).toBe("role-0");
  });

  it("coerces non-string bullets away instead of crashing", async () => {
    const res = await POST(
      request({
        jobDescription: JD,
        experience: [{ id: "r1", title: "E", company: "A", bullets: ["Owned Kubernetes clusters", 42, null, { a: 1 }] }],
      }),
    );
    expect(res.status).toBe(200);
    const { roles } = await res.json();
    expect(roles[0].ranked).toHaveLength(1);
  });
});

describe("semantic ranking (opt-in)", () => {
  it("applies the model's ordering when asked", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "tool_use", name: "submit_ranking", input: { indices: [2, 1] } }],
    });
    const res = await POST(request({ jobDescription: JD, experience: EXPERIENCE, semantic: true, maxKeep: 2 }));
    const data = await res.json();

    expect(data.method).toBe("semantic");
    expect(data.roles[0].selected.map((b: { index: number }) => b.index)).toEqual([2, 1]);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("returns the keyword ranking (200, not 500) when the model fails", async () => {
    createMock.mockRejectedValue(new Error("overloaded"));
    const res = await POST(request({ jobDescription: JD, experience: EXPERIENCE, semantic: true }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.method).toBe("keyword");
    expect(data.roles).toHaveLength(1);
  });

  it("falls back to keyword when no key is set even with semantic: true", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(request({ jobDescription: JD, experience: EXPERIENCE, semantic: true }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.method).toBe("keyword");
  });

  it("reports per-role refinement notes", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "tool_use", name: "submit_ranking", input: { indices: [1], reasoning: "Core ask." } }],
    });
    const res = await POST(request({ jobDescription: JD, experience: EXPERIENCE, semantic: true }));
    const { notes } = await res.json();

    expect(notes).toHaveLength(1);
    expect(notes[0].roleId).toBe("r1");
    expect(notes[0].note).toBe("Core ask.");
  });

  it("rate-limits the semantic path and still returns a usable ranking", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "tool_use", name: "submit_ranking", input: { indices: [1, 2] } }],
    });

    let sawLimit = false;
    // The window allows 12; go past it. The limiter is module state, so this
    // also documents that the free path is never blocked by it.
    for (let i = 0; i < 15; i++) {
      const res = await POST(request({ jobDescription: JD, experience: EXPERIENCE, semantic: true }));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.roles).toHaveLength(1); // always usable output
      if (typeof data.note === "string" && data.note.includes("Rate limit")) sawLimit = true;
    }
    expect(sawLimit).toBe(true);

    // Deterministic requests keep working after the semantic budget is spent.
    const free = await POST(request({ jobDescription: JD, experience: EXPERIENCE }));
    expect(free.status).toBe(200);
    expect((await free.json()).method).toBe("keyword");
  });
});
