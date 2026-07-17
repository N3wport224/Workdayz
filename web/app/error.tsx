"use client";

// Item 91: route-level error boundary — a crash in any page renders a
// recoverable message instead of a blank screen that looks like "nothing
// happened". Data in localStorage is untouched by a render crash.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card border-red-500/30 bg-red-950/30 max-w-xl mx-auto mt-12 text-center space-y-3">
      <div className="text-4xl">💥</div>
      <h2 className="font-semibold text-red-300">Something broke on this page</h2>
      <p className="text-sm text-gray-400">
        Your profile and applications are safe in this browser&apos;s storage — this was a display
        error, not data loss.
      </p>
      <p className="text-xs text-gray-500 break-all">
        {error.message}
        {error.digest ? ` (digest: ${error.digest})` : ""}
      </p>
      <button onClick={reset} className="btn btn-primary">
        Try again
      </button>
    </div>
  );
}
