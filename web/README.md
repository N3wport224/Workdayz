# Workdayz web app

Next.js app that tailors your resume and cover letter to a job posting using
Claude, scores the result for ATS keyword coverage, renders ATS-safe PDFs,
and hands the finished package off to the [browser extension](../extension)
for Workday autofill.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. Set up your resume profile at `/profile` first
(stored in browser localStorage — never sent anywhere except to the tailoring
API when you generate an application), then use `/apply` to tailor an
application to a specific job posting.

## How it works

- `lib/tailor.ts` calls the Claude API (tool use / structured output) to
  rewrite your resume's summary/skills/bullets for a specific job and write a
  cover letter, **without inventing experience** — it's instructed to only
  rephrase/reorder/emphasize what's already in your profile.
- `lib/ats-score.ts` computes an ATS keyword-coverage score in code (not
  trusting the model's own arithmetic), plus formatting heuristics and an
  integrity check that flags any skill the model added that isn't actually
  in your original resume.
- `lib/pdf/*.tsx` render clean, single-column, text-based PDFs via
  `@react-pdf/renderer` — no tables/images/columns that trip up ATS parsers.
- `lib/extension-bridge.ts` talks to the browser extension via
  `window.postMessage` (see `extension/src/content/web-app-bridge.ts` for the
  other half of the protocol).

## API routes

- `POST /api/tailor` — `{ profile, job }` → `{ tailoredResume, coverLetter, atsScore }`
- `POST /api/resume-pdf` — resume data → PDF file
- `POST /api/cover-letter-pdf` — cover letter data → PDF file
