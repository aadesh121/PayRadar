# PayRadar: MSME Cash-Flow Early Warning

PayRadar predicts when each customer will actually pay, forecasts the bank balance with uncertainty, and ranks which dues to chase and which vendor payments to make first to avoid MSMED Act interest and Section 43B(h) disallowance.

## The problem

- The *Indian SME Receivables Report 2026* by Recordent reported that Indian SMEs take an average of **73 days** to pay invoices. This figure was reported by *The Hindu* on June 28, 2026.
- As of August 14, 2026, MSME Samadhaan data showed **₹20,979 crore** in delayed-payment claims pending, out of ₹55,244 crore in claims filed, according to CRISIL's August 17, 2026 press release.
- Under Section 16 of the MSMED Act, qualifying delayed payments attract compound interest with monthly rests at **three times the RBI Bank Rate**.

These figures describe the broader working-capital problem; they are not inputs to PayRadar's forecasts and do not predict an individual business's experience.

## What it does

- **Import a ledger:** Read receivables and payables CSVs locally, detect common column names, manually map unfamiliar headers, validate rows, and merge them by invoice ID. Enter the opening cash balance separately.
- **Estimate buyer payment behavior:** Fit a log-normal payment-duration model for each buyer, shrink sparse buyer histories toward a global model, and account for open invoices that have not yet paid.
- **Forecast cash with uncertainty:** Run a seeded, 60-day Monte Carlo forecast and show P10/P50/P90 cash balances. Flag dates when more than 20% of paths fall below the user's minimum cash buffer.
- **Prioritize actions:** Rank customer follow-ups and supplier dues using the modeled payment behavior, appointed dates, indicative statutory exposures, and a P10 cash-buffer screen.
- **Run a what-if scenario:** Shift one buyer's expected timing and compare the same seeded forecast without changing ledger records.
- **Review and verify:** Compare the model with a time-ordered 70/30 train/test backtest; edit dated Bank Rate assumptions; and inspect the method and limitations.
- **Prepare a payment notice:** Create a polite or firm draft with an indicative interest annexure, then copy it or download it as a text file. PayRadar does not send the notice.
- **Explore synthetic data:** The reproducible demo includes 160 fictional receivables, 26 fictional payables, eight buyer patterns (including one worsening payer), and six suppliers.

Explanations are deterministic templates populated from local calculation results. There is no LLM call or AI provider integration in this build.

## How the estimates work

- The browser fits buyer payment durations from paid invoices using invoice-date-to-paid-date history. A global log-normal model serves as a prior, with per-buyer estimates shrunk toward it when history is sparse. Open invoices are sampled conditional on already having remained unpaid through their current age.
- The dashboard simulates 480 paths over 60 days with a fixed seed. Open receivables are modeled as uncertain receipts; open payables are scheduled on their modeled appointed day. P10/P50/P90 are simulated percentiles, not confidence guarantees.
- Supplier-payment suggestions use a separate receipt-only P10 path and greedily check whether ranked commitments can fit above the configured buffer by their deadlines. Items outside the 60-day horizon are marked unchecked by that cash screen.
- The Section 16 engine uses a dated Bank Rate table and an **indicative** 3× Bank Rate, monthly-rest calculation with pro-rata accrual between rest dates. The Section 43B(h) estimate is simplified: it uses unpaid status, marked supplier category/registration, appointed day, financial-year end derived from the as-of date, and configured tax rate.
- The current default Bank Rate history is 5.50% effective December 5, 2025 and 5.75% effective October 7, 2026. The app links those entries to RBI notices. Its rate history does not reconstruct dates before December 5, 2025.
- The backtest orders paid invoices by invoice date, trains on the earliest 70%, and tests on the latest 30%. It reports model median absolute error, appointed-day-baseline error, and P10–P90 coverage.

## Data handling and database

PayRadar reads CSV files in the browser and stores the ledger, settings, and rate table in that browser's `localStorage`. It does not send the ledger to a PayRadar API or persist it in PostgreSQL. There is no user account, cloud sync, or server-side recovery; clearing the browser's site data removes the saved ledger.

The workspace includes a PostgreSQL/Drizzle package at `lib/db`, but its checked-in schema currently defines **no tables**, and PayRadar does not call the database package. No user-related data is stored by PayRadar in PostgreSQL in the current code. The separate Express API server currently exposes only `/api/healthz` and is not used by PayRadar's ledger or calculations. I did not inspect a separately provisioned external PostgreSQL instance. `DATABASE_URL` is therefore not required to run the PayRadar web app.

## Limitations and important assumptions

- Forecasts are decision-support estimates, not promises of payment or a complete cash budget. Payroll, operating expenses, taxes payable, financing, bank transactions, and other non-ledger cash flows are not modeled.
- The ledger treats invoices as open or paid. Although `paidAmount` is accepted on receivables, an open invoice is forecast at its full amount; partial collections are not modeled as a remaining balance.
- When agreed credit days are blank, the engine uses 15 days for the appointed-day estimate; entered values are capped at 45 days. When acceptance date is missing, import uses invoice date. Confirm actual delivery/acceptance dates and contractual terms.
- Section 16 interest, Section 43B(h) exposure, and supplier eligibility are simplified estimates. The application does not determine legal eligibility, resolve disputes, or file taxes. Confirm the applicable rules and calculations with an Indian chartered accountant or lawyer before acting.
- The status and applicability of the 2026 MSMED amendment have not been independently verified by this application.
- Demo names, invoices, dates, amounts, and payment history are fictional.

## Run locally

This repository uses pnpm workspaces. From the repository root:

```bash
pnpm install
pnpm --filter @workspace/payradar run dev
```

Run the PayRadar type check and production build with:

```bash
pnpm --filter @workspace/payradar run typecheck
PORT=18955 BASE_PATH=/ pnpm --filter @workspace/payradar run build
```

The root workspace checks are also available:

```bash
pnpm run typecheck
pnpm run build
```

## Project map

- `artifacts/payradar/src/App.tsx` — app routes, UI, CSV import flow, and browser persistence.
- `artifacts/payradar/src/lib/engine.ts` — buyer model, forecast, statutory estimates, action ranking, backtest, CSV validators, templates, and demo ledger.
- `artifacts/payradar/src/index.css` — responsive visual styling.
- `artifacts/payradar/.replit-artifact/artifact.toml` — web artifact workflow and build settings.
- `artifacts/api-server/src/routes/health.ts` — health-only API scaffold.
- `lib/db/src/schema/index.ts` — currently empty Drizzle schema.

## Sources

- [The Hindu, June 28, 2026 — Recordent's *Indian SME Receivables Report 2026* and the 73-day average](https://www.thehindu.com/news/cities/Coimbatore/msmes-continue-to-face-issues-related-to-delayed-payments-finds-a-study/article71158728.ece)
- [CRISIL, August 17, 2026 — pending MSME Samadhaan claims](https://intelligence.crisil.com/en/homepage/newsroom/press-releases/2026/08/executed-well-msme-bill-can-be-an-ibc-moment-for-delayed-payments.html)
- [India Code — MSMED Act, 2006, Section 16](https://www.indiacode.nic.in/show-data?actid=AC_CEN_46_77_00002_200627_1517807324919&orderno=16&sectionId=9898&sectionno=16)
- [RBI notification, December 5, 2025 — Bank Rate revised to 5.50%](https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13208&Mode=0)
- [RBI notification, October 7, 2026 — Bank Rate revised to 5.75%](https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13728&Mode=0)
