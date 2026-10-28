# Accounts Manager (Phase 1)

Single-user, local-first accounts and budget manager. Next.js 16 (App Router, TypeScript), Prisma 7 with SQLite, Zod validation, Vitest tests. No authentication: this is a loopback-only local service.

## Setup

### Local setup for a new user

Requirements: Node.js 22.12+ (tested on Node 26), npm, and a macOS or Linux shell (use WSL on Windows).

1. Get the workspace and open the `selavu` folder (the app lives there, not at the workspace root):

   ```bash
   cd selavu
   ```

2. Run the setup script. It installs dependencies, creates `.env`, creates `data/`, generates the Prisma client, applies migrations, and seeds the catalog:

   ```bash
   npm run setup
   ```

3. Start the app and open <http://127.0.0.1:3000>:

   ```bash
   npm run dev
   ```

4. Optional checks: `npm run lint`, `npm run typecheck`, `npm test`.

Notes:

- `data/`, `.env`, and `src/generated/` are not committed, so every user gets their own empty local database. Do not share `data/accounts.db`; it holds financial data.
- Months for 2026 are preconfigured. Add later months under **Admin → Months**.
- If port 3000 is busy, run `npx next dev -H 127.0.0.1 -p 3001`.
- Keep `data/` and `.env` on every machine. Never delete or reset a database when pulling updates or restarting.
- `npm run db:catalog:migrate` is only for a database created before the household catalog; a fresh setup does not need it.
- The `prototype` folder is static HTML. Open `prototype/index.html` in a browser; it needs no install.

### Manual setup

```bash
npm install
cp .env.example .env           # optional; default DB is ./data/accounts.db
mkdir -p data
npm run db:generate            # generate the Prisma client (not committed)
npm run db:migrate             # apply migrations (prisma migrate deploy)
npm run db:seed                # seed household/savings catalog + system records (insert-only)
npm run dev                    # http://127.0.0.1:3000
```

Production-style run: `npm run build && npm run start` (binds 127.0.0.1:3000).

### Updating an existing installation

Each machine keeps its own database. Stop **all** app processes using it first (Ctrl+C in the terminal running the app), then run these commands from the project folder on that machine:

```bash
git pull
npm install
npm run upgrade -- --app-stopped
npm run start
```

Keep the same `.env` and `DATABASE_URL`. The script loads `.env`; an already-exported `DATABASE_URL` takes precedence. It prints the absolute database path before proceeding. Check your environment before running it, especially if you have exported a temporary test database URL. By default it uses `data/accounts.db`.

The upgrade command:

1. Refuses a missing database and requires `--app-stopped` to confirm that you stopped every writer. It cannot stop or detect every app process for you.
2. Checks SQLite integrity and foreign keys, then creates a verified, timestamped backup in `backups/` using SQLite's `VACUUM INTO`, including committed WAL data. Backups have owner-only file permissions.
3. Runs `prisma migrate deploy`, never reset or seed, and checks that existing accounts, transactions, postings, budgets, monthly balances, and audit records are unchanged.
4. Automatically restores the backup if migration or verification fails, exits with an error, and retains the backup. Keep the app stopped and investigate before retrying. This check is intentionally strict: migrations that rewrite existing financial records are rejected.
5. On success, generates the Prisma client and builds the app. A build failure does not roll back a successful, verified migration; fix the build before restarting.

**There is no "put data back" step after a successful upgrade.** The migration keeps your data in place. Restoring the pre-upgrade backup would also restore the old schema and disable the new features.

Options:

```bash
npm run upgrade -- --help
npm run upgrade -- --app-stopped --backup-dir /absolute/path/to/private/backups
npm run upgrade -- --app-stopped --skip-build  # migrate only; use npm run dev afterward
```

For recovery only, stop every app process and restore a backup produced by this script:

```bash
npm run upgrade -- --app-stopped --restore /absolute/path/to/backup.db
```

Restoration first backs up the current database, then replaces it with the selected backup. It discards changes made since that backup and restores its schema and migration history. Run compatible application code afterward, or rerun the upgrade before starting the updated app. If either the upgrade or restore reports an automatic-restore failure, do not restart: retain the printed verified backup for manual recovery.

Pulling code or restarting alone never migrates or resets a database. Do not run `prisma migrate reset`, delete `data/`, or reseed as an update step. The savings/loan-interest migration preserves existing financial amounts and adds the new savings classifications and allowed transaction kinds.

### Savings and home loans

