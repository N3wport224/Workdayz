# Workdayz — full walkthrough (import → tailor → autofill)

A step-by-step tour of the complete loop. (A recorded GIF/video can't be
produced in this environment — this document is the narrated version; each
step notes exactly what you should see on screen so you can film your own
if you want one.)

## 0. One-time setup

1. `cd web && npm install && npm run dev` → open http://localhost:3000.
2. Add your Anthropic key: Settings page, or `ANTHROPIC_API_KEY` in `web/.env.local`.
3. `cd extension && npm install && npm run build`, then load `extension/dist`
   as an unpacked extension at `chrome://extensions` (Developer mode on).
4. In the extension popup → Settings tab → Web App URL → Connect
   (`http://localhost:3000`), then reload the web-app tab.
5. The home page's **Setup checklist** should now show all four rows green.

## 1. Import your resume (Profile page)

- Drag your resume PDF onto the **Step 1 · Import your resume** panel
  (or paste its text; LinkedIn's "More → Save to PDF" export works too).
- *You should see:* a review card listing what was parsed per section
  (roles, education, certifications, skills) with checkboxes.
- Accept the sections you want → **Apply selected sections** → review the
  filled form → **Save profile**.
- *You should see:* "Extension synced just now" — your base resume is now in
  the extension.

## 2. Tailor for a job (Apply page)

- Paste a Workday posting URL and click **Fetch URL** (or paste the
  description manually). Optionally set industry phrasing and cover-letter
  tone/length.
- Click **✨ Tailor my resume** (15–30s).
- *You should see:* the ATS score with matched/missing keyword chips,
  per-section readiness, ranked "what would raise this score" suggestions,
  the bullet-by-bullet diff with strength ratings, fit analysis, and the
  cover letter.
- Rewrite any bullet you don't like — the score updates live.

## 3. Choose the resume and send it

- In **Actions**, the "Resume to use" dropdown defaults to the tailored
  resume; variants and your base profile are the alternatives.
- Download the PDF/DOCX (pick layout/font/section order) — or click
  **📤 Send to extension**.
- *You should see:* "Sent to extension using Tailored resume (ATS …)" and
  the "Extension holds: …" line confirming what's loaded.

## 4. Autofill on Workday

- Open the job's application on the company's `*.myworkdayjobs.com` site
  and sign in / start the application yourself.
- The Workdayz widget appears bottom-right. **Preview fill** shows the
  field-by-field table (values, confidence dots, per-field skip).
- Click **Autofill this step** (or Alt+Shift+F).
- *You should see:* fields flash blue as they fill, all your jobs /
  education / certifications added via the Add buttons, dates in MM/YYYY,
  and a result card: filled count, confidence, anything still required.
- Self-identification questions are always left for you, by design.
- Review every page, then click Workday's own Continue/Submit buttons —
  Workdayz never submits anything.

## 5. Track it

- The application is already in the Tracker (saved when you tailored it).
- Set status as it progresses; add follow-up dates (exportable as .ics),
  notes, and salary. The analytics row shows response rates — including
  per-resume-variant A/B splits once you've sent a few.

## Safety rails worth knowing

- External `*.myworkdayjobs.com` career sites only — never your employer's
  internal Workday. CI fails if the extension's scope ever widens.
- Nothing is fabricated: tailoring only rephrases what your resume already
  says, and blank stays blank.
- Everything lives in your browser; the only external call is to Anthropic
  with your own key.
