import { NextResponse } from "next/server";
import { generateMessage, MESSAGE_KINDS, type GenerateMessageInput, type MessageKind } from "@/lib/generate-message";
import { shapeExperienceItems, str, strArr } from "@/lib/request-shape";
import { describeAnthropicError } from "@/lib/api-error";

export async function POST(request: Request) {
  let body: Partial<GenerateMessageInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.kind || !(body.kind in MESSAGE_KINDS)) {
    return NextResponse.json({ error: "Unknown message kind." }, { status: 400 });
  }
  if (!body.job?.title || !body.job.company) {
    return NextResponse.json({ error: "Missing job context." }, { status: 400 });
  }
  if ((body.job.description ?? "").length > 60_000) {
    return NextResponse.json({ error: "Job description is too long." }, { status: 413 });
  }

  try {
    const message = await generateMessage({
      kind: body.kind as MessageKind,
      job: { ...body.job, description: body.job.description ?? "" },
      summary: str(body.summary),
      skills: strArr(body.skills),
      experience: shapeExperienceItems(body.experience),
      context: str(body.context).slice(0, 2000),
    });
    return NextResponse.json({ message });
  } catch (err) {
    const { message, status } = describeAnthropicError(err, "Message drafting failed.");
    return NextResponse.json({ error: message }, { status });
  }
}
