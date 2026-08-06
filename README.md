# Workdayz

Tailors your resume and cover letter to a specific job posting on a public
Workday career site (`*.myworkdayjobs.com`), scores the result for ATS
keyword match, and autofills the Workday application in your browser —
stopping before the final Submit so you always review before it goes out.

The extension deliberately only runs on public career sites, never on a
company's internal Workday (`*.myworkday.com`) — applying externally with
your own tools is your business; automating your employer's internal systems
may violate policy.

## Architecture

```
web/         Next.js app — resume profile, job input, Claude-powered
             tailoring, ATS scoring, ATS-safe PDF export, review UI.
extension/   Manifest V3 browser extension — scrapes job postings, receives
             the tailored package from the web app, autofills Workday form
             fields and attaches the resume/cover letter PDFs.
```

The two talk to each other via `window.postMessage` (web app ⇄ a content
script the extension registers, only for the web app origin you explicitly
connect) and `chrome.storage.local` (extension-internal state). No Workday
credentials are ever entered into, stored by, or transmitted through either
piece — the extension runs inside your normal, already-logged-in browser
tab and only manipulates form fields.

## Why it's split this way

- **Resume tailoring needs an LLM and your resume data** — that's server-
  side work, so it's a web app with an API route calling Claude.
- **Filling out Workday needs your live, authenticated browser session** —
  Workday sits behind company SSO/MFA, so the only safe way to interact with
  it without storing your credentials somewhere is to run inside the browser
  itself, as an extension, using the session you already have.
- **The extension never clicks Next/Continue/Submit.** It fills in the
  fields it can find on whatever step you're on and stops. You move through
  the wizard and hit the final Submit button yourself. This is a deliberate
  design choice, not a limitation to work around later — see "Safety notes"
  below.

## Quick start

```bash
# 1. Web app
cd web
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                   # http://localhost:3000

# 2. Extension (separate terminal)
cd extension
npm install
npm run build                 # outputs to extension/dist
```

Then load `extension/dist` as an unpacked extension (see
`extension/README.md`), fill out your resume at `/profile` (paste an
existing resume to auto-import it), and tailor your first application at
`/apply`. Every tailored application is saved to `/applications` so you can
track its status over time.

## Features

- **Resume import** — paste your existing resume as text and Claude
  structures it into the profile fields for you.
- **Tailoring** — resume summary/skills/bullets rewritten per job posting,
  plus a matching cover letter, without inventing experience.
- **ATS scoring** — deterministic keyword-coverage score with formatting
  feedback and an integrity check on anything the model added.
- **Fit analysis** — an honest strengths/gaps/verdict read on you vs. the
  role (gaps are deliberately not sugarcoated), generated in the same call.
- **Interview prep** — per application, generate the questions you're likely
  to face with talking points mapped to your real experience, including
  honest framings for your known gaps.
- **ATS-safe PDFs** — single-column, text-based, no tables/images.
- **Application tracker** — every tailored application is saved
  automatically; track status from draft through offer, with per-application
  notes and a stats row (status funnel, average ATS).
- **Workday autofill** — browser extension fills contact fields (including
  Workday's custom listbox dropdowns like country/state and split Month/Year
  date inputs), uploads the resume/cover letter, and fills as many
  work-experience/education panels as are already on the page, re-scanning
  automatically as Workday's SPA navigates between steps.
- **Application question drafting** — the extension scrapes the free-text
  questions on the current Workday step ("Why do you want this role?") and
  drafts first-person answers grounded in your real experience for you to
  review and edit in place. Questions only you can answer (salary, work
  authorization, relocation) come back as explicit "[NEEDS YOUR INPUT]"
  placeholders, never guesses.
- **CSV export** — download the tracker as a spreadsheet, plus full JSON
  backup/restore.
- **Outreach messages** — per application, draft a thank-you email,
  follow-up email, or recruiter LinkedIn DM grounded in your real background.
- **Tracker workflow** — search/filter/sort, follow-up reminder dates with
  overdue flags, application velocity stats, time-in-stage.
- **Writing quality tools** — profile completeness meter, per-bullet
  strength ratings (action verb / quantified / length), cover letter tone
  AND length controls, one-click "different angle" letter rewrites,
  estimated resume page count, clickable missed-keyword chips.
- **Autofill safety & control** — undo the last fill, flash-highlight on
  every filled field, self-identification questions (veteran/disability/
  gender/race) always left to you and reported, prefilled-value mismatch
  warnings (e.g. the form has an old phone number), keyboard shortcut
  (Alt+Shift+F), collapsible/movable on-page widget, toolbar badge showing
  the fill count, and a required-fields-still-empty checklist after every
  run.
