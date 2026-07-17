import { NextRequest, NextResponse } from "next/server";
import { tailor } from "@/lib/tailor";
import { scoreResume } from "@/lib/ats-score";
import type { ResumeProfile, JobPosting } from "@/lib/types";

// Item 84: cost guard — a runaway client loop (bug, stuck retry, batch gone
// wrong) can't silently burn API credits. Sliding one-minute window,
// in-memory per server process; generous enough for real use (batch mode
// tops out at 10 sequential calls).
const WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = 12;
let callTimes: number[] = [];

function rateLimited(): boolean {
  const now = Date.now();
  callTimes = callTimes.filter((t) => now - t < WINDOW_MS);
  if (callTimes.length >= MAX_CALLS_PER_WINDOW) return true;
  callTimes.push(now);
  return false;
}

export async function POST(request: NextRequest) {
  try {
    if (rateLimited()) {
      return NextResponse.json(
        { error: `Rate limit: more than ${MAX_CALLS_PER_WINDOW} tailoring calls in a minute — pausing to protect your API credits. Wait a moment and retry.` },
        { status: 429 },
      );
    }
    const body = await request.json() as {
      profile: ResumeProfile;
      job: JobPosting;
      anthropicKey?: string;
      model?: string;
      industry?: string;
      coverLetterTone?: string;
      coverLetterLength?: "short" | "medium" | "long";
    };

    if (!body.profile || !body.job) {
      return NextResponse.json({ error: "Missing profile or job data" }, { status: 400 });
    }

    const apiKey = body.anthropicKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "No Anthropic API key configured. Set ANTHROPIC_API_KEY in your .env.local or provide one in the request." },
        { status: 400 },
      );
    }

    const result = await tailor(body.profile, body.job, apiKey, body.model, {
      industry: typeof body.industry === "string" ? body.industry.slice(0, 60) : undefined,
      coverLetterTone: typeof body.coverLetterTone === "string" ? body.coverLetterTone.slice(0, 60) : undefined,
      coverLetterLength: body.coverLetterLength,
    });

    // Score the tailored result
    const atsBreakdown = scoreResume(
      body.job.description,
      body.job.title,
      result.summary,
      result.skills,
      result.bullets.map((b) => b.tailored),
      body.profile,
    );

    // Score variants
    const scoredVariants = result.variants.map((v) => ({
      ...v,
      atsScore: scoreResume(
        body.job.description,
        body.job.title,
        v.tailoredSummary,
        v.tailoredSkills,
        v.tailoredBullets.map((b) => b.tailored),
        body.profile,
      ).score,
    }));

    return NextResponse.json({
      ...result,
      variants: scoredVariants,
      atsBreakdown,
      atsScore: atsBreakdown.score,
      estimatedCost: result.estimatedCost,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}