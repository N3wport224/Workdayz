"use client";

import { useState } from "react";
import type { ResumeProfile } from "@/lib/types";

export function ResumeImportPanel({ onImported }: { onImported: (profile: ResumeProfile) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/import-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed.");
      onImported(data.profile as ResumeProfile);
      setOpen(false);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-dashed border-blue-500/50 text-blue-600 dark:text-blue-400 px-4 py-2 text-sm font-medium w-full mb-8"
      >
        Have an existing resume? Paste it to fill this out automatically →
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 mb-8 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Import from an existing resume</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs opacity-60 hover:opacity-100">
          Cancel
        </button>
      </div>
      <p className="text-xs opacity-70">
        Paste the plain text of your resume (copy from a PDF/Word doc works fine). Claude will
        structure it into the fields below — nothing is invented, and you can review/edit
        everything afterward. This replaces whatever is currently filled in.
      </p>
      <textarea
        className="w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste your resume text here..."
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleImport}
          disabled={loading || text.trim().length < 50}
          className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Importing..." : "Import"}
        </button>
        {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      </div>
    </div>
  );
}