- **Custom answers** — teach the autofill tenant-specific fields from the
  extension popup ("Desired salary = 85000", one rule per line) plus a
  dedicated "How did you hear about us?" default; self-ID fields stay
  off-limits even via custom rules.
- **Answer memory** — recurring screening questions ("years of experience",
  "active clearance?", "salary expectations") are captured from applications
  you've already filled and recalled on later ones. Matching normalizes case,
  punctuation, and whitespace so the same question phrased differently by
  another tenant still hits. Capture is one explicit click; recall is
  automatic, and only ever writes into fields that are still empty — the
  form's own prefill and anything you typed both win. Self-identification
  questions are never captured and never recalled, enforced through the same
  `isPersonalField` list the rest of the autofill uses.
- **Multiple profiles** — keep separate resume profiles (e.g. analyst vs.
  ops roles) and switch between them; plus a demo profile to try the tool
  before importing your real resume, and a one-click "delete all my data"
  wipe. Saving syncs *every* named profile to the extension, and the on-page
  widget shows a picker so you choose which resume fills the form without
  going back to the web app (the picker appears only once you have two or
  more profiles).
- **Projects section** — first-class projects on the profile, in tailoring
  input, and on the rendered resume PDF.
- **Fetch posting by URL** — paste a job posting URL and the app extracts
  title/company/location/description server-side (JSON-LD aware, SSRF-guarded)
  so you don't have to copy/paste.
- **Editable output** — tweak the tailored summary and skills inline before
  exporting; cover-letter draft history with one-click restore of any
  previous draft.
- **Cost transparency** — every tailoring run reports its estimated API
  cost plus a lifetime total for this browser; rate-limit/overload/credit
  errors come back as actionable messages instead of generic failures.
- **Tracker board view** — kanban-style status columns alongside the list
  view, per-application status timeline, "open original posting" links,
  archive (single or bulk-archive rejected), and an overdue follow-up nudge
  on the home page.
- **Interview prep export** — download any application's prep as Markdown
  for your notes app.
- **Bullet-level control** — every tailored bullet is editable, shows a
  changed-vs-original indicator, reverts to your original with one click,
  and can be AI-rewritten individually (bounded by your original facts).
- **A/B variants** — generate up to three takes on the same job with
  different emphasis and switch between them as tabs.
- **JD keyword highlighting** — read the posting with matched (green) and
  missing (amber) ATS keywords marked inline.
- **Smarter ATS scoring** — keywords in the job title weigh double, ones
  repeated 3+ times weigh 1.5×, and known aliases match (k8s ↔ Kubernetes,
  ML ↔ machine learning) with word-boundary safety.
- **More export formats** — DOCX resume (many ATSs prefer Word), plain-text
  copy for paste-into-a-box portals, and a Compact PDF layout alongside
  Classic.
- **Batch tailoring** — paste up to 10 posting URLs; each is fetched,
  tailored, and saved to the tracker as a draft while you watch progress.
- **Outcome insights** — response rate by ATS band, median days to hear
  back, and weekly volume, computed from your own tracker history.
- **Offers & comp** — a comp field per application and a comparison table
  once offers arrive; comp is included in the CSV export.
- **Calendar & email handoff** — follow-ups export as an .ics file;
  drafted emails open pre-filled via mailto.
- **Whole-life backup** — one file with every profile, application, and
  setting, optionally passphrase-encrypted (AES-256-GCM); storage-headroom
  meter warns before the browser cap bites.
- **LinkedIn import** — a LinkedIn "Save to PDF" profile export imports
  like any resume.
- **First-run tour** — a three-step guided start for new users.
- **Autofill: grows sections itself** — clicks the section's "Add"/"Add
  Another" button (told apart by section heading) and fills each new panel as
  Workday renders it, so multi-role work history, education, AND
  certifications fill without manual panel-adding — including type-ahead
  School/Certification comboboxes, Degree dropdowns, and readonly "From/To"
  and "Issued/Expiration" MM/YYYY date boxes.
- **Structured certifications** — name, issuer, and issued/expiration dates
  on the profile, imported from your resume, and autofilled into Workday's
  Certifications/Licenses section.
- **Autofill: dry-run preview** — see exactly which fields WOULD be filled
  (dashed highlights) without writing anything.
- **Per-tenant rules & sharing** — custom answers can be scoped to one
  career site's hostname, and all rules export/import as JSON.
- **Page memory** — the widget tells you when you've already autofilled the
  page you're looking at.
- **Experimental Firefox build** — `npm run build:firefox` produces a
  loadable Firefox MV3 variant.
- **Prompt caching** — repeat tailoring runs (refine, variants, new letter
  drafts) reuse cached prompt tokens at a fraction of the price; the cost
  estimator prices cache hits correctly.

### Extension v0.2.0 — 30 New Autofill Features

