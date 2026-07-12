import { NextResponse } from "next/server";
import { rewriteBullet, type RewriteBulletInput } from "@/lib/rewrite-bullet";
import { describeAnthropicError } from "@/lib/api-error";
import { str, strArr } from "@/lib/request-shape";

export async function POST(request: Request) {
  let body: Partial<RewriteBulletInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const currentBullet = str(body.currentBullet).slice(0, 1000);
  const sourceBullets = strArr(body.sourceBullets).map((b) => b.slice(0, 1000)).slice(0, 20);
  if (!currentBullet || sourceBullets.length === 0) {
    return NextResponse.json(
      { error: "Both the current bullet and the original bullets are required." },
      { status: 400 },
    );
  }
  if ((body.jobDescription ?? "").length > 60_000) {
    return NextResponse.json({ error: "Job description is too long." }, { status: 413 });
  }

  try {
    const result = await rewriteBullet({
      currentBullet,
      sourceBullets,
      roleTitle: str(body.roleTitle).slice(0, 200),
      jobTitle: str(body.jobTitle).slice(0, 200),
      jobDescription: str(body.jobDescription),
      instruction: str(body.instruction),
    });
    return NextResponse.json(result);
  } catch (err) {
    const { message, status } = describeAnthropicError(err, "Bullet rewrite failed.");
    return NextResponse.json({ error: message }, { status });
  }
}
