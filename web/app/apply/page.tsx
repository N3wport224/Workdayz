"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AtsScoreMeter } from "@/components/AtsScoreMeter";
import { hasProfile, loadProfile } from "@/lib/storage";
import { getApplication, upsertApplication } from "@/lib/applications";
import {
  fetchPdfAsBase64,
  onExtensionDetected,
  onPackageStored,
  onScrapedJob,
  sendPackageToExtension,
} from "@/lib/extension-bridge";
import { TONE_LABELS, type CoverLetterTone } from "@/lib/tones";
import type { AutofillPackage, JobPosting, ResumeProfile, TailorResult } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "text-xs font-medium opacity-70 mb-1 block";

const emptyJob: JobPosting = { title: "", company: "", location: "", description: "", sourceUrl: "" };

export default function ApplyPage() {
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [job, setJob] = useState<JobPosting>(emptyJob);
  const [result, setResult] = useState<TailorResult | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extensionPresent, setExtensionPresent] = useState(false);
  const [handoffStatus, setHandoffStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tone, setTone] = useState<CoverLetterTone>("professional");
  const [extraInstructions, setExtraInstructions] = useState("");
  const applicationIdRef = useRef<string>(crypto.randomUUID());
  const lastJobKeyRef = useRef<string>("");

  useEffect(() => {
    setProfile(loadProfile());
    const offExt = onExtensionDetected(setExtensionPresent);
    const offJob = onScrapedJob((scraped) => {
      setJob(scraped);
      applicationIdRef.current = crypto.randomUUID();
      lastJobKeyRef.current = `${scraped.title}|${scraped.company}`;
      setResult(null);
      setSaved(false);
    });
    const offStored = onPackageStored(() => {
      setHandoffStatus(
        "Package stored in the extension ✓ — open your Workday application tab and click “Autofill this step”.",
      );
    });
    return () => {
      offExt();
      offJob();
      offStored();
    };
  }, []);

  async function handleTailor(e: React.FormEvent | null, emphasisKeywords?: string[]) {
    e?.preventDefault();
    if (!profile) return;
    // A different job (typed manually or scraped) gets its own tracker entry;
    // re-tailoring/refining the same job updates the existing draft.
    const jobKey = `${job.title}|${job.company}`;
    if (jobKey !== lastJobKeyRef.current) {
      applicationIdRef.current = crypto.randomUUID();
      lastJobKeyRef.current = jobKey;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setSaved(false);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          job,
          options: { tone, extraInstructions, emphasisKeywords },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tailoring failed.");
      const tailored = data as TailorResult;
      setResult(tailored);
      setCoverLetter(tailored.coverLetter);
      persistSnapshot(tailored, tailored.coverLetter);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  /** Saves/updates this application's tracker entry, preserving its original
   * createdAt. Called after tailoring AND whenever the user exports or hands
   * off, so edits made to the cover letter after tailoring aren't lost. */
  function persistSnapshot(tailored: TailorResult, coverLetterText: string) {
    if (!profile) return;
    const now = new Date().toISOString();
    upsertApplication({
      id: applicationIdRef.current,
      status: getApplication(applicationIdRef.current)?.status ?? "draft",
      createdAt: getApplication(applicationIdRef.current)?.createdAt ?? now,
      updatedAt: now,
      job,
      contact: profile.contact,
      summary: tailored.tailoredResume.summary,
      skills: tailored.tailoredResume.skills,
      experience: mergedExperience(profile, tailored),
      education: profile.education,
      certifications: profile.certifications,
      coverLetterText,
      atsScore: tailored.atsScore,
    });
  }

  async function downloadResumePdf() {
    if (!profile || !result) return;
    const merged = mergedExperience(profile, result);
    const { base64, fileName } = await fetchPdfAsBase64("/api/resume-pdf", {
      contact: profile.contact,
      summary: result.tailoredResume.summary,
      skills: result.tailoredResume.skills,
      experience: merged,
      education: profile.education,
      certifications: profile.certifications,
    });
    triggerDownload(base64, fileName);
  }

  async function downloadCoverLetterPdf() {
    if (!profile) return;
    if (result) persistSnapshot(result, coverLetter);
    const { base64, fileName } = await fetchPdfAsBase64("/api/cover-letter-pdf", {
      contact: profile.contact,
      companyName: job.company,
      jobTitle: job.title,
      bodyText: coverLetter,
      date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    });
    triggerDownload(base64, fileName);
  }

  async function sendToExtension() {
    if (!profile || !result) return;
    persistSnapshot(result, coverLetter);
    setHandoffStatus("Generating PDFs...");
    try {
      const merged = mergedExperience(profile, result);
      const [resumePdf, coverPdf] = await Promise.all([
        fetchPdfAsBase64("/api/resume-pdf", {
          contact: profile.contact,
          summary: result.tailoredResume.summary,
          skills: result.tailoredResume.skills,
          experience: merged,
          education: profile.education,
          certifications: profile.certifications,
        }),
        fetchPdfAsBase64("/api/cover-letter-pdf", {
          contact: profile.contact,
          companyName: job.company,
          jobTitle: job.title,
          bodyText: coverLetter,
          date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        }),
      ]);

      const pkg: AutofillPackage = {
        version: 1,
        createdAt: new Date().toISOString(),
        job,
        contact: profile.contact,
        summary: result.tailoredResume.summary,
        skills: result.tailoredResume.skills,
        experience: merged,
        education: profile.education,
        certifications: profile.certifications,
        coverLetterText: coverLetter,
        resumePdfBase64: resumePdf.base64,
        resumeFileName: resumePdf.fileName,
        coverLetterPdfBase64: coverPdf.base64,
        coverLetterFileName: coverPdf.fileName,
        atsScore: result.atsScore.score,
      };
      sendPackageToExtension(pkg);
      setHandoffStatus(
        extensionPresent
          ? "Sent. Open your Workday application tab and click the Workdayz icon to autofill."
          : "Sent, but the Workdayz extension wasn't detected in this tab. Install/enable it, then retry.",
      );
    } catch (err) {
      setHandoffStatus(err instanceof Error ? err.message : "Handoff failed.");
    }
  }

  if (profile && !hasProfile(profile)) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="mb-4">You need to fill out your base resume profile first.</p>
        <Link href="/profile" className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium">
          Go to profile
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Tailor an application</h1>
        <p className="text-sm opacity-70 mt-1">
          Paste the job posting from Workday (or let the browser extension scrape it for you), then
          generate a tailored resume and cover letter.
        </p>
        <p className="text-xs mt-2">
          Extension status:{" "}
          {extensionPresent ? (
            <span className="text-emerald-600 dark:text-emerald-400">detected</span>
          ) : (
            <span className="opacity-60">not detected in this tab</span>
          )}
        </p>
      </div>

      <form onSubmit={handleTailor} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Job title</label>
            <input
              className={inputClass}
              value={job.title}
              onChange={(e) => setJob((j) => ({ ...j, title: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Company</label>
            <input
              className={inputClass}
              value={job.company}
              onChange={(e) => setJob((j) => ({ ...j, company: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Location</label>
            <input
              className={inputClass}
              value={job.location}
              onChange={(e) => setJob((j) => ({ ...j, location: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass}>Source URL (optional)</label>
            <input
              className={inputClass}
              value={job.sourceUrl}
              onChange={(e) => setJob((j) => ({ ...j, sourceUrl: e.target.value }))}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Job description</label>
          <textarea
            className={inputClass}
            rows={10}
            value={job.description}
            onChange={(e) => setJob((j) => ({ ...j, description: e.target.value }))}
            required
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Cover letter tone</label>
            <select
              className={inputClass}
              value={tone}
              onChange={(e) => setTone(e.target.value as CoverLetterTone)}
            >
              {(Object.keys(TONE_LABELS) as CoverLetterTone[]).map((t) => (
                <option key={t} value={t}>
                  {TONE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Extra instructions (optional)</label>
            <input
              className={inputClass}
              value={extraInstructions}
              onChange={(e) => setExtraInstructions(e.target.value)}
              placeholder="e.g. emphasize my leadership experience"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Tailoring..." : "Tailor resume & write cover letter"}
        </button>
        {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      </form>

      {loading ? <ResultSkeleton /> : null}

      {result ? (
        <div className="space-y-6">
          <AtsScoreMeter ats={result.atsScore} />

          {result.atsScore.missingKeywords.length > 0 ? (
            <button
              onClick={() => handleTailor(null, result.atsScore.missingKeywords)}
              disabled={loading}
              className="rounded-md border border-amber-500/50 text-amber-700 dark:text-amber-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              ↻ Rewrite to target the {result.atsScore.missingKeywords.length} missed keyword
              {result.atsScore.missingKeywords.length === 1 ? "" : "s"} (only where truthful)
            </button>
          ) : null}

          <section>
            <h2 className="text-lg font-semibold mb-2">Tailored resume preview</h2>
            <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 text-sm space-y-3">
              <p className="opacity-80">{result.tailoredResume.summary}</p>
              <p>
                <span className="font-medium">Skills: </span>
                {result.tailoredResume.skills.join(", ")}
              </p>
              {result.tailoredResume.experience.map((exp) => {
                const source = profile?.experience.find((e) => e.id === exp.id);
                return (
                  <div key={exp.id}>
                    <p className="font-medium">
                      {source?.title} — {source?.company}
                    </p>
                    <ul className="list-disc list-inside opacity-80">
                      {exp.bullets.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Cover letter (editable)</h2>
            <textarea
              className={inputClass}
              rows={14}
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
            />
          </section>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={downloadResumePdf}
              className="rounded-md border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium"
            >
              Download resume PDF
            </button>
            <button
              onClick={downloadCoverLetterPdf}
              className="rounded-md border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium"
            >
              Download cover letter PDF
            </button>
            <button
              onClick={sendToExtension}
              className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-500"
            >
              Send to extension for Workday autofill
            </button>
          </div>
          {handoffStatus ? <p className="text-sm opacity-80">{handoffStatus}</p> : null}
          {saved ? (
            <p className="text-xs opacity-60">
              Saved to your{" "}
              <Link href="/applications" className="text-blue-600 dark:text-blue-400">
                application tracker
              </Link>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-hidden>
      <div className="h-24 rounded-lg bg-black/5 dark:bg-white/10" />
      <div className="h-40 rounded-lg bg-black/5 dark:bg-white/10" />
      <div className="h-32 rounded-lg bg-black/5 dark:bg-white/10" />
    </div>
  );
}

function mergedExperience(profile: ResumeProfile, result: TailorResult) {
  return profile.experience.map((e) => {
    const tailored = result.tailoredResume.experience.find((t) => t.id === e.id);
    return { ...e, bullets: tailored?.bullets ?? e.bullets };
  });
}

function triggerDownload(base64: string, fileName: string) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