The extension now packs an additional 30 capabilities across three new modules
(`fill-engine.ts`, `features.ts`, `feature-audit.ts`) wired into the existing
autofill pipeline:

| # | Feature | Module | What it does |
|---|---------|--------|-------------|
| 1 | **Field value normalizer** | fill-engine | Detects and formats phone numbers, names, addresses, ZIP codes, URLs, LinkedIn profiles, currencies, and dates based on field label before writing |
| 2 | **Incremental fill planning** | fill-engine | Pre‑scans fields and generates a plan of what would be filled vs skipped vs mismatched — lets the UI show a diff before executing |
| 3 | **Confidence score** | fill-engine | After every fill run, reports the percentage of identified fillable fields that were successfully written (Excellent/Good/Fair/Low) |
| 4 | **Tenant detection** | fill-engine | Identifies the Workday tenant from the URL hostname and activates field‑label overrides (Xcel Energy, Amazon, Target, etc.) |
| 5 | **International synonym expansion** | fill-engine | Augments every synonym list with known international variants (French, Spanish, German labels) so the fill works on non‑English career sites |
| 6 | **Section‑growth retry** | fill-engine | Clicks the "Add" button with exponential backoff (up to 3 attempts) before giving up — compensates for slow SPA rendering |
| 7 | **Batch fill all** | fill-engine | Runs a complete multi‑section autofill in one call with optional progress callbacks |
| 8 | **Required‑field pre‑scan** | fill-engine | Before filling, scans the form for required fields and reports whether the package has data for each one |
| 9 | **Fill timeout guard** | fill-engine | Wraps any fill operation in a 30‑second timeout so a stuck field never hangs the widget forever |
| 10 | **Field type classifier** | fill-engine | Inspects autocomplete attributes, input types, and label text to classify fields as phone/email/name/address/date/number/URL/select |
| 11 | **Format preview** | fill-engine | Shows "raw value → formatted value" so the user sees how a value will be transformed before the fill |
| 12 | **Wizard step detection** | fill-engine | Identifies which step of the Workday multi‑step wizard is currently visible (step number, total steps, name) |
| 13 | **Section fill status** | fill-engine | Returns a per‑section summary (Contact, Experience, Education, Certs) with filled/total/complete flags |
| 14 | **Package staleness checker** | fill-engine | Computes the age of the loaded package in days and warns if it's ≥7 days (stale) or ≥30 days (consider re‑tailoring) |
| 15 | **Aggregate fill runs** | fill-engine | Combines multiple AutofillRunSummary objects into one — useful when filling a page in several passes |
| 16 | **Shortcut manager** | features | Queries `chrome.commands.getAll()` and reports the current keyboard shortcut mapping from the extension popup |
| 17 | **Screen‑reader announcements** | features | Creates a `aria-live="polite"` announcer element and posts fill‑result messages so assistive technology users get spoken feedback |
| 18 | **Form vs profile diff** | features | Compares every contact field's current form value against the profile's stored value and reports matches/mismatches |
| 19 | **Autofill session tracking** | features | Starts a session (UUID, hostname, package info) when a fill begins; updates step/field counts; persisted to chrome.storage |
| 20 | **Error recovery with fallbacks** | features | Attempts the primary value, verifies it was accepted, and tries alternative values in sequence if the field rejects it |
| 21 | **Local usage analytics** | features | Tracks total autofills, fields filled, files attached, per‑tenant breakdown — all local, never transmitted |
| 22 | **Fill templates** | features | Save/load/delete named sets of custom fill rules; apply them as a group |
| 23 | **Batch template processor** | features | Applies multiple templates in sequence with per‑template progress reporting |
| 24 | **In‑page toast notifications** | features | Animated, color‑coded toast messages that appear above the widget for success/warning/error/info feedback |
| 25 | **Field‑to‑data mapper** | features | Generates a list mapping every form field label to its profile data source and confidence level |
| 26 | **Data validation engine** | features | Checks the package for missing first/last name, invalid email, missing job title/company, empty education entries — returns actionable warnings |
| 27 | **Fill history timeline** | features | Records every field fill in sessionStorage (up to 100 entries) with timestamps for per‑page audit trail |
| 28 | **Structured fill report export** | features | Generates a JSON report with package info, field count, validation warnings, and fill history; copies to clipboard |
| 29 | **Import field values from text** | features | Parses `label = value` lines from clipboard and fills matching fields on the current page |
| 30 | **Settings manager** | features | Persistent user preferences: auto‑fill on page load, confidence score display, fill highlighting, retry count, timeout, theme |

### Self‑Diagnostics Audit Engine

The extension now includes a built‑in audit engine (`feature-audit.ts`) that
runs the following health checks:

