export type VendorCategory = "micro" | "small" | "medium" | "other";

export interface Receivable {
  invoiceId: string;
  buyer: string;
  amount: number;
  invoiceDate: string;
  acceptanceDate: string;
  agreedCreditDays: number | null;
  paidDate: string | null;
  paidAmount: number | null;
}

export interface Payable {
  invoiceId: string;
  vendor: string;
  amount: number;
  invoiceDate: string;
  acceptanceDate: string;
  agreedCreditDays: number | null;
  vendorCategory: VendorCategory;
  udyamRegistered: boolean;
  paidDate: string | null;
}

export interface Ledger {
  receivables: Receivable[];
  payables: Payable[];
}

export interface RateChange {
  effectiveFrom: string;
  bankRatePercent: number;
  note?: string;
  sourceUrl?: string;
}

export interface AppSettings {
  asOfDate: string;
  openingBalance: number;
  minCashBuffer: number;
  taxRate: number;
}

export interface BuyerModel {
  mu: number;
  sigma: number;
  count: number;
}

export interface BehaviorModels {
  global: BuyerModel;
  byBuyer: Record<string, BuyerModel>;
}

export interface ForecastDay {
  day: number;
  date: string;
  p10: number;
  p50: number;
  p90: number;
  shortfallProbability: number;
}

export interface CashForecast {
  days: ForecastDay[];
  shortfallDate: string | null;
  paths: number;
}

export interface DashboardMetrics {
  openReceivables: number;
  openPayables: number;
  expectedLateAmount: number;
  accruedInterest: number;
  exposure43B: number;
  openingBalance: number;
}

export interface ChaseAction {
  invoiceId: string;
  buyer: string;
  amount: number;
  priority: number;
  probabilityLate: number;
  daysOutstanding: number;
  accruedInterest: number;
  expectedPaymentDate: string;
}

export interface PayAction {
  invoiceId: string;
  vendor: string;
  amount: number;
  category: VendorCategory;
  appointedDay: string;
  daysToDeadline: number;
  projectedInterest: number;
  exposure43B: number;
  urgency: number;
  eligibleMse: boolean;
  cashBufferFit: boolean | null;
  p10AtDeadline: number | null;
  recommendedPayDate: string | null;
}

export interface BacktestResult {
  testedInvoices: number;
  modelMaeDays: number;
  dueDateMaeDays: number;
  p10ToP90Coverage: number;
}

export interface ImportResult<T> {
  rows: T[];
  errors: string[];
  warnings: string[];
  headers?: string[];
}

export const DEFAULT_RATES: RateChange[] = [
  {
    effectiveFrom: "2025-12-05",
    bankRatePercent: 5.5,
    note: "RBI notification RBI/2025-26/134; rate revised to 5.50% with immediate effect.",
    sourceUrl: "https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13208&Mode=0",
  },
  {
    effectiveFrom: "2026-10-07",
    bankRatePercent: 5.75,
    note: "RBI notification RBI/2026-27/283; rate revised to 5.75% with immediate effect.",
    sourceUrl: "https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13728&Mode=0",
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  asOfDate: new Date().toISOString().slice(0, 10),
  openingBalance: 4_250_000,
  minCashBuffer: 650_000,
  taxRate: 0.25,
};

const DAY_MS = 86_400_000;
const SHRINKAGE = 3;
const MIN_SIGMA = 0.15;
const Z_10 = -1.2815515655446004;
const Z_90 = 1.2815515655446004;

function utcDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const result = utcDate(date);
  result.setUTCDate(result.getUTCDate() + Math.round(days));
  return isoDate(result);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((utcDate(end).getTime() - utcDate(start).getTime()) / DAY_MS);
}

export function appointedDay(acceptanceDate: string, agreedDays: number | null): string {
  const days = agreedDays == null ? 15 : Math.min(Math.max(0, agreedDays), 45);
  return addDays(acceptanceDate, days);
}

