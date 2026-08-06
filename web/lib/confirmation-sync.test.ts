// Confirmation auto-sync into the tracker.
//
// The dangerous failure here is not a missed confirmation — it's a WRONG one:
// marking the wrong role applied, dragging someone who is already interviewing
// back to "Applied", or double-logging on a page reload. Those all corrupt the
// record of a real job search, so they get the most attention below.
import { describe, expect, it } from "vitest";
import {
  applyConfirmation,
  applyConfirmations,
  matchConfirmation,
  type ApplicationConfirmation,
} from "./tracker";
import type { ApplicationStatus, TailoredApplication } from "./types";

const SUBMITTED_AT = "2026-03-10T15:00:00.000Z";

function confirmation(over: Partial<ApplicationConfirmation> = {}): ApplicationConfirmation {
  return {
    key: "acme.myworkdayjobs.com|acme|jr-1234",
    company: "Acme",
    title: "Platform Engineer",
    jobId: "JR-1234",
    submittedAt: SUBMITTED_AT,
    sourceUrl: "https://acme.myworkdayjobs.com/job-apply/confirmation",
    hostname: "acme.myworkdayjobs.com",
    via: "url",
    evidence: "/job-apply/confirmation",
    ...over,
  };
}

function app(over: Partial<TailoredApplication> = {}): TailoredApplication {
  return {
    id: "app-1",
    createdAt: "2026-03-01T10:00:00.000Z",
    job: { title: "Platform Engineer", company: "Acme", location: "Remote", description: "" },
    profile: {
      contact: { firstName: "A", lastName: "B", email: "", phone: "", address: "", city: "", state: "", postalCode: "", country: "", linkedin: "", website: "" },
      summary: "", skills: [], experience: [], education: [], projects: [], certifications: [],
    },
    tailoredSummary: "",
    tailoredSkills: [],
    tailoredBullets: [],
    coverLetter: "",
    atsScore: 70,
    atsBreakdown: { totalKeywords: 0, matchedKeywords: 0, matched: [], missing: [], score: 70, integrityFlags: [] },
    status: "draft",
    ...over,
  };
}

