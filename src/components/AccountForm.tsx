"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { minorToRupeeInput, parseSignedMinorString } from "@/server/lib/money";
import { ApiError, apiRequest, newIdempotencyKey, type FieldErrors } from "./api";

const TYPES = [
  { value: "SAVINGS", label: "Savings" },
  { value: "FD", label: "Deposits (FD)" },
  { value: "MUTUAL_FUND", label: "Mutual Fund" },
  { value: "CREDIT_CARD", label: "Credit Card (debt)" },
  { value: "LOAN", label: "Loan (debt)" },
];

export type EditableAccount = { id: string; name: string; accountType: string; startingBalanceMinor: string; openingDate: string; version: number };

export function AccountForm({ today, existing, onSaved }: { today: string; existing?: EditableAccount; onSaved?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    setErrors({});
    setFormError(null);
    setSaved(null);
    let openingBalanceMinor: string;
    try {
      openingBalanceMinor = parseMinorFromRupees(String(data.get("opening") ?? "0")).toString();
    } catch {
      setErrors({ openingBalance: ["Enter the opening balance in rupees (negative allowed for credit available)."] });
      return;
    }
    const body = {
      name: String(data.get("name") ?? ""),
      accountType: String(data.get("accountType")),
      openingBalanceMinor,
      openingDate: String(data.get("openingDate")),
    };
    start(async () => {
      try {
        if (existing) {
          await apiRequest("PATCH", `/accounts/${existing.id}`, { ...body, expectedVersion: existing.version });
        } else {
          await apiRequest("POST", "/accounts", body, { "Idempotency-Key": key });
          setKey(newIdempotencyKey());
          form.reset();
        }
        setSaved(`${existing ? "Updated" : "Created"} ${body.name}.`);
        router.refresh();
        onSaved?.();
      } catch (error) {
        if (error instanceof ApiError) {
          setErrors(error.fieldErrors);
          setFormError(error.message);
        } else {
          setFormError("Could not save the account. Your entries are still here; try again.");
        }
      }
    });
  }

  const err = (field: string) => (errors[field] ? <span className="error">{errors[field][0]}</span> : null);
  return (
    <form className="panel" noValidate aria-labelledby={`account-title-${existing?.id ?? "new"}`} onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}>
      <h2 id={`account-title-${existing?.id ?? "new"}`}>{existing ? "Edit account" : "Add account"}</h2>
      {existing ? <p className="muted">Starting balance and opening date can only change before the first transaction. Current and monthly balances are maintained automatically.</p> : null}
      {formError ? <div role="alert" className="form-error">{formError}</div> : null}
      {saved ? <div role="status" className="alert info">{saved}</div> : null}
      <div className="form-row">
        <div className="field">
          <label htmlFor={`acc-name-${existing?.id ?? "new"}`}>Name</label>
          <input id={`acc-name-${existing?.id ?? "new"}`} name="name" maxLength={80} defaultValue={existing?.name ?? ""} required />
          {err("name")}
        </div>
        <div className="field">
          <label htmlFor={`acc-type-${existing?.id ?? "new"}`}>Type</label>
          <select id={`acc-type-${existing?.id ?? "new"}`} name="accountType" defaultValue={existing?.accountType ?? "SAVINGS"}>
            {TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
          </select>
          {err("accountType")}
        </div>
        <div className="field">
          <label htmlFor={`acc-open-${existing?.id ?? "new"}`}>Opening balance (₹)</label>
          <input id={`acc-open-${existing?.id ?? "new"}`} name="opening" inputMode="decimal" defaultValue={existing ? minorToRupeeInput(existing.startingBalanceMinor) : "0.00"} />
          {err("openingBalance")}
        </div>
        <div className="field">
          <label htmlFor={`acc-date-${existing?.id ?? "new"}`}>Opening date</label>
          <input id={`acc-date-${existing?.id ?? "new"}`} name="openingDate" type="date" max={today} defaultValue={existing?.openingDate ?? today} required />
          {err("openingDate")}
        </div>
      </div>
      <div>
        <button type="submit" className="primary" disabled={pending}>{pending ? "Saving…" : existing ? "Save changes" : "Add account"}</button>
      </div>
    </form>
  );
}

// Parses signed rupee text (e.g. "-2500.50") into signed paise for the API.
function parseMinorFromRupees(text: string): bigint {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;
  const minor = parseSignedMinorString(`${negative ? "-" : ""}${toMinorDigits(abs)}`, "openingBalance");
  return minor;
}

function toMinorDigits(abs: string): string {
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(abs)) throw new Error("invalid");
  const [whole, fraction = ""] = abs.split(".");
  return (BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2))).toString();
}