export function bankRateOn(date: string, rates: RateChange[] = DEFAULT_RATES): number {
  const ordered = [...rates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let active = ordered[0];
  for (const rate of ordered) {
    if (rate.effectiveFrom <= date) active = rate;
    else break;
  }
  return active?.bankRatePercent ?? 0;
}

function addCalendarMonth(date: string): string {
  const source = utcDate(date);
  const day = source.getUTCDate();
  source.setUTCDate(1);
  source.setUTCMonth(source.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate();
  source.setUTCDate(Math.min(day, lastDay));
  return isoDate(source);
}

/**
 * Indicative Section 16 calculation: 3x the dated Bank Rate with monthly rests
 * and pro-rata accrual between rests. This is an implementation assumption,
 * not a legal opinion; have an Indian CA verify it before relying on figures.
 */
export function section16Interest(
  principal: number,
  appointed: string,
  until: string,
  rates: RateChange[] = DEFAULT_RATES,
): number {
  if (principal <= 0 || until <= appointed) return 0;
  const ordered = [...rates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let balance = principal;
  let current = appointed;
  let restDate = addCalendarMonth(appointed);
  let interestInRestPeriod = 0;

  while (current < until) {
    const nextRateDate = ordered.find((rate) => rate.effectiveFrom > current)?.effectiveFrom;
    let next = until;
    if (restDate < next) next = restDate;
    if (nextRateDate && nextRateDate < next) next = nextRateDate;

    const days = daysBetween(current, next);
    if (days > 0) {
      const annualRate = (3 * bankRateOn(current, ordered)) / 100;
      interestInRestPeriod += balance * (annualRate / 12) * (days / 30);
    }
    current = next;
    if (current === restDate) {
      balance += interestInRestPeriod;
      interestInRestPeriod = 0;
      restDate = addCalendarMonth(restDate);
    }
  }

  return Math.round((balance + interestInRestPeriod - principal) * 100) / 100;
}

export function isMseEligible(payable: Payable): boolean {
  return payable.udyamRegistered && (payable.vendorCategory === "micro" || payable.vendorCategory === "small");
}

export function exposure43B(
  payable: Payable,
  financialYearEnd: string,
  taxRate: number,
): number {
  if (!isMseEligible(payable) || payable.paidDate) return 0;
  const deadline = appointedDay(payable.acceptanceDate, payable.agreedCreditDays);
  return deadline <= financialYearEnd ? payable.amount * taxRate : 0;
}

export function nextFinancialYearEnd(asOfDate: string): string {
  const year = Number(asOfDate.slice(0, 4));
  const month = Number(asOfDate.slice(5, 7));
  const currentYearEnd = month <= 3 ? `${year}-03-31` : `${year + 1}-03-31`;
  return currentYearEnd;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values: number[], center = mean(values)): number {
  if (values.length < 2) return MIN_SIGMA;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

export function fitBehavior(receivables: Receivable[]): BehaviorModels {
  const paid = receivables
    .filter((invoice) => invoice.paidDate)
    .map((invoice) => ({
      buyer: invoice.buyer,
      logDays: Math.log(Math.max(1, daysBetween(invoice.invoiceDate, invoice.paidDate!))),
    }));

  if (paid.length === 0) {
    const prior = { mu: Math.log(45), sigma: 0.55, count: 0 };
    return { global: prior, byBuyer: {} };
  }

  const globalMu = mean(paid.map((item) => item.logDays));
  const globalSigma = Math.max(MIN_SIGMA, standardDeviation(paid.map((item) => item.logDays), globalMu));
  const grouped = new Map<string, number[]>();
  for (const row of paid) {
    grouped.set(row.buyer, [...(grouped.get(row.buyer) ?? []), row.logDays]);
  }

  const byBuyer: Record<string, BuyerModel> = {};
  for (const [buyer, observations] of grouped) {
    const n = observations.length;
    const buyerMu = mean(observations);
    const buyerSigma = standardDeviation(observations, buyerMu);
    byBuyer[buyer] = {
      mu: (n * buyerMu + SHRINKAGE * globalMu) / (n + SHRINKAGE),
      sigma: Math.max(MIN_SIGMA, (n * buyerSigma + SHRINKAGE * globalSigma) / (n + SHRINKAGE)),
      count: n,
    };
  }

  return {
    global: { mu: globalMu, sigma: globalSigma, count: paid.length },
    byBuyer,
  };
}

export function modelForBuyer(models: BehaviorModels, buyer: string): BuyerModel {
  return models.byBuyer[buyer] ?? models.global;
}

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const value = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * value);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-value * value);
  return 0.5 * (1 + sign * erf);
}

function inverseNormalCdf(p: number): number {
  const probability = Math.min(1 - 1e-12, Math.max(1e-12, p));
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;

  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function sampleTruncatedPaymentDays(model: BuyerModel, ageDays: number, random: () => number): number {
  const lower = Math.log(Math.max(1, ageDays));
  const lowerProbability = normalCdf((lower - model.mu) / model.sigma);
  const p = lowerProbability + random() * (1 - lowerProbability);
  return Math.exp(model.mu + model.sigma * inverseNormalCdf(p));
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function adjustedModel(model: BuyerModel, delayDays: number): BuyerModel {
  if (!delayDays) return model;
  const meanDays = Math.exp(model.mu + model.sigma ** 2 / 2);
  return { ...model, mu: model.mu + Math.log(Math.max(1, meanDays + delayDays) / meanDays) };
}

function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const ratio = index - lowerIndex;
  return sorted[lowerIndex] * (1 - ratio) + sorted[upperIndex] * ratio;
}

export function forecastCash(
  ledger: Ledger,
  settings: AppSettings,
  rates: RateChange[] = DEFAULT_RATES,
  options: { horizonDays?: number; paths?: number; seed?: number; whatIfBuyer?: string; delayDays?: number } = {},
): CashForecast {
  const horizonDays = options.horizonDays ?? 60;
  const pathCount = options.paths ?? 800;
  const random = createRandom(options.seed ?? 731_992);
  const models = fitBehavior(ledger.receivables);
  const pathBalances: number[][] = Array.from({ length: horizonDays + 1 }, () => []);
  const openReceivables = ledger.receivables.filter((invoice) => !invoice.paidDate);
  const openPayables = ledger.payables.filter((invoice) => !invoice.paidDate);

  for (let path = 0; path < pathCount; path += 1) {
    const receipts = new Array<number>(horizonDays + 1).fill(0);
    for (const invoice of openReceivables) {
      let model = modelForBuyer(models, invoice.buyer);
      if (options.whatIfBuyer === invoice.buyer) model = adjustedModel(model, options.delayDays ?? 0);
      const age = Math.max(1, daysBetween(invoice.invoiceDate, settings.asOfDate));
      const totalDays = sampleTruncatedPaymentDays(model, age, random);
      const paymentDate = addDays(invoice.invoiceDate, Math.ceil(totalDays));
      const dayIndex = Math.max(1, daysBetween(settings.asOfDate, paymentDate));
      if (dayIndex <= horizonDays) receipts[dayIndex] += invoice.amount;
    }

    const payments = new Array<number>(horizonDays + 1).fill(0);
    for (const invoice of openPayables) {
      const deadline = appointedDay(invoice.acceptanceDate, invoice.agreedCreditDays);
      const dayIndex = Math.max(1, daysBetween(settings.asOfDate, deadline));
      if (dayIndex <= horizonDays) payments[dayIndex] += invoice.amount;
    }

    let balance = settings.openingBalance;
    pathBalances[0].push(balance);
    for (let day = 1; day <= horizonDays; day += 1) {
      balance += receipts[day] - payments[day];
      pathBalances[day].push(balance);
    }
  }

  const days: ForecastDay[] = pathBalances.map((balances, day) => ({
    day,
    date: addDays(settings.asOfDate, day),
    p10: quantile(balances, 0.1),
    p50: quantile(balances, 0.5),
    p90: quantile(balances, 0.9),
    shortfallProbability: balances.filter((balance) => balance < settings.minCashBuffer).length / pathCount,
  }));
  const firstRiskDay = days.find((day) => day.day > 0 && day.shortfallProbability > 0.2);
  return { days, shortfallDate: firstRiskDay?.date ?? null, paths: pathCount };
}

function conditionalLateProbability(invoice: Receivable, model: BuyerModel, asOfDate: string): number {
  const age = Math.max(1, daysBetween(invoice.invoiceDate, asOfDate));
  const deadline = appointedDay(invoice.acceptanceDate, invoice.agreedCreditDays);
  const daysToDue = daysBetween(invoice.invoiceDate, deadline);
  if (daysToDue <= age) return 1;
  const censoredTail = Math.max(1e-9, 1 - normalCdf((Math.log(age) - model.mu) / model.sigma));
  const dueTail = Math.max(0, 1 - normalCdf((Math.log(Math.max(1, daysToDue)) - model.mu) / model.sigma));
  return Math.min(1, dueTail / censoredTail);
}

export function dashboardMetrics(
  ledger: Ledger,
  settings: AppSettings,
  rates: RateChange[] = DEFAULT_RATES,
): DashboardMetrics {
  const models = fitBehavior(ledger.receivables);
  const openReceivables = ledger.receivables.filter((invoice) => !invoice.paidDate);
  const openPayables = ledger.payables.filter((invoice) => !invoice.paidDate);
  const financialYearEnd = nextFinancialYearEnd(settings.asOfDate);
  return {
    openReceivables: openReceivables.reduce((total, invoice) => total + invoice.amount, 0),
    openPayables: openPayables.reduce((total, invoice) => total + invoice.amount, 0),
    expectedLateAmount: openReceivables.reduce(
      (total, invoice) => total + invoice.amount * conditionalLateProbability(invoice, modelForBuyer(models, invoice.buyer), settings.asOfDate),
      0,
    ),
    accruedInterest: openPayables.reduce((total, invoice) => {
      const deadline = appointedDay(invoice.acceptanceDate, invoice.agreedCreditDays);
      return total + section16Interest(invoice.amount, deadline, settings.asOfDate, rates);
    }, 0),
    exposure43B: openPayables.reduce((total, invoice) => total + exposure43B(invoice, financialYearEnd, settings.taxRate), 0),
    openingBalance: settings.openingBalance,
  };
}

export function rankActions(
  ledger: Ledger,
  settings: AppSettings,
  rates: RateChange[] = DEFAULT_RATES,
): { chase: ChaseAction[]; pay: PayAction[] } {
  const models = fitBehavior(ledger.receivables);
  const horizonDate = addDays(settings.asOfDate, 60);
  const financialYearEnd = nextFinancialYearEnd(settings.asOfDate);
  const chase = ledger.receivables
    .filter((invoice) => !invoice.paidDate)
    .map((invoice) => {
      const model = modelForBuyer(models, invoice.buyer);
      const probabilityLate = conditionalLateProbability(invoice, model, settings.asOfDate);
      const deadline = appointedDay(invoice.acceptanceDate, invoice.agreedCreditDays);
      const accruedInterest = section16Interest(invoice.amount, deadline, settings.asOfDate, rates);
      const cutoffDays = Math.max(1, daysBetween(invoice.invoiceDate, horizonDate));
      const age = Math.max(1, daysBetween(invoice.invoiceDate, settings.asOfDate));
      const survivalAtAge = Math.max(1e-9, 1 - normalCdf((Math.log(age) - model.mu) / model.sigma));
      const survivalAtHorizon = Math.max(0, 1 - normalCdf((Math.log(cutoffDays) - model.mu) / model.sigma));
      const beyondHorizon = survivalAtHorizon / survivalAtAge;
      const probabilityAtAge = normalCdf((Math.log(age) - model.mu) / model.sigma);
      const conditionalMedianDays = Math.exp(
        model.mu +
          model.sigma *
            inverseNormalCdf(probabilityAtAge + 0.5 * (1 - probabilityAtAge)),
      );
      return {
        invoiceId: invoice.invoiceId,
        buyer: invoice.buyer,
        amount: invoice.amount,
        priority: invoice.amount * beyondHorizon * (1 + accruedInterest / Math.max(invoice.amount, 1)),
        probabilityLate,
        daysOutstanding: Math.max(0, daysBetween(invoice.invoiceDate, settings.asOfDate)),
        accruedInterest,
        expectedPaymentDate: addDays(invoice.invoiceDate, Math.ceil(Math.max(age, conditionalMedianDays))),
      };
    })
    .sort((a, b) => b.priority - a.priority);

  const rankedPay = ledger.payables
    .filter((invoice) => !invoice.paidDate)
    .map((invoice) => {
      const deadline = appointedDay(invoice.acceptanceDate, invoice.agreedCreditDays);
      const eligibleMse = isMseEligible(invoice);
      const daysToDeadline = Math.max(0, daysBetween(settings.asOfDate, deadline));
      const interestUntil = addDays(deadline > settings.asOfDate ? deadline : settings.asOfDate, 30);
      const projectedInterest = section16Interest(invoice.amount, deadline, interestUntil, rates);
      const taxExposure = exposure43B(invoice, financialYearEnd, settings.taxRate);
      const costOfMissing = (eligibleMse ? taxExposure : 0) + projectedInterest;
      return {
        invoiceId: invoice.invoiceId,
        vendor: invoice.vendor,
        amount: invoice.amount,
        category: invoice.vendorCategory,
        appointedDay: deadline,
        daysToDeadline,
        projectedInterest,
        exposure43B: taxExposure,
        urgency: costOfMissing / Math.max(daysToDeadline, 1),
        eligibleMse,
        cashBufferFit: null,
        p10AtDeadline: null,
        recommendedPayDate: null,
      };
    })
    .sort((a, b) => b.urgency - a.urgency);

  const receiptsOnly = forecastCash(
    { receivables: ledger.receivables, payables: [] },
    settings,
    rates,
    { horizonDays: 60, paths: 480, seed: 731_992 },
  );
  const scheduled: Array<{ day: number; amount: number }> = [];
  const pay = rankedPay.map((action) => {
    if (action.daysToDeadline > 60) {
      return { ...action, cashBufferFit: null, p10AtDeadline: null, recommendedPayDate: action.appointedDay };
    }
    const day = Math.max(1, action.daysToDeadline);
    const priorPayments = scheduled
      .filter((item) => item.day <= day)
      .reduce((total, item) => total + item.amount, 0);
    const p10AtDeadline = receiptsOnly.days[day].p10 - priorPayments;
    const fitsBuffer = p10AtDeadline - action.amount >= settings.minCashBuffer;
    if (fitsBuffer) scheduled.push({ day, amount: action.amount });
    return {
      ...action,
      cashBufferFit: fitsBuffer,
      p10AtDeadline,
      recommendedPayDate: fitsBuffer ? addDays(settings.asOfDate, day) : null,
    };
  });

  return { chase, pay };
}

export function backtest(receivables: Receivable[]): BacktestResult {
  const paid = receivables
    .filter((invoice) => invoice.paidDate)
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  const split = Math.floor(paid.length * 0.7);
  const training = paid.slice(0, split);
  const testing = paid.slice(split);
  if (training.length < 2 || testing.length === 0) {
    return { testedInvoices: 0, modelMaeDays: 0, dueDateMaeDays: 0, p10ToP90Coverage: 0 };
  }
  const models = fitBehavior(training);
  let modelError = 0;
  let dueError = 0;
  let covered = 0;
  for (const invoice of testing) {
    const actual = Math.max(1, daysBetween(invoice.invoiceDate, invoice.paidDate!));
    const model = modelForBuyer(models, invoice.buyer);
    const predicted = Math.exp(model.mu);
    const baseline = Math.max(1, daysBetween(invoice.invoiceDate, appointedDay(invoice.acceptanceDate, invoice.agreedCreditDays)));
    modelError += Math.abs(actual - predicted);
    dueError += Math.abs(actual - baseline);
    if (actual >= Math.exp(model.mu + Z_10 * model.sigma) && actual <= Math.exp(model.mu + Z_90 * model.sigma)) covered += 1;
  }
  return {
    testedInvoices: testing.length,
    modelMaeDays: modelError / testing.length,
    dueDateMaeDays: dueError / testing.length,
    p10ToP90Coverage: covered / testing.length,
  };
}

export function explainChaseAction(action: ChaseAction): string {
  const latePercent = Math.round(action.probabilityLate * 100);
  const interest = action.accruedInterest > 0 ? ` Indicative accrued interest is ₹${Math.round(action.accruedInterest).toLocaleString("en-IN")}.` : "";
  return `${action.buyer} has ₹${Math.round(action.amount).toLocaleString("en-IN")} outstanding on ${action.invoiceId}. Based on the available payment history, the model estimates a ${latePercent}% chance this invoice pays after its appointed day; the estimated payment window centers around ${action.expectedPaymentDate}.${interest} This is a prioritization estimate, not a promise of payment.`;
}

export function explainPayAction(action: PayAction): string {
  if (!action.eligibleMse) {
    return `${action.vendor} has ₹${Math.round(action.amount).toLocaleString("en-IN")} due by ${action.appointedDay}. The vendor is not marked as a registered micro or small supplier, so this record is not treated as eligible for the modeled MSMED or Section 43B(h) exposures. Verify supplier classification before relying on this result.`;
  }
  return `${action.vendor} is marked as a registered ${action.category} supplier. ₹${Math.round(action.amount).toLocaleString("en-IN")} is due by ${action.appointedDay}; the indicative Section 43B(h) exposure is ₹${Math.round(action.exposure43B).toLocaleString("en-IN")} and modeled interest is ₹${Math.round(action.projectedInterest).toLocaleString("en-IN")}. Prioritize against the available cash buffer and have the statutory treatment verified.`;
}

export function draftNotice(
  invoice: Receivable,
  interest: number,
  tone: "polite" | "firm",
): string {
  const greeting = tone === "polite" ? "We hope you are well." : "We request your immediate attention to this overdue amount.";
  const ask = tone === "polite"
    ? "Could you please confirm the expected payment date?"
    : "Please arrange payment promptly and confirm the remittance date.";
  return `Subject: Payment status request — invoice ${invoice.invoiceId}\n\nDear ${invoice.buyer},\n\n${greeting} Our records show an outstanding balance of ₹${Math.round(invoice.amount).toLocaleString("en-IN")} for invoice ${invoice.invoiceId}, dated ${invoice.invoiceDate}. ${ask}\n\nIndicative interest annexure: ₹${Math.round(interest).toLocaleString("en-IN")} as of the calculation date, based on the assumptions shown in PayRadar. Please verify the applicable contract terms and statutory calculation before sending.\n\nThis is a draft for review, not legal or tax advice.`;
}

function seededRandom(seed: number): () => number {
  const uniform = createRandom(seed);
  return () => Math.max(1e-12, uniform());
}

function syntheticLedger(asOfDate: string): Ledger {
  const random = seededRandom(20261007);
  const buyers = [
    { name: "Aruna Components", median: 25, sigma: 0.24 },
    { name: "Bluepeak Retail", median: 34, sigma: 0.3 },
    { name: "Cedar Systems", median: 42, sigma: 0.28 },
    { name: "Delta Auto", median: 57, sigma: 0.35 },
    { name: "Eastline Foods", median: 73, sigma: 0.32 },
    { name: "Forma Packaging", median: 49, sigma: 0.25 },
    { name: "Grove Pharma", median: 31, sigma: 0.29 },
    { name: "Helio Networks", median: 93, sigma: 0.38 },
  ];
  const receivables: Receivable[] = [];
  const invoiceCount = 160;
  for (let i = 0; i < invoiceCount; i += 1) {
    const buyerIndex = i % buyers.length;
    const buyer = buyers[buyerIndex];
    const buyerInvoiceNumber = Math.floor(i / buyers.length);
    const ageDays = Math.max(5, 365 - Math.floor((i * 360) / (invoiceCount - 1)) + Math.floor(random() * 15) - 7);
    const invoiceDate = addDays(asOfDate, -ageDays);
    const acceptanceDate = addDays(invoiceDate, 4);
    const agreedCreditDays = [30, 45, null, 60][i % 4];
    const u1 = random();
    const u2 = random();
    const worseningMultiplier = buyerIndex === 4 ? 1 + buyerInvoiceNumber * 0.055 : 1;
    const totalDays = Math.exp(
      Math.log(buyer.median * worseningMultiplier) +
        buyer.sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2),
    );
    const actualPaymentDate = addDays(invoiceDate, Math.max(1, Math.round(totalDays)));
    const amount = Math.round((22_000 + random() * 425_000) / 100) * 100;
    const isPaid = actualPaymentDate <= asOfDate;
    receivables.push({
      invoiceId: `REC-${String(i + 1).padStart(4, "0")}`,
      buyer: buyer.name,
      amount,
      invoiceDate,
      acceptanceDate,
      agreedCreditDays,
      paidDate: isPaid ? actualPaymentDate : null,
      paidAmount: isPaid ? amount : null,
    });
  }

  const vendors = [
    { name: "Mango Precision Works", category: "micro" as const, registered: true },
    { name: "Northstar Components", category: "small" as const, registered: true },
    { name: "Prism Industrial Supply", category: "small" as const, registered: true },
    { name: "Quarry Office Systems", category: "medium" as const, registered: true },
    { name: "Riverbend Logistics", category: "other" as const, registered: false },
    { name: "Sunfield Tooling", category: "micro" as const, registered: true },
  ];
  const payables: Payable[] = Array.from({ length: 26 }, (_, i) => {
    const vendor = vendors[i % vendors.length];
    const invoiceDate = addDays(asOfDate, -45 + Math.floor(random() * 55));
    const acceptanceDate = addDays(invoiceDate, 3);
    const agreedCreditDays = [30, 45, null, 20][i % 4];
    const amount = Math.round((18_000 + random() * 255_000) / 100) * 100;
    const deadline = appointedDay(acceptanceDate, agreedCreditDays);
    const paidDate = deadline < asOfDate && random() < 0.35 ? addDays(deadline, 2 + Math.floor(random() * 9)) : null;
    return {
      invoiceId: `PAY-${String(i + 1).padStart(3, "0")}`,
      vendor: vendor.name,
      amount,
      invoiceDate,
      acceptanceDate,
      agreedCreditDays,
      vendorCategory: vendor.category,
      udyamRegistered: vendor.registered,
      paidDate,
    };
  });
  return { receivables, payables };
}

export function generateDemoLedger(asOfDate: string): Ledger {
  return syntheticLedger(asOfDate);
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted && char === '"' && source[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      row.push(cell.trim());
      if (row.some((entry) => entry !== "")) matrix.push(row);
      row = [];
      cell = "";
      if (char === "\r" && source[i + 1] === "\n") i += 1;
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((entry) => entry !== "")) matrix.push(row);
  const headers = (matrix.shift() ?? []).map((header) => header.trim());
  return {
    headers,
    rows: matrix.map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    ),
  };
}

