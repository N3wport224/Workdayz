"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isFollowUpOverdue, loadApplications } from "@/lib/applications";
import type { SavedApplication } from "@/lib/types";

/** Home-page nudge listing applications whose follow-up date has passed. */
export function FollowUpNudge() {
  const [overdue, setOverdue] = useState<SavedApplication[]>([]);

  useEffect(() => {
    setOverdue(loadApplications().filter((a) => !a.archived && isFollowUpOverdue(a)));
  }, []);

  if (overdue.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 mb-10 text-sm">
      <p className="font-medium mb-1.5">
        ⏰ {overdue.length} follow-up{overdue.length === 1 ? "" : "s"} overdue
      </p>
      <ul className="space-y-1 opacity-80">
        {overdue.slice(0, 3).map((app) => (
          <li key={app.id}>
            {app.job.title} at {app.job.company} — due {app.followUpAt}
          </li>
        ))}
      </ul>
      <Link href="/applications" className="text-blue-600 dark:text-blue-400 text-xs mt-2 inline-block">
        Open the tracker →
      </Link>
    </div>
  );
}
