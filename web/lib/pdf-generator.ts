/**
 * ATS-safe PDF generator. Produces single-column, text-based PDFs with no
 * tables, images, or complex layouts that could confuse ATS parsers.
 */

import type { ResumeProfile, TailoredApplication } from "./types";

export interface PdfOptions {
  layout: "classic" | "compact";
  includeProjects: boolean;
}

export function renderResumeText(
  profile: ResumeProfile,
  tailored: { summary: string; skills: string[]; bullets: { id: string; original: string; tailored: string }[] },
  options: PdfOptions = { layout: "classic", includeProjects: true },
): string {
  const lines: string[] = [];

  // Header
  lines.push("=".repeat(60));
  lines.push(`${profile.contact.firstName} ${profile.contact.lastName}`);
  lines.push(`${profile.contact.email}  |  ${profile.contact.phone}`);
  if (profile.contact.city && profile.contact.state) {
    lines.push(`${profile.contact.city}, ${profile.contact.state} ${profile.contact.postalCode}`);
  }
  if (profile.contact.linkedin) lines.push(profile.contact.linkedin);
  lines.push("=".repeat(60));
  lines.push("");

  // Summary
  lines.push("PROFESSIONAL SUMMARY");
  lines.push("-".repeat(40));
  lines.push(tailored.summary);
  lines.push("");

  // Skills
  lines.push("SKILLS");
  lines.push("-".repeat(40));
  // Group skills into columns for readability
  const mid = Math.ceil(tailored.skills.length / 2);
  const col1 = tailored.skills.slice(0, mid);
  const col2 = tailored.skills.slice(mid);
  for (let i = 0; i < Math.max(col1.length, col2.length); i++) {
    const left = col1[i] ?? "";
    const right = col2[i] ?? "";
    lines.push(`${left.padEnd(30)}${right}`);
  }
  lines.push("");

  // Experience
  lines.push("EXPERIENCE");
  lines.push("-".repeat(40));
  for (const exp of profile.experience) {
    const tailoredBullet = tailored.bullets.find((b) => b.id === exp.id);
    const bullets = tailoredBullet ? [tailoredBullet.tailored] : exp.bullets;
    lines.push(`${exp.title}  |  ${exp.company}`);
    lines.push(`${exp.startDate} – ${exp.endDate}  |  ${exp.location}`);
    for (const bullet of bullets) {
      lines.push(`  • ${bullet}`);
    }
    lines.push("");
  }

  // Education
  if (profile.education.length > 0) {
    lines.push("EDUCATION");
    lines.push("-".repeat(40));
    for (const edu of profile.education) {
      const degreeStr = edu.degree ? `${edu.degree} in ${edu.fieldOfStudy}` : edu.fieldOfStudy;
      lines.push(`${degreeStr}  |  ${edu.school}`);
      lines.push(`${edu.startDate} – ${edu.endDate}${edu.gpa ? `  |  GPA: ${edu.gpa}` : ""}`);
    }
    lines.push("");
  }

  // Projects
  if (options.includeProjects && profile.projects?.length > 0) {
    lines.push("PROJECTS");
    lines.push("-".repeat(40));
    for (const proj of profile.projects) {
      lines.push(`${proj.name}  |  ${proj.technologies.join(", ")}`);
      lines.push(`  ${proj.description}`);
      if (proj.url) lines.push(`  ${proj.url}`);
    }
    lines.push("");
  }

  // Certifications
  if (profile.certifications?.length > 0) {
    lines.push("CERTIFICATIONS");
    lines.push("-".repeat(40));
    for (const cert of profile.certifications) {
      const detail = cert.issuer ? `${cert.name}  |  ${cert.issuer}` : cert.name;
      const dates = [cert.issueDate, cert.expirationDate].filter(Boolean).join(" – ");
      lines.push(`  • ${detail}${dates ? `  (${dates})` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderCoverLetterText(
  application: TailoredApplication,
): string {
  const { job, profile, coverLetter } = application;
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  return [
    date,
    "",
    `${profile.contact.firstName} ${profile.contact.lastName}`,
    profile.contact.email,
    profile.contact.phone,
    "",
    `Hiring Manager`,
    `${job.company}`,
    `${job.location}`,
    "",
    `Re: Application for ${job.title}`,
    "",
    coverLetter,
    "",
    `Best regards,`,
    `${profile.contact.firstName} ${profile.contact.lastName}`,
  ].join("\n");
}

/** Options for DOCX generation */
export interface DocxOptions {
  includeCoverLetter: boolean;
}

/** Placeholder DOCX generation function — in production this uses docx library */
export function documentMetadata(profile: ResumeProfile, application: TailoredApplication) {
  return {
    title: `${profile.contact.firstName} ${profile.contact.lastName} — ${application.job.title}`,
    subject: `Application for ${application.job.title} at ${application.job.company}`,
    creator: "Workdayz",
    createdAt: new Date().toISOString(),
  };
}