const COLUMN_ALIASES: Record<string, string[]> = {
  invoiceId: ["invoice_id", "invoiceid", "invoice", "bill_no", "bill_number"],
  buyer: ["buyer", "customer", "customer_name", "party", "party_name", "debtor"],
  vendor: ["vendor", "supplier", "supplier_name", "vendor_name", "creditor"],
  amount: ["amount", "invoice_amount", "total", "total_amount", "value"],
  invoiceDate: ["invoice_date", "invoicedate", "bill_date", "date"],
  acceptanceDate: ["acceptance_date", "acceptancedate", "accepted_date", "delivery_date"],
  agreedCreditDays: ["agreed_credit_days", "credit_days", "payment_terms_days", "terms_days"],
  paidDate: ["paid_date", "payment_date", "paiddate", "date_paid"],
  paidAmount: ["paid_amount", "amount_paid", "received_amount"],
  vendorCategory: ["vendor_category", "category", "supplier_category", "msme_category"],
  udyamRegistered: ["udyam_registered", "udyam", "registered", "is_registered"],
};

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fieldValue(row: Record<string, string>, field: string, mapping: Record<string, string> = {}): string {
  const mapped = mapping[field];
  if (mapped && Object.prototype.hasOwnProperty.call(row, mapped)) return row[mapped].trim();
  const aliases = COLUMN_ALIASES[field] ?? [field];
  const keys = Object.keys(row);
  const match = keys.find((key) =>
    aliases.some((alias) => normalizedHeader(key) === normalizedHeader(alias)),
  );
  return match ? row[match].trim() : "";
}

