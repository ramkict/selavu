import { getDb } from "@/server/db";
import { listTransactions } from "@/server/domain/transactions";
import { listAccounts } from "@/server/domain/accounts";
import { listCategories, listPaymentModes, getSettings } from "@/server/domain/reference";
import { currentMonthIn, isValidMonth, todayIn } from "@/server/lib/calendar";
import { AddExpenseForm } from "@/components/AddExpenseForm";
import { TransactionActions, TransactionExport } from "@/components/TransactionTools";
import { EXPENSE_LOCATIONS, FINANCIAL_KINDS } from "@/server/domain/rules";

export const dynamic = "force-dynamic";

type SearchParams = { month?: string; page?: string; search?: string; categoryId?: string; subcategoryId?: string; sourceAccountId?: string; destinationAccountId?: string; accountId?: string; expenseLocation?: string; financialKind?: string; sort?: string; edit?: string; add?: string };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const db = await getDb();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const data = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const month = params.month && isValidMonth(params.month) ? params.month : currentMonthIn(settings.timezone);
    const today = todayIn(settings.timezone);
    const filters = {
      search: params.search,
      categoryId: params.categoryId,
      subcategoryId: params.subcategoryId,
      sourceAccountId: params.sourceAccountId,
      destinationAccountId: params.destinationAccountId,
      accountId: params.accountId,
      expenseLocation: EXPENSE_LOCATIONS.find((location) => location === params.expenseLocation),
      financialKind: FINANCIAL_KINDS.find((kind) => kind === params.financialKind),
      sort: ["date-desc", "date-asc", "amount-desc", "amount-asc"].find((sort) => sort === params.sort) as "date-desc" | "date-asc" | "amount-desc" | "amount-asc" | undefined,
    };
    const [list, accounts, categories, modes] = await Promise.all([
      listTransactions(tx, { month, page, pageSize: 25, ...filters }),
      listAccounts(tx, month),
      listCategories(tx),
      listPaymentModes(tx),
    ]);
    return { month, today, list, accounts, categories, modes };
  });

  const existing = data.list.items.find((item) => item.id === params.edit);
  const sources = data.accounts.filter((a) => a.accountType !== "EXTERNAL_EXPENSE" && (!a.archivedAt || a.id === existing?.source.id));
  const destinations = data.accounts.filter((a) => a.accountType !== "EXTERNAL_INCOME" && (!a.archivedAt || a.id === existing?.destination.id));
  const categories = data.categories.filter((c) => !c.isSystem).map((c) => ({
    id: c.id,
    name: c.name,
    subcategories: c.subcategories.filter((s) => !s.isSystem && (!s.archivedAt || s.id === existing?.subcategory.id)).map((s) => ({ id: s.id, name: s.name })),
  }));
  const defaultDate = data.month === data.today.slice(0, 7) ? data.today : `${data.month}-01`;

  return (
    <>
      <div className="page-heading">
        <div><h1>Transactions</h1><p className="muted">Your spending and account movements · {data.month} · {data.list.total} entries</p></div>
        <div className="heading-actions"><TransactionExport month={data.month} filters={{ search: params.search ?? "", categoryId: params.categoryId ?? "", subcategoryId: params.subcategoryId ?? "", sourceAccountId: params.sourceAccountId ?? "", destinationAccountId: params.destinationAccountId ?? "", accountId: params.accountId ?? "", expenseLocation: params.expenseLocation ?? "", financialKind: params.financialKind ?? "", sort: params.sort ?? "date-desc" }} /></div>
      </div>
      <details className="entry-disclosure" open={!!existing || params.add === "1"}>
        <summary className="primary-link">{existing ? "Editing transaction" : "Add transaction"}</summary>
      <AddExpenseForm
        sourceAccounts={sources}
        destinationAccounts={destinations}
        categories={categories}
        paymentModes={data.modes}
        defaultDate={existing?.date ?? defaultDate}
        maxDate={data.today}
        month={data.month}
        existing={existing}
      />
      </details>
      <section className="panel transaction-panel" aria-labelledby="activity-title">
      <div className="panel-head"><div><h2 id="activity-title">Activity this month</h2><p>{data.list.filteredTotalFormatted} across {data.list.total} matching entries</p></div></div>
      <form className="toolbar transaction-filters" method="get">
        <input type="hidden" name="month" value={data.month} />
        <label className="search"><span className="sr-only">Search descriptions</span><input name="search" defaultValue={params.search ?? ""} placeholder="Search descriptions" /></label>
        <select className="select-control" name="sort" defaultValue={params.sort ?? "date-desc"} aria-label="Sort transactions"><option value="date-desc">Newest first</option><option value="date-asc">Oldest first</option><option value="amount-desc">Highest amount</option><option value="amount-asc">Lowest amount</option></select>
        <div className="filter-group">
          <select className="select-control" name="categoryId" defaultValue={params.categoryId ?? ""} aria-label="Filter category"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="select-control" name="subcategoryId" defaultValue={params.subcategoryId ?? ""} aria-label="Filter subcategory"><option value="">All subcategories</option>{categories.flatMap((category) => category.subcategories.filter(() => !params.categoryId || category.id === params.categoryId).map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{category.name} / {subcategory.name}</option>))}</select>
          <select className="select-control" name="sourceAccountId" defaultValue={params.sourceAccountId ?? ""} aria-label="Filter paid from"><option value="">All source accounts</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select className="select-control" name="destinationAccountId" defaultValue={params.destinationAccountId ?? ""} aria-label="Filter paid to"><option value="">All target accounts</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select className="select-control" name="accountId" defaultValue={params.accountId ?? ""} aria-label="Filter any account"><option value="">Any account</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select className="select-control" name="expenseLocation" defaultValue={params.expenseLocation ?? ""} aria-label="Filter location"><option value="">All locations</option><option value="CHE">Chennai (CHE)</option><option value="HYD">Hyderabad (HYD)</option></select>
          <select className="select-control" name="financialKind" defaultValue={params.financialKind ?? ""} aria-label="Filter type"><option value="">All transaction types</option>{FINANCIAL_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select>
        </div>
        <button type="submit" className="secondary">Apply filters</button>
        <a href={`/transactions?month=${data.month}`} className="filter-reset">Clear</a>
      </form>
      {data.list.items.length === 0 ? <p className="empty-state">{data.list.total ? "No transactions match these filters." : `No transactions recorded for ${data.month}.`}</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col">Category</th>
                <th scope="col">Type</th>
                <th scope="col">Paid from</th>
                <th scope="col">Paid to</th>
                <th scope="col">Location</th>
                <th scope="col">Budget</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.list.items.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.description}</td>
                  <td>{t.subcategory.name}</td>
                  <td>{t.financialKind?.replaceAll("_", " ").toLowerCase() ?? "Expense"}</td>
                  <td>{t.source.name}</td>
                  <td>{t.destination.name}</td>
                  <td>{t.expenseLocation ? <span className={`badge ${t.expenseLocation === "CHE" ? "che" : "hyd"}`}>{t.expenseLocation}</span> : "—"}</td>
                  <td>{t.budgetMatch === "NOT_APPLICABLE" ? "Not applicable" : t.budgetMatch === "MATCHED" ? "Matched" : "Unbudgeted"}</td>
                  <td className="num">{t.amountFormatted}</td>
                  <td><TransactionActions transaction={t} editHref={`/transactions?month=${data.month}&page=${page}&edit=${t.id}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel-foot"><span>Page {data.list.page} of {Math.max(1, Math.ceil(data.list.total / data.list.pageSize))}</span><span className="pagination-actions">{page > 1 ? <a href={pageHref(data.month, params, page - 1)}>Previous</a> : null}{page < Math.ceil(data.list.total / data.list.pageSize) ? <a href={pageHref(data.month, params, page + 1)}>Next</a> : null}</span></div>
      </section>
    </>
  );
}

function pageHref(month: string, params: SearchParams, page: number) {
  const query = new URLSearchParams({ month, page: String(page) });
  for (const key of ["search", "categoryId", "subcategoryId", "sourceAccountId", "destinationAccountId", "accountId", "expenseLocation", "financialKind", "sort"] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  return `/transactions?${query.toString()}`;
}
