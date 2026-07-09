"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import {
  deleteApplication,
  loadApplications,
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

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold mb-6">Application tracker</h1>
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
}: {
  application: SavedApplication;
  onStatusChange: (status: ApplicationStatus) => void;
  onDelete: () => void;
}) {
  const [actionStatus, setActionStatus] = useState<string | null>(null);

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

      <div>
        <h3 className="font-semibold text-sm mb-1">Summary</h3>
        <p className="text-sm opacity-80">{application.summary}</p>
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