| Check | What it verifies |
|-------|-----------------|
| `chrome.storage.local` | Storage is accessible, reports key count |
| `chrome.runtime` | Extension runtime is active, reports extension ID |
| `chrome.tabs` | Tab query succeeds, reports active tab URL |
| `chrome.commands` | Keyboard shortcuts are registered |
| `workday-site-detection` | Content script is on a Workday career site |
| `dom-access` | `document.body` is reachable |
| `storage-usage` | Bytes used vs quota |

Run the audit from any context to get a version‑stamped `AuditReport` with
pass/fail/warn per check. The report contains no personal data — only
extension health metadata.

## Security audit

A code-review pass found and fixed four real issues. Each has a regression
test that was verified to fail against the original code before the fix.

- **XSS in the on-page widget** (`extension/src/content/widget.ts`,
  `workday.ts`). The extension runs on *every* `*.myworkdayjobs.com` tenant,
  so field labels and form values are attacker-controllable text. Three sinks
  interpolated that text into `innerHTML` unescaped — a crafted field value
  like `<img src=x onerror=…>` executed script in the content script's
  context. Fixed with a shared `escapeHtml()` applied at every sink; the
  e2e suite proves raw interpolation creates a live element and escaped
  interpolation does not.
- **SSRF allowlist bypass** in the job-fetch API route
  (`web/app/api/fetch-job/route.ts`). `isAllowed()` used
  `hostname.endsWith(host)`, which any domain merely *ending* in an allowed
  string satisfied — `attackermyworkdayjobs.com` passed. Now requires an
  exact host or a real dot-delimited subdomain, plus a protocol check.
- **Bridge-origin trust gap.** The web-app bridge trusts any postMessage
  claiming `{source: "workdayz-web"}` on the page it's injected into, and
  `myworkdayjobs.com` is already a host permission — so connecting the
  extension to a Workday URL by mistake would let that tenant's own page
  script forge profile-store messages. `isWorkdayDomain()` now blocks this
  at three layers (popup, script registration, and the message handler).
- **Backup crypto.** Encrypted-backup PBKDF2 iterations raised from 310k to
  600k (current OWASP guidance). The count travels *inside* each backup
  rather than being a shared constant, so backups saved at the old count
  still decrypt — changing the constant alone would have silently broken
  every backup already made.

## Accessibility

Every page is audited with `axe-core` in CI (`npm run test:a11y`), and the
build fails on critical violations. All five pages currently report **0
critical and 0 serious** violations, including color contrast.

One root cause worth noting: a `dark:`-variant text color was never
activating, because the app has no light/dark toggle wired to `<html>` — that
element's color silently depended on the *browser's* default color scheme
instead of the app's actual (always-dark) theme.

## Tests & CI

GitHub Actions runs both halves on every push (`.github/workflows/ci.yml`):

| Job | Steps |
|-----|-------|
| **Web app** | `tsc --noEmit`, `eslint`, 76 Vitest unit tests, `next build`, then four browser-driven suites: apply-page UI flows, full user journey, export/toolkit, and the a11y audit (LLM calls mocked) |
| **Extension** | scope audit (must stay on `*.myworkdayjobs.com` only), `tsc --noEmit`, build, DOM-heuristics e2e against three fake Workday tenant fixtures, popup UI e2e, bridge-origin guard, answer-memory suite |

## Safety notes

- **No stored credentials.** The extension has no login flow and never sees
  your Workday password/SSO session token — it only reads/writes form field
  values in the DOM of a page you're already logged into.
- **Human review gate.** Nothing is ever submitted automatically. Read
  `extension/src/content/autofill.ts` — it fills fields, uploads the resume
  PDF and cover letter PDF, and returns a summary; it does not simulate
  clicks on any navigation or submission control.
- **No fabrication in tailoring.** `web/lib/tailor.ts`'s system prompt
  explicitly forbids inventing employers, titles, dates, or metrics not
  present in your source resume; `web/lib/ats-score.ts` cross-checks the
  model's output against your original profile and flags anything it can't
  verify.
- **Prompt-injection defenses.** Job descriptions and uploaded resumes are
  third-party text that flows into LLM prompts; both prompts explicitly
  instruct the model to treat that content as data and ignore instructions
  embedded in it, and the deterministic ATS integrity check flags skills
  that don't trace back to your source resume regardless of what the model
  was talked into.
- **Local, unauthenticated API.** The web app's API routes have no auth —
  they're designed to run on localhost for one person. Don't deploy it to a
  public host as-is; anyone who could reach it could spend your Anthropic
  API credits.
- **Company policy.** Automating form-filling in your own browser session is
  generally very different from running a headless bot against your
  employer's systems, but acceptable-use policies vary — check yours before
  relying on this for real applications.
- **Per-tenant tuning likely needed.** Workday tenants customize field
  labels and page structure; see the "How field matching works, and its
  limits" section in `extension/README.md`.
