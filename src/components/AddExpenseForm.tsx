"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { parseMoneyToMinor } from "@/server/lib/money";
import { ApiError, apiRequest, newIdempotencyKey, type FieldErrors } from "./api";

type Option = { id: string; name: string };
type ExistingTransaction = {
  id: string;
  version: number;
  type: string;
  financialKind: string | null;
  date: string;
  description: string;
  notes: string | null;
  amountMinor: string;
  source: Option & { accountType: string };
  destination: Option & { accountType: string };
  paymentMode: Option | null;
  expenseLocation: string | null;
  categoryId: string;
  subcategory: Option;
  incomeType: string | null;
  incomeSourceLabel: string | null;
  recurring: boolean;
};
type Props = {
  sourceAccounts: (Option & { accountType: string })[];
  destinationAccounts: (Option & { accountType: string })[];
  categories: { id: string; name: string; subcategories: Option[] }[];
  paymentModes: Option[];
  defaultDate: string;
  maxDate: string;
  month?: string;
  existing?: ExistingTransaction;
};

export function AddExpenseForm({ sourceAccounts, destinationAccounts, categories, paymentModes, defaultDate, maxDate, month, existing }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(existing && categories.some((c) => c.id === existing.categoryId) ? existing.categoryId : categories[0]?.id ?? "");
  const subs = categories.find((c) => c.id === categoryId)?.subcategories ?? [];
  const [key, setKey] = useState(newIdempotencyKey());
  const [kind, setKind] = useState(existing?.type === "EXPENSE" ? "EXPENSE" : existing?.financialKind ?? "EXPENSE");
  const expense = kind === "EXPENSE";
  const sources = sourceAccounts.filter((a) => {
    const allowed = kind === "INCOME" ? a.accountType === "EXTERNAL_INCOME"
      : kind === "ATM_WITHDRAWAL" ? a.accountType === "SAVINGS"
        : kind === "CARD_PAYMENT" ? ["SAVINGS", "CASH"].includes(a.accountType)
          : kind === "TRANSFER" ? ["SAVINGS", "CASH", "FD", "MUTUAL_FUND"].includes(a.accountType)
            : kind === "BORROWING" ? ["CREDIT_CARD", "LOAN"].includes(a.accountType)
              : ["SAVINGS", "CASH", "CREDIT_CARD"].includes(a.accountType);
    return allowed || a.id === existing?.source.id;
  });
  const [sourceId, setSourceId] = useState(existing?.source.id ?? "");
  const selectedSource = sources.some((a) => a.id === sourceId) ? sourceId : sources[0]?.id ?? "";
  const destinations = destinationAccounts.filter((a) => {
    const allowed = expense ? a.accountType === "EXTERNAL_EXPENSE"
      : kind === "INCOME" ? ["SAVINGS", "CASH"].includes(a.accountType)
        : kind === "ATM_WITHDRAWAL" ? a.accountType === "CASH"
          : kind === "CARD_PAYMENT" ? a.accountType === "CREDIT_CARD"
            : ["SAVINGS", "CASH", "FD", "MUTUAL_FUND"].includes(a.accountType);
    return a.id !== selectedSource && (allowed || a.id === existing?.destination.id);
  });

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    setErrors({});
    setFormError(null);
    setSaved(null);
    let amountMinor: bigint;
    try {
      amountMinor = parseMoneyToMinor(String(data.get("amount") ?? ""));
    } catch {
      setErrors({ amount: ["Enter an amount in rupees with at most 2 decimals."] });
      return;
    }
    const body = {
      type: expense ? "EXPENSE" : "FINANCIAL",
      financialKind: expense ? null : kind,
      date: String(data.get("date")),
      description: String(data.get("description") ?? ""),
      notes: String(data.get("notes") ?? "").trim() || null,
      amountMinor: amountMinor.toString(),
      sourceAccountId: String(data.get("sourceAccountId")),
      destinationAccountId: String(data.get("destinationAccountId") ?? ""),
      paymentModeId: expense ? String(data.get("paymentModeId") || "") || null : null,
      expenseLocation: expense ? String(data.get("expenseLocation") || "CHE") : null,
      categoryId: expense ? categoryId : "sys_accounts",
      subcategoryId: expense ? String(data.get("subcategoryId") ?? "") : "sys_transfer",
      incomeType: kind === "INCOME" ? String(data.get("incomeType") || "") || null : null,
      incomeSourceLabel: kind === "INCOME" ? String(data.get("incomeSourceLabel") || "") || null : null,
      recurring: kind === "INCOME" && data.get("recurring") === "on",
    };
    start(async () => {
      try {
        if (existing) {
          await apiRequest("PATCH", `/transactions/${existing.id}`, { ...body, expectedVersion: existing.version });
        } else {
          await apiRequest("POST", "/transactions", body, { "Idempotency-Key": key });
        }
        setSaved(`${existing ? "Updated" : "Saved"} ${body.description || "transaction"} for ${formatShort(amountMinor)}.`);
        if (!existing) {
          setKey(newIdempotencyKey());
          form.reset();
          setCategoryId(categories[0]?.id ?? "");
        } else {
          router.push(`/transactions?month=${month ?? body.date.slice(0, 7)}`);
        }
        router.refresh();
      } catch (error) {
        if (error instanceof ApiError) {
          setErrors(error.fieldErrors);
          setFormError(error.message);
        } else {
          setFormError("Could not save. Your entries are still here; try again.");
        }
      }
    });
  }

  const err = (field: string) => (errors[field] ? <span className="error" id={`${field}-error`}>{errors[field][0]}</span> : null);
  const describe = (field: string) => (errors[field] ? { "aria-invalid": true, "aria-describedby": `${field}-error` } : {});

  return (
    <form
      className="panel"
      aria-labelledby="add-expense-title"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      noValidate
    >
      <h2 id="add-expense-title">{existing ? "Edit transaction" : "Add transaction"}</h2>
      <div className="field">
        <label htmlFor="transaction-kind">Transaction type</label>
        <select id="transaction-kind" value={kind} onChange={(e) => { setKind(e.target.value); setSourceId(""); setErrors({}); }}>
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
          <option value="ATM_WITHDRAWAL">Cash withdrawal</option>
          <option value="TRANSFER">Transfer between accounts</option>
          <option value="CARD_PAYMENT">Credit-card payment</option>
          <option value="BORROWING">Borrowing</option>
        </select>
        <small className="muted">{expense ? "Spending is recorded in Expenses and matched against your budget." : "This transaction follows its account-specific posting rules."}</small>
      </div>
      {formError ? <div role="alert" className="form-error">{formError}</div> : null}
      {saved ? <div role="status" className="alert info">{saved}</div> : null}
      <div className="form-row">
        <div className="field">
          <label htmlFor="exp-date">Date</label>
          <input id="exp-date" name="date" type="date" defaultValue={existing?.date ?? defaultDate} max={maxDate} required {...describe("date")} />
          {err("date")}
        </div>
        <div className="field">
          <label htmlFor="exp-amount">Amount (₹)</label>
          <input id="exp-amount" name="amount" inputMode="decimal" defaultValue={existing ? (Number(existing.amountMinor) / 100).toFixed(2) : ""} placeholder="0.00" required {...describe("amount")} />
          {err("amount")}
        </div>
        <div className="field">
          <label htmlFor="exp-desc">Description</label>
          <input id="exp-desc" name="description" defaultValue={existing?.description ?? ""} maxLength={200} required {...describe("description")} />
          {err("description")}
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="exp-source">Paid from</label>
          <select id="exp-source" name="sourceAccountId" required value={selectedSource} onChange={(e) => setSourceId(e.target.value)} {...describe("sourceAccountId")}>
            {sources.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {err("sourceAccountId")}
        </div>
        <div className="field">
          <label htmlFor="exp-destination">Paid to</label>
          <select id="exp-destination" name="destinationAccountId" key={`${kind}-${selectedSource}`} defaultValue={existing?.destination.id} required {...describe("destinationAccountId")}>
            {destinations.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {destinations.length === 0 ? <span className="muted">Create a suitable destination account first.</span> : null}
          {err("destinationAccountId")}
        </div>
        {expense ? <div className="field">
          <label htmlFor="exp-mode">Payment mode</label>
          <select id="exp-mode" name="paymentModeId" required defaultValue={existing?.paymentMode?.id ?? "upi"} {...describe("paymentModeId")}>
            {paymentModes.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {err("paymentModeId")}
        </div> : null}
        {expense ? <div className="field">
          <label htmlFor="exp-location">Expense location</label>
          <select id="exp-location" name="expenseLocation" required defaultValue={existing?.expenseLocation ?? "CHE"} {...describe("expenseLocation")}>
            <option value="CHE">Chennai (CHE)</option>
            <option value="HYD">Hyderabad (HYD)</option>
          </select>
          {err("expenseLocation")}
        </div> : null}
      </div>
      {expense ? <div className="form-row">
        <div className="field">
          <label htmlFor="exp-category">Category</label>
          <select id="exp-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} {...describe("categoryId")}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {err("categoryId")}
        </div>
        <div className="field">
          <label htmlFor="exp-sub">Subcategory</label>
          <select id="exp-sub" name="subcategoryId" key={categoryId} required {...describe("subcategoryId")}>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {err("subcategoryId")}
        </div>
      </div> : null}
      {kind === "INCOME" ? <div className="form-row">
        <div className="field"><label htmlFor="income-type">Income type</label><input id="income-type" name="incomeType" maxLength={40} defaultValue={existing?.incomeType ?? ""} /></div>
        <div className="field"><label htmlFor="income-source-label">Income source</label><input id="income-source-label" name="incomeSourceLabel" maxLength={120} defaultValue={existing?.incomeSourceLabel ?? ""} /></div>
        <label className="field"><span>Recurring income</span><span><input type="checkbox" name="recurring" defaultChecked={existing?.recurring ?? false} /> Mark as recurring</span></label>
      </div> : null}
      <div className="field"><label htmlFor="exp-notes">Notes</label><textarea id="exp-notes" name="notes" maxLength={2000} defaultValue={existing?.notes ?? ""} rows={2} /></div>
      <div>
        <button type="submit" className="primary" disabled={pending || sources.length === 0 || destinations.length === 0}>
          {pending ? "Saving…" : existing ? "Save changes" : "Save transaction"}
        </button>
      </div>
    </form>
  );
}

function formatShort(minor: bigint) {
  return `₹${(Number(minor) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}
