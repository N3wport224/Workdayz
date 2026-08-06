import { NextResponse } from "next/server";
import {
  generateCoverLetter,
  resolveMaxChars,
  type CoverLetterInput,
} from "@/lib/cover-letter";
import { COVER_LETTER_TONES, type CoverLetterTone } from "@/lib/tones";
import { shapeExperienceItems, str, strArr } from "@/lib/request-shape";
import { describeAnthropicError } from "@/lib/api-error";

// Cost guard, same shape as /api/tailor: a runaway client loop can't quietly
// burn API credits. Sliding one-minute window, per server process.
const WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = 12;
let callTimes: number[] = [];

function rateLimited(): boolean {
  const now = Date.now();
  callTimes = callTimes.filter((t) => now - t < WINDOW_MS);
  if (callTimes.length >= MAX_CALLS_PER_WINDOW) return true;
  callTimes.push(now);
  return false;
}

export async function POST(request: Request) {
  let body: Partial<CoverLetterInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (rateLimited()) {
    return NextResponse.json(
      {
        error: `Rate limit: more than ${MAX_CALLS_PER_WINDOW} cover-letter calls in a minute — pausing to protect your API credits. Wait a moment and retry.`,
      },
      { status: 429 },
    );
  }

  if (!body.job?.title || !body.job.company) {
    return NextResponse.json({ error: "Missing job title or company." }, { status: 400 });
  }
  if ((body.job.description ?? "").length > 60_000) {
    return NextResponse.json({ error: "Job description is too long." }, { status: 413 });
  }

  const tone: CoverLetterTone | undefined =
    typeof body.tone === "string" && body.tone in COVER_LETTER_TONES
      ? (body.tone as CoverLetterTone)
      : undefined;

  try {
    const letter = await generateCoverLetter({
      job: {
        title: str(body.job.title),
        company: str(body.job.company),
        location: str(body.job.location),
        description: str(body.job.description),
      },
      summary: str(body.summary),
      skills: strArr(body.skills),
      experience: shapeExperienceItems(body.experience),
      candidateName: str(body.candidateName).slice(0, 120),
      tone,
      // Clamped in the lib too; resolved here so the response echoes the
      // effective cap even when the request asked for something out of range.
      maxChars: resolveMaxChars(body.maxChars),
      context: str(body.context).slice(0, 2000),
    });
    return NextResponse.json({ letter });
  } catch (err) {
    const { message, status } = describeAnthropicError(err, "Cover-letter generation failed.");
    return NextResponse.json({ error: message }, { status });
  }
}
