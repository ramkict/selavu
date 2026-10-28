import Link from "next/link";
import { getDb } from "@/server/db";
import { getBudgetByMonth } from "@/server/domain/budgets";
import { getSettings } from "@/server/domain/reference";
import { currentMonthIn, isValidMonth } from "@/server/lib/calendar";
import { formatMinor } from "@/server/lib/money";
import { BudgetActions } from "@/components/BudgetActions";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const db = await getDb();
  const { month: requested } = await searchParams;
  const { month, budget } = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const m = requested && isValidMonth(requested) ? requested : currentMonthIn(settings.timezone);
    return { month: m, budget: await getBudgetByMonth(tx, m) };
  });

  if (!budget) {
    return (
      <section aria-labelledby="nobudget">
        <h1 id="nobudget">Budget · {month}</h1>
        <div className="card">
          <p><strong>No budget exists for {month}.</strong></p>
          <p className="muted">Actual transactions for this month still count on the Overview. Create one shared budget to plan provisions.</p>
          <Link href={`/budget/new?month=${month}`} className="primary-link">Create budget</Link>
        </div>
      </section>
    );
  }

  const t = budget.totals;
  const settlementPlanned = BigInt(t.settlementPlannedMinor);
  const incomeBalance = BigInt(t.incomeBalanceMinor);
  return (
    <>
      <div className="page-heading"><div><h1>Budget · {month}</h1><p className="muted">One shared plan for all expense locations.</p></div><BudgetActions id={budget.id} month={month} version={budget.version} /></div>
      <div className="grid">
        <div className="card income"><div className="label">Income received</div><div className="value">{formatMinor(BigInt(t.incomeReceivedMinor))}</div></div>
        <div className="card budget"><div className="label">All provisions</div><div className="value">{formatMinor(BigInt(t.allProvisionedMinor))}</div></div>
        <div className="card plan"><div className="label">{incomeBalance < 0n ? "Income shortfall" : "Income surplus"}</div><div className="value">{formatMinor(incomeBalance < 0n ? -incomeBalance : incomeBalance)}</div></div>
        <div className="card budget"><div className="label">Savings provisioned</div><div className="value">{formatMinor(BigInt(t.savingsPlannedMinor))}</div></div>
        <div className="card"><div className="label">Savings contributed</div><div className="value">{formatMinor(BigInt(t.savingsUsedMinor))}</div></div>
        <div className="card expense"><div className="label">Budget used</div><div className="value">{t.formatted.budgetUsed}</div></div>
        <div className="card plan"><div className="label">Remaining</div><div className="value">{t.formatted.remaining}</div></div>
        <div className="card"><div className="label">Card settlement plan</div><div className="value">{formatMinor(settlementPlanned)}</div></div>
      </div>
      <p className="muted">Version {budget.version}. Expense location does not change budget matching.</p>
      <h2>Subcategories</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Category / subcategory</th>
              <th scope="col">Class</th>
              <th scope="col" className="num">Planned</th>
              <th scope="col" className="num">Used</th>
              <th scope="col" className="num">Balance</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {budget.details.map((d) => (
              <tr key={d.id}>
                <td>{d.categoryName} / {d.subcategoryName}</td>
                <td>{d.planningClass === "CARD_SETTLEMENT" ? "Card settlement" : d.planningClass === "SAVING" ? "Savings and investments" : "Regular spending"}</td>
                <td className="num">{formatMinor(BigInt(d.budgetAmountMinor))}</td>
                <td className="num">{formatMinor(BigInt(d.spendMinor))}</td>
                <td className="num">{formatMinor(BigInt(d.balanceMinor))}</td>
                <td>
                  {d.planningClass === "SAVING" ? <span className="badge none">{BigInt(d.spendMinor) >= BigInt(d.budgetAmountMinor) ? "Funded" : "To contribute"}</span>
                    : d.utilizationBps === null && BigInt(d.spendMinor) > 0n ? <span className="badge unspec">Overspent (zero plan)</span>
                    : d.alert ? <span className="badge unspec">Over threshold</span>
                    : <span className="badge none">OK</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
