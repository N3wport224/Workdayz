import { NextResponse } from "next/server";
import { rankProfileBullets } from "@/lib/rank-bullets";
import { refineProfileRanking } from "@/lib/refine-bullet-ranking";
import { str, strArr } from "@/lib/request-shape";
import { describeAnthropicError } from "@/lib/api-error";

// The deterministic path costs nothing, so only the opt-in LLM refinement is
// rate-limited. Same window/shape as /api/tailor.
const WINDOW_MS = 60_000;
const MAX_REFINE_CALLS_PER_WINDOW = 12;
let refineTimes: number[] = [];

function refineRateLimited(): boolean {
  const now = Date.now();
  refineTimes = refineTimes.filter((t) => now - t < WINDOW_MS);
  if (refineTimes.length >= MAX_REFINE_CALLS_PER_WINDOW) return true;
  refineTimes.push(now);
  return false;
}

interface RankRequest {
  jobTitle?: unknown;
  jobDescription?: unknown;
  experience?: unknown;
  maxKeep?: unknown;
  minKeep?: unknown;
  minScore?: unknown;
  /** Opt in to the LLM semantic pass. Default false — deterministic is free. */
  semantic?: unknown;
}

/** Ranking needs bullet ids to map results back, so it shapes experience
 * itself rather than using shapeExperienceItems (which drops id). */
function shapeRankableExperience(v: unknown) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
    .map((e, i) => ({
      id: str(e.id) || `role-${i}`,
      title: str(e.title),
      company: str(e.company),
      bullets: strArr(e.bullets),
    }));
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;

export async function POST(request: Request) {
  let body: RankRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const jobDescription = str(body.jobDescription);
  const jobTitle = str(body.jobTitle);
  if (!jobDescription.trim()) {
    return NextResponse.json({ error: "Missing job description." }, { status: 400 });
  }
  if (jobDescription.length > 60_000) {
    return NextResponse.json({ error: "Job description is too long." }, { status: 413 });
  }

  const experience = shapeRankableExperience(body.experience);
  if (experience.length === 0) {
    return NextResponse.json({ error: "No experience entries to rank." }, { status: 400 });
  }

  const options = {
    maxKeep: Math.min(20, Math.max(1, num(body.maxKeep, 5))),
    minKeep: Math.max(0, num(body.minKeep, 2)),
    minScore: Math.max(0, num(body.minScore, 0)),
  };

  // Always compute the free ranking — it's also the fallback if refinement fails.
  const deterministic = rankProfileBullets(experience, jobDescription, jobTitle, options);

  if (body.semantic !== true) {
    return NextResponse.json({ roles: deterministic, method: "keyword" });
  }

  if (refineRateLimited()) {
    return NextResponse.json({
      roles: deterministic,
      method: "keyword",
      note: `Rate limit: more than ${MAX_REFINE_CALLS_PER_WINDOW} semantic ranking calls in a minute — returned the keyword ranking instead.`,
    });
  }

  try {
    const refined = await refineProfileRanking(deterministic, jobDescription, jobTitle, {
      maxKeep: options.maxKeep,
    });
    return NextResponse.json({
      roles: refined.map((r) => r.role),
      method: refined.some((r) => r.refined) ? "semantic" : "keyword",
      notes: refined.map((r) => ({ roleId: r.role.roleId, refined: r.refined, note: r.note })),
    });
  } catch (err) {
    // Refinement is a nicety; a failure returns the free ranking, not a 500.
    const { message } = describeAnthropicError(err, "Semantic ranking failed.");
    return NextResponse.json({ roles: deterministic, method: "keyword", note: message });
  }
}
