import { NextResponse } from "next/server";
import { answerQuestions, type AnswerQuestionsInput } from "@/lib/answer-questions";
import { shapeExperienceItems, strArr } from "@/lib/request-shape";

// Called cross-origin by the browser extension's background service worker
// (which has explicit host permission for this origin), as well as by the
// web app itself.

export async function POST(request: Request) {
  let body: Partial<AnswerQuestionsInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.job?.title || !body.job.description) {
    return NextResponse.json({ error: "Missing job context." }, { status: 400 });
  }
  if (body.job.description.length > 60_000) {
    return NextResponse.json({ error: "Job description is too long." }, { status: 413 });
  }

  const questions = (Array.isArray(body.questions) ? body.questions : [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.slice(0, 2000))
    .slice(0, 15);
  if (questions.length === 0) {
    return NextResponse.json({ error: "No questions provided." }, { status: 400 });
  }

  try {
    const answers = await answerQuestions({
      job: body.job,
      summary: body.summary ?? "",
      skills: strArr(body.skills),
      experience: shapeExperienceItems(body.experience),
      questions,
    });
    return NextResponse.json({ answers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Answer drafting failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
