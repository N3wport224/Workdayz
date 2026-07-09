import { NextResponse } from "next/server";
import { importResume } from "@/lib/import-resume";

// ~10 MB of PDF, base64-encoded (4/3 expansion).
const MAX_PDF_BASE64_CHARS = 14_000_000;

export async function POST(request: Request) {
  let body: { resumeText?: string; resumePdfBase64?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = body.resumeText?.trim();
  const pdfBase64 = body.resumePdfBase64;

  if (pdfBase64) {
    if (pdfBase64.length > MAX_PDF_BASE64_CHARS) {
      return NextResponse.json(
        { error: "That PDF is too large (max ~10 MB)." },
        { status: 413 },
      );
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(pdfBase64.slice(0, 1000))) {
      return NextResponse.json({ error: "Invalid PDF data." }, { status: 400 });
    }
  } else if (!text || text.length < 50) {
    return NextResponse.json(
      { error: "Paste more of your resume text — that looked too short to parse." },
      { status: 400 },
    );
  }

  try {
    const profile = await importResume(pdfBase64 ? { pdfBase64 } : { text });
    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resume import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
