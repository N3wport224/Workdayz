import { NextResponse } from "next/server";
import type { ResumePdfProps } from "@/lib/pdf/ResumeDocument";
import { resumeToDocx } from "@/lib/resume-docx";
import { safeFilenamePart } from "@/lib/safe-filename";

export async function POST(request: Request) {
  let body: ResumePdfProps & { companyName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body?.contact?.firstName) {
    return NextResponse.json({ error: "Missing resume data." }, { status: 400 });
  }
  if (JSON.stringify(body).length > 300_000) {
    return NextResponse.json({ error: "Resume payload is too large to render." }, { status: 413 });
  }

  try {
    const buffer = await resumeToDocx(body);
    const companyPart = body.companyName ? safeFilenamePart(body.companyName, "") : "";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFilenamePart(`${body.contact.firstName}_${body.contact.lastName}`, "Candidate")}_Resume${companyPart ? `_${companyPart}` : ""}.docx"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DOCX generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
