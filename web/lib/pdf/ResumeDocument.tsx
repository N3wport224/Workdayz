import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { CertificationEntry, ContactInfo, EducationEntry, ProjectEntry, WorkExperience } from "@/lib/types";
import { formatDateRange } from "@/lib/format-date";

// ATS-safe layouts: single column, standard built-in font, plain text only —
// no tables, images, text boxes, or multi-column sections that resume
// parsers commonly choke on. Templates only vary type size and spacing;
// "compact" squeezes a long history onto fewer pages.
export const RESUME_TEMPLATES = ["classic", "compact"] as const;
export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number];

function buildStyles(template: ResumeTemplate) {
  const compact = template === "compact";
  return StyleSheet.create({
    page: {
      fontFamily: "Helvetica",
      fontSize: compact ? 9.5 : 10.5,
      lineHeight: compact ? 1.25 : 1.35,
      padding: compact ? 28 : 36,
      color: "#111111",
    },
    name: { fontSize: compact ? 16 : 18, fontFamily: "Helvetica-Bold", marginBottom: 2 },
    contactLine: { fontSize: compact ? 8.5 : 9.5, color: "#333333", marginBottom: compact ? 7 : 10 },
    sectionHeading: {
      fontSize: compact ? 10 : 11,
      fontFamily: "Helvetica-Bold",
      textTransform: "uppercase" as const,
      borderBottom: "1 solid #111111",
      marginTop: compact ? 8 : 12,
      marginBottom: compact ? 4 : 6,
      paddingBottom: 2,
    },
    paragraph: { marginBottom: compact ? 3 : 4 },
    entryHeader: { fontFamily: "Helvetica-Bold", fontSize: compact ? 9.5 : 10.5 },
    entrySubheader: { fontSize: compact ? 8.5 : 9.5, color: "#333333", marginBottom: compact ? 2 : 3 },
    bullet: { marginBottom: compact ? 1 : 2, paddingLeft: 10 },
    entryBlock: { marginBottom: compact ? 5 : 8 },
  });
}

export interface ResumePdfProps {
  contact: ContactInfo;
  summary: string;
  skills: string[];
  experience: (WorkExperience & { bullets: string[] })[];
  education: EducationEntry[];
  certifications: string[];
  certificationDetails?: CertificationEntry[];
  projects?: ProjectEntry[];
  template?: ResumeTemplate;
}

/** "CSM — Scrum Alliance (May 2024 – May 2026)" from a structured cert. */
function certLine(cert: CertificationEntry): string {
  const dates = formatDateRange(cert.issueDate ?? "", cert.expirationDate ?? "");
  return [
    cert.name,
    cert.issuer ? ` — ${cert.issuer}` : "",
    dates ? ` (${dates})` : "",
  ].join("");
}

export function ResumeDocument({
  contact,
  summary,
  skills,
  experience,
  education,
  certifications,
  certificationDetails,
  projects,
  template,
}: ResumePdfProps) {
  const certs = certificationDetails?.filter((c) => c.name.trim()).length
    ? certificationDetails.filter((c) => c.name.trim()).map(certLine)
    : certifications;
  const styles = buildStyles(template === "compact" ? "compact" : "classic");
  const contactParts = [
    contact.email,
    contact.phone,
    [contact.city, contact.state].filter(Boolean).join(", "),
    contact.linkedin,
    contact.website,
  ].filter(Boolean);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.name}>
          {contact.firstName} {contact.lastName}
        </Text>
        <Text style={styles.contactLine}>{contactParts.join(" | ")}</Text>

        {summary ? (
          <View>
            <Text style={styles.sectionHeading}>Summary</Text>
            <Text style={styles.paragraph}>{summary}</Text>
          </View>
        ) : null}

        {skills.length ? (
          <View>
            <Text style={styles.sectionHeading}>Skills</Text>
            <Text style={styles.paragraph}>{skills.join(" | ")}</Text>
          </View>
        ) : null}

        {experience.length ? (
          <View>
            <Text style={styles.sectionHeading}>Experience</Text>
            {experience.map((exp) => (
              <View key={exp.id} style={styles.entryBlock} wrap={false}>
                <Text style={styles.entryHeader}>
                  {exp.title} — {exp.company}
                </Text>
                <Text style={styles.entrySubheader}>
                  {[exp.location, formatDateRange(exp.startDate, exp.endDate)]
                    .filter(Boolean)
                    .join(" | ")}
                </Text>
                {exp.bullets.map((b, i) => (
                  <Text key={i} style={styles.bullet}>
                    • {b}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {education.length ? (
          <View>
            <Text style={styles.sectionHeading}>Education</Text>
            {education.map((ed) => (
              <View key={ed.id} style={styles.entryBlock} wrap={false}>
                <Text style={styles.entryHeader}>
                  {ed.degree}
                  {ed.fieldOfStudy ? `, ${ed.fieldOfStudy}` : ""}
                </Text>
                <Text style={styles.entrySubheader}>
                  {[ed.school, formatDateRange(ed.startDate, ed.endDate), ed.gpa ? `GPA: ${ed.gpa}` : ""]
                    .filter(Boolean)
                    .join(" | ")}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {projects?.filter((p) => p.name.trim()).length ? (
          <View>
            <Text style={styles.sectionHeading}>Projects</Text>
            {projects
              .filter((p) => p.name.trim())
              .map((p) => (
                <View key={p.id} style={styles.entryBlock} wrap={false}>
                  <Text style={styles.entryHeader}>{p.name}</Text>
                  <Text style={styles.paragraph}>{p.description}</Text>
                </View>
              ))}
          </View>
        ) : null}

        {certs.length ? (
          <View>
            <Text style={styles.sectionHeading}>Certifications</Text>
            {certs.map((line, i) => (
              <Text key={i} style={styles.bullet}>
                • {line}
              </Text>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
