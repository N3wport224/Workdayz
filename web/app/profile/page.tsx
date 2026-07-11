"use client";

import { useEffect, useRef, useState } from "react";
import { ProfileForm } from "@/components/ProfileForm";
import { ResumeImportPanel } from "@/components/ResumeImportPanel";
import { sendProfileToExtension } from "@/lib/extension-bridge";
import { computeCompleteness } from "@/lib/profile-completeness";
import {
  createProfile,
  deleteProfile,
  emptyProfile,
  listProfiles,
  loadProfile,
  mergeProfile,
  renameProfile,
  saveProfile,
  switchProfile,
  wipeAllData,
} from "@/lib/storage";
import type { ResumeProfile } from "@/lib/types";

export default function ProfilePage() {
  const [profile, setProfile] = useState<ResumeProfile>(emptyProfile);
  const [loaded, setLoaded] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProfile(loadProfile());
    setProfiles(listProfiles());
    setLoaded(true);
  }, []);

  function reloadActive() {
    setProfile(loadProfile());
    setProfiles(listProfiles());
    setFormKey((k) => k + 1);
    sendProfileToExtension(loadProfile());
  }

  function persistProfile(next: ResumeProfile) {
    setProfile(next); // keeps the completeness meter live without remounting the form
    saveProfile(next);
    sendProfileToExtension(next);
  }

  function replaceProfile(next: ResumeProfile) {
    setProfile(next);
    persistProfile(next);
    setFormKey((k) => k + 1); // remount ProfileForm so it picks up the new initial values
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(loadProfile(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workdayz-profile.json";
    a.click();
    URL.revokeObjectURL(url);
    setBackupStatus("Profile exported.");
  }

  async function importBackup(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || !parsed.contact) {
        throw new Error("That file doesn't look like a Workdayz profile backup.");
      }
      replaceProfile(mergeProfile(parsed));
      setBackupStatus("Profile restored from backup.");
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : "Couldn't read that backup file.");
    }
  }

  if (!loaded) return null;

  const completeness = computeCompleteness(profile);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6">
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold">Your base resume</h1>
          <div className="flex items-center gap-2 text-sm">
            <select
              className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
              value={profiles.find((p) => p.active)?.id ?? ""}
              onChange={(e) => {
                switchProfile(e.target.value);
                reloadActive();
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-xs text-blue-600 dark:text-blue-400"
              onClick={() => {
                const name = window.prompt("Name for the new profile (e.g. \"PM resume\"):");
                if (!name) return;
                const copy = window.confirm("Start from a copy of the current profile? (Cancel = start blank)");
                createProfile(name, copy);
                reloadActive();
              }}
            >
              + New
            </button>
            <button
              type="button"
              className="text-xs opacity-60 hover:opacity-100"
              onClick={() => {
                const active = profiles.find((p) => p.active);
                if (!active) return;
                const name = window.prompt("Rename profile:", active.name);
                if (name) {
                  renameProfile(active.id, name);
                  setProfiles(listProfiles());
                }
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="text-xs text-rose-600 dark:text-rose-400"
              onClick={() => {
                const active = profiles.find((p) => p.active);
                if (!active) return;
                if (!window.confirm(`Delete the "${active.name}" profile? This can't be undone.`)) return;
                if (!deleteProfile(active.id)) {
                  window.alert("You can't delete your only profile.");
                  return;
                }
                reloadActive();
              }}
            >
              Delete
            </button>
          </div>
        </div>
        <p className="text-sm opacity-70 mt-1">
          This is your ground truth. It stays on your device (browser local storage) — it&apos;s
          never uploaded anywhere except to the tailoring API when you generate an application.
          Every tailored resume is built only from what&apos;s here; nothing is invented.
        </p>
        <div className="flex items-center gap-3 mt-3 text-xs">
          <button type="button" onClick={exportBackup} className="text-blue-600 dark:text-blue-400">
            Export backup (JSON)
          </button>
          <button
            type="button"
            onClick={() => backupInputRef.current?.click()}
            className="text-blue-600 dark:text-blue-400"
          >
            Restore from backup
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importBackup(file);
              e.target.value = "";
            }}
          />
          {backupStatus ? <span className="opacity-70">{backupStatus}</span> : null}
        </div>
      </div>
      <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 mb-6">
        <div className="flex items-baseline justify-between mb-2">
          <p className="font-medium text-sm">Profile completeness</p>
          <span className="text-lg font-bold">{completeness.score}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden mb-2">
          <div
            className={`h-full ${completeness.score >= 80 ? "bg-emerald-500" : completeness.score >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
            style={{ width: `${completeness.score}%` }}
          />
        </div>
        {completeness.suggestions.length ? (
          <ul className="text-xs opacity-70 list-disc list-inside space-y-0.5">
            {completeness.suggestions.slice(0, 4).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs opacity-70">Everything the autofill and tailoring engines need is here.</p>
        )}
        <p className="text-xs opacity-40 mt-1">Updates when you save.</p>
      </div>
      <ResumeImportPanel onImported={replaceProfile} />
      <ProfileForm key={formKey} initial={profile} onSave={persistProfile} />

      <div className="mt-12 pt-6 border-t border-black/10 dark:border-white/15">
        <button
          type="button"
          className="text-xs text-rose-600 dark:text-rose-400"
          onClick={() => {
            if (
              !window.confirm(
                "Delete ALL Workdayz data in this browser — every profile, tracked application, and draft? This cannot be undone.\n\nAlso click \"Clear stored application data\" in the extension popup to wipe its copy.",
              )
            )
              return;
            wipeAllData();
            window.location.reload();
          }}
        >
          Delete all my data from this browser
        </button>
      </div>
    </main>
  );
}
