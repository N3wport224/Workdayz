"use client";

import { useEffect, useState } from "react";
import { loadProfile, saveProfile, createDemoProfile } from "@/lib/storage";
import { sendProfile } from "@/lib/extension-bridge";
import { getBridgeStatus } from "@/lib/extension-bridge";
import { ResumeImportPanel } from "@/components/ResumeImportPanel";
import type { ResumeProfile } from "@/lib/types";

const emptyProfile: ResumeProfile = {
  contact: { firstName: "", lastName: "", email: "", phone: "", address: "", city: "", state: "", postalCode: "", country: "US", linkedin: "", website: "" },
  summary: "",
  skills: [],
  experience: [],
  education: [],
  projects: [],
  certifications: [],
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<ResumeProfile>(emptyProfile);
  const [saved, setSaved] = useState(false);
  const [skillInput, setSkillInput] = useState("");
  const [importNotice, setImportNotice] = useState("");

  useEffect(() => {
    const p = loadProfile();
    if (p) setProfile(p);
  }, []);

  const updateContact = (field: string, value: string) => {
    setProfile((p) => ({ ...p, contact: { ...p.contact, [field]: value } }));
  };

  const addSkill = () => {
    const s = skillInput.trim();
    if (s && !profile.skills.includes(s)) {
      setProfile((p) => ({ ...p, skills: [...p.skills, s] }));
    }
    setSkillInput("");
  };

  const removeSkill = (skill: string) => {
    setProfile((p) => ({ ...p, skills: p.skills.filter((s) => s !== skill) }));
  };

  const addExperience = () => {
    setProfile((p) => ({
      ...p,
      experience: [...p.experience, { id: `exp-${Date.now()}`, company: "", title: "", location: "", startDate: "", endDate: "", bullets: [""] }],
    }));
  };

  const updateExperience = (idx: number, field: string, value: string) => {
    setProfile((p) => {
      const exp = [...p.experience];
      (exp[idx] as unknown as Record<string, unknown>)[field] = value;
      return { ...p, experience: exp };
    });
  };

  const addBullet = (expIdx: number) => {
    setProfile((p) => {
      const exp = [...p.experience];
      exp[expIdx] = { ...exp[expIdx], bullets: [...exp[expIdx].bullets, ""] };
      return { ...p, experience: exp };
    });
  };

  const updateBullet = (expIdx: number, bIdx: number, value: string) => {
    setProfile((p) => {
      const exp = [...p.experience];
      const bullets = [...exp[expIdx].bullets];
      bullets[bIdx] = value;
      exp[expIdx] = { ...exp[expIdx], bullets };
      return { ...p, experience: exp };
    });
  };

  const removeExperience = (idx: number) => {
    setProfile((p) => ({ ...p, experience: p.experience.filter((_, i) => i !== idx) }));
  };

  const save = () => {
    saveProfile(profile);
    // Sync to extension
    if (getBridgeStatus() === "detected") {
      sendProfile({
        contact: profile.contact,
        summary: profile.summary,
        skills: profile.skills,
        experience: profile.experience,
        education: profile.education,
        certifications: profile.certifications.map((c) => c.name),
        certificationDetails: profile.certifications,
      });
    }
    setSaved(true);
    setImportNotice("");
    setTimeout(() => setSaved(false), 2000);
  };

  const loadDemo = () => {
    setProfile(createDemoProfile());
  };

  /** Claude parsed the uploaded/pasted resume into a full profile — load it
   * into the form for review. Nothing is saved (or synced to the extension)
   * until the user clicks Save, so they always review first. */
  const handleImported = (imported: ResumeProfile) => {
    setProfile(imported);
    setImportNotice(
      `Imported ${imported.experience.length} role(s), ${imported.education.length} education, ${imported.certifications.length} certification(s), ${imported.skills.length} skill(s). Review below, fix anything that's off, then click "Save profile" — saving also syncs it to the extension.`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">👤 Resume Profile</h1>
        <div className="flex gap-2">
          <button onClick={loadDemo} className="btn btn-secondary">Load demo</button>
          <button onClick={save} className="btn btn-primary">{saved ? "✓ Saved!" : "Save profile"}</button>
        </div>
      </div>

      {/* The whole journey at a glance */}
      <div className="card bg-gray-900/60 text-sm text-gray-400">
        <span className="text-gray-200 font-medium">How it works:</span>{" "}
        1. Import your resume below → 2. Review &amp; <span className="text-gray-200">Save</span> (this syncs your base resume to the extension) →
        3. Tailor it per job on the <a href="/apply" className="text-blue-400 underline">Apply page</a> →
        4. Pick which resume to autofill with — the tailored one by default — from the dropdown on the Apply page or in the extension popup.
      </div>

      {/* Step 1: import an existing resume (PDF or pasted text → Claude
          structures it). This is the profile that feeds every autofill. */}
      <div className="card">
        <h2 className="font-semibold mb-1">Step 1 · Import your resume</h2>
        <p className="text-sm text-gray-400 mb-3">
          Upload your resume PDF (or paste its text) and Claude fills in every section below —
          contact, experience with dates, education, certifications, and skills. Then review,
          save, and this becomes the base resume the extension autofills from.
        </p>
        <ResumeImportPanel onImported={handleImported} />
        {importNotice && (
          <div className="p-3 bg-green-950/30 border border-green-500/30 rounded-lg text-sm text-green-400">
            ✅ {importNotice}
          </div>
        )}
      </div>

      {/* Contact info */}
      <div className="card">
        <h2 className="font-semibold mb-4">Contact Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label>First Name</label>
            <input value={profile.contact.firstName} onChange={(e) => updateContact("firstName", e.target.value)} />
          </div>
          <div>
            <label>Last Name</label>
            <input value={profile.contact.lastName} onChange={(e) => updateContact("lastName", e.target.value)} />
          </div>
          <div>
            <label>Email</label>
            <input type="email" value={profile.contact.email} onChange={(e) => updateContact("email", e.target.value)} />
          </div>
          <div>
            <label>Phone</label>
            <input value={profile.contact.phone} onChange={(e) => updateContact("phone", e.target.value)} />
          </div>
          <div>
            <label>City</label>
            <input value={profile.contact.city} onChange={(e) => updateContact("city", e.target.value)} />
          </div>
          <div>
            <label>State</label>
            <input value={profile.contact.state} onChange={(e) => updateContact("state", e.target.value)} />
          </div>
          <div>
            <label>Postal Code</label>
            <input value={profile.contact.postalCode} onChange={(e) => updateContact("postalCode", e.target.value)} />
          </div>
          <div>
            <label>Country</label>
            <input value={profile.contact.country} onChange={(e) => updateContact("country", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label>Address</label>
            <input value={profile.contact.address} onChange={(e) => updateContact("address", e.target.value)} />
          </div>
          <div>
            <label>LinkedIn</label>
            <input value={profile.contact.linkedin} onChange={(e) => updateContact("linkedin", e.target.value)} />
          </div>
          <div>
            <label>Website</label>
            <input value={profile.contact.website} onChange={(e) => updateContact("website", e.target.value)} />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="card">
        <h2 className="font-semibold mb-3">Professional Summary</h2>
        <textarea
          value={profile.summary}
          onChange={(e) => setProfile((p) => ({ ...p, summary: e.target.value }))}
          placeholder="Write a 3-4 sentence professional summary..."
          rows={4}
        />
      </div>

      {/* Skills */}
      <div className="card">
        <h2 className="font-semibold mb-3">Skills ({profile.skills.length})</h2>
        <div className="flex gap-2 mb-3">
          <input
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSkill()}
            placeholder="Type a skill and press Enter"
          />
          <button onClick={addSkill} className="btn btn-secondary shrink-0">Add</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {profile.skills.map((skill) => (
            <span key={skill} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/30 text-blue-300 rounded-full text-sm">
              {skill}
              <button onClick={() => removeSkill(skill)} className="hover:text-red-400">✕</button>
            </span>
          ))}
        </div>
      </div>

      {/* Experience */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Experience ({profile.experience.length})</h2>
          <button onClick={addExperience} className="btn btn-secondary btn-sm">+ Add role</button>
        </div>
        {profile.experience.map((exp, i) => (
          <div key={exp.id} className="border border-gray-700 rounded-lg p-4 mb-4">
            <div className="flex justify-between mb-3">
              <h3 className="font-medium">Role {i + 1}</h3>
              <button onClick={() => removeExperience(i)} className="text-red-400 text-sm hover:underline">Remove</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label>Company</label>
                <input value={exp.company} onChange={(e) => updateExperience(i, "company", e.target.value)} />
              </div>
              <div>
                <label>Title</label>
                <input value={exp.title} onChange={(e) => updateExperience(i, "title", e.target.value)} />
              </div>
              <div>
                <label>Location</label>
                <input value={exp.location} onChange={(e) => updateExperience(i, "location", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label>Start</label>
                  <input value={exp.startDate} onChange={(e) => updateExperience(i, "startDate", e.target.value)} placeholder="2021-03" />
                </div>
                <div>
                  <label>End</label>
                  <input value={exp.endDate} onChange={(e) => updateExperience(i, "endDate", e.target.value)} placeholder="Present" />
                </div>
              </div>
            </div>
            <label>Bullets</label>
            {exp.bullets.map((bullet, bIdx) => (
              <div key={bIdx} className="flex gap-2 mb-2">
                <input
                  value={bullet}
                  onChange={(e) => updateBullet(i, bIdx, e.target.value)}
                  placeholder="Describe your achievement..."
                  className="flex-1"
                />
              </div>
            ))}
            <button onClick={() => addBullet(i)} className="text-sm text-blue-400 hover:underline mt-1">+ Add bullet</button>
          </div>
        ))}
      </div>

      {/* Education */}
      <div className="card">
        <h2 className="font-semibold mb-4">Education</h2>
        {profile.education.map((edu, i) => (
          <div key={edu.id} className="grid grid-cols-2 gap-3 mb-4 p-3 border border-gray-700 rounded-lg">
            <div>
              <label>School</label>
              <input value={edu.school} onChange={(e) => {
                const ed = [...profile.education]; ed[i] = { ...ed[i], school: e.target.value }; setProfile((p) => ({ ...p, education: ed }));
              }} />
            </div>
            <div>
              <label>Degree</label>
              <input value={edu.degree} onChange={(e) => {
                const ed = [...profile.education]; ed[i] = { ...ed[i], degree: e.target.value }; setProfile((p) => ({ ...p, education: ed }));
              }} />
            </div>
            <div>
              <label>Field of Study</label>
              <input value={edu.fieldOfStudy} onChange={(e) => {
                const ed = [...profile.education]; ed[i] = { ...ed[i], fieldOfStudy: e.target.value }; setProfile((p) => ({ ...p, education: ed }));
              }} />
            </div>
            <div>
              <label>GPA</label>
              <input value={edu.gpa ?? ""} onChange={(e) => {
                const ed = [...profile.education]; ed[i] = { ...ed[i], gpa: e.target.value }; setProfile((p) => ({ ...p, education: ed }));
              }} />
            </div>
          </div>
        ))}
        <button
          onClick={() => setProfile((p) => ({ ...p, education: [...p.education, { id: `edu-${Date.now()}`, school: "", degree: "", fieldOfStudy: "", startDate: "", endDate: "" }] }))}
          className="text-sm text-blue-400 hover:underline"
        >
          + Add education
        </button>
      </div>

      {/* Save button at bottom */}
      <div className="flex justify-end">
        <button onClick={save} className="btn btn-primary px-8">{saved ? "✓ Saved!" : "Save profile"}</button>
      </div>
    </div>
  );
}