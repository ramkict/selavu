"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { ApiError, apiRequest } from "./api";

export function BudgetActions({ id, month, version }: { id: string; month: string; version: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(`Delete the ${month} budget? Transactions and account balances will remain unchanged.`)) return;
    setError(null);
    start(async () => {
      try {
        await apiRequest("DELETE", `/budgets/${id}`, undefined, { "If-Match": String(version) });
        router.push(`/budget?month=${month}`);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Could not delete the budget.");
      }
    });
  }

  return <div className="budget-actions"><Link href={`/budget/edit?month=${month}`} className="primary-link">Edit planned amounts</Link><button type="button" className="secondary danger" onClick={remove} disabled={pending}><Trash2 size={15} aria-hidden="true" />{pending ? "Deleting…" : "Delete budget"}</button>{error ? <span className="error" role="alert">{error}</span> : null}</div>;
}