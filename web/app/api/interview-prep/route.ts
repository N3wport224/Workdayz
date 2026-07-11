import { NextResponse } from "next/server";
import { generateInterviewPrep, type InterviewPrepInput } from "@/lib/interview-prep";
import { shapeExperienceItems, strArr } from "@/lib/request-shape";
import { describeAnthropicError } from "@/lib/api-error";

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
      skills: strArr(body.skills),
      experience: shapeExperienceItems(body.experience),
      gaps: Array.isArray(body.gaps) ? strArr(body.gaps).slice(0, 10) : undefined,
    });
    return NextResponse.json({ prep });
  } catch (err) {
    const { message, status } = describeAnthropicError(err, "Interview prep generation failed.");
    return NextResponse.json({ error: message }, { status });
  }
}
