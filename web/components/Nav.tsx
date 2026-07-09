"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/profile", label: "Resume" },
  { href: "/apply", label: "Tailor & Apply" },
  { href: "/applications", label: "Tracker" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto max-w-3xl px-4 h-14 flex items-center gap-6">
        <Link href="/" className="font-bold text-sm tracking-tight">
          Workdayz
        </Link>
        <nav className="flex gap-4 text-sm">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? "font-medium text-blue-600 dark:text-blue-400"
                    : "opacity-70 hover:opacity-100"
                }
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
