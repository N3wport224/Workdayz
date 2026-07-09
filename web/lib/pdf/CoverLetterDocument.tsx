import { Document, Page, Text, StyleSheet } from "@react-pdf/renderer";
import type { ContactInfo } from "@/lib/types";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 11,
    lineHeight: 1.5,
    padding: 48,
    color: "#111111",
  },
  header: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  contactLine: { fontSize: 9.5, color: "#333333", marginBottom: 18 },
  date: { fontSize: 10.5, marginBottom: 12 },
  paragraph: { marginBottom: 10 },
});

export interface CoverLetterPdfProps {
  contact: ContactInfo;
  companyName: string;
  jobTitle: string;
  bodyText: string;
  date: string;
}

export function CoverLetterDocument({
  contact,
  companyName,
  jobTitle,
  bodyText,
  date,
}: CoverLetterPdfProps) {
  const contactParts = [
    contact.email,
    contact.phone,
    [contact.city, contact.state].filter(Boolean).join(", "),
  ].filter(Boolean);

  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.header}>
          {contact.firstName} {contact.lastName}
        </Text>
        <Text style={styles.contactLine}>{contactParts.join(" | ")}</Text>
        <Text style={styles.date}>{date}</Text>
        <Text style={styles.paragraph}>
          Re: {jobTitle}
          {companyName ? ` at ${companyName}` : ""}
        </Text>
        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>
            {p}
          </Text>
        ))}
        <Text>
          Sincerely,{"\n"}
          {contact.firstName} {contact.lastName}
        </Text>
      </Page>
    </Document>
  );
}
