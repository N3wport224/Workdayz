import Anthropic from "@anthropic-ai/sdk";
import type { JobPosting, ResumeProfile, TailorResult } from "./types";
import { computeAtsScore } from "./ats-score";

const MODEL = "claude-sonnet-5";

const TOOL_NAME = "submit_tailored_application";

function buildProfileBlock(profile: ResumeProfile): string {
  const experience = profile.experience
    .map(
      (e) =>
        `- id: ${e.id}\n  ${e.title} at ${e.company} (${e.startDate} - ${e.endDate})\n  ${e.bullets.map((b) => `  * ${b}`).join("\n")}`,
    )
    .join("\n");
  const education = profile.education
    .map(
      (ed) =>
        `- ${ed.degree} in ${ed.fieldOfStudy}, ${ed.school} (${ed.startDate} - ${ed.endDate})`,
    )
    .join("\n");

  return `SUMMARY:\n${profile.summary}\n\nSKILLS:\n${profile.skills.join(", ")}\n\nEXPERIENCE:\n${experience}\n\nEDUCATION:\n${education}\n\nCERTIFICATIONS:\n${profile.certifications.join(", ")}`;
}

export async function tailorApplication(
  profile: ResumeProfile,
  job: JobPosting,
): Promise<TailorResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to web/.env.local to enable tailoring.",
    );
  }

  const client = new Anthropic({ apiKey });

  const system = `You help a job applicant tailor their existing resume and write a cover letter for a specific job posting.

Hard rules:
- Never invent employers, titles, dates, degrees, or accomplishments that are not present in the candidate's original resume below.
- You MAY rephrase, reorder, emphasize, and select from the candidate's real experience to better match the job description, and you MAY surface skills/tools the candidate's bullets already demonstrate even if not in their skills list.
- Do not fabricate metrics. Only include a number if it was already present in the source bullet, or is a faithful rephrasing of one that was.
- Keep each experience entry's "id" exactly as given so it can be mapped back to the source entry.
- Write the cover letter in the candidate's voice: confident, specific to this company/role, 3-4 short paragraphs, no generic filler ("I am writing to express my interest..." is banned as an opener).
- Extract 10-20 ATS keywords/skills/requirements from the job description, ordered by importance, using the same phrasing/casing a recruiter's ATS would search for (e.g. "React", "SQL", "stakeholder management").`;

  const userMessage = `CANDIDATE'S ORIGINAL RESUME:\n${buildProfileBlock(profile)}\n\n---\n\nJOB POSTING:\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\n\nDescription:\n${job.description}\n\n---\n\nTailor the resume content and write the cover letter for this job. Call the ${TOOL_NAME} tool with your result.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userMessage }],
    tools: [
      {
        name: TOOL_NAME,
        description:
          "Submit the tailored resume content, cover letter, and extracted ATS keywords.",
        input_schema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "2-4 sentence professional summary tailored to this job.",
            },
            skills: {
              type: "array",
              items: { type: "string" },
              description: "Ordered list of skills to highlight, most relevant first.",
            },
            experience: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  bullets: { type: "array", items: { type: "string" } },
                },
                required: ["id", "bullets"],
              },
            },
            coverLetter: { type: "string" },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "10-20 ATS keywords extracted from the job description, ranked by importance.",
            },
          },
          required: ["summary", "skills", "experience", "coverLetter", "keywords"],
        },
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Model did not return a tailored application.");
  }

  const input = toolUse.input as {
    summary: string;
    skills: string[];
    experience: { id: string; bullets: string[] }[];
    coverLetter: string;
    keywords: string[];
  };

  const tailoredResume = {
    summary: input.summary,
    skills: input.skills,
    experience: input.experience,
  };

  const atsScore = computeAtsScore(input.keywords, tailoredResume, profile);

  return { tailoredResume, coverLetter: input.coverLetter, atsScore };
}
