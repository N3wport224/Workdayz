import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { ResumeDocument, type ResumePdfProps } from "@/lib/pdf/ResumeDocument";

export async function POST(request: Request) {
  let body: ResumePdfProps;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body?.contact?.firstName) {
    return NextResponse.json({ error: "Missing resume data." }, { status: 400 });
  }

  try {
    const element = createElement(ResumeDocument, body) as Parameters<typeof renderToBuffer>[0];
    const buffer = await renderToBuffer(element);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${body.contact.firstName}_${body.contact.lastName}_Resume.pdf"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
