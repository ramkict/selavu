"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutDashboard, ChartNoAxesCombined, ArrowLeftRight, Wallet, ChartSpline, SlidersHorizontal } from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/budget", label: "Budget", icon: ChartNoAxesCombined },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/reports", label: "Reports", icon: ChartSpline },
  { href: "/admin", label: "Admin", icon: SlidersHorizontal },
];

export function Navigation() {
  const pathname = usePathname();
  const month = useSearchParams().get("month");
  return (
    <nav className="app-nav" aria-label="Primary">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return <Link key={href} href={month ? `${href}?month=${encodeURIComponent(month)}` : href} aria-current={active ? "page" : undefined}><Icon size={17} aria-hidden="true" />{label}</Link>;
      })}
      <span className="local-status"><span />Local workspace</span>
    </nav>
  );
}
