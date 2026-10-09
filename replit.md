# PayRadar: MSME Cash-Flow Early Warning

PayRadar predicts when each customer will actually pay, forecasts the bank balance with uncertainty, and ranks which dues to chase and which vendor payments to make first to avoid MSMED Act interest and Section 43B(h) disallowance.

## Run & Operate

- `pnpm --filter @workspace/payradar run dev` — run the PayRadar React/Vite web app.
- `pnpm --filter @workspace/payradar run typecheck` — type-check the PayRadar app.
- `PORT=18955 BASE_PATH=/ pnpm --filter @workspace/payradar run build` — build the web app outside the managed artifact workflow. The artifact config supplies these values during its own build.
- `pnpm run typecheck` — type-check workspace libraries and artifact packages.
- `pnpm run build` — run workspace type-checking, then build packages that define a build script.
- `pnpm --filter @workspace/api-server run dev` — run the separate API scaffold. It currently exposes only `/api/healthz`; PayRadar does not depend on it.
- `pnpm --filter @workspace/db run push` — push the shared Drizzle schema only when intentionally changing it. The current schema defines no tables; this command is not needed to run PayRadar.
- `DATABASE_URL` is required by the shared database package and Drizzle tooling, but not by the PayRadar web app.

## Stack

- pnpm workspace monorepo with TypeScript.
- PayRadar: React, Vite, Wouter routing, and Tailwind CSS with project-specific CSS.
- Separate workspace scaffold: Express 5 API server and a PostgreSQL/Drizzle package.
- The API server currently has a health endpoint only. PayRadar does not use an API or database for ledger calculations.

## Where things live

- `artifacts/payradar/src/App.tsx` — PayRadar shell, routes, dashboard and forms; browser `localStorage` persistence; CSV selection, column mapping, and import UI.
- `artifacts/payradar/src/lib/engine.ts` — source of truth for buyer-behavior fitting, cash simulation, Section 16 interest, Section 43B(h) estimates, action ranking, time-ordered backtesting, CSV parsing/validation, deterministic explanations, and synthetic demo data.
- `artifacts/payradar/src/index.css` — application styling, responsive layout, and visual tokens.
- `artifacts/payradar/.replit-artifact/artifact.toml` — web artifact route, Vite service, and production build configuration.
- `artifacts/api-server/src/routes/health.ts` — the API scaffold’s current `/api/healthz` endpoint; it does not read or write PayRadar data.
- `lib/db/src/schema/index.ts` — shared Drizzle schema entry point. It currently exports no tables.
- `lib/db/src/index.ts` and `lib/db/drizzle.config.ts` — shared PostgreSQL connection and Drizzle tooling; neither is used by the PayRadar UI.

## Architecture decisions

- The PayRadar product is browser-first: CSV parsing, forecasts, rankings, notices, and settings run in the browser. The ledger and settings are saved in browser `localStorage`, not in PostgreSQL.
- Buyer behavior is fit from paid invoice-to-payment durations with a global log-normal prior and per-buyer shrinkage. Open invoices are sampled conditionally on having remained unpaid through their current age.
- The UI runs a seeded 60-day Monte Carlo forecast and displays P10/P50/P90 balances. The seed makes the same inputs reproducible; it does not make the estimate a guarantee.
- Explanations are deterministic strings built from model outputs. There are no LLM/provider calls in PayRadar, and ledger data is not sent to an AI service.
- Statutory outputs are indicative estimates. Section 16 uses a dated Bank Rate table and the engine’s monthly-rest assumptions; Section 43B(h) is a simplified exposure estimate, not a tax filing calculation.

## Product

PayRadar is a cash-flow early-warning decision aid for Indian MSMEs. It includes:

- An overview of open receivables/payables, expected-late amounts, indicative interest and tax exposure, and a 60-day cash outlook.
- Receivables and payables CSV import with automatic header detection, manual column mapping, validation, and invoice-ID-based merging. The opening cash balance is entered separately.
- Buyer-level payment estimates, a ranked collection queue, a P10 cash-buffer check for supplier-payment suggestions, and a buyer-delay what-if scenario.
- Copyable/downloadable payment-notice drafts, a chronological holdout backtest, and editable assumptions with RBI rate-source links.
- A reproducible fictional demo ledger, clearly labeled as synthetic.

## User preferences

- Keep ledger processing local to the browser. Do not add a third-party LLM call or transmit ledger values to another service without explicit user authorization.
- Keep explanations tied to deterministic calculations and clearly label forecasts and statutory figures as estimates.

## Gotchas

- **No PayRadar database is defined or used in this codebase.** `lib/db` is a shared scaffold with an empty Drizzle schema. The API server currently serves health checks only. PayRadar does not store accounts, ledgers, settings, or forecasts in PostgreSQL. A separately provisioned external database was not inspected.
- **Browser storage is local to one browser and origin.** There is no login, cross-device sync, server backup, or recovery if the user clears browser storage.
- **Imports merge by invoice ID.** Incoming IDs replace matching rows; other ledger rows remain. Importing a CSV does not clear the existing ledger.
- **Opening cash is not a CSV import.** It is set separately on the import page.
- **Payments are modeled as open or paid.** `paidDate` determines that state. A `paidAmount` can be imported, but the forecast does not subtract partial payments from an open invoice; use fully paid/open rows for forecasts.
- **Due-date assumptions matter.** A blank agreed-credit-day value defaults to 15 days; entered terms are capped at 45 days by the appointed-day helper. If acceptance date is absent, import validation defaults it to invoice date.
- **The forecast is not a full cash budget.** Open receivables are modeled probabilistically; open payables are placed on their appointed day. Payroll, operating expenses, taxes, financing, bank feeds, and other cash flows are not modeled.
- **Statutory calculations need professional review.** The editable rate table currently covers 5.50% from 2025-12-05 and 5.75% from 2026-10-07. Earlier rate history is not reconstructed, and the status/applicability of the 2026 MSMED amendment is unverified.

## Pointers

- `README.md` — product overview, data handling, limitations, sources, and local run instructions.
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
