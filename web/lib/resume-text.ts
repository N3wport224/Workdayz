// Plain-text resume rendering, for portals that want raw text pasted into a
// box. Mirrors the PDF's section order.

import type { ResumePdfProps } from "./pdf/ResumeDocument";

export function resumeToText(props: ResumePdfProps): string {
  const { contact, summary, skills, experience, education, certifications, projects } = props;
  const lines: string[] = [];

  lines.push(`${contact.firstName} ${contact.lastName}`.trim().toUpperCase());
  const contactBits = [
    contact.email,
    contact.phone,
    [contact.city, contact.state].filter(Boolean).join(", "),
    contact.linkedin,
    contact.website,
  ].filter(Boolean);
  if (contactBits.length) lines.push(contactBits.join(" | "));
  lines.push("");

  if (summary.trim()) {
    lines.push("SUMMARY", summary.trim(), "");
  }
  if (skills.length) {
    lines.push("SKILLS", skills.join(", "), "");
  }
  if (experience.length) {
    lines.push("EXPERIENCE");
    for (const exp of experience) {
      lines.push(`${exp.title} — ${exp.company}${exp.location ? `, ${exp.location}` : ""}`);
      lines.push(`${exp.startDate} - ${exp.endDate}`);
      for (const bullet of exp.bullets) lines.push(`- ${bullet}`);
      lines.push("");
    }
  }
  const namedProjects = (projects ?? []).filter((p) => p.name.trim());
  if (namedProjects.length) {
    lines.push("PROJECTS");
    for (const project of namedProjects) {
      lines.push(`${project.name}: ${project.description}`.trim());
    }
    lines.push("");
  }
  if (education.length) {
    lines.push("EDUCATION");
    for (const ed of education) {
      lines.push(
        `${ed.degree}${ed.fieldOfStudy ? ` in ${ed.fieldOfStudy}` : ""}, ${ed.school} (${ed.startDate} - ${ed.endDate})${ed.gpa ? ` — GPA ${ed.gpa}` : ""}`,
      );
    }
    lines.push("");
  }
  if (certifications.length) {
    lines.push("CERTIFICATIONS", certifications.join(", "), "");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
