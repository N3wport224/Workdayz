"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import {
  bulkArchiveRejected,
  countTailoredSince,
  deleteApplication,
  importApplications,
  isFollowUpOverdue,
  loadApplications,
  setArchived,
  statusSince,
  updateApplication,
  updateApplicationStatus,
} from "@/lib/applications";
import type { MessageKind } from "@/lib/generate-message";
import { applicationsToCsv } from "@/lib/csv";
import { prepToMarkdown } from "@/lib/prep-markdown";
import { safeFilenamePart } from "@/lib/safe-filename";
import { responseSummary, statsByAtsBand, weeklyCounts } from "@/lib/analytics";
import { followUpsToIcs } from "@/lib/ics";
import { fetchPdfAsBase64, onExtensionDetected, sendPackageToExtension } from "@/lib/extension-bridge";
import { APPLICATION_STATUSES, type ApplicationStatus, type AutofillPackage, type SavedApplication } from "@/lib/types";

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<SavedApplication[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [extensionPresent, setExtensionPresent] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const [sortBy, setSortBy] = useState<"newest" | "ats" | "company">("newest");
  const [view, setView] = useState<"list" | "board">("list");
  const [showArchived, setShowArchived] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const apps = loadApplications();
    setApplications(apps);
    setSelectedId(apps[0]?.id ?? null);
    setLoaded(true);
    return onExtensionDetected(setExtensionPresent);
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

  // Stats describe the active pipeline; archived entries are history.
  const active = applications.filter((a) => !a.archived);
  const archivedCount = applications.length - active.length;
  const statusCounts = active.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const avgAts = active.length
    ? Math.round(active.reduce((sum, a) => sum + a.atsScore.score, 0) / active.length)
    : 0;

  const q = query.trim().toLowerCase();
  const visible = applications
    .filter((a) => showArchived || !a.archived)
    .filter((a) => statusFilter === "all" || a.status === statusFilter)
    .filter(
      (a) =>
        !q ||
        a.job.title.toLowerCase().includes(q) ||
        a.job.company.toLowerCase().includes(q) ||
        (a.notes ?? "").toLowerCase().includes(q),
    )
    .sort((a, b) => {
      if (sortBy === "ats") return b.atsScore.score - a.atsScore.score;
      if (sortBy === "company") return a.job.company.localeCompare(b.job.company);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  function exportBackup() {
    const blob = new Blob([JSON.stringify(applications, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workdayz-applications-backup.json";
    a.click();
    URL.revokeObjectURL(url);
    setBackupStatus("Backup exported.");
  }

  async function restoreBackup(file: File) {
    try {
      const added = importApplications(JSON.parse(await file.text()));
      refresh();
      setBackupStatus(`Restored ${added} application(s) (existing entries untouched).`);
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : "Couldn't read that backup.");
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold mb-4">Application tracker</h1>
      <div className="flex flex-wrap gap-4 mb-6 text-sm">
        <span className="rounded-lg border border-black/10 dark:border-white/15 px-3 py-1.5">
          <span className="font-semibold">{active.length}</span> active
          {archivedCount > 0 ? <span className="opacity-60"> · {archivedCount} archived</span> : null}
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
        <span className="rounded-lg border border-black/10 dark:border-white/15 px-3 py-1.5">
          7d <span className="font-semibold">{countTailoredSince(active, 7)}</span> · 30d{" "}
          <span className="font-semibold">{countTailoredSince(active, 30)}</span>
        </span>
        <StorageMeter />
        <span className="flex items-center gap-3 ml-auto">
          {active.some((a) => a.status === "rejected") ? (
            <button
              onClick={() => {
                const n = bulkArchiveRejected();
                setBackupStatus(`Archived ${n} rejected application${n === 1 ? "" : "s"}.`);
                refresh();
              }}
              className="text-blue-600 dark:text-blue-400"
              title="Move all rejected applications out of the active views"
            >
              Archive rejected
            </button>
          ) : null}
          <button
            onClick={() => {
              const blob = new Blob([applicationsToCsv(applications)], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "workdayz-applications.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="text-blue-600 dark:text-blue-400"
          >
            CSV
          </button>
          {applications.some((a) => a.followUpAt && a.status !== "rejected" && a.status !== "offer") ? (
            <button
              onClick={() => {
                const blob = new Blob([followUpsToIcs(applications)], { type: "text/calendar" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "workdayz-followups.ics";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-blue-600 dark:text-blue-400"
              title="Import your follow-up dates into your calendar"
            >
              Follow-ups .ics
            </button>
          ) : null}
          <button onClick={exportBackup} className="text-blue-600 dark:text-blue-400">
            Backup
          </button>
          <button onClick={() => backupInputRef.current?.click()} className="text-blue-600 dark:text-blue-400">
            Restore
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) restoreBackup(file);
              e.target.value = "";
            }}
          />
        </span>
      </div>
      {backupStatus ? <p className="text-xs opacity-70 -mt-4 mb-4">{backupStatus}</p> : null}

      <InsightsPanel applications={applications} />

      <OffersTable applications={applications} onUpdated={refresh} />

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-1.5 text-sm flex-1 min-w-40"
          placeholder="Search title, company, notes..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-2 py-1.5 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | "all")}
        >
          <option value="all">All statuses</option>
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-2 py-1.5 text-sm"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
        >
          <option value="newest">Newest first</option>
          <option value="ats">Highest ATS</option>
          <option value="company">Company A-Z</option>
        </select>
        <div className="flex rounded-md border border-black/15 dark:border-white/20 overflow-hidden text-sm">
          {(["list", "board"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 ${view === v ? "bg-blue-600 text-white" : "opacity-70"}`}
            >
              {v === "list" ? "List" : "Board"}
            </button>
          ))}
        </div>
        {archivedCount > 0 ? (
          <label className="flex items-center gap-1.5 text-xs opacity-80">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived ({archivedCount})
          </label>
        ) : null}
      </div>
      {view === "board" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {APPLICATION_STATUSES.map((s) => {
              const column = visible.filter((a) => a.status === s);
              return (
                <div key={s} className="rounded-lg border border-black/10 dark:border-white/15 p-2 min-h-24">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <StatusBadge status={s} />
                    <span className="text-xs opacity-60">{column.length}</span>
                  </div>
                  <div className="space-y-2">
                    {column.map((app) => (
                      <button
                        key={app.id}
                        onClick={() => setSelectedId(app.id)}
                        className={`w-full text-left rounded-md border p-2 transition-colors ${
                          app.id === selectedId
                            ? "border-blue-500 bg-blue-500/5"
                            : "border-black/10 dark:border-white/15 hover:border-blue-500/50"
                        }`}
                      >
                        <p className="text-xs font-medium truncate">{app.job.title || "Untitled role"}</p>
                        <p className="text-[11px] opacity-70 truncate">{app.job.company}</p>
                        <div className="flex items-center justify-between mt-1 text-[11px]">
                          <span className="opacity-60">ATS {app.atsScore.score}</span>
                          <span className="flex items-center gap-1">
                            {app.archived ? <span className="opacity-50">archived</span> : null}
                            {isFollowUpOverdue(app) ? (
                              <span className="text-amber-700 dark:text-amber-300" title={`Follow-up was due ${app.followUpAt}`}>
                                ⏰
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {selected ? (
            <ApplicationDetail
              application={selected}
              extensionPresent={extensionPresent}
              onStatusChange={(status) => handleStatusChange(selected.id, status)}
              onDelete={() => handleDelete(selected.id)}
              onUpdated={refresh}
            />
          ) : (
            <p className="text-sm opacity-70">Select a card to view details.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
          <ul className="space-y-2">
            {visible.length === 0 ? (
              <li className="text-sm opacity-60 p-2">No applications match.</li>
            ) : null}
            {visible.map((app) => (
              <li key={app.id}>
                <button
                  onClick={() => setSelectedId(app.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    app.id === selectedId
                      ? "border-blue-500 bg-blue-500/5"
                      : "border-black/10 dark:border-white/15 hover:border-blue-500/50"
                  } ${app.archived ? "opacity-60" : ""}`}
                >
                  <p className="font-medium text-sm truncate">{app.job.title || "Untitled role"}</p>
                  <p className="text-xs opacity-70 truncate">{app.job.company}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="flex items-center gap-1.5">
                      <StatusBadge status={app.status} />
                      {app.archived ? <span className="text-xs opacity-50">archived</span> : null}
                      {isFollowUpOverdue(app) ? (
                        <span
                          title={`Follow-up was due ${app.followUpAt}`}
                          className="text-xs text-amber-700 dark:text-amber-300 font-medium"
                        >
                          ⏰ follow up
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs opacity-60">ATS {app.atsScore.score}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <ApplicationDetail
              application={selected}
              extensionPresent={extensionPresent}
              onStatusChange={(status) => handleStatusChange(selected.id, status)}
              onDelete={() => handleDelete(selected.id)}
              onUpdated={refresh}
            />
          ) : (
            <p className="text-sm opacity-70">Select an application to view details.</p>
          )}
        </div>
      )}
    </main>
  );
}

function ApplicationDetail({
  application,
  extensionPresent,
  onStatusChange,
  onDelete,
  onUpdated,
}: {
  application: SavedApplication;
  extensionPresent: boolean;
  onStatusChange: (status: ApplicationStatus) => void;
  onDelete: () => void;
  onUpdated: () => void;
}) {
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<MessageKind | null>(null);
  const [messageText, setMessageText] = useState("");
  const [messageContext, setMessageContext] = useState("");
  const [messageCopied, setMessageCopied] = useState(false);

  async function draftMessage(kind: MessageKind) {
    setMessageKind(kind);
    setMessageText("");
    setMessageCopied(false);
    try {
      const res = await fetch("/api/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          job: application.job,
          summary: application.summary,
          skills: application.skills,
          experience: application.experience.map((e) => ({
            title: e.title,
            company: e.company,
            bullets: e.bullets,
          })),
          context: messageContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Drafting failed.");
      const { subject, body } = data.message as { subject: string; body: string };
      setMessageText(subject ? `Subject: ${subject}\n\n${body}` : body);
    } catch (err) {
      setMessageText(err instanceof Error ? `Error: ${err.message}` : "Error: drafting failed.");
    }
  }

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
      projects: application.projects,
      companyName: application.job.company,
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
          projects: application.projects,
          companyName: application.job.company,
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
      setActionStatus(
        extensionPresent
          ? "Sent to extension — open your Workday tab and click Autofill."
          : "Extension not detected in this tab — install/enable it and reload, then retry.",
      );
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
            Tailored {new Date(application.createdAt).toLocaleString()} · in{" "}
            {application.status} for {daysSince(statusSince(application))}
          </p>
          {application.job.sourceUrl ? (
            <a
              href={application.job.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-blue-600 dark:text-blue-400 mt-1 inline-block"
            >
              Open original posting ↗
            </a>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1.5">
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
          <label className="text-xs opacity-70 flex items-center gap-1.5">
            Follow up by
            <input
              type="date"
              className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-1.5 py-0.5 text-xs"
              value={application.followUpAt ?? ""}
              onChange={(e) => {
                updateApplication(application.id, { followUpAt: e.target.value || undefined });
                onUpdated();
              }}
            />
          </label>
          <label className="text-xs opacity-70 flex items-center gap-1.5">
            Comp
            <input
              key={application.id}
              className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-1.5 py-0.5 text-xs w-36"
              defaultValue={application.salary ?? ""}
              placeholder="$95k + bonus…"
              onBlur={(e) => {
                if (e.target.value !== (application.salary ?? "")) {
                  updateApplication(application.id, { salary: e.target.value || undefined });
                  onUpdated();
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 text-sm">
        <p className="font-medium mb-1">ATS score: {application.atsScore.score}/100</p>
        <p className="opacity-70">{application.atsScore.notes}</p>
      </div>

      {application.statusHistory?.length ? (
        <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 text-sm">
          <p className="font-medium mb-2">Status timeline</p>
          <ol className="space-y-1 text-xs">
            <li className="opacity-70">
              <span className="font-medium">draft</span> — created{" "}
              {new Date(application.createdAt).toLocaleDateString()}
            </li>
            {application.statusHistory.map((entry, i) => (
              <li key={i} className={i === application.statusHistory!.length - 1 ? "" : "opacity-70"}>
                <span className="opacity-50">→ </span>
                <span className="font-medium">{entry.status}</span> —{" "}
                {new Date(entry.at).toLocaleDateString()}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

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
          <div className="flex items-center gap-2">
            {application.interviewPrep ? (
              <button
                onClick={() => {
                  const md = prepToMarkdown(application);
                  const blob = new Blob([md], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `Interview_Prep_${safeFilenamePart(application.job.company, "job")}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 text-xs font-medium"
                title="Download as Markdown for your notes app"
              >
                Export .md
              </button>
            ) : null}
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

      <div>
        <h3 className="font-semibold text-sm mb-2">Outreach messages</h3>
        <div className="flex flex-wrap gap-2 mb-2">
          <button
            onClick={() => draftMessage("thank-you")}
            className="rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 text-xs font-medium"
          >
            Thank-you email
          </button>
          <button
            onClick={() => draftMessage("follow-up")}
            className="rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 text-xs font-medium"
          >
            Follow-up email
          </button>
          <button
            onClick={() => draftMessage("recruiter-dm")}
            className="rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 text-xs font-medium"
          >
            Recruiter DM
          </button>
          <input
            className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-xs flex-1 min-w-40"
            placeholder="Optional context (interviewer's name, what you discussed...)"
            value={messageContext}
            onChange={(e) => setMessageContext(e.target.value)}
          />
        </div>
        {messageKind && !messageText ? <p className="text-xs opacity-60">Drafting...</p> : null}
        {messageText ? (
          <div className="rounded-lg border border-black/10 dark:border-white/15 p-3">
            <pre className="text-sm whitespace-pre-wrap font-sans opacity-90">{messageText}</pre>
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(messageText);
                  setMessageCopied(true);
                  setTimeout(() => setMessageCopied(false), 1500);
                }}
                className="text-xs text-blue-600 dark:text-blue-400"
              >
                {messageCopied ? "Copied ✓" : "Copy message"}
              </button>
              {messageKind !== "recruiter-dm" && !messageText.startsWith("Error:") ? (
                <a
                  className="text-xs text-blue-600 dark:text-blue-400"
                  href={(() => {
                    const match = messageText.match(/^Subject: (.*)\n\n([\s\S]*)$/);
                    const subject = match?.[1] ?? `Re: ${application.job.title}`;
                    const bodyText = match?.[2] ?? messageText;
                    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
                  })()}
                >
                  Open in email app ↗
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
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
          onClick={() => {
            setArchived(application.id, !application.archived);
            onUpdated();
          }}
          className="rounded-md border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium ml-auto"
          title="Archived entries are hidden from the default views but kept in exports"
        >
          {application.archived ? "Unarchive" : "Archive"}
        </button>
        <button
          onClick={onDelete}
          className="rounded-md text-rose-600 dark:text-rose-400 px-4 py-2 text-sm font-medium"
        >
          Delete
        </button>
      </div>
      {actionStatus ? <p className="text-sm opacity-80">{actionStatus}</p> : null}
    </div>
  );
}

/** Browser localStorage is capped (~5 MB). Shows headroom once usage is
 * meaningful, and warns before writes start failing — archiving/deleting or
 * exporting a backup is the fix. */
function StorageMeter() {
  const LIMIT = 5 * 1024 * 1024;
  let bytes = 0;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith("workdayz.")) continue;
      bytes += (key.length + (window.localStorage.getItem(key)?.length ?? 0)) * 2; // UTF-16
    }
  } catch {
    return null;
  }
  const ratio = bytes / LIMIT;
  if (ratio < 0.5) return null;
  const warning = ratio >= 0.8;
  return (
    <span
      className={`rounded-lg border px-3 py-1.5 ${
        warning
          ? "border-amber-500/50 text-amber-700 dark:text-amber-300"
          : "border-black/10 dark:border-white/15"
      }`}
      title="Browser storage used by Workdayz (localStorage caps around 5 MB). Delete or archive+export old applications to free space."
    >
      storage <span className="font-semibold">{Math.round(ratio * 100)}%</span>
      {warning ? " ⚠" : ""}
    </span>
  );
}

/** Outcome analytics: does a higher ATS score actually get more replies? */
function InsightsPanel({ applications }: { applications: SavedApplication[] }) {
  const summary = responseSummary(applications);
  if (summary.submitted < 3) return null; // too little data to say anything
  const bands = statsByAtsBand(applications);
  const weeks = weeklyCounts(applications, 4);
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
  return (
    <details className="rounded-lg border border-black/10 dark:border-white/15 p-4 mb-4 text-sm">
      <summary className="cursor-pointer font-medium">
        Insights — {summary.responses}/{summary.submitted} submitted got a response (
        {pct(summary.responses, summary.submitted)})
        {summary.medianDaysToResponse !== null ? ` · median ${summary.medianDaysToResponse}d to hear back` : ""}
      </summary>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-medium opacity-70 mb-1">Response rate by ATS score</p>
          <ul className="space-y-0.5 text-xs">
            {bands.map((b) => (
              <li key={b.band} className="flex justify-between gap-4">
                <span className="opacity-70">ATS {b.band}</span>
                <span>
                  {b.responses}/{b.submitted} responded ({pct(b.responses, b.submitted)}) ·{" "}
                  {b.interviews} interview{b.interviews === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] opacity-50 mt-1.5">
            Small samples mislead — treat this as a hint, not a law.
          </p>
        </div>
        <div>
          <p className="text-xs font-medium opacity-70 mb-1">Tailored per week (recent first)</p>
          <div className="flex items-end gap-1 h-12">
            {weeks.map((count, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div
                  className="w-6 bg-blue-500/60 rounded-sm"
                  style={{ height: `${Math.min(100, count * 12)}%`, minHeight: count ? 4 : 1 }}
                />
                <span className="text-[10px] opacity-50">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

/** Side-by-side comp comparison once offers exist. */
function OffersTable({
  applications,
  onUpdated,
}: {
  applications: SavedApplication[];
  onUpdated: () => void;
}) {
  const offers = applications.filter((a) => a.status === "offer");
  if (offers.length === 0) return null;
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 mb-4 text-sm">
      <p className="font-medium mb-2">🎉 Offer{offers.length === 1 ? "" : "s"}</p>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr className="text-left opacity-60">
              <th className="pr-4 pb-1 font-medium">Role</th>
              <th className="pr-4 pb-1 font-medium">Company</th>
              <th className="pr-4 pb-1 font-medium">Comp (editable)</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => (
              <tr key={offer.id}>
                <td className="pr-4 py-0.5">{offer.job.title}</td>
                <td className="pr-4 py-0.5">{offer.job.company}</td>
                <td className="pr-4 py-0.5">
                  <input
                    className="rounded border border-black/15 dark:border-white/20 bg-transparent px-1.5 py-0.5 w-56"
                    defaultValue={offer.salary ?? ""}
                    placeholder="$95k base + 10% bonus…"
                    onBlur={(e) => {
                      if (e.target.value !== (offer.salary ?? "")) {
                        updateApplication(offer.id, { salary: e.target.value || undefined });
                        onUpdated();
                      }
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function daysSince(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "less than a day";
  return `${days} day${days === 1 ? "" : "s"}`;
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
