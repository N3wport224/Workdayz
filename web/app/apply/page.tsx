"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AtsScoreMeter } from "@/components/AtsScoreMeter";
import { hasProfile, loadProfile } from "@/lib/storage";
import { getApplication, loadApplications, upsertApplication } from "@/lib/applications";
import { estimateResumePages } from "@/lib/resume-length";
import {
  fetchPdfAsBase64,
  onExtensionDetected,
  onPackageStored,
  onScrapedJob,
  sendPackageToExtension,
} from "@/lib/extension-bridge";
import {
  COVER_LETTER_TONES,
  LENGTH_LABELS,
  TONE_LABELS,
  type CoverLetterLength,
  type CoverLetterTone,
} from "@/lib/tones";
import type { AutofillPackage, JobPosting, ResumeProfile, TailorResult, UsageInfo } from "@/lib/types";
import { formatUsd } from "@/lib/pricing";
import { recordUsage } from "@/lib/usage-log";
import { resumeToText } from "@/lib/resume-text";
import type { ResumeTemplate } from "@/lib/pdf/ResumeDocument";

const inputClass =
  "w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "text-xs font-medium opacity-70 mb-1 block";

const emptyJob: JobPosting = { title: "", company: "", location: "", description: "", sourceUrl: "" };

const DRAFT_KEY = "workdayz.applyDraft.v1";

interface ApplyDraft {
  job: JobPosting;
  tone: CoverLetterTone;
  length: CoverLetterLength;
  extraInstructions: string;
}

