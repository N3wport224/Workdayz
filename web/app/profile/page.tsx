"use client";

import { useEffect, useRef, useState } from "react";
import { ProfileForm } from "@/components/ProfileForm";
import { ResumeImportPanel } from "@/components/ResumeImportPanel";
import { emptyProfile, loadProfile, saveProfile } from "@/lib/storage";
import type { ResumeProfile } from "@/lib/types";

export default function ProfilePage() {
  const [profile, setProfile] = useState<ResumeProfile>(emptyProfile);
  const [loaded, setLoaded] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProfile(loadProfile());
    setLoaded(true);
  }, []);

  function replaceProfile(next: ResumeProfile) {
    setProfile(next);
    saveProfile(next);
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
      replaceProfile({ ...emptyProfile, ...parsed });
      setBackupStatus("Profile restored from backup.");
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : "Couldn't read that backup file.");
    }
  }

  if (!loaded) return null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mt-2">Your base resume</h1>
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
      <ResumeImportPanel onImported={replaceProfile} />
      <ProfileForm key={formKey} initial={profile} onSave={saveProfile} />
    </main>
  );
}
