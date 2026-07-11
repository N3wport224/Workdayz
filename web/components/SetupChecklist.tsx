"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { demoProfile } from "@/lib/demo-data";
import { onExtensionDetected, sendProfileToExtension } from "@/lib/extension-bridge";
import { hasProfile, loadProfile, saveProfile } from "@/lib/storage";

type CheckState = "pending" | "ok" | "missing";

function Row({ state, label, hint }: { state: CheckState; label: string; hint: React.ReactNode }) {
  const icon = state === "ok" ? "✓" : state === "missing" ? "✗" : "…";
  const color =
    state === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "missing"
        ? "text-rose-600 dark:text-rose-400"
        : "opacity-50";
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`font-bold ${color} w-4 shrink-0`}>{icon}</span>
      <span>
        <span className="font-medium">{label}</span>
        {state === "missing" ? <span className="opacity-70"> — {hint}</span> : null}
      </span>
    </li>
  );
}

export function SetupChecklist() {
  const [apiKey, setApiKey] = useState<CheckState>("pending");
  const [profile, setProfile] = useState<CheckState>("pending");
  const [extension, setExtension] = useState<CheckState>("pending");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setApiKey(d.apiKeyConfigured ? "ok" : "missing"))
      .catch(() => setApiKey("missing"));

    setProfile(hasProfile(loadProfile()) ? "ok" : "missing");

    // The extension announces itself asynchronously; give it a moment before
    // declaring it missing.
    const off = onExtensionDetected((present) => setExtension(present ? "ok" : "missing"));
    const timer = window.setTimeout(() => {
      setExtension((prev) => (prev === "pending" ? "missing" : prev));
    }, 1500);
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  const allGood = apiKey === "ok" && profile === "ok" && extension === "ok";

  return (
    <div
      className={`rounded-lg border p-4 mb-10 ${
        allGood
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-black/10 dark:border-white/15"
      }`}
    >
      <p className="font-medium mb-2 text-sm">{allGood ? "Setup complete — you're ready to apply." : "Setup checklist"}</p>
      <ul className="space-y-1.5">
        <Row
          state={apiKey}
          label="Anthropic API key"
          hint={
            <>
              add <code>ANTHROPIC_API_KEY</code> to <code>web/.env.local</code> and restart{" "}
              <code>npm run dev</code>
            </>
          }
        />
        <Row
          state={profile}
          label="Resume profile saved"
          hint={
            <>
              upload your resume on the{" "}
              <Link href="/profile" className="text-blue-600 dark:text-blue-400">Resume page</Link>, or{" "}
              <button
                type="button"
                className="text-blue-600 dark:text-blue-400 underline"
                onClick={() => {
                  saveProfile(demoProfile);
                  sendProfileToExtension(demoProfile);
                  setProfile("ok");
                }}
              >
                load a demo profile
              </button>{" "}
              to try the tool first
            </>
          }
        />
        <Row
          state={extension}
          label="Browser extension connected"
          hint={
            <>
              load <code>extension/dist</code> unpacked, click the toolbar icon → Connect, then
              reload this page
            </>
          }
        />
      </ul>
    </div>
  );
}