function jdWarnings(description: string): string[] {
  const warnings: string[] = [];
  const trimmed = description.trim();
  if (!trimmed) return warnings;
  if (trimmed.length < 300) {
    warnings.push("This description is quite short — the tailoring quality depends on it. Paste the full posting if there's more.");
  }
  if (/(show more|see more|read more|…|\.\.\.)$/i.test(trimmed.slice(-40))) {
    warnings.push("The description looks truncated (ends with a 'show more' marker) — expand the posting and re-copy it.");
  }
  return warnings;
}

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
  const [length, setLength] = useState<CoverLetterLength>("standard");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [dupeNote, setDupeNote] = useState<string | null>(null);
  const [letterLoading, setLetterLoading] = useState(false);
  // Editable copies of the tailored summary/skills — the user can tweak the
  // model's output before exporting, and every export path reads these.
  const [summaryText, setSummaryText] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [letterDrafts, setLetterDrafts] = useState<string[]>([]);
  const [costNote, setCostNote] = useState<string | null>(null);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  // Per-bullet edits keyed by experience id — the working copy every export
  // reads. Revert/rewrite operate on this, never on the model's result.
  const [bulletEdits, setBulletEdits] = useState<Record<string, string[]>>({});
  const [rewritingKey, setRewritingKey] = useState<string | null>(null);
  // A/B variants: each full tailor result is kept; tabs switch between them.
  const [variants, setVariants] = useState<TailorResult[]>([]);
  const [activeVariant, setActiveVariant] = useState(0);
  const [variantLoading, setVariantLoading] = useState(false);
  const [template, setTemplate] = useState<ResumeTemplate>("classic");
  const [textCopied, setTextCopied] = useState(false);
  // Batch queue: one row per pasted URL.
  const [batchUrls, setBatchUrls] = useState("");
  const [batchRows, setBatchRows] = useState<
    { url: string; status: string; title?: string; ats?: number; error?: string }[]
  >([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchAbortRef = useRef(false);
  const applicationIdRef = useRef<string>(crypto.randomUUID());
  const lastJobKeyRef = useRef<string>("");
  const draftLoadedRef = useRef(false);

  useEffect(() => {
    setProfile(loadProfile());
    // Restore an in-progress form (survives refreshes/accidental closes).
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as ApplyDraft;
        if (draft.job?.title || draft.job?.description) setJob({ ...emptyJob, ...draft.job });
        if (draft.tone) setTone(draft.tone);
        if (draft.length) setLength(draft.length);
        if (typeof draft.extraInstructions === "string") setExtraInstructions(draft.extraInstructions);
      }
    } catch {
      /* corrupt draft — start fresh */
    }
    draftLoadedRef.current = true;
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

  // Autosave the form so a refresh never loses a pasted job description.
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ job, tone, length, extraInstructions }));
    } catch {
      /* quota — skip */
    }
  }, [job, tone, length, extraInstructions]);

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
    // Heads-up (not a blocker) if this job already has a tracker entry.
    const dupe = loadApplications().find(
      (a) =>
        a.id !== applicationIdRef.current &&
        a.job.title.trim().toLowerCase() === job.title.trim().toLowerCase() &&
        a.job.company.trim().toLowerCase() === job.company.trim().toLowerCase(),
    );
    setDupeNote(
      dupe
        ? `Heads up: you already tailored "${dupe.job.title}" at ${dupe.job.company} on ${new Date(dupe.createdAt).toLocaleDateString()} (status: ${dupe.status}). This run creates a separate entry.`
        : null,
    );
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
          options: { tone, length, extraInstructions, emphasisKeywords },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tailoring failed.");
      const tailored = data as TailorResult;
      setVariants([tailored]);
      setActiveVariant(0);
      const freshEdits = adoptResult(tailored);
      noteCost(tailored.usage);
      persistSnapshot(tailored, tailored.coverLetter, tailored.tailoredResume.summary, tailored.tailoredResume.skills, freshEdits);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  /** Re-runs tailoring but only swaps in the fresh cover letter — for when
   * the resume is right but the letter needs another take. */
  async function regenerateCoverLetter() {
    if (!profile || !result) return;
    setLetterLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          job,
          options: {
            tone,
            length,
            extraInstructions: `${extraInstructions}\nWrite a cover letter with a noticeably different angle/opening than a previous draft would use.`.trim(),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cover letter regeneration failed.");
      const fresh = (data as TailorResult).coverLetter;
      noteCost((data as TailorResult).usage);
      setLetterDrafts((prev) => [coverLetter, ...prev].slice(0, 5));
      setCoverLetter(fresh);
      persistSnapshot(result, fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLetterLoading(false);
    }
  }

  /** Makes a tailor result the active working copy (fresh tailor or a
   * variant-tab switch): editable fields and bullet edits reset to it. */
  function adoptResult(tailored: TailorResult): Record<string, string[]> {
    const edits = Object.fromEntries(
      tailored.tailoredResume.experience.map((e) => [e.id, [...e.bullets]]),
    );
    setResult(tailored);
    setCoverLetter(tailored.coverLetter);
    setSummaryText(tailored.tailoredResume.summary);
    setSkillsText(tailored.tailoredResume.skills.join(", "));
    setLetterDrafts([]);
    setBulletEdits(edits);
    return edits;
  }

  /** Generates an alternate take on the same job (different emphasis) and
   * switches to it. Both variants stay available as tabs. */
  async function generateVariant() {
    if (!profile || variants.length === 0) return;
    setVariantLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          job,
          options: {
            tone,
            length,
            extraInstructions:
              `${extraInstructions}\nProduce a noticeably different variant: lead with a different subset of the candidate's real strengths and a different summary angle than an earlier draft would.`.trim(),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Variant generation failed.");
      const variant = data as TailorResult;
      noteCost(variant.usage);
      setVariants([...variants, variant]);
      setActiveVariant(variants.length);
      const freshEdits = adoptResult(variant);
      persistSnapshot(variant, variant.coverLetter, variant.tailoredResume.summary, variant.tailoredResume.skills, freshEdits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setVariantLoading(false);
    }
  }

  function switchVariant(index: number) {
    const variant = variants[index];
    if (!variant) return;
    setActiveVariant(index);
    const freshEdits = adoptResult(variant);
    persistSnapshot(variant, variant.coverLetter, variant.tailoredResume.summary, variant.tailoredResume.skills, freshEdits);
  }

  /** AI-rewrites one bullet, bounded by the role's ORIGINAL bullets. */
  async function rewriteBulletAt(expId: string, index: number) {
    if (!profile) return;
    const source = profile.experience.find((e) => e.id === expId);
    const current = bulletEdits[expId]?.[index];
    if (!source || current === undefined) return;
    const key = `${expId}:${index}`;
    setRewritingKey(key);
    try {
      const res = await fetch("/api/rewrite-bullet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentBullet: current,
          sourceBullets: source.bullets,
          roleTitle: source.title,
          jobTitle: job.title,
          jobDescription: job.description,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bullet rewrite failed.");
      noteCost(data.usage);
      setBulletEdits((prev) => {
        const next = { ...prev, [expId]: [...(prev[expId] ?? [])] };
        next[expId][index] = data.bullet;
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bullet rewrite failed.");
    } finally {
      setRewritingKey(null);
    }
  }

  /** Fetch + tailor every URL in the batch box, saving each to the tracker. */
  async function runBatch() {
    if (!profile) return;
    const urls = batchUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (urls.length === 0) return;
    batchAbortRef.current = false;
    setBatchRunning(true);
    setBatchRows(urls.map((url) => ({ url, status: "queued" })));
    const setRow = (i: number, patch: Partial<(typeof batchRows)[number]>) =>
      setBatchRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

    for (let i = 0; i < urls.length; i++) {
      if (batchAbortRef.current) {
        setRow(i, { status: "skipped (stopped)" });
        continue;
      }
      try {
        setRow(i, { status: "fetching posting…" });
        const fetchRes = await fetch("/api/fetch-job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urls[i] }),
        });
        const fetchData = await fetchRes.json();
        if (!fetchRes.ok) throw new Error(fetchData.error || "Fetch failed.");
        const batchJob = fetchData.job as JobPosting;

        setRow(i, { status: "tailoring…", title: batchJob.title });
        const tailorRes = await fetch("/api/tailor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile, job: batchJob, options: { tone, length } }),
        });
        const tailorData = await tailorRes.json();
        if (!tailorRes.ok) throw new Error(tailorData.error || "Tailoring failed.");
        const tailored = tailorData as TailorResult;
        noteCost(tailored.usage);

        const now = new Date().toISOString();
        upsertApplication({
          id: crypto.randomUUID(),
          status: "draft",
          createdAt: now,
          updatedAt: now,
          job: batchJob,
          contact: profile.contact,
          summary: tailored.tailoredResume.summary,
          skills: tailored.tailoredResume.skills,
          experience: profile.experience.map((e) => {
            const t = tailored.tailoredResume.experience.find((x) => x.id === e.id);
            return { ...e, bullets: t?.bullets ?? e.bullets };
          }),
          education: profile.education,
          certifications: profile.certifications,
          projects: profile.projects,
          coverLetterText: tailored.coverLetter,
          atsScore: tailored.atsScore,
          fitAnalysis: tailored.fitAnalysis,
        });
        setRow(i, { status: "done ✓", ats: tailored.atsScore.score });
      } catch (err) {
        setRow(i, { status: "failed", error: err instanceof Error ? err.message : "failed" });
      }
    }
    setBatchRunning(false);
  }

  /** Records the run's estimated AI cost + the lifetime total. */
  function noteCost(usage?: UsageInfo) {
    if (!usage) return;
    const { runCostUsd, log } = recordUsage(usage);
    if (runCostUsd === null) return;
    setCostNote(
      `Est. AI cost: ${formatUsd(runCostUsd)} this run · ${formatUsd(log.totalCostUsd)} across ${log.runs} run${log.runs === 1 ? "" : "s"} in this browser`,
    );
  }

  /** Fills the job form from a pasted posting URL via /api/fetch-job. */
  async function fetchFromUrl() {
    const url = job.sourceUrl?.trim();
    if (!url) return;
    setFetchingUrl(true);
    setError(null);
    try {
      const res = await fetch("/api/fetch-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't fetch that URL.");
      const fetched = data.job as JobPosting;
      setJob((j) => ({
        ...j,
        title: fetched.title || j.title,
        company: fetched.company || j.company,
        location: fetched.location || j.location,
        description: fetched.description || j.description,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't fetch that URL.");
    } finally {
      setFetchingUrl(false);
    }
  }

  /** Saves/updates this application's tracker entry, preserving its original
   * createdAt. Called after tailoring AND whenever the user exports or hands
   * off, so edits made to the cover letter after tailoring aren't lost. */
  function persistSnapshot(
    tailored: TailorResult,
    coverLetterText: string,
    summaryArg?: string,
    skillsArg?: string[],
    /** Pass when `bulletEdits` state is about to change (fresh tailor /
     * variant switch) — the state value is still the OLD variant's edits. */
    editsArg?: Record<string, string[]>,
  ) {
    if (!profile) return;
    const now = new Date().toISOString();
    upsertApplication({
      id: applicationIdRef.current,
      status: getApplication(applicationIdRef.current)?.status ?? "draft",
      createdAt: getApplication(applicationIdRef.current)?.createdAt ?? now,
      updatedAt: now,
      job,
      contact: profile.contact,
      summary: summaryArg ?? summaryText,
      skills: skillsArg ?? parseSkills(skillsText),
      experience: mergedExperience(profile, tailored, editsArg ?? bulletEdits),
      education: profile.education,
      certifications: profile.certifications,
      projects: profile.projects,
      coverLetterText,
      atsScore: tailored.atsScore,
      fitAnalysis: tailored.fitAnalysis,
      // Preserve prep/notes added from the tracker if this entry already exists.
      interviewPrep: getApplication(applicationIdRef.current)?.interviewPrep,
      notes: getApplication(applicationIdRef.current)?.notes,
    });
  }

  async function downloadResumePdf() {
    if (!profile || !result) return;
    persistSnapshot(result, coverLetter); // capture bullet/summary edits
    const merged = mergedExperience(profile, result, bulletEdits);
    const { base64, fileName } = await fetchPdfAsBase64("/api/resume-pdf", {
      contact: profile.contact,
      summary: summaryText,
      skills: parseSkills(skillsText),
      experience: merged,
      education: profile.education,
      certifications: profile.certifications,
      projects: profile.projects,
      companyName: job.company,
      template,
    });
    triggerDownload(base64, fileName);
  }

  async function downloadResumeDocx() {
    if (!profile || !result) return;
    persistSnapshot(result, coverLetter); // capture bullet/summary edits
    const merged = mergedExperience(profile, result, bulletEdits);
    const { base64, fileName } = await fetchPdfAsBase64("/api/resume-docx", {
      contact: profile.contact,
      summary: summaryText,
      skills: parseSkills(skillsText),
      experience: merged,
      education: profile.education,
      certifications: profile.certifications,
      projects: profile.projects,
      companyName: job.company,
    });
    triggerDownload(base64, fileName, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }

  async function copyPlainText() {
    if (!profile || !result) return;
    const text = resumeToText({
      contact: profile.contact,
      summary: summaryText,
      skills: parseSkills(skillsText),
      experience: mergedExperience(profile, result, bulletEdits),
      education: profile.education,
      certifications: profile.certifications,
      projects: profile.projects,
    });
    try {
      await navigator.clipboard.writeText(text);
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
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
      const merged = mergedExperience(profile, result, bulletEdits);
      const [resumePdf, coverPdf] = await Promise.all([
        fetchPdfAsBase64("/api/resume-pdf", {
          contact: profile.contact,
          summary: summaryText,
          skills: parseSkills(skillsText),
          experience: merged,
          education: profile.education,
          certifications: profile.certifications,
          projects: profile.projects,
          companyName: job.company,
          template,
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
        summary: summaryText,
        skills: parseSkills(skillsText),
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

      <details className="rounded-lg border border-black/10 dark:border-white/15 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Batch tailor from URLs (up to 10)
        </summary>
        <p className="text-xs opacity-60 mt-2 mb-2">
          One posting URL per line. Each is fetched, tailored with the tone/length set below, and
          saved to your tracker as a draft. Rough cost: ~{formatUsd(0.05)}–{formatUsd(0.1)} per job.
        </p>
        <textarea
          className={inputClass}
          rows={3}
          value={batchUrls}
          onChange={(e) => setBatchUrls(e.target.value)}
          placeholder={"https://acme.wd5.myworkdayjobs.com/...\nhttps://globex.wd1.myworkdayjobs.com/..."}
          disabled={batchRunning}
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            onClick={runBatch}
            disabled={batchRunning || !batchUrls.trim() || !profile}
            className="rounded-md bg-blue-600 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {batchRunning ? "Running…" : "Fetch & tailor all"}
          </button>
          {batchRunning ? (
            <button
              type="button"
              onClick={() => {
                batchAbortRef.current = true;
              }}
              className="text-xs text-rose-600 dark:text-rose-400"
            >
              Stop after current
            </button>
          ) : null}
        </div>
        {batchRows.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs">
            {batchRows.map((row, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="opacity-60 truncate max-w-60">{row.title || row.url}</span>
                <span className={row.status === "failed" ? "text-rose-600 dark:text-rose-400" : "opacity-80"}>
                  {row.status}
                  {row.ats !== undefined ? ` · ATS ${row.ats}` : ""}
                  {row.error ? ` — ${row.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {!batchRunning && batchRows.some((r) => r.status === "done ✓") ? (
          <p className="text-xs mt-2">
            <Link href="/applications" className="text-blue-600 dark:text-blue-400">
              Review the drafts in your tracker →
            </Link>
          </p>
        ) : null}
      </details>

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
            <div className="flex gap-2">
              <input
                className={inputClass}
                value={job.sourceUrl}
                onChange={(e) => setJob((j) => ({ ...j, sourceUrl: e.target.value }))}
                placeholder="https://company.wd5.myworkdayjobs.com/..."
              />
              <button
                type="button"
                onClick={fetchFromUrl}
                disabled={fetchingUrl || !job.sourceUrl?.trim()}
                className="rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 text-sm font-medium shrink-0 disabled:opacity-40"
                title="Fetch the posting and fill the fields below"
              >
                {fetchingUrl ? "Fetching…" : "Fetch"}
              </button>
            </div>
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
          {jdWarnings(job.description).map((w, i) => (
            <p key={i} className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              ⚠ {w}
            </p>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <p className="text-xs opacity-50 mt-1">{COVER_LETTER_TONES[tone]}</p>
          </div>
          <div>
            <label className={labelClass}>Cover letter length</label>
            <select
              className={inputClass}
              value={length}
              onChange={(e) => setLength(e.target.value as CoverLetterLength)}
            >
              {(Object.keys(LENGTH_LABELS) as CoverLetterLength[]).map((l) => (
                <option key={l} value={l}>
                  {LENGTH_LABELS[l]}
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
        {dupeNote ? <p className="text-xs text-amber-700 dark:text-amber-300">{dupeNote}</p> : null}
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
          <div className="flex items-center gap-2">
            {variants.map((v, i) => (
              <button
                key={i}
                onClick={() => switchVariant(i)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                  i === activeVariant
                    ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                    : "border-black/15 dark:border-white/20 opacity-70"
                }`}
              >
                Variant {String.fromCharCode(65 + i)} · ATS {v.atsScore.score}
              </button>
            ))}
            {variants.length > 0 && variants.length < 3 ? (
              <button
                onClick={generateVariant}
                disabled={variantLoading || loading}
                className="rounded-md border border-dashed border-black/20 dark:border-white/25 px-3 py-1.5 text-xs opacity-70 hover:opacity-100 disabled:opacity-40"
                title="Same job, different emphasis — compare and pick"
              >
                {variantLoading ? "Generating…" : "+ Variant (different emphasis)"}
              </button>
            ) : null}
          </div>

          <AtsScoreMeter
            ats={result.atsScore}
            onMissingKeywordClick={(k) =>
              setExtraInstructions((prev) => (prev.includes(k) ? prev : prev ? `${prev}; emphasize "${k}"` : `Emphasize "${k}"`))
            }
          />

          <details className="rounded-lg border border-black/10 dark:border-white/15 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Job description with keyword highlights
            </summary>
            <p className="text-xs opacity-60 mt-2 mb-2">
              <mark className="bg-emerald-500/25 rounded px-0.5">green</mark> = in your tailored
              resume · <mark className="bg-amber-500/30 rounded px-0.5">amber</mark> = the posting
              asks for it, your resume doesn&apos;t say it
            </p>
            <HighlightedJd
              description={job.description}
              matched={result.atsScore.matchedKeywords}
              missing={result.atsScore.missingKeywords}
            />
          </details>

          {result.fitAnalysis.verdict ? (
            <div className="rounded-lg border border-black/10 dark:border-white/15 p-4">
              <h3 className="font-semibold mb-2">Fit analysis</h3>
              <p className="text-sm opacity-80 mb-3">{result.fitAnalysis.verdict}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium mb-1 text-emerald-700 dark:text-emerald-300">
                    Strengths for this role
                  </p>
                  <ul className="list-disc list-inside opacity-80 space-y-0.5">
                    {result.fitAnalysis.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium mb-1 text-amber-700 dark:text-amber-300">
                    Gaps to prepare for
                  </p>
                  <ul className="list-disc list-inside opacity-80 space-y-0.5">
                    {result.fitAnalysis.gaps.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

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
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Tailored resume preview</h2>
              <span className="text-xs opacity-60">
                est. {estimateResumePages({
                  summary: summaryText,
                  skills: parseSkills(skillsText),
                  experience: mergedExperience(profile!, result, bulletEdits),
                  education: profile?.education ?? [],
                  certifications: profile?.certifications ?? [],
                })}{" "}
                page(s)
              </span>
            </div>
            <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 text-sm space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={labelClass}>Summary (editable)</label>
                  <CopyButton text={summaryText} />
                </div>
                <textarea
                  className={inputClass}
                  rows={3}
                  value={summaryText}
                  onChange={(e) => setSummaryText(e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>Skills (editable, comma-separated)</label>
                <input
                  className={inputClass}
                  value={skillsText}
                  onChange={(e) => setSkillsText(e.target.value)}
                />
              </div>
              {result.tailoredResume.experience.map((exp) => {
                const source = profile?.experience.find((e) => e.id === exp.id);
                const bullets = bulletEdits[exp.id] ?? exp.bullets;
                return (
                  <div key={exp.id}>
                    <p className="font-medium mb-1">
                      {source?.title} — {source?.company}
                    </p>
                    <div className="space-y-1.5">
                      {bullets.map((bullet, i) => {
                        const original = source?.bullets[i];
                        const changed = original !== undefined && original !== bullet;
                        const key = `${exp.id}:${i}`;
                        return (
                          <div key={i} className="flex items-start gap-1.5 group">
                            <span
                              className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${changed ? "bg-blue-500" : "bg-black/20 dark:bg-white/25"}`}
                              title={changed ? "Rewritten vs. your original" : "Unchanged from your original"}
                            />
                            <textarea
                              className={`${inputClass} !py-1 text-xs`}
                              rows={2}
                              value={bullet}
                              onChange={(e) =>
                                setBulletEdits((prev) => {
                                  const next = { ...prev, [exp.id]: [...(prev[exp.id] ?? exp.bullets)] };
                                  next[exp.id][i] = e.target.value;
                                  return next;
                                })
                              }
                            />
                            <div className="flex flex-col gap-0.5 shrink-0">
                              {changed ? (
                                <button
                                  type="button"
                                  className="text-[11px] opacity-50 hover:opacity-100"
                                  title={`Revert to your original: "${original}"`}
                                  onClick={() =>
                                    setBulletEdits((prev) => {
                                      const next = { ...prev, [exp.id]: [...(prev[exp.id] ?? exp.bullets)] };
                                      next[exp.id][i] = original!;
                                      return next;
                                    })
                                  }
                                >
                                  ↺ original
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="text-[11px] text-blue-600 dark:text-blue-400 disabled:opacity-40"
                                disabled={rewritingKey !== null}
                                title="AI-rewrite this bullet (facts stay bounded by your original bullets)"
                                onClick={() => rewriteBulletAt(exp.id, i)}
                              >
                                {rewritingKey === key ? "…" : "✨ rewrite"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {source ? (
                      <details className="mt-1">
                        <summary className="text-xs opacity-50 cursor-pointer">
                          View your original bullets for this role
                        </summary>
                        <ul className="list-disc list-inside opacity-60 text-xs mt-1">
                          {source.bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Cover letter (editable)</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={regenerateCoverLetter}
                  disabled={letterLoading || loading}
                  className="text-xs text-blue-600 dark:text-blue-400 disabled:opacity-50"
                >
                  {letterLoading ? "Rewriting..." : "↻ New draft (different angle)"}
                </button>
                <CopyButton text={coverLetter} />
              </div>
            </div>
            <textarea
              className={inputClass}
              rows={14}
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
            />
            {letterDrafts.length > 0 ? (
              <details className="mt-2">
                <summary className="text-xs opacity-60 cursor-pointer">
                  Previous draft{letterDrafts.length === 1 ? "" : "s"} ({letterDrafts.length})
                </summary>
                <div className="space-y-2 mt-2">
                  {letterDrafts.map((draft, i) => (
                    <div key={i} className="rounded-md border border-black/10 dark:border-white/15 p-2">
                      <p className="text-xs opacity-70 whitespace-pre-wrap max-h-32 overflow-y-auto">{draft}</p>
                      <button
                        type="button"
                        className="text-xs text-blue-600 dark:text-blue-400 mt-1"
                        onClick={() => {
                          // Swap: the current letter joins the history so
                          // nothing is ever lost by restoring.
                          setLetterDrafts((prev) => [coverLetter, ...prev.filter((_, idx) => idx !== i)].slice(0, 5));
                          setCoverLetter(draft);
                        }}
                      >
                        Restore this draft
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs opacity-70 flex items-center gap-1.5">
              Layout
              <select
                className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-xs"
                value={template}
                onChange={(e) => setTemplate(e.target.value as ResumeTemplate)}
              >
                <option value="classic">Classic</option>
                <option value="compact">Compact (fits more per page)</option>
              </select>
            </label>
            <button
              onClick={downloadResumePdf}
              className="rounded-md border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium"
            >
              Resume PDF
            </button>
            <button
              onClick={downloadResumeDocx}
              className="rounded-md border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium"
              title="Word format — some ATSs and recruiters prefer .docx"
            >
              Resume DOCX
            </button>
            <button
              onClick={copyPlainText}
              className="rounded-md border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium"
              title="For portals that want raw text pasted into a box"
            >
              {textCopied ? "Copied ✓" : "Copy as text"}
            </button>
            <button
              onClick={downloadCoverLetterPdf}
              className="rounded-md border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium"
            >
              Cover letter PDF
            </button>
            <button
              onClick={sendToExtension}
              className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-500"
            >
              Send to extension for Workday autofill
            </button>
          </div>
          {handoffStatus ? <p className="text-sm opacity-80">{handoffStatus}</p> : null}
          {costNote ? <p className="text-xs opacity-50">{costNote}</p> : null}
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="text-xs opacity-60 hover:opacity-100 shrink-0"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
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

/** The pasted JD with ATS keywords marked: green = your tailored resume says
 * it, amber = the posting asks and your resume is silent. Built as React
 * nodes (never innerHTML) — the JD is untrusted text. */
function HighlightedJd({
  description,
  matched,
  missing,
}: {
  description: string;
  matched: string[];
  missing: string[];
}) {
  const text = description.slice(0, 20_000);
  const terms = [
    ...matched.map((k) => ({ k, missing: false })),
    ...missing.map((k) => ({ k, missing: true })),
  ]
    .filter((t) => t.k.trim().length > 1)
    .sort((a, b) => b.k.length - a.k.length);
  if (terms.length === 0) {
    return <pre className="text-xs whitespace-pre-wrap font-sans opacity-80">{text}</pre>;
  }
  const byLower = new Map(terms.map((t) => [t.k.toLowerCase(), t.missing]));
  const pattern = new RegExp(
    `(${terms.map((t) => t.k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const parts = text.split(pattern);
  return (
    <pre className="text-xs whitespace-pre-wrap font-sans opacity-80 max-h-80 overflow-y-auto">
      {parts.map((part, i) => {
        const isMissing = byLower.get(part.toLowerCase());
        if (isMissing === undefined) return part;
        return (
          <mark
            key={i}
            className={`rounded px-0.5 ${isMissing ? "bg-amber-500/30" : "bg-emerald-500/25"}`}
          >
            {part}
          </mark>
        );
      })}
      {description.length > text.length ? "\n… (truncated for display)" : ""}
    </pre>
  );
}

function parseSkills(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergedExperience(
  profile: ResumeProfile,
  result: TailorResult,
  edits?: Record<string, string[]>,
) {
  return profile.experience.map((e) => {
    const tailored = result.tailoredResume.experience.find((t) => t.id === e.id);
    return { ...e, bullets: edits?.[e.id] ?? tailored?.bullets ?? e.bullets };
  });
}

function triggerDownload(base64: string, fileName: string, mime = "application/pdf") {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
