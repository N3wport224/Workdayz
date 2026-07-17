"use client";

/**
 * Post-tailoring toolkit for the Apply page. Reconnects the previously
 * orphaned backends: PDF/DOCX/cover-letter downloads, interview prep,
 * per-bullet rewriting with strength scoring, outreach messages, and
 * application-question drafting.
 */

import { useState } from "react";
import { analyzeBullet } from "@/lib/bullet-strength";
import { estimateResumePages } from "@/lib/resume-length";
import type { ResumeProfile, JobPosting } from "@/lib/types";
import type { InterviewPrepResult } from "@/lib/interview-prep";

/** The resume the user picked in the "Resume to use" dropdown. */
export interface ChosenResume {
  kind: "tailored" | "variant" | "profile";
  label: string;
  summary: string;
  skills: string[];
  bullets: { id: string; original: string; tailored: string }[];
  coverLetter: string;
  atsScore: number;
}

function experienceForExport(profile: ResumeProfile, chosen: ChosenResume) {
  return profile.experience.map((exp) => {
    const tailored = chosen.bullets.find((b) => b.id === exp.id);
    return { ...exp, bullets: tailored ? [tailored.tailored] : exp.bullets };
  });
}

/** PDF style knobs (items 23-26): layout template, font, section order. */
export interface PdfStyle {
  template: "classic" | "compact";
  font: "Helvetica" | "Times-Roman" | "Courier";
  sectionOrder: "chronological" | "skills-first";
}

export const DEFAULT_PDF_STYLE: PdfStyle = { template: "classic", font: "Helvetica", sectionOrder: "chronological" };

function resumePdfBody(profile: ResumeProfile, chosen: ChosenResume, companyName: string, style: PdfStyle) {
  return {
    contact: profile.contact,
    summary: chosen.summary,
    skills: chosen.skills,
    experience: experienceForExport(profile, chosen),
    education: profile.education,
    certifications: profile.certifications.map((c) => c.name),
    certificationDetails: profile.certifications,
    projects: profile.projects,
    companyName,
    ...style,
  };
}

async function downloadFromApi(url: string, body: unknown, fallbackName: string): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return (data as { error?: string }).error ?? `Download failed (${res.status}).`;
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] ?? fallbackName;
  a.click();
  URL.revokeObjectURL(a.href);
  return null;
}

