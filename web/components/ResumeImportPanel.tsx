"use client";

import { useRef, useState } from "react";
import type { ResumeProfile } from "@/lib/types";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function ResumeImportPanel({ onImported }: { onImported: (profile: ResumeProfile) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<{ base64: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Item 13: drag-and-drop anywhere on the panel (or the collapsed button).
  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      setOpen(true);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
  };

  async function handleFile(file: File) {
    setError(null);
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      if (file.size > 10 * 1024 * 1024) {
        setError("That PDF is too large (max 10 MB).");
        return;
      }
      const buffer = await file.arrayBuffer();
      setPdf({ base64: arrayBufferToBase64(buffer), name: file.name });
    } else {
      // Treat anything else as plain text (.txt, .md, exported text).
      const content = await file.text();
      setText(content);
      setPdf(null);
    }
  }

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      const body = pdf ? { resumePdfBase64: pdf.base64 } : { resumeText: text };
      const res = await fetch("/api/import-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed.");
      onImported(data.profile as ResumeProfile);
      setOpen(false);
      setText("");
      setPdf(null);
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
        {...dragProps}
        className={`rounded-md border border-dashed px-4 py-2 text-sm font-medium w-full mb-8 ${
          dragging ? "border-blue-400 bg-blue-500/15 text-blue-300" : "border-blue-500/50 text-blue-400"
        }`}
      >
        {dragging
          ? "Drop your resume PDF here…"
          : "Have an existing resume? Upload / drag-and-drop the PDF, or paste it to fill this out automatically →"}
      </button>
    );
  }

  const canImport = pdf !== null || text.trim().length >= 50;
  const isLinkedinUrl = /linkedin\.com\/(in|pub)\//i.test(linkedinUrl);

  return (
    <div
      {...dragProps}
      className={`rounded-lg border p-4 mb-8 space-y-3 ${
        dragging ? "border-blue-400 bg-blue-500/15" : "border-blue-500/30 bg-blue-500/5"
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Import from an existing resume</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs opacity-60 hover:opacity-100">
          Cancel
        </button>
      </div>
      <p className="text-xs opacity-70">
        Upload your resume PDF, or paste its plain text. Claude will structure it into the fields
        below — nothing is invented, and you can review/edit everything afterward. This replaces
        whatever is currently filled in. No resume file handy? LinkedIn&apos;s{" "}
        <span className="font-medium">More → Save to PDF</span> export works here too.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 text-sm font-medium"
        >
          Choose file (.pdf, .txt)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        {pdf ? (
          <span className="text-xs bg-blue-500/15 text-blue-700 dark:text-blue-300 rounded px-2 py-1">
            {pdf.name}{" "}
            <button type="button" className="ml-1 opacity-60 hover:opacity-100" onClick={() => setPdf(null)}>
              ✕
            </button>
          </span>
        ) : (
          <span className="text-xs opacity-60">or paste below</span>
        )}
      </div>

      {!pdf ? (
        <textarea
          className="w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your resume text here..."
        />
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleImport}
          disabled={loading || !canImport}
          className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Importing..." : pdf ? `Import ${pdf.name}` : "Import pasted text"}
        </button>
        {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      </div>

      {/* Item 17: LinkedIn guided flow. LinkedIn blocks automated fetching,
          so this is an honest assistant: detect the URL, walk the user
          through LinkedIn's own PDF export, then import that PDF here. */}
      <div className="pt-3 border-t border-blue-500/20">
        <label className="text-xs opacity-70 block mb-1">Importing from LinkedIn instead?</label>
        <div className="flex items-center gap-2">
          <input
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/your-profile"
            className="flex-1 rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-1.5 text-sm"
          />
          {isLinkedinUrl && (
            <a
              href={linkedinUrl.startsWith("http") ? linkedinUrl : `https://${linkedinUrl}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 text-sm font-medium shrink-0"
            >
              Open profile ↗
            </a>
          )}
        </div>
        {isLinkedinUrl && (
          <ol className="mt-2 text-xs opacity-70 list-decimal list-inside space-y-0.5">
            <li>On your LinkedIn profile, click <span className="font-medium">More → Save to PDF</span>.</li>
            <li>LinkedIn blocks automated access, so that export is the reliable route.</li>
            <li>Drag the downloaded PDF into this panel — everything imports from there.</li>
          </ol>
        )}
      </div>
    </div>
  );
}
