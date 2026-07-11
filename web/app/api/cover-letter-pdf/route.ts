import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import {
  CoverLetterDocument,
  type CoverLetterPdfProps,
} from "@/lib/pdf/CoverLetterDocument";
import { safeFilenamePart } from "@/lib/safe-filename";

export async function POST(request: Request) {
  let body: CoverLetterPdfProps;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body?.contact?.firstName || !body?.bodyText) {
    return NextResponse.json({ error: "Missing cover letter data." }, { status: 400 });
  }
  if (body.bodyText.length > 30_000) {
    return NextResponse.json({ error: "Cover letter is too long to render." }, { status: 413 });
  }

  try {
    const element = createElement(CoverLetterDocument, body) as Parameters<typeof renderToBuffer>[0];
    const buffer = await renderToBuffer(element);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilenamePart(`${body.contact.firstName}_${body.contact.lastName}`, "Candidate")}_Cover_Letter${body.companyName ? `_${safeFilenamePart(body.companyName, "")}` : ""}.pdf"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
