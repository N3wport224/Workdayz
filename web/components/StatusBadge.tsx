import type { ApplicationStatus } from "@/lib/types";

const STYLES: Record<ApplicationStatus, string> = {
  draft: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  applied: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  interviewing: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  rejected: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  offer: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const LABELS: Record<ApplicationStatus, string> = {
  draft: "Draft",
  applied: "Applied",
  interviewing: "Interviewing",
  rejected: "Rejected",
  offer: "Offer",
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
