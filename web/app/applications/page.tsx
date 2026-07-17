"use client";

import { useEffect, useMemo, useState } from "react";
import { loadApplications, saveApplication, deleteApplication } from "@/lib/storage";
import {
  buildCsv,
  duplicateIds,
  effectiveBullets,
  followUpsToIcs,
  isFollowUpOverdue,
  keywordGaps,
  medianResponseDays,
  responseStats,
  timeInStage,
  trackerSummaryMarkdown,
  weeklyVolume,
  withStatusChange,
} from "@/lib/tracker";
import type { TailoredApplication, ApplicationStatus } from "@/lib/types";

const statuses: ApplicationStatus[] = ["draft", "applied", "screening", "interview", "offer", "rejected", "accepted", "archived"];

type SortKey = "newest" | "oldest" | "ats" | "company" | "status";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ApplicationsPage() {
  const [applications, setApps] = useState<TailoredApplication[]>([]);
  const [filter, setFilter] = useState<ApplicationStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  useEffect(() => {
    setApps(loadApplications());
  }, []);

  const persist = (updated: TailoredApplication) => {
    saveApplication(updated);
    setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  const dupes = useMemo(() => duplicateIds(applications), [applications]);
  const stats = useMemo(() => responseStats(applications), [applications]);
  const volume = useMemo(() => weeklyVolume(applications, 8), [applications]);
  const scoreTrend = useMemo(
    () => [...applications].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((a) => a.atsScore),
    [applications],
  );

  const filtered = applications
    .filter((app) => {
      if (!showArchived && app.archived) return false;
      if (filter !== "all" && app.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        return app.job.title.toLowerCase().includes(q) || app.job.company.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortKey) {
        case "oldest": return a.createdAt.localeCompare(b.createdAt);
        case "ats": return b.atsScore - a.atsScore;
        case "company": return a.job.company.localeCompare(b.job.company);
        case "status": return statuses.indexOf(a.status) - statuses.indexOf(b.status);
        default: return b.createdAt.localeCompare(a.createdAt);
      }
    });

  const counts = statuses.map((s) => ({ status: s, count: applications.filter((a) => a.status === s && (showArchived || !a.archived)).length }));

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      draft: "badge-gray", applied: "badge-blue", screening: "badge-amber", interview: "badge-blue",
      offer: "badge-green", rejected: "badge-red", accepted: "badge-green", archived: "badge-gray",
    };
    return colors[s] ?? "badge-gray";
  };

  const updateStatus = (id: string, status: ApplicationStatus) => {
    const app = applications.find((a) => a.id === id);
    if (app) persist(withStatusChange(app, status));
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this application? (Archiving keeps it without cluttering the list.)")) {
      deleteApplication(id);
      setApps((prev) => prev.filter((a) => a.id !== id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Item 47: bulk status / archive / delete over the selection. */
  const bulkStatus = (status: ApplicationStatus) => {
    setApps((prev) => {
      const next = prev.map((a) => (selected.has(a.id) ? withStatusChange(a, status) : a));
      next.filter((a) => selected.has(a.id)).forEach(saveApplication);
      return next;
    });
    setSelected(new Set());
  };

  const bulkDelete = () => {
    if (!confirm(`Delete ${selected.size} application(s)? This cannot be undone.`)) return;
    selected.forEach((id) => deleteApplication(id));
    setApps((prev) => prev.filter((a) => !selected.has(a.id)));
    setSelected(new Set());
  };

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(""), 2500);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">📊 Application Tracker</h1>
        <div className="flex gap-2 flex-wrap">
          {/* Items 40, 41, 54: exports */}
          <button onClick={() => { download("workdayz-applications.csv", buildCsv(applications), "text/csv"); flash("CSV downloaded."); }} className="btn btn-secondary btn-sm">⬇ CSV</button>
          <button onClick={() => { download("workdayz-followups.ics", followUpsToIcs(applications), "text/calendar"); flash("Calendar file downloaded — import it into Google/Outlook."); }} className="btn btn-secondary btn-sm">📅 Follow-ups .ics</button>
          <button onClick={async () => { await navigator.clipboard.writeText(trackerSummaryMarkdown(applications)); flash("Summary copied as markdown."); }} className="btn btn-secondary btn-sm">📋 Copy summary</button>
        </div>
      </div>

      {message && <div className="card border-green-500/30 bg-green-950/30 text-green-400 text-sm py-2">{message}</div>}

      {/* Items 36, 50, 51: analytics */}
      {applications.length > 0 && (
        <div className="card">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-sm">
            <div><div className="text-2xl font-bold">{stats.submitted}</div><div className="text-gray-500 text-xs uppercase">Submitted</div></div>
            <div><div className="text-2xl font-bold">{stats.responses}</div><div className="text-gray-500 text-xs uppercase">Responses</div></div>
            <div><div className="text-2xl font-bold">{stats.responseRate === null ? "—" : `${Math.round(stats.responseRate * 100)}%`}</div><div className="text-gray-500 text-xs uppercase">Response rate</div></div>
            <div><div className="text-2xl font-bold">{stats.interviews}</div><div className="text-gray-500 text-xs uppercase">Interviews+</div></div>
          </div>
          <div className="mt-4 grid md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">Applications / week (8 wks)</p>
              <div className="flex items-end gap-1 h-16">
                {volume.map((v, i) => (
                  <div key={i} className="flex-1 bg-blue-700/60 rounded-t" style={{ height: `${Math.max(6, (v / Math.max(...volume, 1)) * 100)}%` }} title={`${v} application(s)`} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">ATS score trend (oldest → newest)</p>
              <div className="flex items-end gap-1 h-16">
                {scoreTrend.slice(-24).map((s, i) => (
                  <div key={i} className={`flex-1 rounded-t ${s >= 80 ? "bg-green-700/70" : s >= 60 ? "bg-amber-700/70" : "bg-red-700/70"}`} style={{ height: `${Math.max(6, s)}%` }} title={`ATS ${s}`} />
                ))}
              </div>
            </div>
          </div>
          {stats.byResume.length > 1 && (
            <div className="mt-4">
              <p className="text-xs text-gray-500 uppercase mb-1">Responses by resume sent (A/B)</p>
              <div className="space-y-1 text-xs">
                {stats.byResume.map((r) => (
                  <p key={r.label} className="text-gray-400">
                    <span className="text-gray-300">{r.label}</span> — {r.responses}/{r.submitted} responded
                    {r.submitted >= 3 ? ` (${Math.round((r.responses / r.submitted) * 100)}%)` : " (small sample)"}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Item 98: your own time-to-response benchmark */}
          {medianResponseDays(applications) !== null && (
            <p className="mt-3 text-xs text-gray-500">
              ⏱ Your median time to first response: <span className="text-gray-300">{medianResponseDays(applications)} day(s)</span> — anything past double that probably deserves a follow-up.
            </p>
          )}

          {/* Item 97: recurring keyword gaps — a "what to learn next" signal */}
          {keywordGaps(applications).length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 uppercase mb-1">Recurring keyword gaps (last {Math.min(applications.length, 20)} applications)</p>
              <div className="flex flex-wrap gap-1.5">
                {keywordGaps(applications).map((g) => (
                  <span key={g.keyword} className="px-2 py-0.5 rounded-full text-xs bg-amber-900/40 text-amber-300 border border-amber-700/40" title={`Missing from ${g.count} of your last ${g.total} applications — a repeated gap worth actually learning or adding truthfully.`}>
                    {g.keyword} ×{g.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Item 99: bullets that correlate with responses */}
          {effectiveBullets(applications).length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 uppercase mb-1">Bullets in applications that got responses</p>
              <ul className="text-xs text-gray-400 space-y-1">
                {effectiveBullets(applications).map((b, i) => (
                  <li key={i}>💪 &ldquo;{b.bullet.slice(0, 110)}{b.bullet.length > 110 ? "…" : ""}&rdquo; <span className="text-gray-500">({b.responded}/{b.sent} responded)</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {counts.map(({ status, count }) => (
          <button
            key={status}
            onClick={() => setFilter(filter === status ? "all" : status)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              filter === status ? "bg-gray-700 border-gray-500 border" : "bg-gray-800 border border-gray-700 hover:border-gray-500"
            }`}
          >
            <span className={`badge ${statusBadge(status)}`}>{status}</span>
            <span className="font-medium">{count}</span>
          </button>
        ))}
        <button onClick={() => setFilter("all")} className={`px-3 py-2 rounded-lg text-sm ${filter === "all" ? "bg-gray-700" : "bg-gray-800 hover:bg-gray-700"} transition-colors`}>
          All
        </button>
        <label className="flex items-center gap-1.5 text-sm text-gray-400 ml-2 cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="w-4 h-4" />
          Show archived
        </label>
        {/* Item 48: sorting */}
        <select aria-label="Sort applications" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm w-auto ml-auto">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="ats">Highest ATS</option>
          <option value="company">Company A-Z</option>
          <option value="status">By status</option>
        </select>
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title or company..." className="max-w-md" />

      {/* Item 47: bulk actions */}
      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-2 py-2 border-blue-500/30 bg-blue-950/30 text-sm">
          <span className="text-blue-300">{selected.size} selected:</span>
          {(["applied", "rejected", "archived"] as ApplicationStatus[]).map((s) => (
            <button key={s} onClick={() => bulkStatus(s)} className="btn btn-secondary btn-sm">Mark {s}</button>
          ))}
          <button onClick={bulkDelete} className="btn btn-secondary btn-sm text-red-400">Delete</button>
          <button onClick={() => setSelected(new Set())} className="btn btn-secondary btn-sm ml-auto">Clear</button>
        </div>
      )}

      {/* Application list */}
      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">📋</div>
          <p className="text-gray-400">Nothing here. <a href="/apply" className="text-blue-400 underline">Tailor your first application.</a></p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((app) => (
            <div key={app.id} className={`card ${app.archived ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected.has(app.id)} onChange={() => toggleSelect(app.id)} className="w-4 h-4 mt-1.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold">{app.job.title}</h3>
                    <span className={`badge ${statusBadge(app.status)}`}>{app.status}</span>
                    <span className={`badge ${app.atsScore >= 80 ? "badge-green" : app.atsScore >= 60 ? "badge-amber" : "badge-red"}`}>ATS {app.atsScore}</span>
                    {dupes.has(app.id) && <span className="badge badge-amber" title="Same company + title tracked within 30 days.">possible duplicate</span>}
                    {isFollowUpOverdue(app) && <span className="badge badge-red">follow-up overdue</span>}
                    {app.archived && <span className="badge badge-gray">archived</span>}
                    <span className="text-xs text-gray-500 ml-auto">{timeInStage(app)}</span>
                  </div>
                  <p className="text-sm text-gray-400">
                    {app.job.company} · {app.job.location}
                    {/* Item 52: posting link */}
                    {app.job.sourceUrl && (
                      <>
                        {" · "}
                        <a href={app.job.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">posting ↗</a>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Created {new Date(app.createdAt).toLocaleDateString()}
                    {app.sentResume ? ` · sent: ${app.sentResume}` : ""}
                  </p>
                </div>
              </div>

              {/* Status controls */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {statuses.filter((s) => s !== "archived").map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(app.id, s)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      app.status === s ? "bg-blue-900/30 border-blue-500 text-blue-300" : "border-gray-700 text-gray-500 hover:border-gray-500"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                {/* Item 46: archive is separate from status/delete */}
                <button
                  onClick={() => persist({ ...app, archived: !app.archived, updatedAt: new Date().toISOString() })}
                  className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-400 hover:border-gray-500 ml-2"
                >
                  {app.archived ? "Unarchive" : "Archive"}
                </button>
                {/* Item 53: reapply pre-fills the apply page from this record */}
                <a href={`/apply?reapply=${app.id}`} className="text-xs px-2 py-1 rounded border border-gray-700 text-blue-400 hover:border-blue-500">
                  Reapply →
                </a>
                {/* Item 81: strip the heavy/private payload but keep the row */}
                <button
                  onClick={() => {
                    if (!confirm("Purge this application's stored details (resume snapshot, cover letter, job description)? The tracker row and status stay.")) return;
                    persist({
                      ...app,
                      profile: { ...app.profile, summary: "", skills: [], experience: [], education: [], projects: [], certifications: [] },
                      coverLetter: "",
                      tailoredBullets: [],
                      variants: [],
                      interviewPrep: undefined,
                      outreachMessages: undefined,
                      job: { ...app.job, description: "(purged)" },
                      notes: app.notes,
                      updatedAt: new Date().toISOString(),
                    });
                  }}
                  className="text-xs px-2 py-1 rounded border border-gray-700 text-amber-500 hover:border-amber-500"
                  title="Remove the stored resume/cover-letter/job text for this application but keep the tracker row."
                >
                  Purge details
                </button>
                <button onClick={() => handleDelete(app.id)} className="text-xs px-2 py-1 rounded border border-gray-700 text-red-500 hover:border-red-500">
                  Delete
                </button>
              </div>

              {/* Items 42/43/45: notes, follow-up date, salary */}
              <div className="grid md:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">Follow-up date</label>
                  <input
                    type="date"
                    value={app.followUpDate ?? ""}
                    onChange={(e) => persist({ ...app, followUpDate: e.target.value || undefined, updatedAt: new Date().toISOString() })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Salary / comp</label>
                  <input
                    value={app.comp ?? ""}
                    placeholder="e.g. $72k posted"
                    onChange={(e) => persist({ ...app, comp: e.target.value || undefined, updatedAt: new Date().toISOString() })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Notes</label>
                  <input
                    value={app.notes ?? ""}
                    placeholder="Recruiter name, next step…"
                    onChange={(e) => persist({ ...app, notes: e.target.value || undefined, updatedAt: new Date().toISOString() })}
                  />
                </div>
              </div>

              {/* Item 44: status history */}
              <details className="mt-3">
                <summary className="text-sm text-blue-400 cursor-pointer hover:underline">Details &amp; history</summary>
                <div className="mt-3 space-y-2 text-sm">
                  {(app.statusHistory?.length ?? 0) > 0 && (
                    <div>
                      <span className="text-gray-400">Status history:</span>
                      <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
                        {app.statusHistory!.map((h, i) => (
                          <li key={i}>{new Date(h.at).toLocaleString()} → {h.status}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-400">Summary:</span>
                    <p className="text-gray-300 mt-1">{app.tailoredSummary}</p>
                  </div>
                  <div>
                    <span className="text-gray-400">Skills:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {app.tailoredSkills.slice(0, 8).map((s) => (
                        <span key={s} className="px-2 py-0.5 bg-gray-700 rounded text-xs">{s}</span>
                      ))}
                      {app.tailoredSkills.length > 8 && <span className="text-xs text-gray-500">+{app.tailoredSkills.length - 8} more</span>}
                    </div>
                  </div>
                  {app.fitAnalysis && (
                    <p className="text-gray-400 text-xs italic">&ldquo;{app.fitAnalysis.verdict}&rdquo;</p>
                  )}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
