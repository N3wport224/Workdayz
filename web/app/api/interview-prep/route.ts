import { NextResponse } from "next/server";
import { generateInterviewPrep, type InterviewPrepInput } from "@/lib/interview-prep";

export async function POST(request: Request) {
  let body: Partial<InterviewPrepInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.job?.title || !body.job.description || body.job.description.length < 50) {
    return NextResponse.json(
      { error: "This application is missing its job description — re-tailor it first." },
      { status: 400 },
    );
  }
  if (body.job.description.length > 60_000) {
    return NextResponse.json({ error: "Job description is too long." }, { status: 413 });
  }

  try {
    const prep = await generateInterviewPrep({
      job: body.job,
      summary: body.summary ?? "",
      skills: Array.isArray(body.skills) ? body.skills : [],
      experience: Array.isArray(body.experience) ? body.experience : [],
      gaps: Array.isArray(body.gaps) ? body.gaps : undefined,
    });
    return NextResponse.json({ prep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Interview prep generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
