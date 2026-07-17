"use client";

import { useEffect, useState } from "react";
import {
  loadProfile,

  createDemoProfile,
  listProfileNames,
  getActiveProfileName,
  saveNamedProfile,
  switchProfile,
  createNamedProfile,
  deleteNamedProfile,
} from "@/lib/storage";
import { sendProfile, getBridgeStatus, requestSyncStatus, onSyncStatus, onProfileStored } from "@/lib/extension-bridge";
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
  // Import review (items 15/16/21/22): parsed resume waits here until the
  // user applies it section-by-section; the pre-import state backs "Undo".
  const [pendingImport, setPendingImport] = useState<ResumeProfile | null>(null);
  const [importChecks, setImportChecks] = useState<Record<string, boolean>>({});
  const [undoSnapshot, setUndoSnapshot] = useState<ResumeProfile | null>(null);
  // Multiple named profiles (item 14)
  const [profileNames, setProfileNames] = useState<string[]>(["Default"]);
  const [activeName, setActiveName] = useState("Default");

  // Item 74: what the extension holds and when it was last synced
  const [extSyncNote, setExtSyncNote] = useState("");

  useEffect(() => {
    const p = loadProfile();
    if (p) setProfile(p);
    setProfileNames(listProfileNames());
    setActiveName(getActiveProfileName());
    const offStatus = onSyncStatus((s) => {
      if (!s?.syncedAt) setExtSyncNote("Extension detected — profile not synced yet (click Save).");
      else {
        const mins = Math.round((Date.now() - new Date(s.syncedAt).getTime()) / 60_000);
        setExtSyncNote(`Extension synced ${mins <= 1 ? "just now" : `${mins}m ago`}.`);
      }
    });
    // Item 76: make last-write-wins visible instead of silent.
    const offStored = onProfileStored((previousSyncedAt) => {
      const replaced = previousSyncedAt
        ? ` (replaced the copy synced ${new Date(previousSyncedAt).toLocaleTimeString()})`
        : "";
      setExtSyncNote(`Extension synced just now${replaced}.`);
    });
    setTimeout(requestSyncStatus, 800); // give the bridge a beat to attach
    return () => {
      offStatus();
      offStored();
    };
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
    saveNamedProfile(profile); // saves the active named profile + legacy mirror
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
        references: profile.references,
      });
    }
    setSaved(true);
    setImportNotice("");
    setTimeout(() => setSaved(false), 2000);
  };

  const loadDemo = () => {
    setProfile(createDemoProfile());
  };

  const IMPORT_SECTIONS = ["contact", "summary", "skills", "experience", "education", "certifications", "projects"] as const;

  /** Item 21: cheap OCR sanity flags — garbled glyphs or unreadable "words". */
  const ocrWarnings = (p: ResumeProfile): string[] => {
    const texts = [
      p.summary,
      ...p.skills,
      ...p.experience.flatMap((e) => [e.company, e.title, ...e.bullets]),
      ...p.education.map((e) => e.school),
      ...p.certifications.map((c) => c.name),
    ];
    const warnings: string[] = [];
    for (const t of texts) {
      if (!t) continue;
      if (t.includes("�")) warnings.push(`Garbled characters in: “${t.slice(0, 50)}…”`);
      else if (/[bcdfghjklmnpqrstvwxz]{6,}/i.test(t)) warnings.push(`Possibly mis-read word in: “${t.slice(0, 50)}…”`);
    }
    return [...new Set(warnings)].slice(0, 6);
  };

  /** Claude parsed the resume — hold it for section-by-section review instead
   * of silently overwriting anything (items 15/16). */
  const handleImported = (imported: ResumeProfile) => {
    setPendingImport(imported);
    setImportChecks(Object.fromEntries(IMPORT_SECTIONS.map((s) => [s, true])));
    setImportNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const applyImport = () => {
    if (!pendingImport) return;
    setUndoSnapshot(profile); // item 22
    const next: ResumeProfile = { ...profile };
    if (importChecks.contact) next.contact = pendingImport.contact;
    if (importChecks.summary) next.summary = pendingImport.summary;
    if (importChecks.skills) next.skills = pendingImport.skills;
    if (importChecks.experience) next.experience = pendingImport.experience;
    if (importChecks.education) next.education = pendingImport.education;
    if (importChecks.certifications) next.certifications = pendingImport.certifications;
    if (importChecks.projects) next.projects = pendingImport.projects;
    setProfile(next);
    setPendingImport(null);
    setImportNotice(
      `Imported ${next.experience.length} role(s), ${next.education.length} education, ${next.certifications.length} certification(s), ${next.skills.length} skill(s). Review below, then click "Save profile" — saving also syncs to the extension.`,
    );
  };

  const undoImport = () => {
    if (!undoSnapshot) return;
    setProfile(undoSnapshot);
    setUndoSnapshot(null);
    setImportNotice("Import undone — the profile is back to its previous state (unsaved).");
  };

  /** Item 18: headshot stored as a small data URL, never in the ATS PDF. */
  const handlePhoto = (file: File) => {
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const scale = Math.max(size / img.width, size / img.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, (size - img.width * scale) / 2, (size - img.height * scale) / 2, img.width * scale, img.height * scale);
      setProfile((p) => ({ ...p, photoDataUrl: canvas.toDataURL("image/jpeg", 0.8) }));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };

  // --- Item 14: named profile switching ---
  const handleSwitchProfile = (name: string) => {
    saveNamedProfile(profile); // don't lose unsaved edits on the current one
    const next = switchProfile(name);
    if (next) {
      setProfile(next);
      setActiveName(name);
      setImportNotice("");
    }
  };

  const handleNewProfile = () => {
    const name = prompt('Name for the new profile (e.g. "Warehouse resume"):')?.trim();
    if (!name) return;
    saveNamedProfile(profile);
    const created = createNamedProfile(name, profile);
    if (!created) {
      alert("A profile with that name already exists.");
      return;
    }
    setProfileNames(listProfileNames());
    setActiveName(name);
    setProfile(created);
  };

  const handleDeleteProfile = () => {
    if (profileNames.length <= 1) return;
    if (!confirm(`Delete profile "${activeName}"? This cannot be undone.`)) return;
    deleteNamedProfile(activeName);
    setProfileNames(listProfileNames());
    const nowActive = getActiveProfileName();
    setActiveName(nowActive);
    const p = loadProfile();
    if (p) setProfile(p);
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

      {/* Item 14: multiple named profiles */}
      <div className="card flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor="profileSwitcher" className="text-gray-400 !mb-0">Profile:</label>
        <select
          id="profileSwitcher"
          value={activeName}
          onChange={(e) => handleSwitchProfile(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm w-auto"
        >
          {profileNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button onClick={handleNewProfile} className="btn btn-secondary btn-sm">+ New (copy current)</button>
        {profileNames.length > 1 && (
          <button onClick={handleDeleteProfile} className="btn btn-secondary btn-sm text-red-400">Delete</button>
        )}
        <span className="text-xs text-gray-500">
          Keep separate resumes (e.g. &ldquo;Warehouse&rdquo; vs &ldquo;Office&rdquo;) — the active one feeds tailoring &amp; autofill.
        </span>
        {extSyncNote && <span className="text-xs text-blue-400 ml-auto">🔌 {extSyncNote}</span>}
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

        {/* Items 15/16/21: review the parsed resume before anything changes */}
        {pendingImport && (
          <div className="p-4 bg-blue-950/30 border border-blue-500/30 rounded-lg space-y-3">
            <p className="text-sm font-medium text-blue-300">
              Resume parsed — choose which sections to bring in. Nothing is overwritten until you click Apply.
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {IMPORT_SECTIONS.map((section) => {
                const counts: Record<string, string> = {
                  contact: `${pendingImport.contact.firstName} ${pendingImport.contact.lastName} · ${pendingImport.contact.email}`,
                  summary: pendingImport.summary ? `${pendingImport.summary.split(/\s+/).length} words` : "empty",
                  skills: `${pendingImport.skills.length} skill(s)`,
                  experience: `${pendingImport.experience.length} role(s)`,
                  education: `${pendingImport.education.length} entr(ies)`,
                  certifications: `${pendingImport.certifications.length} cert(s)`,
                  projects: `${pendingImport.projects.length} project(s)`,
                };
                return (
                  <label key={section} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importChecks[section] ?? true}
                      onChange={(e) => setImportChecks((c) => ({ ...c, [section]: e.target.checked }))}
                      className="w-4 h-4"
                    />
                    <span className="capitalize">{section}</span>
                    <span className="text-xs text-gray-500">{counts[section]}</span>
                  </label>
                );
              })}
            </div>
            {ocrWarnings(pendingImport).length > 0 && (
              <div className="p-2 bg-amber-950/40 border border-amber-500/30 rounded text-xs text-amber-300 space-y-1">
                <p className="font-medium">⚠ Possible mis-reads — double-check these after applying:</p>
                {ocrWarnings(pendingImport).map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={applyImport} className="btn btn-primary btn-sm">Apply selected sections</button>
              <button onClick={() => setPendingImport(null)} className="btn btn-secondary btn-sm">Cancel import</button>
            </div>
          </div>
        )}

        {importNotice && (
          <div className="p-3 bg-green-950/30 border border-green-500/30 rounded-lg text-sm text-green-400 flex items-center gap-3">
            <span className="flex-1">✅ {importNotice}</span>
            {undoSnapshot && (
              <button onClick={undoImport} className="btn btn-secondary btn-sm shrink-0">↩ Undo import</button>
            )}
          </div>
        )}
      </div>

      {/* Item 18: optional headshot — stored only, never in the ATS PDF */}
      <div className="card">
        <h2 className="font-semibold mb-1">Photo (optional)</h2>
        <p className="text-sm text-gray-400 mb-3">
          Some non-US employers expect a headshot. It is stored locally and never added to the
          ATS-safe PDF — photos can hurt US applications.
        </p>
        <div className="flex items-center gap-4">
          {profile.photoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photoDataUrl} alt="Headshot preview" className="w-16 h-16 rounded-full object-cover border border-gray-700" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-600">—</div>
          )}
          <input
            aria-label="Upload profile photo"
            type="file"
            accept="image/*"
            className="text-sm w-auto"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePhoto(f);
              e.target.value = "";
            }}
          />
          {profile.photoDataUrl && (
            <button
              onClick={() => setProfile((p) => ({ ...p, photoDataUrl: undefined }))}
              className="btn btn-secondary btn-sm"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Item 64: professional references */}
      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold">References (optional)</h2>
          <button
            onClick={() =>
              setProfile((p) => ({
                ...p,
                references: [...(p.references ?? []), { id: `ref-${Date.now()}`, name: "" }],
              }))
            }
            className="btn btn-secondary btn-sm"
          >
            + Add reference
          </button>
        </div>
        <p className="text-sm text-gray-400 mb-3">
          Some Workday applications ask for references — the extension fills the first one it can match.
          Ask each person before listing them.
        </p>
        {(profile.references ?? []).map((ref, idx) => (
          <div key={ref.id} className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3 p-3 bg-gray-800 rounded-lg">
            {([
              ["name", "Full name"],
              ["title", "Their title"],
              ["company", "Company"],
              ["email", "Email"],
              ["phone", "Phone"],
              ["relationship", "Relationship (e.g. former manager)"],
            ] as const).map(([field, label]) => (
              <div key={field}>
                <label className="text-xs text-gray-500">{label}</label>
                <input
                  aria-label={label}
                  value={ref[field] ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      references: (p.references ?? []).map((r, i) => (i === idx ? { ...r, [field]: e.target.value } : r)),
                    }))
                  }
                />
              </div>
            ))}
            <button
              onClick={() => setProfile((p) => ({ ...p, references: (p.references ?? []).filter((_, i) => i !== idx) }))}
              className="btn btn-secondary btn-sm text-red-400 self-end"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Contact info */}
      <div className="card">
        <h2 className="font-semibold mb-4">Contact Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label>First Name</label>
            <input aria-label="First name" value={profile.contact.firstName} onChange={(e) => updateContact("firstName", e.target.value)} />
          </div>
          <div>
            <label>Last Name</label>
            <input aria-label="Last name" value={profile.contact.lastName} onChange={(e) => updateContact("lastName", e.target.value)} />
          </div>
          <div>
            <label>Preferred Name (optional — &ldquo;goes by&rdquo;)</label>
            <input aria-label="Preferred name" value={profile.contact.preferredName ?? ""} onChange={(e) => updateContact("preferredName", e.target.value)} />
          </div>
          <div>
            <label>Email</label>
            <input aria-label="Email" type="email" value={profile.contact.email} onChange={(e) => updateContact("email", e.target.value)} />
          </div>
          <div>
            <label>Phone</label>
            <input aria-label="Phone" value={profile.contact.phone} onChange={(e) => updateContact("phone", e.target.value)} />
          </div>
          <div>
            <label>Work Phone (optional)</label>
            <input aria-label="Work phone" value={profile.contact.workPhone ?? ""} onChange={(e) => updateContact("workPhone", e.target.value)} />
          </div>
          <div>
            <label>City</label>
            <input aria-label="City" value={profile.contact.city} onChange={(e) => updateContact("city", e.target.value)} />
          </div>
          <div>
            <label>State</label>
            <input aria-label="State" value={profile.contact.state} onChange={(e) => updateContact("state", e.target.value)} />
          </div>
          <div>
            <label>Postal Code</label>
            <input aria-label="Postal code" value={profile.contact.postalCode} onChange={(e) => updateContact("postalCode", e.target.value)} />
          </div>
          <div>
            <label>Country</label>
            <input aria-label="Country" value={profile.contact.country} onChange={(e) => updateContact("country", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label>Address</label>
            <input aria-label="Street address" value={profile.contact.address} onChange={(e) => updateContact("address", e.target.value)} />
          </div>
          <div>
            <label>LinkedIn</label>
            <input aria-label="LinkedIn URL" value={profile.contact.linkedin} onChange={(e) => updateContact("linkedin", e.target.value)} />
          </div>
          <div>
            <label>Website</label>
            <input aria-label="Website URL" value={profile.contact.website} onChange={(e) => updateContact("website", e.target.value)} />
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
                <input aria-label="Company" value={exp.company} onChange={(e) => updateExperience(i, "company", e.target.value)} />
              </div>
              <div>
                <label>Title</label>
                <input aria-label="Job title" value={exp.title} onChange={(e) => updateExperience(i, "title", e.target.value)} />
              </div>
              <div>
                <label>Location</label>
                <input aria-label="Job location" value={exp.location} onChange={(e) => updateExperience(i, "location", e.target.value)} />
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
              <input aria-label="School" value={edu.school} onChange={(e) => {
                const ed = [...profile.education]; ed[i] = { ...ed[i], school: e.target.value }; setProfile((p) => ({ ...p, education: ed }));
              }} />
            </div>
            <div>
              <label>Degree</label>
              <input aria-label="Degree" value={edu.degree} onChange={(e) => {
                const ed = [...profile.education]; ed[i] = { ...ed[i], degree: e.target.value }; setProfile((p) => ({ ...p, education: ed }));
              }} />
            </div>
            <div>
              <label>Field of Study</label>
              <input aria-label="Field of study" value={edu.fieldOfStudy} onChange={(e) => {
                const ed = [...profile.education]; ed[i] = { ...ed[i], fieldOfStudy: e.target.value }; setProfile((p) => ({ ...p, education: ed }));
              }} />
            </div>
            <div>
              <label>GPA</label>
              <input aria-label="GPA" value={edu.gpa ?? ""} onChange={(e) => {
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