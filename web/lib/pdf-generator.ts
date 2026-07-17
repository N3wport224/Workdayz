/**
 * ATS-safe PDF generator. Produces single-column, text-based PDFs with no
 * tables, images, or complex layouts that could confuse ATS parsers.
 */

import type { ResumeProfile, TailoredApplication } from "./types";
import { resumeToText } from "./resume-text";

export interface PdfOptions {
  layout: "classic" | "compact";
  includeProjects: boolean;
}

/**
 * Item 100: ONE canonical plain-text renderer. This used to be a second,
 * diverging implementation; it now adapts its inputs and delegates to
 * lib/resume-text.ts — the same renderer behind every text export — so the
 * "copy resume text" button and the file exports can never drift apart.
 * The PdfOptions parameter is kept for source compatibility; layout only
 * affects the PDF, not plain text.
 */
export function renderResumeText(
  profile: ResumeProfile,
  tailored: { summary: string; skills: string[]; bullets: { id: string; original: string; tailored: string }[] },
  options: PdfOptions = { layout: "classic", includeProjects: true },
): string {
  return resumeToText({
    contact: profile.contact,
    summary: tailored.summary,
    skills: tailored.skills,
    experience: profile.experience.map((exp) => {
      const tailoredBullet = tailored.bullets.find((b) => b.id === exp.id);
      return { ...exp, bullets: tailoredBullet ? [tailoredBullet.tailored] : exp.bullets };
    }),
    education: profile.education,
    certifications: profile.certifications.map((c) => c.name),
    certificationDetails: profile.certifications,
    projects: options.includeProjects ? profile.projects : [],
  });
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