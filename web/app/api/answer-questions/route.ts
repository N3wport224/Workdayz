import { NextRequest, NextResponse } from "next/server";
import { answerQuestions } from "@/lib/tailor";
import type { ResumeProfile, JobPosting } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      questions: string[];
      profile: ResumeProfile;
      job: JobPosting;
      anthropicKey?: string;
    };

    if (!body.questions?.length || !body.profile) {
      return NextResponse.json({ error: "Missing questions or profile data" }, { status: 400 });
    }

    const apiKey = body.anthropicKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "No API key configured" }, { status: 400 });
    }

    const answers = await answerQuestions(body.questions, body.profile, body.job, apiKey);
    return NextResponse.json({ answers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}