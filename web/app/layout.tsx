import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Workdayz — Tailored Job Applications",
  description: "Tailor resumes and cover letters to Workday job postings using AI. Score for ATS keyword match and autofill applications with the browser extension.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <nav className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="text-lg font-bold text-blue-400 hover:text-blue-300 transition-colors">
              ⚡ Workdayz
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/profile" className="text-gray-400 hover:text-gray-200 transition-colors">Profile</Link>
              <Link href="/apply" className="text-gray-400 hover:text-gray-200 transition-colors">Apply</Link>
              <Link href="/applications" className="text-gray-400 hover:text-gray-200 transition-colors">Tracker</Link>
              <Link href="/settings" className="text-gray-400 hover:text-gray-200 transition-colors">Settings</Link>
            </div>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}