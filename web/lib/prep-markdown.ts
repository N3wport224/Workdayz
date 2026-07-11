// Renders a saved application's interview prep as a Markdown document the
// user can drop into their notes app or print before an interview.

import type { SavedApplication } from "./types";

export function prepToMarkdown(app: SavedApplication): string {
  const prep = app.interviewPrep;
  if (!prep || prep.questions.length === 0) return "";

  const lines: string[] = [
    `# Interview prep — ${app.job.title} at ${app.job.company}`,
    "",
    `Generated ${new Date(prep.generatedAt).toLocaleDateString()} · ATS score at tailoring: ${app.atsScore.score}/100`,
    "",
  ];

  if (app.fitAnalysis?.verdict) {
    lines.push("## Fit summary", "", app.fitAnalysis.verdict, "");
    if (app.fitAnalysis.gaps.length > 0) {
      lines.push("**Gaps to prepare for:**", "");
      for (const gap of app.fitAnalysis.gaps) lines.push(`- ${gap}`);
      lines.push("");
    }
  }

  const byCategory = new Map<string, typeof prep.questions>();
  for (const q of prep.questions) {
    const key = q.category || "general";
    const bucket = byCategory.get(key) ?? [];
    bucket.push(q);
    byCategory.set(key, bucket);
  }

  for (const [category, questions] of byCategory) {
    lines.push(`## ${category.charAt(0).toUpperCase()}${category.slice(1)} questions`, "");
    for (const q of questions) {
      lines.push(`### ${q.question}`, "");
      for (const point of q.talkingPoints) lines.push(`- ${point}`);
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
