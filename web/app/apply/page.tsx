"use client";

import { useEffect, useState } from "react";
import { loadProfile, loadSettings, saveApplication, loadApplications } from "@/lib/storage";
import { sendAutofillPackage, getBridgeStatus } from "@/lib/extension-bridge";
import { segmentByKeywords } from "@/lib/highlight-keywords";
import { scoreResume, sectionReadiness, suggestImprovements, thinSections } from "@/lib/ats-score";
import { renderResumeText, renderCoverLetterText } from "@/lib/pdf-generator";
import { ExportButtons, BulletsCard, InterviewPrepCard, OutreachCard, QuestionsCard } from "@/components/ResultToolkit";
import type { ResumeProfile, JobPosting, TailoredApplication, TailoredVariant, AtsBreakdown } from "@/lib/types";

interface TailorResult {
  summary: string;
  skills: string[];
  bullets: { id: string; original: string; tailored: string }[];
  coverLetter: string;
  fitAnalysis: { strengths: string[]; gaps: string[]; verdict: string };
  variants: TailoredVariant[];
  atsBreakdown: AtsBreakdown;
  atsScore: number;
  estimatedCost: number;
}

export default function ApplyPage() {
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [jobUrl, setJobUrl] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobCompany, setJobCompany] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [tailoring, setTailoring] = useState(false);
  const [result, setResult] = useState<TailorResult | null>(null);
  const [activeVariant, setActiveVariant] = useState("original");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [hasServerKey, setHasServerKey] = useState(true); // optimistic until checked, so we don't flash a false error
  const [showHighlights, setShowHighlights] = useState(false);
  const [copiedMissing, setCopiedMissing] = useState(false);
  // Which resume feeds "Send to extension" / exports: the tailored resume by
  // default, a variant, or the untailored base profile. "tailored" | "profile"
  // | a variant id.
  const [resumeChoice, setResumeChoice] = useState("tailored");
  // Items 27 + 33: tailoring style controls
  const [industry, setIndustry] = useState("");
  const [letterTone, setLetterTone] = useState("");
  const [letterLength, setLetterLength] = useState<"" | "short" | "medium" | "long">("");
  // Item 31: id of the tracker record for THIS tailoring run
  const [lastAppId, setLastAppId] = useState("");
  // Item 30: batch tailoring
  const [batchUrls, setBatchUrls] = useState("");
  const [batchLog, setBatchLog] = useState<string[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  // Item 32: saved tailored-resume templates
  const [templates, setTemplates] = useState<{ name: string; summary: string; skills: string[]; bullets: { id: string; original: string; tailored: string }[]; coverLetter: string }[]>([]);
  // Item 63: optional extra attachment (writing sample, portfolio…)
  const [extraFile, setExtraFile] = useState<{ name: string; base64: string } | null>(null);

  const TEMPLATES_KEY = "workdayz-resume-templates";
  const loadTemplatesList = () => {
    try {
      return JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? "[]") as typeof templates;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    const p = loadProfile();
    setProfile(p);
    if (!p) setStatusMessage("Set up your resume profile first.");
    // Check for query params from extension
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") === "extension") {
      setStatusMessage("Job posting scraped from the extension — fill in the details below.");
    }
    // Item 53: "Reapply" from the tracker pre-fills the job from that record.
    const reapplyId = params.get("reapply");
    if (reapplyId) {
      const past = loadApplications().find((a) => a.id === reapplyId);
      if (past) {
        setJobTitle(past.job.title);
        setJobCompany(past.job.company);
        setJobLocation(past.job.location);
        setJobDescription(past.job.description);
        setJobUrl(past.job.sourceUrl ?? "");
        setStatusMessage(`Re-applying to "${past.job.title}" at ${past.job.company} — review the details and tailor again.`);
      }
    }
    // A key/model chosen in Settings (browser-only) is sent per-request; an
    // empty model falls through to the server's ANTHROPIC_MODEL/default.
    const settings = loadSettings();
    setApiKey(settings.anthropicKey);
    setModel(settings.model);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pure localStorage read, stable across renders
    setTemplates(loadTemplatesList());
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setHasServerKey(Boolean(data.apiKeyConfigured)))
      .catch(() => setHasServerKey(true)); // don't block tailoring on a health-check network blip
  }, []);

  const fetchJobUrl = async () => {
    setError("");
    setStatusMessage("Fetching job posting...");
    try {
      const res = await fetch("/api/fetch-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jobUrl }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setStatusMessage("");
        return;
      }
      setJobTitle(data.title ?? "");
      setJobCompany(data.company ?? "");
      setJobLocation(data.location ?? "");
      setJobDescription(data.description ?? "");
      setStatusMessage("Job posting fetched!");
    } catch {
      setError("Couldn't fetch that URL — paste the details manually.");
      setStatusMessage("");
    }
  };

  const tailor = async () => {
    if (!profile) return;
    if (!apiKey && !hasServerKey) {
      setError("Enter your Anthropic API key in Settings, or set ANTHROPIC_API_KEY in .env.local.");
      return;
    }
    if (!jobDescription || jobDescription.length < 50) {
      setError("Job description is too short — paste the full description.");
      return;
    }

    setTailoring(true);
    setError("");
    setResult(null);
    setStatusMessage("Tailoring resume with Claude... (15-30s)");

    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          job: {
            title: jobTitle || "Position",
            company: jobCompany || "Company",
            location: jobLocation || "",
            description: jobDescription,
            sourceUrl: jobUrl || undefined,
          },
          anthropicKey: apiKey || undefined,
          model: model || undefined,
          industry: industry || undefined,
          coverLetterTone: letterTone || undefined,
          coverLetterLength: letterLength || undefined,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setStatusMessage("");
        return;
      }

      const job: JobPosting = {
        title: jobTitle || "Position",
        company: jobCompany || "Company",
        location: jobLocation || "",
        description: jobDescription,
        sourceUrl: jobUrl || undefined,
      };

      const resultData: TailorResult = {
        summary: data.summary,
        skills: data.skills,
        bullets: data.bullets,
        coverLetter: data.coverLetter,
        fitAnalysis: data.fitAnalysis,
        variants: data.variants ?? [],
        atsBreakdown: data.atsBreakdown,
        atsScore: data.atsScore,
        estimatedCost: data.estimatedCost,
      };

      setResult(resultData);

      // Save to tracker
      const app: TailoredApplication = {
        id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        job,
        profile,
        tailoredSummary: data.summary,
        tailoredSkills: data.skills,
        tailoredBullets: data.bullets,
        coverLetter: data.coverLetter,
        atsScore: data.atsScore,
        atsBreakdown: data.atsBreakdown,
        fitAnalysis: data.fitAnalysis,
        variants: data.variants ?? [],
        status: "draft",
      };
      saveApplication(app);
      setLastAppId(app.id);

      setStatusMessage(`ATS Score: ${data.atsScore}/100 · Cost: $${data.estimatedCost}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tailoring failed");
      setStatusMessage("");
    } finally {
      setTailoring(false);
    }
  };

  /** Resolves the resume the dropdown points at. Defaults to the tailored
   * resume; a variant or the untailored base profile are explicit opt-ins. */
  const resolveResumeChoice = () => {
    if (!profile) return null;
    if (resumeChoice === "profile") {
      return {
        kind: "profile" as const,
        label: "Base profile (untailored)",
        summary: profile.summary,
        skills: profile.skills,
        bullets: [] as { id: string; original: string; tailored: string }[],
        coverLetter: "",
        atsScore: 0,
      };
    }
    if (!result) return null;
    if (resumeChoice !== "tailored") {
      const v = result.variants.find((variant) => variant.id === resumeChoice);
      if (v) {
        return {
          kind: "variant" as const,
          label: `Variant: ${v.label} (ATS ${v.atsScore})`,
          summary: v.tailoredSummary,
          skills: v.tailoredSkills,
          bullets: v.tailoredBullets,
          coverLetter: v.coverLetter,
          atsScore: v.atsScore,
        };
      }
    }
    return {
      kind: "tailored" as const,
      label: `Tailored resume (ATS ${result.atsScore})`,
      summary: result.summary,
      skills: result.skills,
      bullets: result.bullets,
      coverLetter: result.coverLetter,
      atsScore: result.atsScore,
    };
  };

  const sendToExtension = () => {
    if (!profile || !result) return;
    const chosen = resolveResumeChoice();
    if (!chosen) return;
    const job: JobPosting = {
      title: jobTitle || "Position",
      company: jobCompany || "Company",
      location: jobLocation || "",
      description: jobDescription,
      sourceUrl: jobUrl || undefined,
    };
    sendAutofillPackage({
      version: 1,
      createdAt: new Date().toISOString(),
      job,
      contact: profile.contact,
      summary: chosen.summary,
      skills: chosen.skills,
      experience: profile.experience,
      education: profile.education,
      certifications: profile.certifications.map((c) => c.name),
      certificationDetails: profile.certifications,
      resumeSource: { kind: chosen.kind, label: chosen.label },
      references: profile.references,
      extraFile: extraFile ?? undefined,
      coverLetterText: chosen.coverLetter,
      resumePdfBase64: "",
      resumeFileName: `resume-${job.company?.toLowerCase().replace(/\s+/g, "-") ?? "position"}.pdf`,
      coverLetterPdfBase64: "",
      coverLetterFileName: `cover-letter-${job.company?.toLowerCase().replace(/\s+/g, "-") ?? "position"}.pdf`,
      atsScore: chosen.atsScore,
    });
    // Item 31: record on the tracker entry WHICH resume was actually sent, so
    // response analytics can compare variants later.
    if (lastAppId) {
      const app = loadApplications().find((a) => a.id === lastAppId);
      if (app) saveApplication({ ...app, sentResume: chosen.label, updatedAt: new Date().toISOString() });
    }
    setStatusMessage(`✅ Sent to extension using ${chosen.label}. Open the Workday application form and click Autofill.`);
  };

  /** Item 30: tailor several postings back-to-back from their URLs. */
  const runBatch = async () => {
    if (!profile) return;
    const urls = batchUrls.split("\n").map((u) => u.trim()).filter((u) => u.startsWith("http")).slice(0, 10);
    if (urls.length === 0) return;
    setBatchRunning(true);
    setBatchLog([`Starting batch of ${urls.length}…`]);
    for (const url of urls) {
      try {
        const jobRes = await fetch("/api/fetch-job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const jobData = await jobRes.json();
        if (jobData.error || !jobData.description) {
          setBatchLog((l) => [...l, `✗ ${url} — ${jobData.error ?? "no description found"}`]);
          continue;
        }
        const res = await fetch("/api/tailor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile,
            job: { title: jobData.title, company: jobData.company, location: jobData.location ?? "", description: jobData.description, sourceUrl: url },
            anthropicKey: apiKey || undefined,
            model: model || undefined,
            industry: industry || undefined,
          }),
        });
        const data = await res.json();
        if (data.error) {
          setBatchLog((l) => [...l, `✗ ${jobData.title ?? url} — ${data.error}`]);
          continue;
        }
        saveApplication({
          id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          job: { title: jobData.title, company: jobData.company, location: jobData.location ?? "", description: jobData.description, sourceUrl: url },
          profile,
          tailoredSummary: data.summary,
          tailoredSkills: data.skills,
          tailoredBullets: data.bullets,
          coverLetter: data.coverLetter,
          atsScore: data.atsScore,
          atsBreakdown: data.atsBreakdown,
          fitAnalysis: data.fitAnalysis,
          variants: data.variants ?? [],
          status: "draft",
        });
        setBatchLog((l) => [...l, `✓ ${jobData.title} at ${jobData.company} — ATS ${data.atsScore}/100 (saved to tracker)`]);
      } catch {
        setBatchLog((l) => [...l, `✗ ${url} — network error`]);
      }
    }
    setBatchLog((l) => [...l, "Batch finished — everything is in the tracker."]);
    setBatchRunning(false);
  };

  /** Item 32: save/load the current tailored resume as a named template. */
  const saveAsTemplate = () => {
    if (!result) return;
    const name = prompt("Template name (e.g. \"Ops roles\"):")?.trim().slice(0, 40);
    if (!name) return;
    const list = loadTemplatesList().filter((t) => t.name !== name);
    list.push({ name, summary: result.summary, skills: result.skills, bullets: result.bullets, coverLetter: result.coverLetter });
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list.slice(-20)));
    setTemplates(list);
    setStatusMessage(`Saved tailored resume as template "${name}".`);
  };

  const loadTemplate = (name: string) => {
    const t = loadTemplatesList().find((tpl) => tpl.name === name);
    if (!t || !profile) return;
    // Re-score the template against the CURRENT job description so the ATS
    // panel is honest for this posting, not the one it was tailored for.
    const breakdown = scoreResume(jobDescription, jobTitle, t.summary, t.skills, t.bullets.map((b) => b.tailored), profile);
    setResult({
      summary: t.summary,
      skills: t.skills,
      bullets: t.bullets,
      coverLetter: t.coverLetter,
      fitAnalysis: { strengths: [], gaps: [], verdict: `Loaded from template "${t.name}" — re-scored against the current job description.` },
      variants: [],
      atsBreakdown: breakdown,
      atsScore: breakdown.score,
      estimatedCost: 0,
    });
    setLastAppId("");
    setStatusMessage(`Loaded template "${t.name}" (ATS ${breakdown.score}/100 against this posting).`);
  };

  const scoreColor = (s: number) => s >= 80 ? "text-green-400" : s >= 60 ? "text-amber-400" : "text-red-400";

  /** Job posting object for the toolkit cards (prep/outreach/questions). */
  const jobForCards = (): JobPosting => ({
    title: jobTitle || "Position",
    company: jobCompany || "Company",
    location: jobLocation || "",
    description: jobDescription,
    sourceUrl: jobUrl || undefined,
  });

  /** Experience in the {title, company, bullets} shape the LLM routes expect. */
  const experienceForCards = () =>
    (profile?.experience ?? []).map((e) => ({ title: e.title, company: e.company, bullets: e.bullets }));

  /** Item 5: a rewritten bullet replaces the tailored text; item 39: the ATS
   * score re-computes live so the number always reflects what's on screen. */
  const handleBulletChange = (id: string, newText: string) => {
    setResult((prev) => {
      if (!prev || !profile) return prev;
      const bullets = prev.bullets.map((b) => (b.id === id ? { ...b, tailored: newText } : b));
      const breakdown = scoreResume(jobDescription, jobTitle, prev.summary, prev.skills, bullets.map((b) => b.tailored), profile);
      return { ...prev, bullets, atsBreakdown: breakdown, atsScore: breakdown.score };
    });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">🎯 Tailor Application</h1>

      {!profile && (
        <div className="card border-amber-500/30 bg-amber-950/30">
          <p className="text-amber-400">No resume profile found. <a href="/profile" className="underline">Create one first</a>.</p>
        </div>
      )}

      {/* Job Input */}
      <div className="card">
        <h2 className="font-semibold mb-4">Job Posting</h2>
        <div className="flex gap-2 mb-4">
          <input
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="Paste a Workday job posting URL..."
            className="flex-1"
          />
          <button onClick={fetchJobUrl} disabled={!jobUrl.trim()} className="btn btn-secondary shrink-0">Fetch URL</button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label>Job Title</label>
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Software Engineer" />
            </div>
            <div>
              <label>Company</label>
              <input value={jobCompany} onChange={(e) => setJobCompany(e.target.value)} placeholder="e.g. Acme Corp" />
            </div>
            <div>
              <label>Location</label>
              <input value={jobLocation} onChange={(e) => setJobLocation(e.target.value)} placeholder="e.g. Remote" />
            </div>
          </div>
          <div>
            <label>Job Description</label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full job description here..."
              rows={8}
            />
          </div>
        </div>
        {/* Items 27 + 33: tailoring style */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span>Style:</span>
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="Industry phrasing (optional, e.g. healthcare)"
            className="!w-64 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs"
          />
          <select
            value={letterTone}
            onChange={(e) => setLetterTone(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs w-auto"
          >
            <option value="">Letter tone: default</option>
            <option value="professional and warm">Professional &amp; warm</option>
            <option value="confident and direct">Confident &amp; direct</option>
            <option value="enthusiastic">Enthusiastic</option>
            <option value="formal">Formal</option>
          </select>
          <select
            value={letterLength}
            onChange={(e) => setLetterLength(e.target.value as typeof letterLength)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs w-auto"
          >
            <option value="">Letter length: default</option>
            <option value="short">Short (&lt;150 words)</option>
            <option value="medium">Medium (200-280)</option>
            <option value="long">Long (320-420)</option>
          </select>
        </div>
        <button
          onClick={tailor}
          disabled={tailoring || !profile || !jobDescription.trim()}
          className="btn btn-primary mt-4 w-full"
        >
          {tailoring ? "⏳ Tailoring with Claude..." : "✨ Tailor my resume"}
        </button>
        {templates.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
            <span>Or reuse a saved tailored resume:</span>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) loadTemplate(e.target.value);
                e.target.value = "";
              }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs w-auto"
              disabled={!jobDescription.trim()}
            >
              <option value="">Load template…</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
            {!jobDescription.trim() && <span>(paste a job description first so it can be re-scored)</span>}
          </div>
        )}
      </div>

      {/* Item 30: batch tailoring */}
      <div className="card">
        <details>
          <summary className="font-semibold cursor-pointer">⚡ Batch mode — tailor several postings at once</summary>
          <p className="text-sm text-gray-400 mt-2 mb-2">
            Paste up to 10 Workday posting URLs (one per line). Each is fetched, tailored with the
            style settings above, and saved to the tracker.
          </p>
          <textarea
            value={batchUrls}
            onChange={(e) => setBatchUrls(e.target.value)}
            placeholder={"https://company.wd1.myworkdayjobs.com/...\nhttps://other.wd5.myworkdayjobs.com/..."}
            rows={3}
          />
          <button onClick={runBatch} disabled={batchRunning || !profile || !batchUrls.trim()} className="btn btn-secondary mt-2">
            {batchRunning ? "⏳ Running batch…" : "Run batch"}
          </button>
          {batchLog.length > 0 && (
            <div className="mt-3 p-3 bg-gray-800 rounded-lg text-xs space-y-1 max-h-48 overflow-y-auto">
              {batchLog.map((line, i) => (
                <p key={i} className={line.startsWith("✗") ? "text-red-400" : line.startsWith("✓") ? "text-green-400" : "text-gray-400"}>{line}</p>
              ))}
            </div>
          )}
        </details>
      </div>

      {/* Error */}
      {error && (
        <div className="card border-red-500/30 bg-red-950/30">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Status */}
      {statusMessage && !error && (
        <div className="card border-blue-500/30 bg-blue-950/30">
          <p className="text-blue-400">{statusMessage}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* ATS Score */}
          <div className="card">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">ATS Match Score</h2>
              <div className={`text-4xl font-bold ${scoreColor(result.atsScore)}`}>{result.atsScore}/100</div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Matched keywords:</span>
                <span className="ml-2 text-green-400 font-medium">{result.atsBreakdown.matched.length}</span>
              </div>
              <div>
                <span className="text-gray-400">Missing keywords:</span>
                <span className="ml-2 text-red-400 font-medium">{result.atsBreakdown.missing.length}</span>
              </div>
              <div>
                <span className="text-gray-400">Cost:</span>
                <span className="ml-2 font-medium">${result.estimatedCost}</span>
              </div>
            </div>

            {/* Keyword chips */}
            {(result.atsBreakdown.matched.length > 0 || result.atsBreakdown.missing.length > 0) && (
              <div className="mt-4 space-y-2">
                {result.atsBreakdown.matched.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-500 uppercase tracking-wide mr-1">Matched</span>
                    {result.atsBreakdown.matched.map((kw, i) => (
                      <span key={`m-${kw}-${i}`} className="px-2 py-0.5 rounded-full text-xs bg-green-900/40 text-green-300 border border-green-700/40">✓ {kw}</span>
                    ))}
                  </div>
                )}
                {result.atsBreakdown.missing.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-500 uppercase tracking-wide mr-1">Missing</span>
                    {result.atsBreakdown.missing.map((kw, i) => (
                      <span key={`x-${kw}-${i}`} className="px-2 py-0.5 rounded-full text-xs bg-amber-900/40 text-amber-300 border border-amber-700/40">{kw}</span>
                    ))}
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(result.atsBreakdown.missing.join(", "));
                          setCopiedMissing(true);
                          setTimeout(() => setCopiedMissing(false), 2000);
                        } catch { /* clipboard unavailable */ }
                      }}
                      className="px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                    >
                      {copiedMissing ? "Copied ✓" : "Copy list"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* JD keyword highlighting */}
            {jobDescription.trim() && (
              <div className="mt-4">
                <button
                  onClick={() => setShowHighlights((v) => !v)}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {showHighlights ? "▼ Hide" : "▶ Show"} job description with keyword highlights
                </button>
                {showHighlights && (
                  <div className="mt-2 p-3 bg-gray-800 rounded-lg text-sm leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap">
                    {segmentByKeywords(jobDescription, result.atsBreakdown.matched, result.atsBreakdown.missing).map((seg, i) =>
                      seg.kind === "plain" ? (
                        <span key={i}>{seg.text}</span>
                      ) : (
                        <mark
                          key={i}
                          className={
                            seg.kind === "matched"
                              ? "bg-green-900/60 text-green-200 rounded px-0.5"
                              : "bg-amber-900/60 text-amber-200 rounded px-0.5"
                          }
                        >
                          {seg.text}
                        </mark>
                      ),
                    )}
                  </div>
                )}
              </div>
            )}

            {result.atsBreakdown.integrityFlags?.length > 0 && (
              <div className="mt-3 p-3 bg-red-950/30 border border-red-500/30 rounded-lg">
                <p className="text-red-400 text-sm font-medium">⚠ Integrity flags:</p>
                {result.atsBreakdown.integrityFlags.map((f, i) => (
                  <p key={i} className="text-red-300 text-xs mt-1">{f}</p>
                ))}
              </div>
            )}

            {/* Item 34: per-section parseability */}
            {profile && (
              <div className="mt-4 flex flex-wrap gap-2">
                {sectionReadiness(profile).map((s) => (
                  <span
                    key={s.section}
                    title={s.detail}
                    className={`px-2 py-0.5 rounded-full text-xs border ${
                      s.status === "ok"
                        ? "bg-green-900/40 text-green-300 border-green-700/40"
                        : s.status === "warn"
                          ? "bg-amber-900/40 text-amber-300 border-amber-700/40"
                          : "bg-red-900/40 text-red-300 border-red-700/40"
                    }`}
                  >
                    {s.status === "ok" ? "✓" : s.status === "warn" ? "⚠" : "✗"} {s.section}
                  </span>
                ))}
              </div>
            )}

            {/* Item 35: ranked improvement suggestions */}
            {suggestImprovements(jobDescription, jobTitle, result.atsBreakdown).length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-300 mb-1">📈 What would raise this score</p>
                <ul className="space-y-1 text-xs">
                  {suggestImprovements(jobDescription, jobTitle, result.atsBreakdown).map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`px-1.5 rounded text-[10px] uppercase mt-0.5 ${
                        s.impact === "high" ? "bg-red-900/50 text-red-300" : s.impact === "medium" ? "bg-amber-900/50 text-amber-300" : "bg-gray-700 text-gray-400"
                      }`}>{s.impact}</span>
                      <span className="text-gray-400">{s.suggestion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Item 38: sections the JD emphasizes that the profile barely covers */}
            {profile && thinSections(jobDescription, profile).length > 0 && (
              <div className="mt-3 p-3 bg-amber-950/30 border border-amber-500/30 rounded-lg text-xs text-amber-300 space-y-1">
                {thinSections(jobDescription, profile).map((f, i) => (
                  <p key={i}>⚠ {f}</p>
                ))}
              </div>
            )}

            {/* Item 37: how Workday's parser actually behaves */}
            <details className="mt-4 text-xs text-gray-500">
              <summary className="cursor-pointer text-gray-400">ℹ How Workday reads your resume</summary>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                <li>Workday parses the resume PDF text-first — the generated PDFs here are single-column, no tables/images, exactly what its parser prefers.</li>
                <li>Dates parse most reliably as MM/YYYY; that&apos;s the format this app normalizes to everywhere.</li>
                <li>Workday pre-fills its form from the parsed resume, then the extension&apos;s autofill corrects/completes fields from your structured profile — so the form fields, not just the PDF, are what reviewers see.</li>
                <li>Keywords matter twice: once for the recruiter&apos;s search inside Workday, once for any screening rules the employer set up.</li>
              </ul>
            </details>
          </div>

          {/* Variant tabs */}
          {result.variants?.length > 0 && (
            <div className="card">
              <h2 className="font-semibold mb-3">Variants</h2>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setActiveVariant("original")}
                  className={`btn btn-sm ${activeVariant === "original" ? "btn-primary" : "btn-secondary"}`}
                >
                  Main (ATS {result.atsScore})
                </button>
                {result.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setActiveVariant(v.id)}
                    className={`btn btn-sm ${activeVariant === v.id ? "btn-primary" : "btn-secondary"}`}
                  >
                    {v.label} (ATS {v.atsScore})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="card">
            <h2 className="font-semibold mb-3">Tailored Summary</h2>
            <div className="p-3 bg-gray-800 rounded-lg text-sm leading-relaxed">
              {activeVariant === "original" ? result.summary : result.variants.find((v) => v.id === activeVariant)?.tailoredSummary ?? result.summary}
            </div>
          </div>

          {/* Skills */}
          <div className="card">
            <h2 className="font-semibold mb-3">Tailored Skills</h2>
            <div className="flex flex-wrap gap-2">
              {(activeVariant === "original" ? result.skills : result.variants.find((v) => v.id === activeVariant)?.tailoredSkills ?? result.skills).map((skill) => {
                const matched = result.atsBreakdown.matched.some((m) => skill.toLowerCase().includes(m.toLowerCase()));
                const missing = result.atsBreakdown.missing.some((m) => skill.toLowerCase().includes(m.toLowerCase()));
                return (
                  <span key={skill} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm ${
                    matched ? "bg-green-900/30 text-green-300" : missing ? "bg-amber-900/30 text-amber-300" : "bg-gray-700 text-gray-300"
                  }`}>
                    {skill}
                    {matched && <span className="text-green-400">✓</span>}
                    {missing && <span className="text-amber-400">!</span>}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Tailored bullets: diff + strength + rewrite (items 5, 8, 28-lite, 29-lite) */}
          <BulletsCard
            bullets={result.bullets}
            profile={profile!}
            jobTitle={jobTitle}
            jobDescription={jobDescription}
            onBulletChange={handleBulletChange}
            onStatus={(msg, isError) => (isError ? setError(msg) : setStatusMessage(msg))}
          />

          {/* Fit Analysis */}
          {result.fitAnalysis && (
            <div className="card">
              <h2 className="font-semibold mb-3">Fit Analysis</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-green-400 font-medium mb-2">✅ Strengths</p>
                  <ul className="space-y-1">
                    {result.fitAnalysis.strengths.map((s, i) => (
                      <li key={i} className="text-sm text-gray-300">• {s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-amber-400 font-medium mb-2">⚠ Gaps</p>
                  <ul className="space-y-1">
                    {result.fitAnalysis.gaps.map((g, i) => (
                      <li key={i} className="text-sm text-gray-300">• {g}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="mt-3 text-sm italic text-gray-400">&ldquo;{result.fitAnalysis.verdict}&rdquo;</p>
            </div>
          )}

          {/* Cover Letter */}
          <div className="card">
            <h2 className="font-semibold mb-3">Cover Letter</h2>
            <div className="p-3 bg-gray-800 rounded-lg text-sm leading-relaxed whitespace-pre-wrap">
              {(activeVariant === "original" ? result.coverLetter : result.variants.find((v) => v.id === activeVariant)?.coverLetter ?? result.coverLetter)}
            </div>
          </div>

          {/* Interview prep, outreach, question drafting (items 4, 6, 7) */}
          <InterviewPrepCard
            job={jobForCards()}
            summary={result.summary}
            skills={result.skills}
            experience={experienceForCards()}
            gaps={result.fitAnalysis?.gaps}
          />
          <OutreachCard
            job={jobForCards()}
            summary={result.summary}
            skills={result.skills}
            experience={experienceForCards()}
          />
          <QuestionsCard job={jobForCards()} profile={profile!} apiKey={apiKey} />

          {/* Actions */}
          <div className="card">
            <h2 className="font-semibold mb-3">Actions</h2>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="resumeChoice" className="text-gray-400">Resume to use:</label>
              <select
                id="resumeChoice"
                value={resumeChoice}
                onChange={(e) => setResumeChoice(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm"
              >
                <option value="tailored">Tailored resume (recommended)</option>
                {result.variants.map((v) => (
                  <option key={v.id} value={v.id}>Variant: {v.label} (ATS {v.atsScore})</option>
                ))}
                <option value="profile">Base profile (untailored)</option>
              </select>
              <span className="px-2 py-0.5 rounded-full text-xs bg-blue-900/40 text-blue-300 border border-blue-700/40">
                Using: {resolveResumeChoice()?.label ?? "—"}
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={sendToExtension}
                disabled={getBridgeStatus() !== "detected"}
                className="btn btn-primary"
              >
                {getBridgeStatus() === "detected" ? "📤 Send to extension" : "🔌 Extension not detected"}
              </button>
              <button onClick={saveAsTemplate} className="btn btn-secondary" title="Reuse this tailored resume on similar roles later.">
                💾 Save as template
              </button>
              <label className="btn btn-secondary cursor-pointer" title="Writing sample / portfolio PDF — attached by the extension when the form asks for one.">
                {extraFile ? `📎 ${extraFile.name.slice(0, 18)} ✓` : "📎 Extra attachment"}
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    f.arrayBuffer().then((buf) => {
                      const bytes = new Uint8Array(buf);
                      let binary = "";
                      for (let i = 0; i < bytes.length; i += 0x8000) {
                        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                      }
                      setExtraFile({ name: f.name, base64: btoa(binary) });
                    });
                    e.target.value = "";
                  }}
                />
              </label>
              {(() => {
                const chosen = resolveResumeChoice();
                return chosen ? (
                  <ExportButtons
                    profile={profile!}
                    chosen={chosen}
                    jobTitle={jobTitle}
                    jobCompany={jobCompany}
                    onStatus={(msg, isError) => (isError ? setError(msg) : setStatusMessage(msg))}
                  />
                ) : null;
              })()}
              <button
                onClick={() => {
                  // Export resume text for the SELECTED resume source
                  const chosen = resolveResumeChoice();
                  if (!chosen) return;
                  const text = renderResumeText(profile!, {
                    summary: chosen.summary,
                    skills: chosen.skills,
                    bullets: chosen.bullets,
                  });
                  navigator.clipboard.writeText(text).then(() => setStatusMessage(`Resume text copied (${chosen.label}).`));
                }}
                className="btn btn-secondary"
              >
                📋 Copy resume text
              </button>
              <button
                onClick={() => {
                  // The base profile has no tailored cover letter — fall back
                  // to the main tailored one rather than copying nothing.
                  const chosen = resolveResumeChoice();
                  navigator.clipboard.writeText(
                    renderCoverLetterText({
                      id: "",
                      createdAt: "",
                      job: { title: jobTitle || "", company: jobCompany || "", location: jobLocation || "", description: jobDescription },
                      profile: profile!,
                      tailoredSummary: chosen?.summary ?? result.summary,
                      tailoredSkills: chosen?.skills ?? result.skills,
                      tailoredBullets: chosen?.bullets ?? result.bullets,
                      coverLetter: chosen?.coverLetter || result.coverLetter,
                      atsScore: result.atsScore,
                      atsBreakdown: result.atsBreakdown,
                      status: "draft",
                    })
                  ).then(() => setStatusMessage("Cover letter copied!"));
                }}
                className="btn btn-secondary"
              >
                📋 Copy cover letter
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}