import { NextResponse } from "next/server";
import { importResume } from "@/lib/import-resume";

export async function POST(request: Request) {
  let body: { resumeText?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.resumeText || body.resumeText.trim().length < 50) {
    return NextResponse.json(
      { error: "Paste more of your resume text — that looked too short to parse." },
      { status: 400 },
    );
  }

  try {
    const profile = await importResume(body.resumeText);
    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resume import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
