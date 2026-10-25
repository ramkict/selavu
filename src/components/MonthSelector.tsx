"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  const shortMonth = new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(year, month - 1, 1)));
  return `${shortMonth}-${year}`;
}

export function MonthSelector({ months, defaultMonth }: { months: string[]; defaultMonth: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("month") ?? "";
  const current = MONTH_PATTERN.test(requested) ? requested : defaultMonth;

  function selectMonth(month: string) {
    const next = new URLSearchParams(params.toString());
    next.set("month", month);
    router.push(`${pathname}?${next.toString()}`);
  }

  const options = [...new Set([...months, current])].sort();

  return (
    <div className="month-form">
      <label htmlFor="month-select">Month</label>
      <select
        id="month-select"
        aria-label="Month and year"
        value={current}
        onChange={(event) => selectMonth(event.target.value)}
      >
        {options.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
      </select>
    </div>
  );
}
