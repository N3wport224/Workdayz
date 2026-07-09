import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold mb-2">Workdayz</h1>
      <p className="opacity-70 mb-10">
        Tailor your resume and cover letter to a job posting from your company&apos;s internal
        Workday, with an ATS match score — then hand off to the browser extension to autofill the
        Workday application for a final review before you submit.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/profile"
          className="rounded-lg border border-black/10 dark:border-white/15 p-5 hover:border-blue-500 transition-colors"
        >
          <h2 className="font-semibold mb-1">1. Set up your resume</h2>
          <p className="text-sm opacity-70">
            Enter your real work history once. This is the ground truth every tailored resume is
            built from.
          </p>
        </Link>
        <Link
          href="/apply"
          className="rounded-lg border border-black/10 dark:border-white/15 p-5 hover:border-blue-500 transition-colors"
        >
          <h2 className="font-semibold mb-1">2. Tailor & apply</h2>
          <p className="text-sm opacity-70">
            Paste a job posting, review the tailored resume, cover letter, and ATS score, then send
            it to Workday.
          </p>
        </Link>
      </div>

      <div className="mt-10 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium mb-1">How Workday autofill works</p>
        <p className="opacity-80">
          Install the Workdayz browser extension (see <code>extension/README.md</code>) and load it
          in your browser. It runs in your already-logged-in session — no credentials are ever
          stored by this app. It fills in the Workday application form for you and stops before the
          final Submit step so you can review everything first.
        </p>
      </div>
    </main>
  );
}
