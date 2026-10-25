import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { getAccount, listAccountMonths } from "@/server/domain/accounts";
import { listTransactions } from "@/server/domain/transactions";
import { getSettings } from "@/server/domain/reference";
import { currentMonthIn, isValidMonth } from "@/server/lib/calendar";
import { formatMinor } from "@/server/lib/money";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string; page?: string }> };

export default async function AccountDetailPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const data = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const month = query.month && isValidMonth(query.month) ? query.month : currentMonthIn(settings.timezone);
    const [account, months] = await Promise.all([getAccount(tx, id, month), listAccountMonths(tx, id)]);
    const activity = await listTransactions(tx, { month, accountId: id, page: Number(query.page) || 1, pageSize: 25 });
    return { month, account, months, activity };
  }).catch((error: unknown) => {
    if (error && typeof error === "object" && "status" in error && error.status === 404) notFound();
    throw error;
  });
  const account = data.account;

  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">Account activity · {data.month}</p><h1>{account.name}</h1><p className="muted">{account.accountTypeLabel}{account.archivedAt ? " · Archived" : ""}</p></div><Link className="secondary" href={`/accounts?month=${data.month}`}>Back to accounts</Link></div>
      <div className="grid account-detail-metrics">
        <section className="card networth"><div className="label">Current balance</div><div className="value">{account.currentBalanceFormatted}</div><p className="muted">As of {account.balanceAsOf}</p></section>
        <section className="card budget"><div className="label">Month opening</div><div className="value">{account.monthOpeningFormatted ?? "Not opened"}</div><p className="muted">{account.openingDate} opening date</p></section>
        <section className="card plan"><div className="label">Month closing</div><div className="value">{account.monthClosingFormatted ?? "Not available"}</div><p className="muted">Persisted monthly snapshot</p></section>
        <section className="card income"><div className="label">Starting balance</div><div className="value">{account.startingBalanceFormatted}</div><p className="muted">From {account.openingDate}</p></section>
      </div>
      <section className="panel account-months">
        <div className="panel-head"><div><h2>Monthly balances</h2><p>Opening, movement, and closing values are rebuilt from ledger postings.</p></div></div>
        {data.months.length ? <div className="table-wrap"><table><thead><tr><th>Month</th><th className="num">Opening</th><th className="num">Movement</th><th className="num">Closing</th><th>As of</th></tr></thead><tbody>
          {data.months.map((snapshot) => <tr key={snapshot.month}><td><Link href={`/accounts/${id}?month=${snapshot.month}`}>{snapshot.month}</Link></td><td className="num">{snapshot.openingFormatted ?? "—"}</td><td className="num">{formatMinor(BigInt(snapshot.movementMinor))}</td><td className="num">{snapshot.closingFormatted ?? "—"}</td><td>{snapshot.asOfDate ?? "—"}</td></tr>)}
        </tbody></table></div> : <p className="empty-state">No monthly snapshots are available yet.</p>}
      </section>
      <section className="panel account-activity">
        <div className="panel-head"><div><h2>Transactions</h2><p>{data.activity.total} entries in {data.month}</p></div><Link href={`/transactions?month=${data.month}&accountId=${id}`} className="primary-link">View in transactions</Link></div>
        {data.activity.items.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Other account</th><th>Location</th><th className="num">Amount</th></tr></thead><tbody>
          {data.activity.items.map((transaction) => <tr key={transaction.id}><td>{transaction.date}</td><td>{transaction.description}</td><td>{transaction.financialKind?.replaceAll("_", " ") ?? "Expense"}</td><td>{transaction.source.id === id ? transaction.destination.name : transaction.source.name}</td><td>{transaction.expenseLocation ?? "—"}</td><td className="num">{transaction.amountFormatted}</td></tr>)}
        </tbody></table></div> : <p className="empty-state">No transactions for this account in {data.month}.</p>}
      </section>
    </>
  );
}