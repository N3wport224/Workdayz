"use client";

import { useEffect, useState } from "react";
import { loadProfile, loadApplications } from "@/lib/storage";
import type { ResumeProfile, TailoredApplication } from "@/lib/types";
import { getBridgeStatus, onBridgeStatusChange } from "@/lib/extension-bridge";
import type { BridgeStatus } from "@/lib/extension-bridge";

export default function HomePage() {
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [applications, setApps] = useState<TailoredApplication[]>([]);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("checking");
  const [showTour, setShowTour] = useState(false);
  // Item 92: live setup checklist inputs
  const [hasServerKey, setHasServerKey] = useState<boolean | null>(null);

  useEffect(() => {
    setProfile(loadProfile());
    const apps = loadApplications();
    setApps(apps);
    setShowTour(!localStorage.getItem("workdayz-tour-done"));
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHasServerKey(Boolean(d.apiKeyConfigured)))
      .catch(() => setHasServerKey(null));

    // Listen for extension bridge status
    setBridgeStatus(getBridgeStatus());
    const unsub = onBridgeStatusChange(setBridgeStatus);
    return unsub;
  }, []);

  const dismissTour = () => {
    localStorage.setItem("workdayz-tour-done", "true");
    setShowTour(false);
  };

  const stats = {
    total: applications.length,
    applied: applications.filter((a) => a.status === "applied" || a.status === "screening" || a.status === "interview").length,
    offers: applications.filter((a) => a.status === "offer" || a.status === "accepted").length,
    avgAts: applications.length > 0
      ? Math.round(applications.reduce((s, a) => s + a.atsScore, 0) / applications.length)
      : 0,
  };

  const statusColor = (s: string) => {
    const colors: Record<string, string> = {
      draft: "gray", applied: "blue", screening: "amber", interview: "blue",
      offer: "green", rejected: "red", accepted: "green", archived: "gray",
    };
    return colors[s] ?? "gray";
  };

  return (
    <div className="space-y-8">
      {/* First-run tour */}
      {showTour && (
        <div className="card border-blue-500/30 bg-blue-950/30 relative">
          <button onClick={dismissTour} className="absolute top-3 right-3 text-gray-500 hover:text-gray-300">✕</button>
          <h2 className="text-lg font-bold text-blue-400 mb-3">👋 Welcome to Workdayz</h2>
          <div className="space-y-3 text-sm text-gray-300">
            <p><strong>1. Set up your profile</strong> — Go to <a href="/profile" className="text-blue-400 underline">Profile</a> and paste your existing resume to auto-import. Or try the demo profile.</p>
            <p><strong>2. Connect the extension</strong> — Install the browser extension and connect it from the popup. You&apos;ll see <span className="text-green-400">● Extension detected</span> below.</p>
            <p><strong>3. Apply for a job</strong> — Paste a job posting URL or the description on the <a href="/apply" className="text-blue-400 underline">Apply</a> page. Claude tailors your resume and scores it for ATS match.</p>
            <p><strong>4. Autofill Workday</strong> — The tailored package syncs to the extension. Navigate to the Workday application form and click &ldquo;Autofill this step&rdquo;.</p>
          </div>
          <button onClick={dismissTour} className="btn btn-primary mt-4">Got it — let&apos;s go!</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">⚡ Workdayz</h1>
          <p className="text-gray-400 text-sm mt-1">Tailored job applications, powered by AI</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-sm ${bridgeStatus === "detected" ? "text-green-400" : bridgeStatus === "checking" ? "text-yellow-400" : "text-gray-500"}`}>
            <span className={`status-dot ${bridgeStatus === "detected" ? "green" : bridgeStatus === "checking" ? "amber" : "red"}`} />
            {bridgeStatus === "detected" ? "Extension detected" : bridgeStatus === "checking" ? "Checking..." : "Extension not found"}
          </div>
        </div>
      </div>

      {/* Item 92: live setup checklist — every row is a real check, not decoration */}
      <div className="card">
        <h2 className="font-semibold mb-3">Setup checklist</h2>
        <div className="space-y-1.5 text-sm">
          {[
            {
              ok: Boolean(profile?.contact.firstName && profile?.contact.email),
              label: "Resume profile saved",
              fix: <a href="/profile" className="text-blue-400 underline">import your resume</a>,
            },
            {
              ok: hasServerKey === true,
              label: "Anthropic API key configured",
              fix: <a href="/settings" className="text-blue-400 underline">add it in Settings or .env.local</a>,
            },
            {
              ok: bridgeStatus === "detected",
              label: "Browser extension connected",
              fix: <span>load <code className="text-blue-400">extension/dist</code> and connect from its popup</span>,
            },
            {
              ok: applications.length > 0,
              label: "First application tailored",
              fix: <a href="/apply" className="text-blue-400 underline">tailor one on the Apply page</a>,
            },
          ].map((item, i) => (
            <p key={i} className={item.ok ? "text-green-400" : "text-gray-400"}>
              {item.ok ? "✅" : "⬜"} {item.label}
              {!item.ok && <span className="text-gray-500"> — {item.fix}</span>}
            </p>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card text-center">
          <div className="text-3xl font-bold text-blue-400">{stats.total}</div>
          <div className="text-sm text-gray-400 mt-1">Applications</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-green-400">{stats.applied}</div>
          <div className="text-sm text-gray-400 mt-1">In Progress</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-amber-400">{stats.offers}</div>
          <div className="text-sm text-gray-400 mt-1">Offers</div>
        </div>
        <div className="card text-center">
          <div className={`text-3xl font-bold ${stats.avgAts >= 80 ? "text-green-400" : stats.avgAts >= 60 ? "text-amber-400" : "text-red-400"}`}>{stats.avgAts}</div>
          <div className="text-sm text-gray-400 mt-1">Avg ATS Score</div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-4">
        <a href="/apply" className="card border-blue-500/30 hover:border-blue-500/60 transition-colors group">
          <div className="text-2xl mb-2">🎯</div>
          <h3 className="font-semibold group-hover:text-blue-400 transition-colors">Tailor a new application</h3>
          <p className="text-sm text-gray-400 mt-1">Paste a job URL or description to generate a tailored resume and cover letter.</p>
        </a>
        <a href="/profile" className="card border-green-500/30 hover:border-green-500/60 transition-colors group">
          <div className="text-2xl mb-2">👤</div>
          <h3 className="font-semibold group-hover:text-green-400 transition-colors">
            {profile ? "Edit your profile" : "Create your profile"}
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            {profile
              ? `${profile.contact.firstName} ${profile.contact.lastName} · ${profile.experience.length} role(s)`
              : "Import your resume to get started."}
          </p>
        </a>
      </div>

      {/* Recent applications */}
      {applications.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Recent Applications</h2>
            <a href="/applications" className="text-sm text-blue-400 hover:underline">View all →</a>
          </div>
          <div className="space-y-3">
            {applications.slice(0, 5).map((app) => (
              <a key={app.id} href={`/applications#${app.id}`} className="card block hover:border-gray-600 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{app.job.title}</div>
                    <div className="text-sm text-gray-400">{app.job.company} · {app.job.location}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`badge badge-${statusColor(app.status)}`}>{app.status}</span>
                    <span className={`badge ${app.atsScore >= 80 ? "badge-green" : app.atsScore >= 60 ? "badge-amber" : "badge-red"}`}>
                      ATS {app.atsScore}
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* No data state */}
      {!profile && applications.length === 0 && !showTour && (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">⚡</div>
          <h2 className="text-xl font-bold mb-2">Ready to get started?</h2>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            Import your resume, connect the browser extension, and start tailoring applications with AI.
          </p>
          <a href="/profile" className="btn btn-primary">Set up your profile</a>
        </div>
      )}

      {/* Item 94: how autofill actually works — linked from the extension widget */}
      <details id="how-autofill-works" className="card text-sm text-gray-400">
        <summary className="font-semibold text-gray-200 cursor-pointer">ℹ️ How the autofill actually works</summary>
        <ul className="mt-3 space-y-2 list-disc list-inside">
          <li><span className="text-gray-300">It fills from your structured profile, not from the PDF.</span> The extension reads the contact/experience/education/certification data you saved here — the generated PDF is what gets uploaded as your resume file, but the form fields come from the data.</li>
          <li><span className="text-gray-300">Field matching is by label.</span> Each Workday tenant names fields differently (&ldquo;From&rdquo; vs &ldquo;Start Date&rdquo;); the extension matches on a library of label synonyms, grows &ldquo;Add&rdquo; sections to fit all your entries, and handles Workday&apos;s special date and dropdown widgets.</li>
          <li><span className="text-gray-300">Dates matter.</span> Everything is normalized to MM/YYYY because that&apos;s what Workday&apos;s widgets parse reliably.</li>
          <li><span className="text-gray-300">Nothing is ever submitted for you.</span> The extension fills and stops — you review every page and click Workday&apos;s own buttons. Self-identification questions are never touched.</li>
          <li><span className="text-gray-300">If a field doesn&apos;t fill</span>, use the widget&apos;s preview table, custom rules (label = value), or the &ldquo;Correct one field&rdquo; tool — and the field report helps get new labels supported.</li>
        </ul>
      </details>
    </div>
  );
}