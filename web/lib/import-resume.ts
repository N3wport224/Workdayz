import Anthropic from "@anthropic-ai/sdk";
import type { ResumeProfile } from "./types";

const MODEL = "claude-sonnet-5";
const TOOL_NAME = "submit_parsed_resume";

export async function importResume(resumeText: string): Promise<ResumeProfile> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to web/.env.local to enable resume import.",
    );
  }

  const client = new Anthropic({ apiKey });

  const system = `You extract structured resume data from raw resume text. Copy content faithfully — do not invent, embellish, or summarize away details. Preserve the candidate's original wording for bullet points as closely as possible; only clean up obvious OCR/copy-paste artifacts (stray line breaks mid-sentence, bullet glyphs, repeated whitespace). If a field isn't present in the text, leave it as an empty string/array rather than guessing.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: `RESUME TEXT:\n\n${resumeText}\n\nCall ${TOOL_NAME} with the extracted data.` }],
    tools: [
      {
        name: TOOL_NAME,
        description: "Submit the resume data extracted from raw text.",
        input_schema: {
          type: "object",
          properties: {
            contact: {
              type: "object",
              properties: {
                firstName: { type: "string" },
                lastName: { type: "string" },
                email: { type: "string" },
                phone: { type: "string" },
                address: { type: "string" },
                city: { type: "string" },
                state: { type: "string" },
                postalCode: { type: "string" },
                country: { type: "string" },
                linkedin: { type: "string" },
                website: { type: "string" },
              },
              required: ["firstName", "lastName", "email", "phone"],
            },
            summary: { type: "string" },
            skills: { type: "array", items: { type: "string" } },
            experience: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  company: { type: "string" },
                  title: { type: "string" },
                  location: { type: "string" },
                  startDate: { type: "string", description: "e.g. 2021-06" },
                  endDate: { type: "string", description: "e.g. 2023-09 or Present" },
                  bullets: { type: "array", items: { type: "string" } },
                },
                required: ["company", "title", "bullets"],
              },
            },
            education: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  school: { type: "string" },
                  degree: { type: "string" },
                  fieldOfStudy: { type: "string" },
                  startDate: { type: "string" },
                  endDate: { type: "string" },
                  gpa: { type: "string" },
                },
                required: ["school", "degree"],
              },
            },
            certifications: { type: "array", items: { type: "string" } },
          },
          required: ["contact", "summary", "skills", "experience", "education", "certifications"],
        },
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Could not parse a resume from that text.");
  }

  const input = toolUse.input as Omit<ResumeProfile, "experience" | "education"> & {
    experience: Omit<ResumeProfile["experience"][number], "id">[];
    education: Omit<ResumeProfile["education"][number], "id">[];
  };

  return {
    ...input,
    experience: input.experience.map((e) => ({ ...e, id: crypto.randomUUID() })),
    education: input.education.map((e) => ({ ...e, id: crypto.randomUUID() })),
  };
}
