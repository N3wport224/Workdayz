// DOCX resume rendering — many ATSs and recruiters explicitly prefer Word
// files. Same single-column, plain-text structure as the PDF template.

import { BorderStyle, Document, Packer, Paragraph, TextRun } from "docx";
import type { ResumePdfProps } from "./pdf/ResumeDocument";

const FONT = "Calibri";

function heading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "111111" } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, font: FONT })],
  });
}

function body(text: string, opts: { bold?: boolean; color?: string; bullet?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    bullet: opts.bullet ? { level: 0 } : undefined,
    children: [
      new TextRun({ text, bold: opts.bold, color: opts.color, size: 21, font: FONT }),
    ],
  });
}

export async function resumeToDocx(props: ResumePdfProps): Promise<Buffer> {
  const { contact, summary, skills, experience, education, certifications, projects } = props;
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${contact.firstName} ${contact.lastName}`.trim(),
          bold: true,
          size: 34,
          font: FONT,
        }),
      ],
    }),
  );
  const contactBits = [
    contact.email,
    contact.phone,
    [contact.city, contact.state].filter(Boolean).join(", "),
    contact.linkedin,
    contact.website,
  ].filter(Boolean);
  if (contactBits.length) children.push(body(contactBits.join(" | "), { color: "333333" }));

  if (summary.trim()) {
    children.push(heading("Summary"), body(summary.trim()));
  }
  if (skills.length) {
    children.push(heading("Skills"), body(skills.join(" | ")));
  }
  if (experience.length) {
    children.push(heading("Experience"));
    for (const exp of experience) {
      children.push(body(`${exp.title} — ${exp.company}`, { bold: true }));
      children.push(
        body(
          [exp.location, `${exp.startDate} - ${exp.endDate}`].filter(Boolean).join(" | "),
          { color: "333333" },
        ),
      );
      for (const bullet of exp.bullets) children.push(body(bullet, { bullet: true }));
    }
  }
  const namedProjects = (projects ?? []).filter((p) => p.name.trim());
  if (namedProjects.length) {
    children.push(heading("Projects"));
    for (const project of namedProjects) {
      children.push(body(project.name, { bold: true }));
      if (project.description) children.push(body(project.description));
    }
  }
  if (education.length) {
    children.push(heading("Education"));
    for (const ed of education) {
      children.push(body(`${ed.degree}${ed.fieldOfStudy ? `, ${ed.fieldOfStudy}` : ""}`, { bold: true }));
      children.push(
        body(
          [ed.school, `${ed.startDate} - ${ed.endDate}`, ed.gpa ? `GPA: ${ed.gpa}` : ""]
            .filter(Boolean)
            .join(" | "),
          { color: "333333" },
        ),
      );
    }
  }
  if (certifications.length) {
    children.push(heading("Certifications"), body(certifications.join(" | ")));
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}
