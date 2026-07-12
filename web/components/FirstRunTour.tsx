"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { demoProfile } from "@/lib/demo-data";
import { sendProfileToExtension } from "@/lib/extension-bridge";
import { hasProfile, loadProfile, saveProfile } from "@/lib/storage";

const DISMISSED_KEY = "workdayz.tourDismissed";

/** Three-step guided start for brand-new users. Disappears once a profile
 * exists or the user dismisses it. */
export function FirstRunTour() {
  const [show, setShow] = useState(false);
  const [demoLoaded, setDemoLoaded] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISSED_KEY)) return;
      if (hasProfile(loadProfile())) return;
      setShow(true);
    } catch {
      /* storage blocked */
    }
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* storage blocked */
    }
    setShow(false);
  }

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-5 mb-10">
      <div className="flex items-start justify-between gap-4 mb-3">
        <p className="font-semibold">New here? Three steps to your first tailored application</p>
        <button onClick={dismiss} className="text-xs opacity-50 hover:opacity-100 shrink-0">
          Dismiss ✕
        </button>
      </div>
      <ol className="space-y-2.5 text-sm">
        <li className="flex gap-2">
          <span className="font-bold text-blue-600 dark:text-blue-400">1.</span>
          <span>
            <Link href="/profile" className="text-blue-600 dark:text-blue-400 font-medium">
              Import your resume
            </Link>{" "}
            (PDF, pasted text, or a LinkedIn &ldquo;Save to PDF&rdquo; export) — or{" "}
            <button
              type="button"
              className="text-blue-600 dark:text-blue-400 underline"
              onClick={() => {
                saveProfile(demoProfile);
                sendProfileToExtension(demoProfile);
                setDemoLoaded(true);
              }}
            >
              {demoLoaded ? "demo loaded ✓" : "load the demo profile"}
            </button>{" "}
            to explore first.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-bold text-blue-600 dark:text-blue-400">2.</span>
          <span>
            <Link href="/apply" className="text-blue-600 dark:text-blue-400 font-medium">
              Tailor an application
            </Link>{" "}
            — paste any job posting (or just its URL) and review the resume, cover letter, ATS
            score, and honest fit analysis.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-bold text-blue-600 dark:text-blue-400">3.</span>
          <span>
            Load <code className="text-xs">extension/dist</code> as an unpacked extension, click
            its toolbar icon → Connect, and it autofills public Workday application forms for you
            — always stopping before Submit.
          </span>
        </li>
      </ol>
    </div>
  );
}