- Budget **Savings and Investments / Mutual Funds, Kids Savings Account, Fixed Deposit** each month. Create matching asset accounts, then record **Transfer between accounts** with the corresponding savings category and subcategory. General transfers remain outside provisions.
- The Budget page shows income actually received, all provisions (including savings and card settlement), and income surplus or shortfall. This is received income minus the plan, not your bank balance or an expected-income forecast. Card settlement provisions are additional cash commitments, not additional expense consumption.
- Create **Home Loan** as a **Loan** account with the opening outstanding debt. Record **Loan interest accrual**, from that loan to Expenses, using the lender's actual interest amount. It increases debt and the expense ledger without moving cash or consuming the cash budget.
- Provision **Home and Household Operations / Home-loan** for the instalment, then record **Home-loan payment** from your bank to the loan. The full payment reduces debt and uses that provision; do not also enter it as an ordinary expense. For example, debt of INR 100,000 plus INR 1,000 accrued interest minus INR 5,000 paid leaves INR 96,000 outstanding.
- Interest accrual is manual, not an automatic interest-rate calculation. Ordinary expense charts remain cash/purchase consumption views; loan interest is separately identifiable by transaction kind and in the loan ledger.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | First-time setup for a fresh clone (idempotent) |
| `npm run upgrade -- --app-stopped` | Verified backup, migrate, preserve financial records, and build; automatic recovery on migration failure |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript) |
| `npm test` | Vitest; every suite creates a fresh migrated temp SQLite DB |
| `npm run build` | `prisma generate` + `next build` |
| `npm run db:catalog:migrate` | Migrate existing built-in category history and budgets once; back up data first |

## What is implemented

- **Catalog**: 13 household categories and 68 subcategories plus Savings and Investments with three savings lines. Three protected card-settlement lines remain outside ordinary expenses. `sys_accounts`/`sys_transfer` and system accounts `sys_cash_in_hand`, `sys_income`, and `sys_expense` remain protected. Seeding inserts missing rows only; run the one-time catalog migration to update existing built-in records.
- **Accounts**: user-selectable types are Savings, Deposits (FD), Mutual Fund (assets) and Credit Card, Loan (liabilities; positive = debt, negative = credit available). **Cash In Hand** and **Expense**/**Income** are always-present generic accounts that are not user-selectable types. Cash In Hand is an owned asset; Income and Expense are external endpoints excluded from owned totals. Type is persisted; an asset-to-liability change is rejected once the account has transactions.
- **Account figures** (stored, rebuilt from transactions): starting balance, current balance (per account), and monthly opening and closing balances (per account and month, in the `RunningAccount` snapshot table). Expenses is visible alongside Cash In Hand; its cumulative balance and monthly snapshots are persisted, but it is not an asset and never adds to net worth. Account reads use the stored figures rather than summing expense history. Shown in ₹ with two decimals; stored as integer paise.
- **Transactions** (every expense is a transaction): ordinary expenses are tagged CHE or HYD; CHE is the default. Financial kinds include INCOME, TRANSFER, ATM_WITHDRAWAL, CARD_PAYMENT, and BORROWING. Search, category/subcategory/account/location/type filters, sorting, versioned edit/delete, and filtered CSV export are available. Mutations recompute account balances, monthly running rows, and budget totals atomically.
- **Shared monthly budget**: one BudgetMaster per month. Creation requires an explicit reviewed amount (including 0) for every active household subcategory and each of three separate card-settlement lines. Regular expenses match by month + category + subcategory; card payments match their selected settlement line. CHE/HYD never changes the match. Delete clears detail links and keeps all facts and balances; recreate rematches.
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

- Not yet built: goal tracking, investment valuations, automated loan interest and principal/interest statements, bills and the reminder worker, spreadsheet import, the offline advisor, reconciliation/repair, opening-balance corrections, and budget suggestions. Savings provisions and manual loan interest/payment recording are supported.
- Budget impact applies to ordinary expenses, home-loan payments, savings-classified transfers, and CARD_PAYMENT (separate card-settlement lane). General transfers and noncash loan interest accrual do not consume provisions.
- Refunds, negative expenses, and FD interest are not supported (per your decisions).
- UI styling follows the prototype's white header, teal navigation, pastel summary tiles, compact tables, reports, and responsive spacing. Full visual, WCAG, and responsive browser validation remains outstanding. Account deletion is limited to accounts without history; archive/restore preserves balances. System accounts remain protected.
- Single Node process, SQLite file, no multi-replica support. Writes are serialized per request, not globally across processes.

## Local deployment, backup, and restore

- Keep `DATABASE_URL` pointing at a file outside any public folder. `data/` is gitignored.
- Back up with SQLite's online backup, not a plain copy of the live file while WAL is active, for example `sqlite3 data/accounts.db ".backup 'backups/accounts-YYYYMMDD.db'"`. Restore by stopping the server and copying a backup into place.
