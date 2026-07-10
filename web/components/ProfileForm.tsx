"use client";

import { useState } from "react";
import type { ContactInfo, EducationEntry, ResumeProfile, WorkExperience } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "text-xs font-medium opacity-70 mb-1 block";

function newExperience(): WorkExperience {
  return {
    id: crypto.randomUUID(),
    company: "",
    title: "",
    location: "",
    startDate: "",
    endDate: "",
    bullets: [""],
  };
}

function newEducation(): EducationEntry {
  return {
    id: crypto.randomUUID(),
    school: "",
    degree: "",
    fieldOfStudy: "",
    startDate: "",
    endDate: "",
    gpa: "",
  };
}

function parseList(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export function ProfileForm({
  initial,
  onSave,
}: {
  initial: ResumeProfile;
  onSave: (profile: ResumeProfile) => void;
}) {
  const [profile, setProfile] = useState<ResumeProfile>(initial);
  const [saved, setSaved] = useState(false);
  // Comma-separated lists keep raw text state: deriving the input value from
  // the parsed array would eat the trailing comma as you type it.
  const [skillsText, setSkillsText] = useState(initial.skills.join(", "));
  const [certificationsText, setCertificationsText] = useState(initial.certifications.join(", "));

  function updateContact<K extends keyof ContactInfo>(key: K, value: ContactInfo[K]) {
    setProfile((p) => ({ ...p, contact: { ...p.contact, [key]: value } }));
    setSaved(false);
  }

  function updateExperience(id: string, patch: Partial<WorkExperience>) {
    setProfile((p) => ({
      ...p,
      experience: p.experience.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
    setSaved(false);
  }

  function updateBullet(expId: string, index: number, value: string) {
    setProfile((p) => ({
      ...p,
      experience: p.experience.map((e) =>
        e.id === expId
          ? { ...e, bullets: e.bullets.map((b, i) => (i === index ? value : b)) }
          : e,
      ),
    }));
    setSaved(false);
  }

  function updateEducation(id: string, patch: Partial<EducationEntry>) {
    setProfile((p) => ({
      ...p,
      education: p.education.map((ed) => (ed.id === id ? { ...ed, ...patch } : ed)),
    }));
    setSaved(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(profile);
    setSaved(true);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Contact Info</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(
            [
              ["firstName", "First name"],
              ["lastName", "Last name"],
              ["email", "Email"],
              ["phone", "Phone"],
              ["address", "Address"],
              ["city", "City"],
              ["state", "State"],
              ["postalCode", "Postal code"],
              ["country", "Country"],
              ["linkedin", "LinkedIn URL"],
              ["website", "Website / portfolio"],
            ] as [keyof ContactInfo, string][]
          ).map(([key, label]) => (
            <div key={key}>
              <label className={labelClass}>{label}</label>
              <input
                className={inputClass}
                value={profile.contact[key]}
                onChange={(e) => updateContact(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Summary</h2>
        <textarea
          className={inputClass}
          rows={3}
          value={profile.summary}
          onChange={(e) => {
            setProfile((p) => ({ ...p, summary: e.target.value }));
            setSaved(false);
          }}
          placeholder="A few sentences about your professional background."
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Skills</h2>
        <label className={labelClass}>Comma-separated</label>
        <input
          className={inputClass}
          value={skillsText}
          onChange={(e) => {
            setSkillsText(e.target.value);
            setProfile((p) => ({ ...p, skills: parseList(e.target.value) }));
            setSaved(false);
          }}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Experience</h2>
          <button
            type="button"
            className="text-sm text-blue-600 dark:text-blue-400"
            onClick={() => {
              setProfile((p) => ({ ...p, experience: [...p.experience, newExperience()] }));
              setSaved(false);
            }}
          >
            + Add role
          </button>
        </div>
        {profile.experience.map((exp) => (
          <div key={exp.id} className="rounded-lg border border-black/10 dark:border-white/15 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className={inputClass}
                placeholder="Title"
                value={exp.title}
                onChange={(e) => updateExperience(exp.id, { title: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Company"
                value={exp.company}
                onChange={(e) => updateExperience(exp.id, { company: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Location"
                value={exp.location}
                onChange={(e) => updateExperience(exp.id, { location: e.target.value })}
              />
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder="Start (2021-06)"
                  value={exp.startDate}
                  onChange={(e) => updateExperience(exp.id, { startDate: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="End (Present)"
                  value={exp.endDate}
                  onChange={(e) => updateExperience(exp.id, { endDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Bullets (your real accomplishments — the tailoring engine will only rephrase these, never invent new ones)</label>
              {exp.bullets.map((b, i) => (
                <div key={i} className="flex gap-2 mb-1">
                  <input
                    className={inputClass}
                    value={b}
                    onChange={(e) => updateBullet(exp.id, i, e.target.value)}
                  />
                  <button
                    type="button"
                    className="text-xs opacity-60 hover:opacity-100"
                    onClick={() =>
                      updateExperience(exp.id, {
                        bullets: exp.bullets.filter((_, idx) => idx !== i),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-xs text-blue-600 dark:text-blue-400"
                onClick={() => updateExperience(exp.id, { bullets: [...exp.bullets, ""] })}
              >
                + Add bullet
              </button>
            </div>
            <button
              type="button"
              className="text-xs text-rose-600 dark:text-rose-400"
              onClick={() => {
                setProfile((p) => ({
                  ...p,
                  experience: p.experience.filter((e) => e.id !== exp.id),
                }));
                setSaved(false);
              }}
            >
              Remove role
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Education</h2>
          <button
            type="button"
            className="text-sm text-blue-600 dark:text-blue-400"
            onClick={() => {
              setProfile((p) => ({ ...p, education: [...p.education, newEducation()] }));
              setSaved(false);
            }}
          >
            + Add education
          </button>
        </div>
        {profile.education.map((ed) => (
          <div key={ed.id} className="rounded-lg border border-black/10 dark:border-white/15 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              className={inputClass}
              placeholder="School"
              value={ed.school}
              onChange={(e) => updateEducation(ed.id, { school: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Degree"
              value={ed.degree}
              onChange={(e) => updateEducation(ed.id, { degree: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Field of study"
              value={ed.fieldOfStudy}
              onChange={(e) => updateEducation(ed.id, { fieldOfStudy: e.target.value })}
            />
            <div className="flex gap-2">
              <input
                className={inputClass}
                placeholder="Start"
                value={ed.startDate}
                onChange={(e) => updateEducation(ed.id, { startDate: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="End"
                value={ed.endDate}
                onChange={(e) => updateEducation(ed.id, { endDate: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="GPA (optional)"
                value={ed.gpa ?? ""}
                onChange={(e) => updateEducation(ed.id, { gpa: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="text-xs text-rose-600 dark:text-rose-400 sm:col-span-2 text-left"
              onClick={() => {
                setProfile((p) => ({
                  ...p,
                  education: p.education.filter((e) => e.id !== ed.id),
                }));
                setSaved(false);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Certifications</h2>
        <label className={labelClass}>Comma-separated</label>
        <input
          className={inputClass}
          value={certificationsText}
          onChange={(e) => {
            setCertificationsText(e.target.value);
            setProfile((p) => ({ ...p, certifications: parseList(e.target.value) }));
            setSaved(false);
          }}
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-500"
        >
          Save profile
        </button>
        {saved ? <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved</span> : null}
      </div>
    </form>
  );
}
