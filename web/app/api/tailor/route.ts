import { NextResponse } from "next/server";
import type { JobPosting, ResumeProfile } from "@/lib/types";
import { tailorApplication, type TailorOptions } from "@/lib/tailor";
import { shapeProfile, strArr } from "@/lib/request-shape";
import { describeAnthropicError } from "@/lib/api-error";
import { COVER_LETTER_LENGTHS, COVER_LETTER_TONES } from "@/lib/tones";

export async function POST(request: Request) {
  let body: { profile?: ResumeProfile; job?: JobPosting; options?: TailorOptions };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { profile, job } = body;
  if (!profile || !job) {
    return NextResponse.json(
      { error: "Both `profile` and `job` are required." },
      { status: 400 },
    );
  }
  if (!job.description || job.description.trim().length < 50) {
    return NextResponse.json(
      { error: "Job description looks too short to tailor against." },
      { status: 400 },
    );
  }
  if (job.description.length > 60_000) {
    return NextResponse.json(
      { error: "Job description is too long (max ~60k characters) — trim it to the relevant sections." },
      { status: 413 },
    );
  }

  const options: TailorOptions = {};
  if (body.options?.tone && body.options.tone in COVER_LETTER_TONES) {
    options.tone = body.options.tone;
  }
  if (body.options?.length && body.options.length in COVER_LETTER_LENGTHS) {
    options.length = body.options.length;
  }
  if (typeof body.options?.extraInstructions === "string") {
    options.extraInstructions = body.options.extraInstructions.slice(0, 2000);
  }
  if (Array.isArray(body.options?.emphasisKeywords)) {
    options.emphasisKeywords = strArr(body.options.emphasisKeywords)
      .map((k) => k.slice(0, 200))
      .slice(0, 30);
  }

  try {
    const result = await tailorApplication(shapeProfile(profile), job, options);
    return NextResponse.json(result);
  } catch (err) {
    const { message, status } = describeAnthropicError(err, "Tailoring failed.");
    return NextResponse.json({ error: message }, { status });
  }
}
