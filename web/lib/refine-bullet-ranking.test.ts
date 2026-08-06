// The load-bearing property here is that semantic refinement can only REORDER.
// The model receives bullets and returns indices, so a poisoned job description
// cannot get fabricated experience onto a resume through this path — any index
// that isn't already a real bullet is discarded. These tests mock the Anthropic
// SDK so that guarantee is verified without network access or an API key.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: createMock };
  }
  return { default: MockAnthropic };
});

import { refineProfileRanking, refineRoleRanking } from "./refine-bullet-ranking";
import { buildJobKeywordIndex, rankRoleBullets } from "./rank-bullets";

const JD = "Kubernetes platform role. Terraform and CI/CD pipelines required.";
const TITLE = "Platform Engineer";

/** A real deterministic ranking, so refinement is exercised against genuine input. */
function baseRole(bullets: string[]) {
  return rankRoleBullets(
    { id: "r1", title: "Engineer", company: "Acme", bullets },
    buildJobKeywordIndex(JD, TITLE),
    { maxKeep: 3 },
  );
}

const BULLETS = [
  "Filed paperwork",                     // 0
  "Owned Kubernetes clusters",           // 1
  "Built CI/CD pipelines",               // 2
  "Managed Terraform modules",           // 3
];

/** Shapes a fake tool_use response the way the SDK returns one. */
function toolResponse(input: unknown) {
  return { content: [{ type: "tool_use", name: "submit_ranking", input }] };
}

beforeEach(() => {
  createMock.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("refineRoleRanking — reorder-only guarantee", () => {
  it("applies the model's ordering when indices are valid", async () => {
    createMock.mockResolvedValue(toolResponse({ indices: [3, 1, 2] }));
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE, { maxKeep: 3 });

    expect(result.refined).toBe(true);
    expect(result.role.selected.map((b) => b.index)).toEqual([3, 1, 2]);
  });

  it("DISCARDS indices that do not exist — no invented bullets", async () => {
    // 99 is not a real bullet. A naive implementation would crash or, worse,
    // fabricate an entry.
    createMock.mockResolvedValue(toolResponse({ indices: [1, 99, 2] }));
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE, { maxKeep: 3 });

    expect(result.role.selected.map((b) => b.index)).toEqual([1, 2]);
    for (const bullet of result.role.ranked) {
      expect(BULLETS).toContain(bullet.text);
    }
  });

  it("cannot introduce text even if the model returns some", async () => {
    // The tool schema has no text field, but prove it regardless: whatever
    // extra keys arrive, every returned bullet still traces to the input.
    createMock.mockResolvedValue(
      toolResponse({ indices: [1], body: "Invented: CEO of Google", text: "ignore me" }),
    );
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE, { maxKeep: 3 });

    const allText = result.role.ranked.map((b) => b.text).join(" ");
    expect(allText).not.toContain("Invented");
    expect(allText).not.toContain("CEO of Google");
  });

  it("collapses duplicate indices", async () => {
    createMock.mockResolvedValue(toolResponse({ indices: [1, 1, 1, 2] }));
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE, { maxKeep: 3 });
    expect(result.role.selected.map((b) => b.index)).toEqual([1, 2]);
  });

  it("ignores non-numeric indices", async () => {
    createMock.mockResolvedValue(toolResponse({ indices: ["1", null, 2, {}] }));
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE, { maxKeep: 3 });
    expect(result.role.selected.map((b) => b.index)).toEqual([2]);
  });

  it("keeps omitted bullets in `ranked` so none silently disappear", async () => {
    createMock.mockResolvedValue(toolResponse({ indices: [1] }));
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE, { maxKeep: 3 });

    expect(result.role.ranked).toHaveLength(BULLETS.length);
    expect(result.role.ranked[0].index).toBe(1);
  });

  it("honors maxKeep on the refined selection", async () => {
    createMock.mockResolvedValue(toolResponse({ indices: [3, 1, 2, 0] }));
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE, { maxKeep: 2 });
    expect(result.role.selected).toHaveLength(2);
  });

  it("passes through a one-sentence reasoning note", async () => {
    createMock.mockResolvedValue(toolResponse({ indices: [1], reasoning: "Kubernetes is the core ask." }));
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE);
    expect(result.note).toBe("Kubernetes is the core ask.");
  });
});

describe("refineRoleRanking — degradation to deterministic", () => {
  it("falls back when no API key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const deterministic = baseRole(BULLETS);
    const result = await refineRoleRanking(deterministic, JD, TITLE);

    expect(result.refined).toBe(false);
    expect(result.note).toContain("No API key");
    expect(result.role.selected).toEqual(deterministic.selected);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("falls back when the API call throws", async () => {
    createMock.mockRejectedValue(new Error("overloaded"));
    const deterministic = baseRole(BULLETS);
    const result = await refineRoleRanking(deterministic, JD, TITLE);

    expect(result.refined).toBe(false);
    expect(result.note).toContain("overloaded");
    expect(result.role.selected).toEqual(deterministic.selected);
  });

  it("falls back when the model returns no tool_use block", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "sorry" }] });
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE);
    expect(result.refined).toBe(false);
  });

  it("falls back when every returned index is unusable", async () => {
    createMock.mockResolvedValue(toolResponse({ indices: [99, 100] }));
    const deterministic = baseRole(BULLETS);
    const result = await refineRoleRanking(deterministic, JD, TITLE);

    expect(result.refined).toBe(false);
    expect(result.role.selected).toEqual(deterministic.selected);
  });

  it("falls back when indices is missing entirely", async () => {
    createMock.mockResolvedValue(toolResponse({}));
    const result = await refineRoleRanking(baseRole(BULLETS), JD, TITLE);
    expect(result.refined).toBe(false);
  });

  it("skips the call for a role with fewer than two bullets", async () => {
    const result = await refineRoleRanking(baseRole(["Only one"]), JD, TITLE);
    expect(result.refined).toBe(false);
    expect(result.note).toContain("Too few");
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("refineProfileRanking", () => {
  it("refines each role and returns one result per role", async () => {
    createMock.mockResolvedValue(toolResponse({ indices: [1, 2] }));
    const roles = [baseRole(BULLETS), baseRole(BULLETS)];
    const results = await refineProfileRanking(roles, JD, TITLE, { maxKeep: 2 });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.refined)).toBe(true);
  });

  it("runs sequentially, not as a burst the rate limiter would reject", async () => {
    let concurrent = 0;
    let peak = 0;
    createMock.mockImplementation(async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return toolResponse({ indices: [1, 2] });
    });

    await refineProfileRanking([baseRole(BULLETS), baseRole(BULLETS), baseRole(BULLETS)], JD, TITLE);
    expect(peak).toBe(1);
  });

  it("one role's failure does not stop the others", async () => {
    createMock
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue(toolResponse({ indices: [1, 2] }));

    const results = await refineProfileRanking([baseRole(BULLETS), baseRole(BULLETS)], JD, TITLE);
    expect(results[0].refined).toBe(false);
    expect(results[1].refined).toBe(true);
  });
});
