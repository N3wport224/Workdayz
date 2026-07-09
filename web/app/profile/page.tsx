"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProfileForm } from "@/components/ProfileForm";
import { emptyProfile, loadProfile, saveProfile } from "@/lib/storage";
import type { ResumeProfile } from "@/lib/types";

export default function ProfilePage() {
  const [profile, setProfile] = useState<ResumeProfile>(emptyProfile);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setProfile(loadProfile());
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-blue-600 dark:text-blue-400">
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold mt-2">Your base resume</h1>
        <p className="text-sm opacity-70 mt-1">
          This is your ground truth. It stays on your device (browser local storage) — it&apos;s
          never uploaded anywhere except to the tailoring API when you generate an application.
          Every tailored resume is built only from what&apos;s here; nothing is invented.
        </p>
      </div>
      <ProfileForm initial={profile} onSave={saveProfile} />
    </main>
  );
}
