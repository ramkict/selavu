import Link from "next/link";
import { getDb } from "@/server/db";
import { getDashboard } from "@/server/domain/dashboard";
import { getSettings } from "@/server/domain/reference";
import { currentMonthIn, isValidMonth } from "@/server/lib/calendar";
import { formatMinor } from "@/server/lib/money";
import { TopCategoriesChart } from "@/components/TopCategoriesChart";

export const dynamic = "force-dynamic";

const LOCATION_LABEL = { CHE: "Chennai (CHE)", HYD: "Hyderabad (HYD)" } as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const db = await getDb();
  const { month: requested } = await searchParams;
  const data = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const month = requested && isValidMonth(requested) ? requested : currentMonthIn(settings.timezone);
    return getDashboard(tx, month);
  });
  const m = data.metrics;
  const planRows = new Map<string, { name: string; color: string; planned: bigint; actual: bigint }>();
  for (const detail of data.budget?.details ?? []) {
    if (detail.planningClass !== "EXPENSE") continue;
    const row = planRows.get(detail.categoryId) ?? { name: detail.categoryName, color: "#087f77", planned: 0n, actual: 0n };
    row.planned += BigInt(detail.budgetAmountMinor);
    row.actual += BigInt(detail.spendMinor);
    planRows.set(detail.categoryId, row);
  }
  for (const category of data.expensesByCategory) {
    const row = planRows.get(category.categoryId) ?? { name: category.name, color: category.color, planned: 0n, actual: 0n };
    row.name = category.name;
    row.color = category.color;
    row.actual = BigInt(category.minor);
    planRows.set(category.categoryId, row);
  }
  const categories = [...planRows.entries()].map(([id, row]) => ({ id, ...row })).sort((a, b) => a.name.localeCompare(b.name));
  const topCategories = [...data.expensesByCategory].sort((a, b) => Number(BigInt(b.minor) - BigInt(a.minor))).slice(0, 6);
  const isCurrentMonth = data.month === data.today.slice(0, 7);
  const dayOfMonth = Number(data.today.slice(-2));
  const daysInMonth = new Date(Number(data.month.slice(0, 4)), Number(data.month.slice(5)), 0).getDate();
  const projection = isCurrentMonth && dayOfMonth >= 5 && m.expenses.count >= 3
    ? BigInt(m.expenses.minor) * BigInt(daysInMonth) / BigInt(dayOfMonth)
    : null;
  const planned = m.totalProvisioned ? BigInt(m.totalProvisioned.minor) : null;
  const overspent = categories.filter((category) => category.actual > category.planned && category.actual > 0n);

  return (
    <>
      <div className="page-heading"><div><h1>Your month, at a glance</h1><p className="muted">A little clarity for {data.month}. Make room for what matters.</p></div><div className="heading-actions"><Link className="secondary" href={`/budget?month=${data.month}`}>Manage budget</Link><Link className="primary-link" href={`/transactions?month=${data.month}&add=1`}>Add expense</Link></div></div>
      {data.alerts.map((a, i) => (
        <div key={i} className={`alert ${a.level}`} role={a.level === "warning" ? "alert" : undefined}>{a.message}</div>
      ))}

      <section aria-labelledby="kpi-title">
        <h2 id="kpi-title">This month</h2>
        <div className="grid">
          <div className="card income">
            <div className="label">Total income</div>
            <div className="value">{m.totalIncome.formatted}</div>
          </div>
          <div className="card budget">
            <div className="label">Total provisioned</div>
            <div className="value">{data.budget ? formatMinor(BigInt(data.budget.totals.allProvisionedMinor)) : "No budget"}</div>
          </div>
          <div className="card expense">
            <div className="label">Expenses</div>
            <div className="value">{m.expenses.formatted}</div>
          </div>
          <div className="card plan">
            <div className="label">Budget used</div>
            <div className="value">{m.budgetUsed ? m.budgetUsed.formatted : "No budget"}</div>
          </div>
          <div className="card budget">
            <div className="label">Remaining budget</div>
            <div className="value">{m.remaining ? m.remaining.formatted : "No budget"}</div>
          </div>
          <div className="card networth">
            <div className="label">Net worth as of {data.netWorth.asOf}</div>
            <div className="value">{data.netWorth.formatted}</div>
          </div>
          {data.budget ? <div className="card plan"><div className="label">{BigInt(data.budget.totals.incomeBalanceMinor) < 0n ? "Income shortfall" : "Income surplus"}</div><div className="value">{formatMinor(BigInt(data.budget.totals.incomeBalanceMinor) < 0n ? -BigInt(data.budget.totals.incomeBalanceMinor) : BigInt(data.budget.totals.incomeBalanceMinor))}</div></div> : null}
        </div>
        <p className="muted">
          <Link href={`/budget?month=${data.month}`}>Manage budget</Link> · <Link href={`/transactions?month=${data.month}`}>View transactions</Link>
        </p>
      </section>

      <div className="dashboard-layout">
      <section className="panel" aria-labelledby="plan-title">
        <div className="panel-head"><div><h2 id="plan-title">Where your money goes</h2><p>Planned, spent, and still available.</p></div><Link href={`/budget?month=${data.month}`} className="primary-link">View budget</Link></div>
        {!data.budget ? <div className="empty-state">No budget set. Recorded expenses stay visible and unbudgeted. <p><Link href={`/budget/new?month=${data.month}`}>Create a monthly plan</Link></p></div> : categories.length ? <div className="table-wrap"><table className="dashboard-table"><thead><tr><th>Category</th><th className="num">Planned</th><th className="num">Actual</th><th className="num">Remaining</th><th>Budget used</th></tr></thead><tbody>
          {categories.map((category) => {
            const percent = category.planned > 0n ? Number(category.actual * 100n / category.planned) : 0;
            return <tr key={category.id}><td><span className="report-category"><span style={{ backgroundColor: category.color }} />{category.name}</span></td><td className="num">{formatMinor(category.planned)}</td><td className="num">{formatMinor(category.actual)}</td><td className={`num ${category.actual > category.planned ? "negative" : ""}`}>{formatMinor(category.planned - category.actual)}</td><td><div className="usage-cell"><div className="progress"><span style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: category.actual > category.planned ? "var(--coral)" : category.color }} /></div><span>{category.planned > 0n ? `${percent}%` : category.actual ? "Unbudgeted" : "Not planned"}</span></div></td></tr>;
          })}
        </tbody></table></div> : <p className="empty-state">No category allocations are available for this month.</p>}
        <div className="panel-foot"><span>{data.budget ? "Shared plan across both locations." : "Create a plan to compare planned and actual spending."}</span><span>INR</span></div>
      </section>
      <aside className="insights-panel" aria-labelledby="insights-title"><div className="panel-head"><div><h2 id="insights-title">Insights</h2><p>Patterns from recorded activity.</p></div></div>
        <div className="insight-forecast"><span className="muted">Estimated month-end spending</span><strong>{projection === null ? "Not available" : formatMinor(projection)}</strong><span className={`badge ${projection !== null && planned !== null && projection > planned ? "unspec" : "none"}`}>{projection === null ? "Insufficient data" : planned === null ? "No monthly plan" : projection > planned ? `${formatMinor(projection - planned)} above plan` : "Within your plan"}</span></div>
        {overspent.length ? overspent.slice(0, 3).map((category) => <div className="insight-item" key={category.id}><strong>{category.name} is over plan</strong><p>{formatMinor(category.actual - category.planned)} above its allocation.</p></div>) : <div className="insight-item"><strong>{m.expenses.count ? "Keep your plan in view" : "Start with an expense"}</strong><p>{m.expenses.count ? "No category is currently above its planned allocation." : "Record activity to see monthly spending patterns."}</p></div>}
        <div className="insight-footer">Projection uses month-to-date spending extrapolation. It is not financial advice.</div>
      </aside>
      </div>

      <div className="dashboard-columns">
      <section aria-labelledby="loc-title">
        <h2 id="loc-title">Expenses by location</h2>
        <p className="muted">Actual consumption only. Shared plans are not split by location.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Location</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Entries</th></tr>
            </thead>
            <tbody>
              {data.expensesByLocation.map((row) => (
                <tr key={row.code}>
                  <td>{LOCATION_LABEL[row.code]}</td>
                  <td className="num">{row.formatted}</td>
                  <td className="num">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="cat-title">
        <h2 id="cat-title">Top categories</h2>
        {topCategories.length ? <TopCategoriesChart rows={topCategories} /> : <p className="muted">No expenses recorded this month.</p>}
      </section>

      </div>
      <section aria-labelledby="acc-title">
        <h2 id="acc-title">Accounts</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col" className="num">Month opening</th>
                <th scope="col" className="num">Month closing</th>
                <th scope="col" className="num">Live balance</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/accounts/${a.id}?month=${data.month}`}>{a.name}</Link> <span className="muted">{a.isLiability ? "(debt)" : ""}</span></td>
                  <td className="num">{a.monthOpeningMinor ? formatMinor(BigInt(a.monthOpeningMinor)) : "Not opened"}</td>
                  <td className="num">{a.monthClosingMinor ? formatMinor(BigInt(a.monthClosingMinor)) : "—"}</td>
                  <td className="num">{a.liveCurrentFormatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
