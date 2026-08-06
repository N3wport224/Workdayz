import { describe, expect, it } from "vitest";
import {
  buildJobKeywordIndex,
  rankProfileBullets,
  rankRoleBullets,
  scoreBullet,
  topBulletsAcrossRoles,
} from "./rank-bullets";

const JD = `
We are hiring a Senior Kubernetes Platform Engineer. You will own our
Kubernetes clusters, build CI/CD pipelines, and drive infrastructure as code
adoption across teams. Experience with Terraform and observability is required.
Kubernetes experience is essential. You will also mentor engineers.
`;
const TITLE = "Senior Kubernetes Platform Engineer";

const role = (bullets: string[], id = "r1") => ({
  id,
  title: "Platform Engineer",
  company: "Acme",
  bullets,
});

describe("buildJobKeywordIndex", () => {
  it("extracts weighted terms from the posting", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    expect(index.terms.length).toBeGreaterThan(0);
    expect(index.totalWeight).toBeGreaterThan(0);
  });

  it("weights title keywords above body-only keywords", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const kubernetes = index.terms.find((t) => t.term === "kubernetes");
    const mentor = index.terms.find((t) => t.term === "mentor");
    expect(kubernetes).toBeDefined();
    expect(mentor).toBeDefined();
    expect(kubernetes!.weight).toBeGreaterThan(mentor!.weight);
  });

  it("dedupes repeated terms into a single entry", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const hits = index.terms.filter((t) => t.term === "kubernetes");
    expect(hits).toHaveLength(1);
  });

  it("survives an empty posting without dividing by zero", () => {
    const index = buildJobKeywordIndex("", "");
    expect(index.totalWeight).toBe(0);
    expect(scoreBullet("Did some work on things", 0, index).score).toBe(0);
  });
});

describe("scoreBullet", () => {
  it("scores a relevant bullet above an irrelevant one", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const relevant = scoreBullet("Ran Kubernetes clusters and built CI/CD pipelines", 0, index);
    const irrelevant = scoreBullet("Organized the office holiday party for 40 people", 1, index);
    expect(relevant.score).toBeGreaterThan(irrelevant.score);
  });

  it("reports which keywords drove the score", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const scored = scoreBullet("Managed Terraform modules for infrastructure as code", 0, index);
    expect(scored.matchedKeywords.join(" ")).toContain("terraform");
    expect(scored.score).toBeGreaterThan(0);
  });

  it("matches known aliases (k8s <-> kubernetes)", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const alias = scoreBullet("Migrated 30 services onto k8s", 0, index);
    expect(alias.score).toBeGreaterThan(0);
  });

  it("length-normalizes so padding does not win", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const tight = scoreBullet("Owned Kubernetes clusters and CI/CD pipelines", 0, index);
    const padded = scoreBullet(
      "Owned Kubernetes clusters and CI/CD pipelines while also attending numerous " +
        "meetings and writing many documents and generally being present in the office " +
        "for a considerable number of hours each and every week without fail",
      1,
      index,
    );
    expect(tight.score).toBeGreaterThan(padded.score);
  });

  it("preserves the bullet's original index", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    expect(scoreBullet("Anything", 7, index).index).toBe(7);
  });

  it("handles an empty bullet", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const scored = scoreBullet("   ", 0, index);
    expect(scored.score).toBe(0);
    expect(scored.matchedKeywords).toEqual([]);
  });

  it("caps the score at 100", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const stuffed = scoreBullet("Kubernetes CI/CD Terraform observability infrastructure as code", 0, index);
    expect(stuffed.score).toBeLessThanOrEqual(100);
  });

  // Regression guard. extractKeywords emits every 1-4 word window, so echoing
  // one long JD phrase used to bank a hit for the phrase AND all its sub-grams
  // ("infrastructure as code adoption" scored 8 hits / 54.9 vs a title-keyword
  // bullet's 3 hits / 20.6). Without the collapse, phrase-echoing bullets
  // systematically outrank genuinely central ones.
  it("credits an overlapping phrase once, not once per sub-gram", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const scored = scoreBullet("Drove Terraform infrastructure as code adoption", 0, index);
    // Two distinct concepts matched: the IaC phrase and Terraform.
    expect(scored.matchedKeywords).toHaveLength(2);
    expect(scored.matchedKeywords).toContain("terraform");
    // The maximal n-gram survives; its sub-grams do not appear separately.
    expect(scored.matchedKeywords).toContain("infrastructure as code adoption");
    expect(scored.matchedKeywords).not.toContain("infrastructure");
    expect(scored.matchedKeywords).not.toContain("as code");
  });

  it("keeps a subsumed term's title weight when collapsing", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    // "kubernetes" is a title keyword (2x) living inside "kubernetes clusters"
    // (1.2x). Collapsing to the longer term must not discard the title bonus,
    // so this must still beat an equal-length match on a non-title phrase.
    const titleMatch = scoreBullet("Owned Kubernetes clusters for many teams", 0, index);
    const bodyMatch = scoreBullet("Owned CI/CD pipelines for many teams", 1, index);
    expect(titleMatch.matchedKeywords).toEqual(["kubernetes clusters"]);
    expect(titleMatch.score).toBeGreaterThan(bodyMatch.score);
  });
});

