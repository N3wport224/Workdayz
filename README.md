# Workdayz

Tailors your resume and cover letter to a specific job posting from your
company's internal Workday, scores the result for ATS keyword match, and
autofills the Workday application in your browser — stopping before the
final Submit so you always review before it goes out.

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
- **CSV export** — download the tracker as a spreadsheet.

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
