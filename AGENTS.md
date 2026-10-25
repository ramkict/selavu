# Project workflow

- Verify with `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- Use `../../prototype` as the visual reference. Reuse its design patterns in React, not its string-template renderer or fictional financial data.
- The default user database is `data/accounts.db`. Never delete `data/` or reset a database for verification. Use an absolute DATABASE_URL pointing to an isolated temporary directory.
- Never remove `.next` while a development server is running. Stop only servers started for the current verification task.
- Account reads use persisted AccountMaster and RunningAccount figures. Expenses is a protected generic ledger, visible in Accounts but excluded from owned assets and net worth.
- Expenses, cash withdrawals, transfers, and card payments have distinct posting rules. Internal account movements must not count as ordinary expense consumption.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
