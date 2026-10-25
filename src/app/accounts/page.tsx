import { getDb } from "@/server/db";
import { listAccounts } from "@/server/domain/accounts";
import { AccountForm } from "@/components/AccountForm";
import { AccountActions } from "@/components/AccountActions";
import { getSettings } from "@/server/domain/reference";
import { currentMonthIn, isValidMonth, todayIn } from "@/server/lib/calendar";
import Link from "next/link";

export const dynamic = "force-dynamic";

const MONTH_STATUS_TEXT: Record<string, string> = { NOT_OPENED: "Not opened", UNKNOWN: "Not yet known", OPEN: "" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const db = await getDb();
  const { month: requested } = await searchParams;
  const { month, today, accounts } = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const m = requested && isValidMonth(requested) ? requested : currentMonthIn(settings.timezone);
    return { month: m, today: todayIn(settings.timezone), accounts: await listAccounts(tx, m) };
  });
  const owned = accounts.filter((a) => a.accountType !== "EXTERNAL_INCOME");
  return (
    <>
      <h1>Your accounts</h1>
      <p className="muted">Balances and monthly snapshots · {month} · All amounts in rupees</p>
      <div className="alert info">Cash In Hand and Expenses are always present. Expenses tracks cumulative spending, not an asset, and is excluded from net worth. Credit-card and loan balances show debt.</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Type</th>
              <th scope="col" className="num">Starting balance</th>
              <th scope="col" className="num">Monthly opening</th>
              <th scope="col" className="num">Monthly closing</th>
              <th scope="col" className="num">Current balance</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {owned.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/accounts/${a.id}?month=${month}`}>{a.name}</Link> {a.isProtected ? <span className="badge none">Always present</span> : null} {a.archivedAt ? <span className="badge none">Archived</span> : null}
                </td>
                <td>{a.accountTypeLabel}</td>
                <td className="num">{a.startingBalanceFormatted}<div className="muted">from {a.openingDate}</div></td>
                <td className="num">{a.monthOpeningFormatted ?? MONTH_STATUS_TEXT[a.monthStatus ?? "UNKNOWN"]}</td>
                <td className="num">{a.monthClosingFormatted ?? MONTH_STATUS_TEXT[a.monthStatus ?? "UNKNOWN"]}</td>
                <td className="num">{a.currentBalanceFormatted}{a.balanceNote ? <div className="muted">{a.balanceNote}</div> : null}</td>
                <td>{a.isProtected ? <span className="muted">Protected</span> : <AccountActions account={a} today={today} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Current balance is live as of {today}. Monthly figures are stored per month and rebuilt from transactions.</p>
      <details className="entry-disclosure">
        <summary className="primary-link">Add account</summary>
        <AccountForm today={today} />
      </details>
    </>
  );
}
