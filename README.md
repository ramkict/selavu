# Accounts Manager (Phase 1)

Single-user, local-first accounts and budget manager. Next.js 16 (App Router, TypeScript), Prisma 7 with SQLite, Zod validation, Vitest tests. No authentication: this is a loopback-only local service.

## Setup

Requirements: Node.js 22.12+ (tested on Node 26), npm.

```bash
npm install
cp .env.example .env           # optional; default DB is ./data/accounts.db
npm run db:migrate             # apply migrations (prisma migrate deploy)
npm run db:seed                # seed the 12/77 catalog + system records (idempotent)
npm run dev                    # http://127.0.0.1:3000
```

Production-style run: `npm run build && npm run start` (binds 127.0.0.1:3000).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript) |
| `npm test` | Vitest; every suite creates a fresh migrated temp SQLite DB |
| `npm run build` | `prisma generate` + `next build` |

## What is implemented

- **Catalog**: all 12 categories and 77 subcategories from `cat.json` with exact IDs, names, parents, icons, and colors. Protected system records: `sys_accounts`/`sys_transfer`, and accounts `sys_cash_in_hand`, `sys_income`, and `sys_expense`. Seeding inserts missing rows only and never overwrites edits.
- **Accounts**: user-selectable types are Savings, Deposits (FD), Mutual Fund (assets) and Credit Card, Loan (liabilities; positive = debt, negative = credit available). **Cash In Hand** and **Expense**/**Income** are always-present generic accounts that are not user-selectable types. Cash In Hand is an owned asset; Income and Expense are external endpoints excluded from owned totals. Type is persisted; an asset-to-liability change is rejected once the account has transactions.
- **Account figures** (stored, rebuilt from transactions): starting balance, current balance (per account), and monthly opening and closing balances (per account and month, in the `RunningAccount` snapshot table). Expenses is visible alongside Cash In Hand; its cumulative balance and monthly snapshots are persisted, but it is not an asset and never adds to net worth. Account reads use the stored figures rather than summing expense history. Shown in ₹ with two decimals; stored as integer paise.
- **Transactions** (every expense is a transaction): ordinary expenses are tagged CHE or HYD; CHE is the default. Financial kinds include INCOME, TRANSFER, ATM_WITHDRAWAL, CARD_PAYMENT, and BORROWING. Search, category/subcategory/account/location/type filters, sorting, versioned edit/delete, and filtered CSV export are available. Mutations recompute account balances, monthly running rows, and budget totals atomically.
- **Shared monthly budget**: one BudgetMaster per month. Creation requires an explicit reviewed amount (including 0) for every active subcategory. Regular expenses match by month + category + subcategory; card payments retain a separate settlement lane. CHE/HYD never changes the match. Delete clears detail links and keeps all facts and balances; recreate rematches.
- **Configured months**: the header uses a `MMM-YYYY` dropdown. January through December 2026 are seeded; add future months in Admin before using them for planning and reports.
- **Dashboard and reports**: plan-versus-actual categories, top-category chart, forecast insights, income/expense metrics, location reconciliation, account positions, and net worth as of today. Reports include category variance/mix, daily accumulation, six-month trends, independent CHE/HYD and source-account filters, and CSV export.
- **Account and catalog administration**: account detail includes monthly snapshots and incoming/outgoing activity. Accounts, categories, and subcategories support versioned editing and archival/restoration without deleting historical activity. Subcategory parent reassignment is disabled.
- **Concurrency and safety**: version checks (`expectedVersion` in body, `If-Match` on DELETE, 428 when missing, 409 on stale). `Idempotency-Key` on creates is stored in the same DB transaction and replayed. Host and Origin guard in `src/proxy.ts`. Strict Zod schemas reject unknown fields. Paise as BigInt with CHECK constraints in the migration.

## API (`/api/v1`)

Success: `{ data }`. Errors: `{ error: { code, message, fieldErrors, requestId } }`.

- `GET/POST /transactions` (`GET` supports month, type/kind, category/subcategory, source/destination/account, location, description search, sorting, and pagination)
- `GET/PATCH/DELETE /transactions/:id`
- `GET/POST /accounts?month=`, `GET/PATCH/DELETE /accounts/:id?month=`, `GET /accounts/:id/months`
- `GET/POST /budgets?month=`, `GET/PATCH/DELETE /budgets/:id` (planned amounts may be 0)
- `GET/POST /categories`, `PATCH /categories/:id`, `POST /subcategories`, `PATCH /subcategories/:id`
- `GET/POST /months` (future months are unique and configurable)
- `GET /payment-modes`, `GET /settings`, `GET /dashboard?month=`, `GET /health`

Amounts are integer paise strings (for example `"12550"` for ₹125.50). Dates are `YYYY-MM-DD`.

## Limitations (deliberately out of Phase 1)

- Not yet built: goals, investments, loans with principal/interest breakdowns, bills and the reminder worker, valuations, spreadsheet import, the offline advisor, reconciliation/repair, opening-balance corrections, and budget suggestions.
- Budget impact applies to ordinary expenses and CARD_PAYMENT (separate card-settlement lane). Other financial movements do not consume expense provisions.
- Refunds, negative expenses, and FD interest are not supported (per your decisions).
- UI styling follows the prototype's white header, teal navigation, pastel summary tiles, compact tables, reports, and responsive spacing. Full visual, WCAG, and responsive browser validation remains outstanding. Account deletion is limited to accounts without history; archive/restore preserves balances. System accounts remain protected.
- Single Node process, SQLite file, no multi-replica support. Writes are serialized per request, not globally across processes.

## Local deployment, backup, and restore

- Keep `DATABASE_URL` pointing at a file outside any public folder. `data/` is gitignored.
- Back up with SQLite's online backup, not a plain copy of the live file while WAL is active, for example `sqlite3 data/accounts.db ".backup 'backups/accounts-YYYYMMDD.db'"`. Restore by stopping the server and copying a backup into place.
