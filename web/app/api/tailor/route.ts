import { NextResponse } from "next/server";
import type { JobPosting, ResumeProfile } from "@/lib/types";
import { tailorApplication } from "@/lib/tailor";

export async function POST(request: Request) {
  let body: { profile?: ResumeProfile; job?: JobPosting };
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

  try {
    const result = await tailorApplication(profile, job);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tailoring failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
