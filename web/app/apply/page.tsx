"use client";

import { useEffect, useState } from "react";
import { loadProfile, loadSettings, saveApplication } from "@/lib/storage";
import { sendAutofillPackage, getBridgeStatus } from "@/lib/extension-bridge";
import { segmentByKeywords } from "@/lib/highlight-keywords";
import { renderResumeText, renderCoverLetterText } from "@/lib/pdf-generator";
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

  useEffect(() => {
    const p = loadProfile();
    setProfile(p);
    if (!p) setStatusMessage("Set up your resume profile first.");
    // Check for query params from extension
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") === "extension") {
      setStatusMessage("Job posting scraped from the extension — fill in the details below.");
    }
    // A key/model chosen in Settings (browser-only) is sent per-request; an
    // empty model falls through to the server's ANTHROPIC_MODEL/default.
    const settings = loadSettings();
    setApiKey(settings.anthropicKey);
    setModel(settings.model);
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

      setStatusMessage(`ATS Score: ${data.atsScore}/100 · Cost: $${data.estimatedCost}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tailoring failed");
      setStatusMessage("");
    } finally {
      setTailoring(false);
    }
  };

  const sendToExtension = () => {
    if (!profile || !result) return;
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
      summary: result.summary,
      skills: result.skills,
      experience: profile.experience,
      education: profile.education,
      certifications: profile.certifications.map((c) => c.name),
      certificationDetails: profile.certifications,
      coverLetterText: result.coverLetter,
      resumePdfBase64: "",
      resumeFileName: `resume-${job.company?.toLowerCase().replace(/\s+/g, "-") ?? "position"}.pdf`,
      coverLetterPdfBase64: "",
      coverLetterFileName: `cover-letter-${job.company?.toLowerCase().replace(/\s+/g, "-") ?? "position"}.pdf`,
      atsScore: result.atsScore,
    });
    setStatusMessage("✅ Sent to extension! Open the Workday application form and click Autofill.");
  };

  const scoreColor = (s: number) => s >= 80 ? "text-green-400" : s >= 60 ? "text-amber-400" : "text-red-400";

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
        <button
          onClick={tailor}
          disabled={tailoring || !profile || !jobDescription.trim()}
          className="btn btn-primary mt-4 w-full"
        >
          {tailoring ? "⏳ Tailoring with Claude..." : "✨ Tailor my resume"}
        </button>
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

          {/* Actions */}
          <div className="card">
            <h2 className="font-semibold mb-3">Actions</h2>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={sendToExtension}
                disabled={getBridgeStatus() !== "detected"}
                className="btn btn-primary"
              >
                {getBridgeStatus() === "detected" ? "📤 Send to extension" : "🔌 Extension not detected"}
              </button>
              <button
                onClick={() => {
                  // Export resume text
                  const text = renderResumeText(profile!, {
                    summary: result.summary,
                    skills: result.skills,
                    bullets: result.bullets,
                  });
                  navigator.clipboard.writeText(text).then(() => setStatusMessage("Resume text copied!"));
                }}
                className="btn btn-secondary"
              >
                📋 Copy resume text
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    renderCoverLetterText({
                      id: "",
                      createdAt: "",
                      job: { title: jobTitle || "", company: jobCompany || "", location: jobLocation || "", description: jobDescription },
                      profile: profile!,
                      tailoredSummary: result.summary,
                      tailoredSkills: result.skills,
                      tailoredBullets: result.bullets,
                      coverLetter: result.coverLetter,
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