// ---------------------------------------------------------------------------
// Items 1-3 + 9: real file exports + page-length estimate
// ---------------------------------------------------------------------------
export function ExportButtons({
  profile,
  chosen,
  jobTitle,
  jobCompany,
  onStatus,
}: {
  profile: ResumeProfile;
  chosen: ChosenResume;
  jobTitle: string;
  jobCompany: string;
  onStatus: (msg: string, isError?: boolean) => void;
}) {
  const [busy, setBusy] = useState("");
  const [style, setStyle] = useState<PdfStyle>(DEFAULT_PDF_STYLE);

  const pages = estimateResumePages({
    summary: chosen.summary,
    skills: chosen.skills,
    experience: experienceForExport(profile, chosen).map((e) => ({
      title: e.title,
      company: e.company,
      bullets: e.bullets,
    })),
    education: profile.education.map((e) => ({ school: e.school, degree: e.degree })),
    certifications: profile.certifications.map((c) => c.name),
  });

  const run = async (label: string, url: string, body: unknown, fallback: string) => {
    setBusy(label);
    try {
      const err = await downloadFromApi(url, body, fallback);
      onStatus(err ?? `${label} downloaded (${chosen.label}).`, Boolean(err));
    } catch {
      onStatus(`${label} download failed — is the server running?`, true);
    } finally {
      setBusy("");
    }
  };

  const selectCls = "bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs w-auto";

  return (
    <div className="w-full space-y-2">
      {/* Items 23-26: layout, font, and section-order for the generated files */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <span>PDF style:</span>
        <select className={selectCls} value={style.template} onChange={(e) => setStyle((s) => ({ ...s, template: e.target.value as PdfStyle["template"] }))}>
          <option value="classic">Classic layout</option>
          <option value="compact">Compact layout (fits more)</option>
        </select>
        <select className={selectCls} value={style.font} onChange={(e) => setStyle((s) => ({ ...s, font: e.target.value as PdfStyle["font"] }))}>
          <option value="Helvetica">Helvetica</option>
          <option value="Times-Roman">Times Roman</option>
          <option value="Courier">Courier</option>
        </select>
        <select className={selectCls} value={style.sectionOrder} onChange={(e) => setStyle((s) => ({ ...s, sectionOrder: e.target.value as PdfStyle["sectionOrder"] }))}>
          <option value="chronological">Chronological</option>
          <option value="skills-first">Skills-first (functional)</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={() => run("Resume PDF", "/api/resume-pdf", resumePdfBody(profile, chosen, jobCompany, style), "resume.pdf")}
        disabled={busy !== ""}
        className="btn btn-secondary"
      >
        {busy === "Resume PDF" ? "⏳ Rendering…" : "⬇ Resume PDF"}
      </button>
      <button
        onClick={() => run("Resume DOCX", "/api/resume-docx", resumePdfBody(profile, chosen, jobCompany, style), "resume.docx")}
        disabled={busy !== ""}
        className="btn btn-secondary"
      >
        {busy === "Resume DOCX" ? "⏳ Rendering…" : "⬇ Resume DOCX"}
      </button>
      <button
        onClick={() =>
          run(
            "Cover letter PDF",
            "/api/cover-letter-pdf",
            {
              contact: profile.contact,
              companyName: jobCompany || "the company",
              jobTitle: jobTitle || "the role",
              bodyText: chosen.coverLetter,
              date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
            },
            "cover-letter.pdf",
          )
        }
        disabled={busy !== "" || !chosen.coverLetter}
        title={chosen.coverLetter ? "" : "The base profile has no tailored cover letter."}
        className="btn btn-secondary"
      >
        {busy === "Cover letter PDF" ? "⏳ Rendering…" : "⬇ Cover letter PDF"}
      </button>
      <span
        className={`px-2 py-0.5 rounded-full text-xs border ${
          pages <= 1.05
            ? "bg-green-900/40 text-green-300 border-green-700/40"
            : pages <= 2.05
              ? "bg-blue-900/40 text-blue-300 border-blue-700/40"
              : "bg-amber-900/40 text-amber-300 border-amber-700/40"
        }`}
        title="Estimated length of the generated PDF. The compact layout fits roughly 15% more per page."
      >
        ~{pages} page{pages === 1 ? "" : "s"}{pages > 2.05 ? " — consider trimming or the compact layout" : ""}
      </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items 5 + 8 (+ groundwork for 28/29): bullets with strength + rewrite
// ---------------------------------------------------------------------------
export function BulletsCard({
  bullets,
  profile,
  jobTitle,
  jobDescription,
  onBulletChange,
  onStatus,
}: {
  bullets: { id: string; original: string; tailored: string }[];
  profile: ResumeProfile;
  jobTitle: string;
  jobDescription: string;
  onBulletChange: (id: string, newText: string) => void;
  onStatus: (msg: string, isError?: boolean) => void;
}) {
  const [rewriting, setRewriting] = useState("");

  if (bullets.length === 0) return null;

  const rewrite = async (b: { id: string; original: string; tailored: string }, instruction?: string) => {
    const exp = profile.experience.find((e) => e.id === b.id);
    setRewriting(b.id + (instruction ?? ""));
    try {
      const res = await fetch("/api/rewrite-bullet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentBullet: b.tailored,
          sourceBullets: exp?.bullets ?? [b.original],
          roleTitle: exp?.title ?? "",
          jobTitle,
          jobDescription,
          instruction,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        onStatus(data.error ?? "Rewrite failed.", true);
        return;
      }
      onBulletChange(b.id, data.bullet);
      onStatus("Bullet rewritten — review it before sending anything out.");
    } catch {
      onStatus("Rewrite failed — network error.", true);
    } finally {
      setRewriting("");
    }
  };

  /** Item 29 (deterministic version): which job keywords the tailoring added. */
  const addedKeywords = (b: { original: string; tailored: string }): string[] => {
    const orig = b.original.toLowerCase();
    const tail = b.tailored.toLowerCase();
    const jd = jobDescription.toLowerCase();
    return tail
      .split(/[^a-z0-9+#.]+/i)
      .filter((w) => w.length > 3 && !orig.includes(w) && jd.includes(w))
      .slice(0, 5);
  };

  const strengthChip = (rating: "strong" | "ok" | "weak") =>
    rating === "strong"
      ? "bg-green-900/40 text-green-300 border-green-700/40"
      : rating === "ok"
        ? "bg-blue-900/40 text-blue-300 border-blue-700/40"
        : "bg-amber-900/40 text-amber-300 border-amber-700/40";

  return (
    <div className="card">
      <h2 className="font-semibold mb-1">Tailored Bullets</h2>
      <p className="text-sm text-gray-400 mb-4">
        Original vs tailored, with a strength rating. Rewrite any bullet you don&apos;t like — rewrites
        only ever use facts from your original bullets.
      </p>
      <div className="space-y-4">
        {bullets.map((b) => {
          const analysis = analyzeBullet(b.tailored);
          const added = addedKeywords(b);
          const exp = profile.experience.find((e) => e.id === b.id);
          return (
            <div key={b.id} className="p-3 bg-gray-800 rounded-lg">
              {exp && <p className="text-xs text-gray-500 mb-2">{exp.title} · {exp.company}</p>}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Original</p>
                  <p className="text-gray-400">{b.original}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Tailored</p>
                  <p className="text-gray-200">{b.tailored}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs border ${strengthChip(analysis.rating)}`}>
                  {analysis.rating === "strong" ? "💪 strong" : analysis.rating === "ok" ? "👍 ok" : "⚠ weak"}
                </span>
                {added.length > 0 && (
                  <span className="text-xs text-gray-500" title="Job-description keywords this rewrite added over the original.">
                    added: {added.join(", ")}
                  </span>
                )}
                <span className="flex-1" />
                <button
                  onClick={() => rewrite(b)}
                  disabled={rewriting !== ""}
                  className="text-xs px-2 py-1 rounded border border-gray-700 text-blue-400 hover:border-blue-500"
                >
                  {rewriting === b.id ? "⏳ Rewriting…" : "↻ Rewrite"}
                </button>
                <button
                  onClick={() => rewrite(b, "Make it more quantified with numbers already present in the original bullets.")}
                  disabled={rewriting !== ""}
                  className="text-xs px-2 py-1 rounded border border-gray-700 text-blue-400 hover:border-blue-500"
                >
                  {rewriting === b.id + "Make it more quantified with numbers already present in the original bullets." ? "⏳…" : "↻ More quantified"}
                </button>
              </div>
              {analysis.tips.length > 0 && (
                <ul className="mt-2 text-xs text-gray-500 space-y-0.5">
                  {analysis.tips.map((t, i) => (
                    <li key={i}>· {t}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item 4: interview prep
// ---------------------------------------------------------------------------
export function InterviewPrepCard({
  job,
  summary,
  skills,
  experience,
  gaps,
}: {
  job: JobPosting;
  summary: string;
  skills: string[];
  experience: { title: string; company: string; bullets: string[] }[];
  gaps?: string[];
}) {
  const [prep, setPrep] = useState<InterviewPrepResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/interview-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job, summary, skills, experience, gaps }),
      });
      const data = await res.json();
      if (!res.ok || data.error) setError(data.error ?? "Interview prep failed.");
      else setPrep(data.prep);
    } catch {
      setError("Interview prep failed — network error.");
    } finally {
      setLoading(false);
    }
  };

  const copyAll = async () => {
    if (!prep) return;
    const md = prep.questions
      .map((q) => `## ${q.question}\n(${q.category})\n${q.talkingPoints.map((t) => `- ${t}`).join("\n")}`)
      .join("\n\n");
    await navigator.clipboard.writeText(`# Interview prep — ${job.title} at ${job.company}\n\n${md}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Interview Prep</h2>
        {prep && (
          <button onClick={copyAll} className="btn btn-secondary btn-sm text-xs">
            {copied ? "Copied ✓" : "📋 Copy as markdown"}
          </button>
        )}
      </div>
      {!prep && (
        <>
          <p className="text-sm text-gray-400 mb-3">
            Generate likely interview questions for this exact role, with talking points grounded in
            your real experience.
          </p>
          <button onClick={generate} disabled={loading} className="btn btn-secondary">
            {loading ? "⏳ Generating… (10-30s)" : "🎤 Generate interview prep"}
          </button>
        </>
      )}
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      {prep && (
        <div className="space-y-3 mt-2">
          {prep.questions.map((q, i) => (
            <details key={i} className="p-3 bg-gray-800 rounded-lg">
              <summary className="text-sm cursor-pointer">
                <span className="text-xs text-gray-500 uppercase mr-2">{q.category}</span>
                {q.question}
              </summary>
              <ul className="mt-2 space-y-1 text-sm text-gray-300">
                {q.talkingPoints.map((t, j) => (
                  <li key={j}>• {t}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item 6: outreach messages (thank-you / follow-up / recruiter DM)
// ---------------------------------------------------------------------------
export function OutreachCard({
  job,
  summary,
  skills,
  experience,
}: {
  job: JobPosting;
  summary: string;
  skills: string[];
  experience: { title: string; company: string; bullets: string[] }[];
}) {
  const [kind, setKind] = useState<"thank-you" | "follow-up" | "recruiter-dm">("recruiter-dm");
  const [context, setContext] = useState("");
  const [message, setMessage] = useState<{ subject: string; body: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError("");
    setMessage(null);
    try {
      const res = await fetch("/api/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, job, summary, skills, experience, context }),
      });
      const data = await res.json();
      if (!res.ok || data.error) setError(data.error ?? "Drafting failed.");
      else setMessage(data.message);
    } catch {
      setError("Drafting failed — network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2 className="font-semibold mb-2">Outreach Messages</h2>
      <p className="text-sm text-gray-400 mb-3">
        Draft a recruiter DM, post-interview thank-you, or follow-up email for this application.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        {([["recruiter-dm", "LinkedIn DM"], ["thank-you", "Thank-you email"], ["follow-up", "Follow-up email"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`btn btn-sm ${kind === k ? "btn-primary" : "btn-secondary"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="Optional context — interviewer name, what you discussed…"
        className="mb-3"
      />
      <button onClick={generate} disabled={loading} className="btn btn-secondary">
        {loading ? "⏳ Drafting…" : "✍️ Draft message"}
      </button>
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      {message && (
        <div className="mt-3 p-3 bg-gray-800 rounded-lg text-sm">
          {message.subject && <p className="font-medium mb-2">Subject: {message.subject}</p>}
          <p className="whitespace-pre-wrap text-gray-300">{message.body}</p>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(message.subject ? `Subject: ${message.subject}\n\n${message.body}` : message.body);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="btn btn-secondary btn-sm text-xs mt-2"
          >
            {copied ? "Copied ✓" : "📋 Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item 7: application-question answer drafting (web-side)
// ---------------------------------------------------------------------------
export function QuestionsCard({
  job,
  profile,
  apiKey,
}: {
  job: JobPosting;
  profile: ResumeProfile;
  apiKey?: string;
}) {
  const [questionsText, setQuestionsText] = useState("");
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const draft = async () => {
    const questions = questionsText.split("\n").map((q) => q.trim()).filter((q) => q.length > 5).slice(0, 12);
    if (questions.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/answer-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions, profile, job, anthropicKey: apiKey || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.error) setError(data.error ?? "Answer drafting failed.");
      else setAnswers(data.answers ?? []);
    } catch {
      setError("Answer drafting failed — network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2 className="font-semibold mb-2">Application Questions</h2>
      <p className="text-sm text-gray-400 mb-3">
        Paste the application&apos;s free-text questions (one per line) and get grounded draft answers
        to review and paste in. Self-identification questions are always yours to answer.
      </p>
      <textarea
        value={questionsText}
        onChange={(e) => setQuestionsText(e.target.value)}
        placeholder={"Why do you want to work here?\nDescribe a time you led a project…"}
        rows={3}
      />
      <button onClick={draft} disabled={loading || !questionsText.trim()} className="btn btn-secondary mt-3">
        {loading ? "⏳ Drafting… (10-30s)" : "💬 Draft answers"}
      </button>
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      {answers.length > 0 && (
        <div className="mt-3 space-y-3">
          {answers.map((a, i) => (
            <div key={i} className="p-3 bg-gray-800 rounded-lg text-sm">
              <p className="font-medium mb-1">{a.question}</p>
              <p className="text-gray-300 whitespace-pre-wrap">{a.answer}</p>
              <button
                onClick={() => navigator.clipboard.writeText(a.answer)}
                className="btn btn-secondary btn-sm text-xs mt-2"
              >
                📋 Copy answer
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
