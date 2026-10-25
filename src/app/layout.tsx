import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MonthSelector } from "@/components/MonthSelector";
import { Navigation } from "@/components/Navigation";
import { getDb } from "@/server/db";
import { getSettings } from "@/server/domain/reference";
import { listConfiguredMonths } from "@/server/domain/months";
import { currentMonthIn } from "@/server/lib/calendar";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "Accounts Manager",
  description: "Single-user, local-first accounts and budget manager",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const db = await getDb();
  const { months, defaultMonth } = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    return { months: await listConfiguredMonths(tx), defaultMonth: currentMonthIn(settings.timezone) };
  });

  return (
    <html lang="en-IN">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="app-header">
          <Link href="/" className="brand" aria-label="Accounts Manager home">
            <span className="brand-mark" aria-hidden="true">₹</span>
            <span>Accounts Manager<small>Your money, in perspective</small></span>
          </Link>
          <Suspense fallback={null}>
            <MonthSelector months={months} defaultMonth={defaultMonth} />
          </Suspense>
        </header>
        <Suspense fallback={null}><Navigation /></Suspense>
        <main id="main" className="app-main">
          {children}
        </main>
      </body>
    </html>
  );
}