describe("rankRoleBullets", () => {
  const bullets = [
    "Organized the office holiday party for 40 people",       // 0 irrelevant
    "Owned 12 Kubernetes clusters serving 200 microservices", // 1 highly relevant
    "Answered support tickets",                                // 2 irrelevant
    "Built CI/CD pipelines cutting deploy time 60%",          // 3 relevant
    "Drove Terraform infrastructure as code adoption",        // 4 relevant
  ];

  it("ranks every relevant bullet above every irrelevant one", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const order = rankRoleBullets(role(bullets), index).ranked.map((b) => b.index);
    // Asserting a single specific winner would be brittle — 1, 3 and 4 are all
    // genuinely relevant, and their relative order is a judgment call. The real
    // invariant is that the filler (0, 2) never outranks substance.
    const worstRelevant = Math.max(order.indexOf(1), order.indexOf(3), order.indexOf(4));
    const bestIrrelevant = Math.min(order.indexOf(0), order.indexOf(2));
    expect(worstRelevant).toBeLessThan(bestIrrelevant);
  });

  it("keeps every bullet in `ranked`, even ones not selected", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const result = rankRoleBullets(role(bullets), index, { maxKeep: 3 });
    expect(result.ranked).toHaveLength(bullets.length);
    expect(result.selected).toHaveLength(3);
  });

  it("honors maxKeep", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    expect(rankRoleBullets(role(bullets), index, { maxKeep: 3 }).selected).toHaveLength(3);
    expect(rankRoleBullets(role(bullets), index, { maxKeep: 5 }).selected).toHaveLength(5);
  });

  it("selects the relevant bullets and drops the irrelevant ones", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const selected = rankRoleBullets(role(bullets), index, { maxKeep: 3 }).selected.map((b) => b.index);
    expect(selected).toContain(1);
    expect(selected).not.toContain(0); // holiday party
    expect(selected).not.toContain(2); // support tickets
  });

  it("keeps minKeep bullets even when all score below minScore", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const weak = role(["Answered phones", "Filed paperwork", "Watered the plants"]);
    const result = rankRoleBullets(weak, index, { minScore: 99, minKeep: 2, maxKeep: 5 });
    // A role showing zero bullets reads as a gap in your history.
    expect(result.selected).toHaveLength(2);
  });

  it("never exceeds maxKeep even when minKeep is larger", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const result = rankRoleBullets(role(bullets), index, { minKeep: 10, maxKeep: 2 });
    expect(result.selected).toHaveLength(2);
  });

  it("is stable: equal scores keep original order", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    // Three bullets with no keyword overlap all score 0.
    const tied = role(["Aaa bbb ccc ddd", "Eee fff ggg hhh", "Iii jjj kkk lll"]);
    const first = rankRoleBullets(tied, index).ranked.map((b) => b.index);
    const second = rankRoleBullets(tied, index).ranked.map((b) => b.index);
    expect(first).toEqual([0, 1, 2]);
    expect(second).toEqual(first); // re-running is not a diff
  });

  it("handles a role with no bullets", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const result = rankRoleBullets(role([]), index);
    expect(result.ranked).toEqual([]);
    expect(result.selected).toEqual([]);
  });

  it("carries the role identity through", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const result = rankRoleBullets(role(bullets, "role-abc"), index);
    expect(result.roleId).toBe("role-abc");
    expect(result.title).toBe("Platform Engineer");
    expect(result.company).toBe("Acme");
  });

  it("attaches a strength rating from bullet-strength", () => {
    const index = buildJobKeywordIndex(JD, TITLE);
    const result = rankRoleBullets(role(["Built CI/CD pipelines cutting deploy time 60%"]), index);
    expect(["strong", "ok", "weak"]).toContain(result.ranked[0].strength);
  });
});

describe("rankProfileBullets", () => {
  it("ranks every role", () => {
    const roles = rankProfileBullets(
      [
        role(["Owned Kubernetes clusters", "Filed paperwork"], "a"),
        role(["Built CI/CD pipelines", "Answered phones"], "b"),
      ],
      JD,
      TITLE,
    );
    expect(roles).toHaveLength(2);
    expect(roles.map((r) => r.roleId)).toEqual(["a", "b"]);
  });

  it("returns an empty list for empty experience", () => {
    expect(rankProfileBullets([], JD, TITLE)).toEqual([]);
  });
});

describe("topBulletsAcrossRoles", () => {
  it("returns the strongest bullets across all roles, best first", () => {
    const top = topBulletsAcrossRoles(
      [
        role(["Filed paperwork", "Owned 12 Kubernetes clusters"], "a"),
        role(["Answered phones", "Built CI/CD pipelines cutting deploys 60%"], "b"),
      ],
      JD,
      TITLE,
      2,
    );
    expect(top).toHaveLength(2);
    expect(top[0].score).toBeGreaterThanOrEqual(top[1].score);
    // Both picks should be the relevant ones, not the filler.
    expect(top.map((b) => b.text).join(" ")).not.toContain("paperwork");
  });

  it("tags each bullet with its source role", () => {
    const top = topBulletsAcrossRoles([role(["Owned Kubernetes clusters"], "role-x")], JD, TITLE, 1);
    expect(top[0].roleId).toBe("role-x");
    expect(top[0].company).toBe("Acme");
  });

  it("respects the limit and tolerates limit 0", () => {
    const experience = [role(["Owned Kubernetes clusters", "Built CI/CD pipelines"], "a")];
    expect(topBulletsAcrossRoles(experience, JD, TITLE, 1)).toHaveLength(1);
    expect(topBulletsAcrossRoles(experience, JD, TITLE, 0)).toHaveLength(0);
  });
});
