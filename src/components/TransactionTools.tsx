"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Download, Pencil, Trash2 } from "lucide-react";
import { ApiError, apiRequest } from "./api";

type TransactionRow = {
  id: string;
  version: number;
  type: string;
  financialKind: string | null;
  date: string;
  description: string;
  amountMinor: string;
  source: { name: string };
  destination: { name: string };
  expenseLocation: string | null;
  budgetMatch: string;
  subcategory: { name: string };
};

type TransactionList = { items: TransactionRow[]; total: number };

export function TransactionActions({ transaction, editHref }: { transaction: TransactionRow; editHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(`Delete “${transaction.description}”? Account balances and budget totals will be recalculated.`)) return;
    setError(null);
    start(async () => {
      try {
        await apiRequest("DELETE", `/transactions/${transaction.id}`, undefined, { "If-Match": String(transaction.version) });
        router.refresh();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Could not delete the transaction.");
      }
    });
  }

  return <>
    <div className="table-action">
      <a className="icon-btn" href={editHref} aria-label={`Edit ${transaction.description}`} title="Edit"><Pencil size={15} aria-hidden="true" /></a>
      <button className="icon-btn danger-icon" type="button" onClick={remove} disabled={pending} aria-label={`Delete ${transaction.description}`} title="Delete"><Trash2 size={15} aria-hidden="true" /></button>
    </div>
    {error ? <span className="error" role="alert">{error}</span> : null}
  </>;
}

export function TransactionExport({ month, filters }: { month: string; filters: Record<string, string> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function exportCsv() {
    setError(null);
    start(async () => {
      try {
        const query = new URLSearchParams({ month, page: "1", pageSize: "100" });
        for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
        const first = await apiRequest<TransactionList>("GET", `/transactions?${query}`);
        const rows = [...first.items];
        for (let page = 2; rows.length < first.total; page++) {
          query.set("page", String(page));
          const next = await apiRequest<TransactionList>("GET", `/transactions?${query}`);
          if (!next.items.length) break;
          rows.push(...next.items);
        }
        const csv = [
          ["Date", "Description", "Category", "Type", "Paid from", "Paid to", "Location", "Budget", "Amount (INR)"],
          ...rows.map((row) => [row.date, row.description, row.subcategory.name, row.financialKind ?? "Expense", row.source.name, row.destination.name, row.expenseLocation ?? "", row.budgetMatch, (Number(row.amountMinor) / 100).toFixed(2)]),
        ].map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `selavu-transactions-${month}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Could not export transactions.");
      }
    });
  }

  return <>
    <button type="button" className="secondary" onClick={exportCsv} disabled={pending}><Download size={16} aria-hidden="true" />{pending ? "Preparing…" : "Export CSV"}</button>
    {error ? <span className="error" role="alert">{error}</span> : null}
  </>;
}