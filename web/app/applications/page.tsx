"use client";

import { useEffect, useState } from "react";
import { loadApplications, deleteApplication } from "@/lib/storage";
import type { TailoredApplication, ApplicationStatus } from "@/lib/types";

const statuses: ApplicationStatus[] = ["draft", "applied", "screening", "interview", "offer", "rejected", "accepted", "archived"];

export default function ApplicationsPage() {
  const [applications, setApps] = useState<TailoredApplication[]>([]);
  const [filter, setFilter] = useState<ApplicationStatus | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setApps(loadApplications());
  }, []);

  const filtered = applications.filter((app) => {
    if (filter !== "all" && app.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return app.job.title.toLowerCase().includes(q) || app.job.company.toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const stats = statuses.map((s) => ({
    status: s,
    count: applications.filter((a) => a.status === s).length,
  }));

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      draft: "badge-gray", applied: "badge-blue", screening: "badge-amber", interview: "badge-blue",
      offer: "badge-green", rejected: "badge-red", accepted: "badge-green", archived: "badge-gray",
    };
    return colors[s] ?? "badge-gray";
  };

  const updateStatus = (id: string, status: ApplicationStatus) => {
    setApps((prev) => {
      const updated = prev.map((a) => a.id === id ? { ...a, status } : a);
      localStorage.setItem("workdayz-applications", JSON.stringify(updated));
      return updated;
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this application?")) {
      deleteApplication(id);
      setApps((prev) => prev.filter((a) => a.id !== id));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📊 Application Tracker</h1>
        <span className="text-gray-400 text-sm">{applications.length} total</span>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-2">
        {stats.map(({ status, count }) => (
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
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-2 rounded-lg text-sm ${filter === "all" ? "bg-gray-700" : "bg-gray-800 hover:bg-gray-700"} transition-colors`}
        >
          All ({applications.length})
        </button>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by title or company..."
        className="max-w-md"
      />

      {/* Application list */}
      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">📋</div>
          <p className="text-gray-400">No applications yet. <a href="/apply" className="text-blue-400 underline">Tailor your first one.</a></p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((app) => (
            <div key={app.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">{app.job.title}</h3>
                    <span className={`badge ${statusBadge(app.status)}`}>{app.status}</span>
                    <span className={`badge ${app.atsScore >= 80 ? "badge-green" : app.atsScore >= 60 ? "badge-amber" : "badge-red"}`}>
                      ATS {app.atsScore}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400">{app.job.company} · {app.job.location}</p>
                  <p className="text-xs text-gray-500 mt-1">Created {new Date(app.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              {/* Status controls */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {statuses.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(app.id, s)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      app.status === s
                        ? "bg-blue-900/30 border-blue-500 text-blue-300"
                        : "border-gray-700 text-gray-500 hover:border-gray-500"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <button onClick={() => handleDelete(app.id)} className="text-xs px-2 py-1 rounded border border-gray-700 text-red-500 hover:border-red-500 ml-2">
                  Delete
                </button>
              </div>

              {/* Summary preview */}
              <details className="mt-3">
                <summary className="text-sm text-blue-400 cursor-pointer hover:underline">View details</summary>
                <div className="mt-3 space-y-2 text-sm">
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
                  {app.coverLetter && (
                    <div>
                      <span className="text-gray-400">Cover letter preview:</span>
                      <p className="text-gray-300 mt-1 text-xs line-clamp-3">{app.coverLetter.slice(0, 200)}</p>
                    </div>
                  )}
                  {app.fitAnalysis && (
                    <div>
                      <span className="text-gray-400">Fit:</span>
                      <p className="text-gray-400 text-xs italic">"{app.fitAnalysis.verdict}"</p>
                    </div>
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