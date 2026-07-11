import { NextResponse } from "next/server";

// Setup self-check for the home page checklist. Reports presence only —
// never the key itself.
export async function GET() {
  return NextResponse.json({
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}
