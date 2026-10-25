"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { ApiError, apiRequest } from "./api";

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return `${new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(year, month - 1, 1)))}-${year}`;
}

function monthOffset(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const index = year * 12 + month - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function nextUnconfiguredMonth(currentMonth: string, months: string[]) {
  for (let offset = 1; offset <= 240; offset++) {
    const candidate = monthOffset(currentMonth, offset);
    if (!months.includes(candidate)) return candidate;
  }
  return monthOffset(currentMonth, 241);
}

export function ConfiguredMonthsPanel({ months, currentMonth }: { months: string[]; currentMonth: string }) {
  const router = useRouter();
  const [month, setMonth] = useState(() => nextUnconfiguredMonth(currentMonth, months));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const minMonth = monthOffset(currentMonth, 1);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    start(async () => {
      try {
        await apiRequest("POST", "/months", { month });
        setMessage(`${monthLabel(month)} is now available in the header.`);
        setMonth(nextUnconfiguredMonth(currentMonth, [...months, month]));
        router.refresh();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Could not add this month.");
      }
    });
  }

  return (
    <section className="panel configured-months" aria-labelledby="configured-months-title">
      <div className="panel-head"><div><h2 id="configured-months-title">Available months</h2><p>Configured months appear in the header selector.</p></div><span className="badge none">{months.length} months</span></div>
      <form className="month-admin-form" onSubmit={submit}>
        <label className="field" htmlFor="new-month"><span>Add a future month</span><input id="new-month" type="month" min={minMonth} value={month} onChange={(event) => { setMonth(event.target.value); setError(null); }} required /></label>
        <button className="primary" type="submit" disabled={pending || !month}>{pending ? "Adding..." : <><CalendarPlus size={16} aria-hidden="true" />Add month</>}</button>
      </form>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="alert info" role="status">{message}</p> : null}
      <div className="table-wrap"><table><thead><tr><th>Month</th><th>Status</th></tr></thead><tbody>
        {months.map((availableMonth) => <tr key={availableMonth}><td>{monthLabel(availableMonth)}</td><td><span className="badge che">Available</span></td></tr>)}
      </tbody></table></div>
    </section>
  );
}