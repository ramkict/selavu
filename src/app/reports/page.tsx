import { MapPin, ReceiptText } from "lucide-react";
import { ReportCharts } from "@/components/ReportCharts";
import { ReportExport } from "@/components/ReportExport";
import { getDb } from "@/server/db";
import { getReports } from "@/server/domain/reports";
import { getSettings } from "@/server/domain/reference";
import { currentMonthIn, isValidMonth } from "@/server/lib/calendar";
import { formatMinor } from "@/server/lib/money";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string; sourceAccountId?: string; expenseLocation?: string }> }) {
  const params = await searchParams;
  const db = await getDb();
  const report = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const month = params.month && isValidMonth(params.month) ? params.month : currentMonthIn(settings.timezone);
    const location = params.expenseLocation === "CHE" || params.expenseLocation === "HYD" ? params.expenseLocation : undefined;
    return getReports(tx, month, { sourceAccountId: params.sourceAccountId, expenseLocation: location });
  });
  const actual = BigInt(report.totalMinor);
  const planned = BigInt(report.plannedMinor);

  return (
    <>
      <div className="page-heading">
        <div><h1>Reports</h1><p className="muted">A clearer view of spending patterns for {report.month}.</p></div>
        <ReportExport month={report.month} rows={report.categories} />
      </div>
      <div className="grid report-metrics">
        <section className="card expense"><div className="label">Expenses in view</div><div className="value">{formatMinor(actual)}</div><p className="muted"><ReceiptText size={14} aria-hidden="true" /> {report.totalCount} records</p></section>
        <section className="card budget"><div className="label">Regular spending plan</div><div className="value">{formatMinor(planned)}</div><p className="muted">Workspace-wide plan</p></section>
        <section className="card plan"><div className="label">Plan remaining</div><div className="value">{formatMinor(planned - actual)}</div><p className="muted">Actuals use selected filters</p></section>
        <section className="card income"><div className="label">Locations</div><div className="value">2</div><p className="muted"><MapPin size={14} aria-hidden="true" /> CHE and HYD</p></section>
      </div>
      <form className="report-filters" method="get" aria-label="Report filters">
        <input type="hidden" name="month" value={report.month} />
        <label className="field"><span>Source account</span><select name="sourceAccountId" defaultValue={report.sourceAccountId}>
          <option value="">All accounts</option>
          {report.sourceAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select></label>
        <label className="field"><span>Expense location</span><select name="expenseLocation" defaultValue={report.expenseLocation}>
          <option value="">All locations</option><option value="CHE">Chennai (CHE)</option><option value="HYD">Hyderabad (HYD)</option>
        </select></label>
        <button type="submit" className="primary">Apply filters</button>
        <a className="secondary reset-filter" href={`/reports?month=${report.month}`}>Reset</a>
      </form>
      <ReportCharts report={report} />
      <div className="report-grid report-tables">
        <section aria-labelledby="category-summary-title">
          <div className="section-heading"><div><h2 id="category-summary-title">Category summary</h2><p className="muted">Planned amounts are not split by location or account.</p></div></div>
          {report.categories.length ? <div className="table-wrap"><table><thead><tr><th>Category</th><th className="num">Planned</th><th className="num">Actual</th><th className="num">Remaining</th></tr></thead><tbody>
            {report.categories.map((row) => <tr key={row.id}><td><span className="report-category"><span style={{ backgroundColor: row.color }} />{row.name}</span></td><td className="num">{formatMinor(BigInt(row.plannedMinor))}</td><td className="num">{formatMinor(BigInt(row.actualMinor))}</td><td className="num">{formatMinor(BigInt(row.plannedMinor) - BigInt(row.actualMinor))}</td></tr>)}
          </tbody></table></div> : <p className="empty-state">No expenses match these report filters.</p>}
        </section>
        <section aria-labelledby="location-summary-title">
          <div className="section-heading"><div><h2 id="location-summary-title">Expenses by location</h2><p className="muted">Location totals reconcile to expenses in view.</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>Location</th><th className="num">Entries</th><th className="num">Amount</th></tr></thead><tbody>
            {report.locationTotals.map((row) => <tr key={row.location}><td><span className={`badge ${row.location === "CHE" ? "che" : "hyd"}`}>{row.location === "CHE" ? "Chennai" : "Hyderabad"} · {row.location}</span></td><td className="num">{row.count}</td><td className="num">{formatMinor(BigInt(row.totalMinor))}</td></tr>)}
          </tbody><tfoot><tr><th>Total</th><th className="num">{report.totalCount}</th><th className="num">{formatMinor(actual)}</th></tr></tfoot></table></div>
        </section>
      </div>
    </>
  );
}