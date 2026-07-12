# First real run — UAT checklist

Everything below takes ~30 minutes and is the only remaining step between
"passes 124 automated checks" and "proven on real Workday." Work through it
in order; each step says what to capture if something misses.

## 0. Setup (one time)

- [ ] `cd web && npm install && echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local && npm run dev`
- [ ] `cd extension && npm install && npm run build`, then load `extension/dist`
      unpacked at `chrome://extensions` (Developer mode → Load unpacked)
- [ ] Click the Workdayz toolbar icon → set `http://localhost:3000` → **Connect**
- [ ] Open http://localhost:3000 — the setup checklist should show three green checks
      (reload the tab if the extension row is red)

## 1. Profile

- [ ] Import your real resume on the Resume page (PDF, pasted text, or a
      LinkedIn "Save to PDF" export)
- [ ] Read every imported field. The import is instructed to copy faithfully —
      flag anything invented or dropped. **Capture:** which field, what it said,
      what it should say.
- [ ] Check the completeness meter's suggestions are sensible

## 2. Tailoring (real posting, real key)

Pick a real posting on any public `*.myworkdayjobs.com` careers site.

- [ ] Paste the posting URL into **Source URL** → **Fetch**. It should fill
      title/company/location/description. **Capture on failure:** the URL and
      the error message (the Workday JSON endpoint is tried first, then HTML —
      knowing which failed matters).
- [ ] Tailor. Review with suspicion:
  - [ ] Every bullet claim traces back to your real resume (blue dot = changed;
        expand "View your original bullets" to compare)
  - [ ] ATS "verify before submitting" warnings only list skills you actually lack
  - [ ] The fit analysis gaps ring true (they're supposed to be blunt)
  - [ ] Cover letter reads like you and names the company/role specifically
- [ ] Try one per-bullet ✨ rewrite and one ↺ revert
- [ ] Download the resume PDF **and** DOCX — open both, check layout and that
      your edits are in them

## 3. Autofill (the real test)

On the posting page, the Workdayz widget should appear bottom-right.

- [ ] Click **Tailor with Workdayz →** on the posting page — it should scrape
      the description and open the web app with it prefilled
- [ ] In the web app: **Send to extension for Workday autofill**
- [ ] Start the application ("Apply" → "Autofill with Resume" is fine — our
      resume upload happens later, or apply manually), sign up/log in with a
      personal account
- [ ] On each wizard step, click **Preview fill (writes nothing)** first —
      dashed outlines show what would be touched
- [ ] Then **Autofill this step**. Check:
  - [ ] Contact fields correct (country/state dropdowns included)
  - [ ] Resume + cover letter PDFs attached to the right upload slots
  - [ ] Work-experience panels filled; "Add Another" clicked automatically for
        extra roles (watch it — this is the newest behavior)
  - [ ] Self-ID questions (veteran/disability/gender/race) untouched and
        reported as "left for you"
  - [ ] The "STILL NEEDED" list matches what's actually empty
- [ ] **For every field it missed:** click **Copy field report** and paste the
      report somewhere safe. It contains only the employer's form labels, never
      your data. This is the single most valuable artifact of the whole UAT —
      bring it back and the synonym lists get tuned for that tenant.
      The report ends with an **UNMATCHED** section of ready-made
      `Field label = ` lines: to fix a missed field on the spot, paste those
      lines into the extension popup's custom answers, fill in the right-hand
      side, save, and re-run autofill on the step.
- [ ] Try **Draft answers to questions** on a step with essay questions;
      confirm "[NEEDS YOUR INPUT]" placeholders appear where only you know the
      answer
- [ ] **Review everything, then submit yourself.** The tool never submits.

## 4. Tracking

- [ ] The application appears in the tracker; move it to "applied"
- [ ] Set a follow-up date; confirm it exports in the .ics and nudges on the
      home page once overdue
- [ ] Note the estimated AI cost line and sanity-check it against
      console.anthropic.com usage

## What to bring back

1. Field reports from any step that missed fields (per tenant)
2. The fetch-URL result (worked / fell back / failed, and for which URL)
3. Any invented resume content — quote it exactly
4. Anything that felt slow, confusing, or untrustworthy

## Known rough edges going in

- Tenants customize Workday heavily; expect a first-run miss rate on
  non-contact fields. That's what the field report + custom rules are for.
- The extension deliberately refuses to run on internal `*.myworkday.com`.
- Cost estimates are estimates; the console is the invoice.
