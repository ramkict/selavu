"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { parseMoneyToMinor } from "@/server/lib/money";
import { ApiError, apiRequest, newIdempotencyKey, type FieldErrors } from "./api";

const BUDGET_LANES = [
  { value: "EXPENSE", label: "Regular spending" },
  { value: "CARD_SETTLEMENT", label: "Credit-card settlement" },
  { value: "SAVING", label: "Savings and investments" },
] as const;

export type BudgetCategory = {
  id: string;
  name: string;
  subcategories: { id: string; name: string; suggestedPlanningClass: string }[];
};

type Line = { categoryId: string; categoryName: string; subcategoryId: string; subcategoryName: string; planningClass: string; amount: string };

export type ExistingBudget = { id: string; version: number; amounts: Record<string, { rupees: string; planningClass: string }> };

/**
 * Full-page budget creation or edit. Every active subcategory must be reviewed: a blank amount is
 * "not reviewed", while 0 is an explicit zero plan.
 */
export function BudgetForm({ month, categories, existing }: { month: string; categories: BudgetCategory[]; existing?: ExistingBudget }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<Line[]>(() =>
    categories.flatMap((c) =>
      c.subcategories.map((s) => {
        const saved = existing?.amounts[s.id];
        return {
          categoryId: c.id,
          categoryName: c.name,
          subcategoryId: s.id,
          subcategoryName: s.name,
          planningClass: s.suggestedPlanningClass,
          amount: saved?.rupees ?? "0.00",
        };
      }),
    ),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);

  const update = (index: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  function reviewBlanksAsZero() {
    setLines((prev) => prev.map((l) => (l.amount.trim() === "" ? { ...l, amount: "0" } : l)));
  }

  function save() {
    setErrors({});
    setFormError(null);
    const fieldErrors: FieldErrors = {};
    const payload: { categoryId: string; subcategoryId: string; planningClass: string; budgetAmountMinor: string; alertThresholdBps: number }[] = [];
    lines.forEach((l) => {
      const label = `${l.categoryName} / ${l.subcategoryName}`;
      try {
        payload.push({
          categoryId: l.categoryId,
          subcategoryId: l.subcategoryId,
          planningClass: l.planningClass,
          budgetAmountMinor: parseMoneyToMinor(l.amount.trim() || "0", { allowZero: true }).toString(),
          alertThresholdBps: 8000,
        });
      } catch {
        fieldErrors[`${l.categoryId}/${l.subcategoryId}`] = [`Enter a valid amount for ${label}.`];
      }
    });
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError("Please correct the invalid amounts. Zero and blank amounts are allowed.");
      return;
    }
    start(async () => {
      try {
        if (existing) {
          await apiRequest("PATCH", `/budgets/${existing.id}`, { expectedVersion: existing.version, lines: payload });
        } else {
          await apiRequest("POST", "/budgets", { month, lines: payload }, { "Idempotency-Key": key });
        }
        router.push(`/budget?month=${month}`);
        router.refresh();
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && !existing) {
          router.push(`/budget?month=${month}`);
          return;
        }
        if (error instanceof ApiError) {
          setErrors(error.fieldErrors);
          setFormError(error.message);
        } else {
          setFormError("Could not save the budget. Your draft is still here; try again.");
        }
      }
    });
  }

  return (
    <form
      className="panel"
      noValidate
      aria-labelledby="budget-form-title"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h1 id="budget-form-title">{existing ? `Edit planned amounts · ${month}` : `Create budget for ${month}`}</h1>
      <p className="muted">
        One shared budget covers all locations. Zero is valid, including for the entire budget. Blank amounts are saved as zero.
        {existing ? " Saving checks the version, so a concurrent change is reported instead of overwritten." : ""}
      </p>
      {formError ? <div role="alert" className="form-error">{formError}</div> : null}
      <div className="page-actions">
        <button type="button" className="secondary" onClick={reviewBlanksAsZero}>Fill blank lines with zero</button>
        <span className="muted">{lines.length} subcategories · defaults to ₹0.00</span>
      </div>
      <div className="table-wrap">
        <table className="budget-table">
          <caption className="muted" style={{ textAlign: "left" }}>Planned amounts in rupees by subcategory</caption>
          <thead>
            <tr>
              <th scope="col">Subcategory</th>
              <th scope="col">Budget lane</th>
              <th scope="col" className="num">Planned (₹)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const showCategory = index === 0 || lines[index - 1].categoryId !== line.categoryId;
              const key = `${line.categoryId}/${line.subcategoryId}`;
              const amountId = `amt-${line.subcategoryId}`;
              return (
                <tr key={key}>
                  <td>
                    {showCategory ? <strong>{line.categoryName}</strong> : null}
                    {showCategory ? <br /> : null}
                    <label htmlFor={amountId}>{line.subcategoryName}</label>
                  </td>
                  <td>
                    <span className="badge none">{BUDGET_LANES.find((lane) => lane.value === line.planningClass)?.label ?? "Regular spending"}</span>
                  </td>
                  <td className="num">
                    <input
                      id={amountId}
                      inputMode="decimal"
                      value={line.amount}
                      placeholder="0.00"
                      onChange={(e) => update(index, { amount: e.target.value })}
                      aria-invalid={errors[key] ? true : undefined}
                      aria-describedby={errors[key] ? `${amountId}-error` : undefined}
                    />
                    {errors[key] ? <div id={`${amountId}-error`} className="error">{errors[key][0]}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {errors._missing ? <div role="alert" className="form-error">{errors._missing[0]}</div> : null}
      <div className="page-actions">
        <button type="button" className="secondary" onClick={() => router.push(`/budget?month=${month}`)}>Cancel</button>
        <button type="submit" className="primary" disabled={pending}>{pending ? "Saving…" : existing ? "Save planned amounts" : "Save budget"}</button>
      </div>
    </form>
  );
}