describe("matchConfirmation", () => {
  it("matches on company + title", () => {
    expect(matchConfirmation([app()], confirmation())?.id).toBe("app-1");
  });

  it("is case- and whitespace-insensitive", () => {
    const tracked = app({ job: { title: "  platform   ENGINEER ", company: "ACME", location: "", description: "" } });
    expect(matchConfirmation([tracked], confirmation())?.id).toBe("app-1");
  });

  it("does NOT match on company alone", () => {
    // Anyone tracking several openings at one employer would otherwise have the
    // wrong role marked applied.
    const other = app({ id: "app-2", job: { title: "Data Scientist", company: "Acme", location: "", description: "" } });
    expect(matchConfirmation([other], confirmation())).toBeNull();
  });

  it("does NOT match on title alone", () => {
    const other = app({ id: "app-2", job: { title: "Platform Engineer", company: "Globex", location: "", description: "" } });
    expect(matchConfirmation([other], confirmation())).toBeNull();
  });

  it("skips archived applications", () => {
    expect(matchConfirmation([app({ archived: true })], confirmation())).toBeNull();
  });

  it("picks the newest when several match", () => {
    const older = app({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = app({ id: "new", createdAt: "2026-03-01T00:00:00.000Z" });
    expect(matchConfirmation([older, newer], confirmation())?.id).toBe("new");
  });

  it("returns null for an empty tracker", () => {
    expect(matchConfirmation([], confirmation())).toBeNull();
  });

  it("returns null when the confirmation carries no identity at all", () => {
    expect(matchConfirmation([app()], confirmation({ company: "", title: "" }))).toBeNull();
  });
});

describe("applyConfirmation — updating a match", () => {
  it("moves a draft to applied", () => {
    const { apps, action, applicationId } = applyConfirmation([app()], confirmation());
    expect(action).toBe("updated");
    expect(applicationId).toBe("app-1");
    expect(apps[0].status).toBe("applied");
  });

  it("uses the submission timestamp, not the sync time", () => {
    const { apps } = applyConfirmation([app()], confirmation());
    expect(apps[0].updatedAt).toBe(SUBMITTED_AT);
    // Response-time analytics read statusHistory, so it has to carry the real
    // moment too — otherwise "days to first response" is measured from whenever
    // the tracker happened to be opened.
    const last = apps[0].statusHistory?.at(-1);
    expect(last).toEqual({ status: "applied", at: SUBMITTED_AT });
  });

  it("appends to existing status history rather than replacing it", () => {
    const tracked = app({ statusHistory: [{ status: "draft", at: "2026-03-01T10:00:00.000Z" }] });
    const { apps } = applyConfirmation([tracked], confirmation());
    expect(apps[0].statusHistory).toHaveLength(2);
    expect(apps[0].statusHistory?.[0].status).toBe("draft");
  });

  it("fills a missing source URL from the confirmation", () => {
    const { apps } = applyConfirmation([app()], confirmation());
    expect(apps[0].job.sourceUrl).toBe("https://acme.myworkdayjobs.com/job-apply/confirmation");
  });

  it("never overwrites an existing source URL", () => {
    const tracked = app({
      job: { title: "Platform Engineer", company: "Acme", location: "", description: "", sourceUrl: "https://original/posting" },
    });
    const { apps } = applyConfirmation([tracked], confirmation());
    expect(apps[0].job.sourceUrl).toBe("https://original/posting");
  });

  it("leaves other applications untouched", () => {
    const other = app({ id: "app-2", job: { title: "Data Scientist", company: "Globex", location: "", description: "" } });
    const { apps } = applyConfirmation([app(), other], confirmation());
    expect(apps.find((a) => a.id === "app-2")).toEqual(other);
  });

  it("does not mutate the input array", () => {
    const input = [app()];
    const snapshot = JSON.parse(JSON.stringify(input));
    applyConfirmation(input, confirmation());
    expect(input).toEqual(snapshot);
  });
});

describe("applyConfirmation — never regressing a later stage", () => {
  // The worst-case bug: someone revisits an old confirmation page (or the queue
  // redelivers) while they're deep in the process, and their status resets.
  const laterStages: ApplicationStatus[] = ["applied", "screening", "interview", "offer", "rejected", "accepted"];

  for (const status of laterStages) {
    it(`leaves "${status}" untouched`, () => {
      const tracked = app({ status, updatedAt: "2026-03-05T00:00:00.000Z" });
      const input = [tracked];
      const { apps, action } = applyConfirmation(input, confirmation());
      expect(action).toBe("already-applied");
      expect(apps[0].status).toBe(status);
      expect(apps[0].updatedAt).toBe("2026-03-05T00:00:00.000Z");
      // The exact object must come back through — no history entry appended,
      // no timestamp touched.
      expect(apps[0]).toBe(tracked);
      expect(apps[0].statusHistory).toBeUndefined();
    });
  }

  it("returns the identical array when nothing changed", () => {
    const input = [app({ status: "interview" })];
    const { apps } = applyConfirmation(input, confirmation());
    expect(apps).toBe(input);
  });

  it("is idempotent — applying the same confirmation twice is a no-op", () => {
    const first = applyConfirmation([app()], confirmation());
    expect(first.action).toBe("updated");

    const second = applyConfirmation(first.apps, confirmation());
    expect(second.action).toBe("already-applied");
    expect(second.apps).toEqual(first.apps);
  });
});

describe("applyConfirmation — creating an entry when nothing matches", () => {
  it("records the submission rather than losing it", () => {
    const { apps, action } = applyConfirmation([], confirmation(), () => "generated-id");
    expect(action).toBe("created");
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe("generated-id");
    expect(apps[0].status).toBe("applied");
  });

  it("carries the metadata the confirmation page provided", () => {
    const { apps } = applyConfirmation([], confirmation(), () => "x");
    expect(apps[0].job.title).toBe("Platform Engineer");
    expect(apps[0].job.company).toBe("Acme");
    expect(apps[0].job.sourceUrl).toContain("confirmation");
    expect(apps[0].createdAt).toBe(SUBMITTED_AT);
  });

  it("notes the job ID and that it was not tailored here", () => {
    const { apps } = applyConfirmation([], confirmation(), () => "x");
    expect(apps[0].notes).toContain("JR-1234");
    expect(apps[0].notes).toContain("Not tailored");
  });

  it("omits the job ID from the note when the page had none", () => {
    const { apps } = applyConfirmation([], confirmation({ jobId: "" }), () => "x");
    expect(apps[0].notes).not.toContain("Job ID");
  });

  it("produces an entry the analytics helpers can consume", () => {
    // atsBreakdown.missing is read by keywordGaps; tailoredBullets by
    // effectiveBullets. Both must exist as arrays, not undefined.
    const { apps } = applyConfirmation([], confirmation(), () => "x");
    expect(Array.isArray(apps[0].atsBreakdown.missing)).toBe(true);
    expect(Array.isArray(apps[0].tailoredBullets)).toBe(true);
    expect(Array.isArray(apps[0].statusHistory)).toBe(true);
  });

  it("keeps existing applications alongside the new one", () => {
    const other = app({ id: "keep", job: { title: "Other", company: "Globex", location: "", description: "" } });
    const { apps } = applyConfirmation([other], confirmation(), () => "x");
    expect(apps).toHaveLength(2);
    expect(apps.find((a) => a.id === "keep")).toEqual(other);
  });
});

describe("applyConfirmations — batches", () => {
  it("threads the list so one role never yields two entries in a drain", () => {
    // Same role confirmed twice in one drain (queue redelivery). The second
    // must see the first's result, not the original list.
    const { apps, outcomes } = applyConfirmations([], [confirmation(), confirmation()], () => "only-one");
    expect(apps).toHaveLength(1);
    expect(outcomes.map((o) => o.action)).toEqual(["created", "already-applied"]);
  });

  it("handles a mix of updates and creations", () => {
    let n = 0;
    const { apps, outcomes } = applyConfirmations(
      [app()],
      [confirmation(), confirmation({ key: "k2", company: "Globex", title: "Data Scientist", jobId: "JR-9" })],
      () => `new-${n++}`,
    );
    expect(outcomes.map((o) => o.action)).toEqual(["updated", "created"]);
    expect(apps).toHaveLength(2);
  });

  it("returns one outcome per confirmation, keyed for acknowledgement", () => {
    const { outcomes } = applyConfirmations([app()], [confirmation({ key: "abc" })]);
    expect(outcomes).toHaveLength(1);
    // The web app acknowledges by key; a missing key would leave the
    // confirmation queued forever.
    expect(outcomes[0].key).toBe("abc");
  });

  it("handles an empty batch", () => {
    const input = [app()];
    const { apps, outcomes } = applyConfirmations(input, []);
    expect(apps).toBe(input);
    expect(outcomes).toEqual([]);
  });
});
