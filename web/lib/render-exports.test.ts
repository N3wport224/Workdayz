// Item 88: render regression tests for the file exports. Full binary
// snapshots would churn on every library update, so these assert the things
// that catch real regressions: rendering succeeds, output is a valid
// non-trivial file of the right format, and (for DOCX) the resume's actual
// content made it into the document XML.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { ResumeDocument, type ResumePdfProps } from "./pdf/ResumeDocument";
import { resumeToDocx } from "./resume-docx";
import { inflateRawSync } from "node:zlib";

const props: ResumePdfProps = {
  contact: { firstName: "Alex", lastName: "Perez", email: "a@b.c", phone: "555", address: "", city: "Denver", state: "CO", postalCode: "", country: "", linkedin: "", website: "" },
  summary: "Operations professional.",
  skills: ["Forklift", "Inventory"],
  experience: [{ id: "1", company: "Xcel Energy", title: "Operations Tech", location: "Denver", startDate: "01/2019", endDate: "Present", bullets: ["Managed inventory."] }],
  education: [{ id: "e", school: "CU Denver", degree: "BS", fieldOfStudy: "Business", startDate: "2014", endDate: "2018" }],
  certifications: [],
  certificationDetails: [{ id: "c", name: "ADP Payroll", issuer: "ADP", issueDate: "05/2024" }],
  projects: [],
};

/** Pull readable text out of a DOCX buffer (ZIP of XML) without a zip lib:
 * find word/document.xml's deflated entry and inflate it. */
function docxText(buffer: Buffer): string {
  const needle = Buffer.from("word/document.xml");
  const nameIdx = buffer.indexOf(needle);
  if (nameIdx < 0) return "";
  // Local file header: name follows at offset 30; extra-field length at 28.
  const header = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), nameIdx);
  if (header < 0) return "";
  const nameLen = buffer.readUInt16LE(header + 26);
  const extraLen = buffer.readUInt16LE(header + 28);
  const dataStart = header + 30 + nameLen + extraLen;
  try {
    return inflateRawSync(buffer.subarray(dataStart)).toString("utf-8");
  } catch {
    // Entry may be stored uncompressed
    return buffer.subarray(dataStart, dataStart + 50_000).toString("utf-8");
  }
}

describe("resume PDF rendering", () => {
  it("renders a valid PDF for every template/font/order combination", async () => {
    for (const template of ["classic", "compact"] as const) {
      for (const font of ["Helvetica", "Times-Roman", "Courier"] as const) {
        for (const sectionOrder of ["chronological", "skills-first"] as const) {
          const buffer = await renderToBuffer(
            createElement(ResumeDocument, { ...props, template, font, sectionOrder }) as Parameters<typeof renderToBuffer>[0],
          );
          expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
          expect(buffer.length).toBeGreaterThan(1500);
        }
      }
    }
  }, 30_000);
});

describe("resume DOCX rendering", () => {
  it("renders a valid DOCX containing the resume's actual content", async () => {
    const buffer = await resumeToDocx(props);
    // ZIP magic
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    const xml = docxText(Buffer.from(buffer));
    expect(xml).toContain("Alex");
    expect(xml).toContain("Xcel Energy");
    expect(xml).toContain("ADP Payroll");
  });
});
