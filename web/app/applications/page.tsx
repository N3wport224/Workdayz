"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import {
  deleteApplication,
  loadApplications,
  updateApplication,
  updateApplicationStatus,
} from "@/lib/applications";
import { fetchPdfAsBase64, sendPackageToExtension } from "@/lib/extension-bridge";
import { APPLICATION_STATUSES, type ApplicationStatus, type AutofillPackage, type SavedApplication } from "@/lib/types";

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<SavedApplication[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const apps = loadApplications();
    setApplications(apps);
    setSelectedId(apps[0]?.id ?? null);
    setLoaded(true);
  }, []);

  function refresh() {
    setApplications(loadApplications());
  }

  function handleStatusChange(id: string, status: ApplicationStatus) {
    updateApplicationStatus(id, status);
    refresh();
  }

  function handleDelete(id: string) {
    deleteApplication(id);
    if (selectedId === id) setSelectedId(null);
    refresh();
  }

  if (!loaded) return null;

  const selected = applications.find((a) => a.id === selectedId) ?? null;

  if (applications.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold mb-2">Application tracker</h1>
        <p className="text-sm opacity-70 mb-6">
          Nothing here yet — applications are saved automatically each time you tailor one.
        </p>
        <Link href="/apply" className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium">
          Tailor your first application
        </Link>
      </main>
    );
  }

  const statusCounts = applications.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const avgAts = Math.round(
    applications.reduce((sum, a) => sum + a.atsScore.score, 0) / applications.length,
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold mb-4">Application tracker</h1>
      <div className="flex flex-wrap gap-4 mb-6 text-sm">
        <span className="rounded-lg border border-black/10 dark:border-white/15 px-3 py-1.5">
          <span className="font-semibold">{applications.length}</span> total
        </span>
        {APPLICATION_STATUSES.filter((s) => statusCounts[s]).map((s) => (
          <span key={s} className="rounded-lg border border-black/10 dark:border-white/15 px-3 py-1.5 flex items-center gap-2">
            <StatusBadge status={s} />
            <span className="font-semibold">{statusCounts[s]}</span>
          </span>
        ))}
        <span className="rounded-lg border border-black/10 dark:border-white/15 px-3 py-1.5">
          avg ATS <span className="font-semibold">{avgAts}</span>
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
        <ul className="space-y-2">
          {applications.map((app) => (
            <li key={app.id}>
              <button
                onClick={() => setSelectedId(app.id)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  app.id === selectedId
                    ? "border-blue-500 bg-blue-500/5"
                    : "border-black/10 dark:border-white/15 hover:border-blue-500/50"
                }`}
              >
                <p className="font-medium text-sm truncate">{app.job.title || "Untitled role"}</p>
                <p className="text-xs opacity-70 truncate">{app.job.company}</p>
                <div className="flex items-center justify-between mt-2">
                  <StatusBadge status={app.status} />
                  <span className="text-xs opacity-60">ATS {app.atsScore.score}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <ApplicationDetail
            application={selected}
            onStatusChange={(status) => handleStatusChange(selected.id, status)}
            onDelete={() => handleDelete(selected.id)}
            onUpdated={refresh}
          />
        ) : (
          <p className="text-sm opacity-70">Select an application to view details.</p>
        )}
      </div>
    </main>
  );
}

function ApplicationDetail({
  application,
  onStatusChange,
  onDelete,
  onUpdated,
}: {
  application: SavedApplication;
  onStatusChange: (status: ApplicationStatus) => void;
  onDelete: () => void;
  onUpdated: () => void;
}) {
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  async function generatePrep() {
    setPrepLoading(true);
    setPrepError(null);
    try {
      const res = await fetch("/api/interview-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job: application.job,
          summary: application.summary,
          skills: application.skills,
          experience: application.experience.map((e) => ({
            title: e.title,
            company: e.company,
            bullets: e.bullets,
          })),
          gaps: application.fitAnalysis?.gaps,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Interview prep failed.");
      updateApplication(application.id, { interviewPrep: data.prep });
      onUpdated();
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPrepLoading(false);
    }
  }

  async function downloadResumePdf() {
    const { base64, fileName } = await fetchPdfAsBase64("/api/resume-pdf", {
      contact: application.contact,
      summary: application.summary,
      skills: application.skills,
      experience: application.experience,
      education: application.education,
      certifications: application.certifications,
    });
    triggerDownload(base64, fileName);
  }

  async function downloadCoverLetterPdf() {
    const { base64, fileName } = await fetchPdfAsBase64("/api/cover-letter-pdf", {
      contact: application.contact,
      companyName: application.job.company,
      jobTitle: application.job.title,
      bodyText: application.coverLetterText,
      date: new Date(application.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    });
    triggerDownload(base64, fileName);
  }

  async function sendToExtension() {
    setActionStatus("Generating PDFs...");
    try {
      const [resumePdf, coverPdf] = await Promise.all([
        fetchPdfAsBase64("/api/resume-pdf", {
          contact: application.contact,
          summary: application.summary,
          skills: application.skills,
          experience: application.experience,
          education: application.education,
          certifications: application.certifications,
        }),
        fetchPdfAsBase64("/api/cover-letter-pdf", {
          contact: application.contact,
          companyName: application.job.company,
          jobTitle: application.job.title,
          bodyText: application.coverLetterText,
          date: new Date(application.createdAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        }),
      ]);
      const pkg: AutofillPackage = {
        version: 1,
        createdAt: new Date().toISOString(),
        job: application.job,
        contact: application.contact,
        summary: application.summary,
        skills: application.skills,
        experience: application.experience,
        education: application.education,
        certifications: application.certifications,
        coverLetterText: application.coverLetterText,
        resumePdfBase64: resumePdf.base64,
        resumeFileName: resumePdf.fileName,
        coverLetterPdfBase64: coverPdf.base64,
        coverLetterFileName: coverPdf.fileName,
        atsScore: application.atsScore.score,
      };
      sendPackageToExtension(pkg);
      setActionStatus("Sent to extension.");
    } catch (err) {
      setActionStatus(err instanceof Error ? err.message : "Failed.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{application.job.title}</h2>
          <p className="text-sm opacity-70">
            {application.job.company}
            {application.job.location ? ` — ${application.job.location}` : ""}
          </p>
          <p className="text-xs opacity-50 mt-1">
            Tailored {new Date(application.createdAt).toLocaleString()}
          </p>
        </div>
        <select
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
          value={application.status}
          onChange={(e) => onStatusChange(e.target.value as ApplicationStatus)}
        >
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 text-sm">
        <p className="font-medium mb-1">ATS score: {application.atsScore.score}/100</p>
        <p className="opacity-70">{application.atsScore.notes}</p>
      </div>

      {application.fitAnalysis?.verdict ? (
        <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 text-sm">
          <p className="font-medium mb-1">Fit analysis</p>
          <p className="opacity-80 mb-2">{application.fitAnalysis.verdict}</p>
          {application.fitAnalysis.gaps.length ? (
            <p className="opacity-70">
              <span className="font-medium text-amber-700 dark:text-amber-300">Gaps: </span>
              {application.fitAnalysis.gaps.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <h3 className="font-semibold text-sm mb-1">Summary</h3>
        <p className="text-sm opacity-80">{application.summary}</p>
      </div>

      <div>
        <h3 className="font-semibold text-sm mb-1">Notes</h3>
        <textarea
          key={application.id}
          className="w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm"
          rows={3}
          defaultValue={application.notes ?? ""}
          placeholder="Recruiter names, interview dates, follow-ups..."
          onBlur={(e) => {
            if (e.target.value !== (application.notes ?? "")) {
              updateApplication(application.id, { notes: e.target.value });
              onUpdated();
            }
          }}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Interview prep</h3>
          <button
            onClick={generatePrep}
            disabled={prepLoading}
            className="rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {prepLoading
              ? "Generating..."
              : application.interviewPrep
                ? "Regenerate"
                : "Generate likely questions & talking points"}
          </button>
        </div>
        {prepError ? <p className="text-sm text-rose-600 dark:text-rose-400 mb-2">{prepError}</p> : null}
        {application.interviewPrep ? (
          <div className="space-y-3">
            <p className="text-xs opacity-50">
              Generated {new Date(application.interviewPrep.generatedAt).toLocaleString()} — talking
              points reference only your real experience.
            </p>
            {application.interviewPrep.questions.map((q, i) => (
              <details key={i} className="rounded-lg border border-black/10 dark:border-white/15 p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  <span className="inline-block mr-2 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs uppercase tracking-wide">
                    {q.category}
                  </span>
                  {q.question}
                </summary>
                <ul className="list-disc list-inside opacity-80 mt-2 space-y-1">
                  {q.talkingPoints.map((tp, j) => (
                    <li key={j}>{tp}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-sm opacity-60">
            Questions this role is likely to ask, with talking points mapped to your actual
            experience — and honest framings for your gaps.
          </p>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-sm mb-1">Cover letter</h3>
        <p className="text-sm opacity-80 whitespace-pre-wrap">{application.coverLetterText}</p>
      </div>

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
          Send to extension
        </button>
        <button
          onClick={onDelete}
          className="rounded-md text-rose-600 dark:text-rose-400 px-4 py-2 text-sm font-medium ml-auto"
        >
          Delete
        </button>
      </div>
      {actionStatus ? <p className="text-sm opacity-80">{actionStatus}</p> : null}
    </div>
  );
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