function hasMappedColumn(headers: string[], field: string, mapping: Record<string, string>): boolean {
  if (mapping[field] && headers.includes(mapping[field])) return true;
  return headers.some((header) =>
    (COLUMN_ALIASES[field] ?? [field]).some((alias) => normalizedHeader(header) === normalizedHeader(alias)),
  );
}

function parseMoney(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[₹,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalDays(value: string): number | null | "invalid" {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : "invalid";
}

function parseIsoDate(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : isoDate(parsed);
}

export function parseReceivablesCsv(text: string, mapping: Record<string, string> = {}): ImportResult<Receivable> {
  const parsed = parseCsv(text);
  const errors: string[] = [];
  const warnings: string[] = [];
  const required = ["buyer", "amount", "invoiceDate"];
  const missing = required.filter((field) => !hasMappedColumn(parsed.headers, field, mapping));
  if (missing.length) return { rows: [], errors: [`Missing required column(s): ${missing.join(", ")}.`], warnings, headers: parsed.headers };

  const rows: Receivable[] = [];
  const seen = new Set<string>();
  parsed.rows.forEach((row, index) => {
    const line = index + 2;
    const invoiceId = fieldValue(row, "invoiceId", mapping) || `REC-IMPORT-${line}`;
    const buyer = fieldValue(row, "buyer", mapping);
    const amount = parseMoney(fieldValue(row, "amount", mapping));
    const invoiceDate = parseIsoDate(fieldValue(row, "invoiceDate", mapping));
    const acceptanceDate = parseIsoDate(fieldValue(row, "acceptanceDate", mapping)) ?? invoiceDate;
    const agreedCreditDays = parseOptionalDays(fieldValue(row, "agreedCreditDays", mapping));
    const paidDateRaw = fieldValue(row, "paidDate", mapping);
    const paidDate = paidDateRaw ? parseIsoDate(paidDateRaw) : null;
    const paidAmountRaw = fieldValue(row, "paidAmount", mapping);
    const paidAmount = paidAmountRaw ? parseMoney(paidAmountRaw) : null;
    const rowErrors = [
      !buyer ? "buyer is blank" : "",
      amount == null ? "amount must be a positive number" : "",
      invoiceDate == null ? "invoice_date is missing or invalid" : "",
      acceptanceDate == null ? "acceptance_date is missing or invalid" : "",
      agreedCreditDays === "invalid" ? "agreed_credit_days must be a non-negative integer" : "",
      paidDateRaw && !paidDate ? "paid_date is invalid" : "",
      seen.has(invoiceId) ? "duplicate invoice_id" : "",
    ].filter(Boolean);
    if (rowErrors.length) {
      errors.push(`Row ${line}: ${rowErrors.join("; ")}.`);
      return;
    }
    seen.add(invoiceId);
    rows.push({
      invoiceId,
      buyer,
      amount: amount!,
      invoiceDate: invoiceDate!,
      acceptanceDate: acceptanceDate!,
      agreedCreditDays: agreedCreditDays as number | null,
      paidDate,
      paidAmount: paidAmount ?? (paidDate ? amount : null),
    });
  });
  if (rows.length && rows.length < parsed.rows.length) warnings.push(`${parsed.rows.length - rows.length} invalid row(s) were skipped.`);
  return { rows, errors, warnings, headers: parsed.headers };
}

export function parsePayablesCsv(text: string, mapping: Record<string, string> = {}): ImportResult<Payable> {
  const parsed = parseCsv(text);
  const errors: string[] = [];
  const warnings: string[] = [];
  const required = ["vendor", "amount", "invoiceDate"];
  const missing = required.filter((field) => !hasMappedColumn(parsed.headers, field, mapping));
  if (missing.length) return { rows: [], errors: [`Missing required column(s): ${missing.join(", ")}.`], warnings, headers: parsed.headers };

  const rows: Payable[] = [];
  const seen = new Set<string>();
  parsed.rows.forEach((row, index) => {
    const line = index + 2;
    const invoiceId = fieldValue(row, "invoiceId", mapping) || `PAY-IMPORT-${line}`;
    const vendor = fieldValue(row, "vendor", mapping);
    const amount = parseMoney(fieldValue(row, "amount", mapping));
    const invoiceDate = parseIsoDate(fieldValue(row, "invoiceDate", mapping));
    const acceptanceDate = parseIsoDate(fieldValue(row, "acceptanceDate", mapping)) ?? invoiceDate;
    const agreedCreditDays = parseOptionalDays(fieldValue(row, "agreedCreditDays", mapping));
    const paidDateRaw = fieldValue(row, "paidDate", mapping);
    const paidDate = paidDateRaw ? parseIsoDate(paidDateRaw) : null;
    const rawCategory = fieldValue(row, "vendorCategory", mapping).toLowerCase();
    const category: VendorCategory = ["micro", "small", "medium", "other"].includes(rawCategory)
      ? (rawCategory as VendorCategory)
      : "other";
    const rawRegistered = fieldValue(row, "udyamRegistered", mapping).toLowerCase();
    const registered = ["yes", "y", "true", "1"].includes(rawRegistered);
    const rowErrors = [
      !vendor ? "vendor is blank" : "",
      amount == null ? "amount must be a positive number" : "",
      invoiceDate == null ? "invoice_date is missing or invalid" : "",
      acceptanceDate == null ? "acceptance_date is missing or invalid" : "",
      agreedCreditDays === "invalid" ? "agreed_credit_days must be a non-negative integer" : "",
      paidDateRaw && !paidDate ? "paid_date is invalid" : "",
      seen.has(invoiceId) ? "duplicate invoice_id" : "",
    ].filter(Boolean);
    if (rowErrors.length) {
      errors.push(`Row ${line}: ${rowErrors.join("; ")}.`);
      return;
    }
    seen.add(invoiceId);
    if (!["micro", "small", "medium", "other"].includes(rawCategory)) {
      warnings.push(`Row ${line}: vendor_category was not recognized; treated as "other".`);
    }
    rows.push({
      invoiceId,
      vendor,
      amount: amount!,
      invoiceDate: invoiceDate!,
      acceptanceDate: acceptanceDate!,
      agreedCreditDays: agreedCreditDays as number | null,
      vendorCategory: category,
      udyamRegistered: registered,
      paidDate,
    });
  });
  if (rows.length && rows.length < parsed.rows.length) warnings.push(`${parsed.rows.length - rows.length} invalid row(s) were skipped.`);
  return { rows, errors, warnings, headers: parsed.headers };
}
