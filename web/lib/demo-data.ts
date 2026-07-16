import type { ResumeProfile } from "./types";

/** Sample profile so the whole flow can be exercised before importing a real
 * resume. Clearly fictional — the name makes that obvious in any output. */
export const demoProfile: ResumeProfile = {
  contact: {
    firstName: "Demo",
    lastName: "Applicant",
    email: "demo.applicant@example.com",
    phone: "555-010-0100",
    address: "100 Example Street",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    country: "United States",
    linkedin: "linkedin.com/in/demo-applicant",
    website: "",
  },
  summary:
    "Operations analyst with 6 years of experience turning messy processes into measurable wins across logistics and retail, comfortable owning dashboards, vendor relationships, and cross-team rollouts end to end.",
  skills: ["Excel", "SQL", "Tableau", "Process improvement", "Vendor management", "Forecasting", "Stakeholder communication"],
  experience: [
    {
      id: "demo-exp-1",
      company: "Lonestar Logistics",
      title: "Senior Operations Analyst",
      location: "Austin, TX",
      startDate: "2021-03",
      endDate: "Present",
      bullets: [
        "Rebuilt the weekly demand forecast in SQL and Tableau, cutting stockouts by 23% across 40 distribution routes",
        "Led a 4-person rollout of barcode scanning to 12 warehouses, reducing intake errors by 35%",
        "Negotiated carrier contracts saving $410K annually",
      ],
    },
    {
      id: "demo-exp-2",
      company: "Bluebonnet Retail Group",
      title: "Operations Analyst",
      location: "Dallas, TX",
      startDate: "2018-06",
      endDate: "2021-02",
      bullets: [
        "Automated monthly inventory reconciliation in Excel/VBA, saving 30 analyst-hours per month",
        "Built store-level staffing model adopted by 60 locations",
      ],
    },
  ],
  education: [
    {
      id: "demo-edu-1",
      school: "Texas State University",
      degree: "B.B.A.",
      fieldOfStudy: "Supply Chain Management",
      startDate: "2014",
      endDate: "2018",
      gpa: "3.6",
    },
  ],
  certifications: [
    {
      id: "demo-cert-1",
      name: "Lean Six Sigma Green Belt",
      issuer: "ASQ",
      issueDate: "03/2022",
      expirationDate: "",
    },
  ],
  projects: [
    {
      id: "demo-proj-1",
      name: "Route-efficiency dashboard",
      description: "Personal Tableau project ranking delivery routes by cost per stop; adopted by two regional managers.",
      technologies: ["Tableau"],
    },
  ],
};
