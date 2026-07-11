// Rough page-count estimate for the generated resume PDF, derived from the
// same layout constants as lib/pdf/ResumeDocument.tsx (US Letter, 10.5pt,
// ~54 usable lines per page, ~95 chars per line).

const LINES_PER_PAGE = 54;
const CHARS_PER_LINE = 95;

function linesFor(text: string): number {
  if (!text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
}

export interface ResumeContent {
  summary: string;
  skills: string[];
  experience: { title: string; company: string; bullets: string[] }[];
  education: { school: string; degree: string }[];
  certifications: string[];
}

export function estimateResumePages(content: ResumeContent): number {
  let lines = 3; // name + contact line + spacing

  if (content.summary.trim()) lines += 2 + linesFor(content.summary);
  if (content.skills.length) lines += 2 + linesFor(content.skills.join(" | "));

  if (content.experience.length) {
    lines += 2;
    for (const exp of content.experience) {
      lines += 2.5; // header + subheader + block spacing
      for (const b of exp.bullets) lines += linesFor(b);
    }
  }

  if (content.education.length) {
    lines += 2 + content.education.length * 2.5;
  }
  if (content.certifications.length) {
    lines += 2 + linesFor(content.certifications.join(" | "));
  }

  return Math.max(0.1, Math.round((lines / LINES_PER_PAGE) * 10) / 10);
}
