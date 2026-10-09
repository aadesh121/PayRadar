import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter, Link } from 'wouter';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BadgeIndianRupee, BookOpen,
  Check, CircleHelp, Clipboard, CloudUpload, Download, FileCheck2,
  FileText, Gauge, HandCoins, Landmark, LayoutDashboard, LockKeyhole, RotateCcw,
  Scale, ShieldCheck, SlidersHorizontal, Sparkles, Upload, Users, X,
} from 'lucide-react';
import {
  type AppSettings, type BacktestResult, type CashForecast,
  type Ledger, type RateChange, type Receivable, type ImportResult,
  DEFAULT_RATES, DEFAULT_SETTINGS, appointedDay, backtest, dashboardMetrics,
  draftNotice, explainChaseAction, explainPayAction, forecastCash, generateDemoLedger,
  nextFinancialYearEnd, parsePayablesCsv, parseReceivablesCsv, rankActions, section16Interest,
} from '@/lib/engine';

const queryClient = new QueryClient();
const STORE_KEY = 'payradar.local.v1';
const today = new Date().toISOString().slice(0, 10);
type Persisted = { ledger: Ledger; settings: AppSettings; rates: RateChange[]; synthetic: boolean };
function getInitial(): Persisted {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Persisted;
      if (parsed.ledger?.receivables && parsed.settings) return parsed;
    }
  } catch { /* Start with the reproducible demo when local storage is unavailable. */ }
  const settings = { ...DEFAULT_SETTINGS, asOfDate: today };
  return { ledger: generateDemoLedger(settings.asOfDate), settings, rates: DEFAULT_RATES.map((r) => ({ ...r })), synthetic: true };
}
const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;
const compactMoney = (value: number) => value >= 10000000 ? `₹${(value / 10000000).toFixed(2)} cr` : value >= 100000 ? `₹${(value / 100000).toFixed(1)} L` : money(value);
const shortDate = (date: string | null) => date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const percent = (value: number) => `${Math.round(value * 100)}%`;
const Icon = ({ children }: { children: ReactNode }) => <span className="nav-icon">{children}</span>;
const nav = [
  { href: '/', label: 'Overview', icon: <LayoutDashboard size={17} /> },
  { href: '/upload', label: 'Import ledger', icon: <Upload size={17} /> },
  { href: '/actions', label: 'Cash actions', icon: <HandCoins size={17} /> },
  { href: '/what-if', label: 'What if?', icon: <SlidersHorizontal size={17} /> },
  { href: '/notice', label: 'Payment notice', icon: <FileText size={17} /> },
  { href: '/backtest', label: 'Model check', icon: <Activity size={17} /> },
  { href: '/assumptions', label: 'Assumptions', icon: <BookOpen size={17} /> },
];
function Shell({ children, synthetic, asOfDate, onReset }: { children: ReactNode; synthetic: boolean; asOfDate: string; onReset: () => void }) {
  const [location] = useLocation();
  const label = nav.find((item) => item.href === location)?.label ?? 'PayRadar';
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label="PayRadar overview">
        <span className="brand-mark"><Activity size={20} strokeWidth={2.5} /></span>
        <span><span className="brand-title">PayRadar</span><span className="brand-sub">CASHFLOW DESK</span></span>
      </Link>
      <div className="nav-label">Workspace</div>
      {nav.map((item) => <Link key={item.href} href={item.href} className={`nav-link ${location === item.href ? 'active' : ''}`} data-testid={`link-nav-${item.href === '/' ? 'overview' : item.href.slice(1)}`}>
        <Icon>{item.icon}</Icon>{item.label}
      </Link>)}
      <div className="sidebar-bottom">
        <div className="privacy-chip"><strong><LockKeyhole size={13} /> Local by design</strong>Files and forecasts stay in this browser. No AI provider receives your data.</div>
        <div className="sidebar-foot">PAYRADAR · PRIVATE PREVIEW</div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="crumb">Workspace <span style={{ color: '#bdc0b9', margin: '0 8px' }}>/</span> {label}</div>
        <div className="top-meta"><span className="today">As of {shortDate(asOfDate)}</span><span className="demo-pill"><i className="demo-dot" />{synthetic ? 'Synthetic demo' : 'Private ledger'}</span>
          {!synthetic && <button className="button ghost" style={{ padding: '5px 8px', fontSize: 10 }} onClick={onReset} data-testid="button-reset-demo"><RotateCcw size={13} /> Reset demo</button>}
        </div>
      </header>
      {children}
    </main>
    <nav className="mobile-nav">{nav.map((item) => <Link key={item.href} href={item.href} className={location === item.href ? 'active' : ''} data-testid={`mobile-nav-${item.href.slice(1) || 'overview'}`}>{item.icon}<span>{item.label === 'Overview' ? 'Home' : item.label.split(' ')[0]}</span></Link>)}</nav>
  </div>;
}
function PageHead({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <div className="page-head animate-in"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="page-desc">{description}</p></div>{children && <div className="page-head-actions">{children}</div>}</div>;
}
function Metric({ label, value, foot, icon, tone }: { label: string; value: string; foot: string; icon: ReactNode; tone?: string }) {
  return <div className="card metric"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="metric-label">{label}</span><span style={{ color: tone ?? '#57836f' }}>{icon}</span></div><div className="metric-value">{value}</div><div className="metric-foot">{foot}</div></div>;
}
function ForecastChart({ forecast, buffer }: { forecast: CashForecast; buffer: number }) {
  const width = 720, height = 260, pad = { top: 18, right: 15, bottom: 32, left: 62 };
  const maxDay = forecast.days.length - 1;
  const min = Math.min(buffer, ...forecast.days.map((d) => d.p10));
  const max = Math.max(buffer, ...forecast.days.map((d) => d.p90));
  const span = Math.max(1, max - min);
  const x = (day: number) => pad.left + day / maxDay * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (max - value) / span * (height - pad.top - pad.bottom);
  const line = (key: 'p10' | 'p50' | 'p90') => forecast.days.map((d, i) => `${i ? 'L' : 'M'}${x(d.day).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const band = `${forecast.days.map((d, i) => `${i ? 'L' : 'M'}${x(d.day).toFixed(1)},${y(d.p90).toFixed(1)}`).join(' ')} ${[...forecast.days].reverse().map((d) => `L${x(d.day).toFixed(1)},${y(d.p10).toFixed(1)}`).join(' ')} Z`;
  const ticks = [0, .33, .66, 1].map((r) => min + span * r);
  return <div className="forecast-chart">
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="60-day cash forecast with P10, P50 and P90 confidence range">
      {ticks.map((v, i) => <g key={i}><line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="#ebe9e1" strokeDasharray="3 5" /><text x={pad.left - 9} y={y(v) + 4} textAnchor="end" fill="#87908d" fontSize="10" fontFamily="DM Mono">{compactMoney(v)}</text></g>)}
      <path d={band} fill="#c9e1d4" opacity=".55" />
      <line x1={pad.left} x2={width - pad.right} y1={y(buffer)} y2={y(buffer)} stroke="#ca8651" strokeDasharray="5 5" />
      <path d={line('p90')} fill="none" stroke="#7cae96" strokeWidth="1.5" />
      <path d={line('p10')} fill="none" stroke="#7cae96" strokeWidth="1.5" />
      <path d={line('p50')} fill="none" stroke="#286b55" strokeWidth="3" strokeLinejoin="round" />
      {[0, 15, 30, 45, 60].map((d) => <text key={d} x={x(d)} y={height - 8} textAnchor="middle" fill="#87908d" fontSize="10" fontFamily="DM Mono">{d === 0 ? 'Today' : `${d}d`}</text>)}
    </svg>
    <div className="chart-legend"><span><i className="legend-dot" style={{ background: '#286b55' }} />P50 expected cash</span><span><i className="legend-dot" style={{ background: '#a8cdb8' }} />P10–P90 range</span><span><i className="legend-dot" style={{ background: '#ca8651' }} />Minimum cash buffer</span></div>
  </div>;
}
function Dashboard({ ledger, settings, rates, synthetic }: { ledger: Ledger; settings: AppSettings; rates: RateChange[]; synthetic: boolean }) {
  const metrics = useMemo(() => dashboardMetrics(ledger, settings, rates), [ledger, settings, rates]);
  const forecast = useMemo(() => forecastCash(ledger, settings, rates, { horizonDays: 60, paths: 480, seed: 731992 }), [ledger, settings, rates]);
  const actions = useMemo(() => rankActions(ledger, settings, rates), [ledger, settings, rates]);
  const lowest = forecast.days.reduce((a, b) => b.p10 < a.p10 ? b : a, forecast.days[0]);
  const firstRisk = forecast.shortfallDate;
  const open = ledger.receivables.filter((r) => !r.paidDate);
  return <div className="content">
    <PageHead eyebrow="Cash position · 60-day view" title="Know what lands. Know what leaves." description="A practical view of likely receipts, committed supplier payments, and the days your cash buffer may be tested.">
      <Link href="/upload" className="button primary" data-testid="button-import-ledger"><Upload size={15} /> Import ledger</Link>
    </PageHead>
    {synthetic && <div className="alert-box" style={{ marginBottom: 14 }}><strong>Fictional demo ledger.</strong> Every visible buyer, supplier, invoice and amount is synthetic, generated from a reproducible seed. It includes eight buyer patterns (including a worsening payer) and six fictional suppliers. Import your own CSV to replace it.</div>}
    <div className="metric-grid">
      <Metric label="Open receivables" value={compactMoney(metrics.openReceivables)} foot={`${open.length} unpaid invoices in ledger`} icon={<ArrowDownRight size={17} />} />
      <Metric label="Expected-late amount" value={compactMoney(metrics.expectedLateAmount)} foot="Probability-weighted late receipts" icon={<AlertTriangle size={17} />} tone="#bf8150" />
      <Metric label="Open payables" value={compactMoney(metrics.openPayables)} foot={`${ledger.payables.filter((p) => !p.paidDate).length} supplier commitments`} icon={<ArrowUpRight size={17} />} tone="#bf8150" />
      <Metric label="Indicative accrued interest" value={compactMoney(metrics.accruedInterest)} foot="Section 16 model · accountant verification needed" icon={<Scale size={17} />} tone="#bf8150" />
      <Metric label="43B(h) exposure" value={compactMoney(metrics.exposure43B)} foot="Registered micro/small supplier estimate" icon={<BadgeIndianRupee size={17} />} tone="#bf8150" />
      <Metric label="Opening cash" value={compactMoney(metrics.openingBalance)} foot={`Minimum buffer ${compactMoney(settings.minCashBuffer)}`} icon={<Landmark size={17} />} />
    </div>
    <div className="dashboard-grid">
      <section className="card">
        <div className="card-head"><div><h2 className="card-title">Cash forecast · next 60 days</h2><p className="card-sub">Deterministic Monte Carlo · {forecast.paths.toLocaleString('en-IN')} paths · INR</p></div><Link href="/what-if" className="button" data-testid="button-open-what-if"><SlidersHorizontal size={14} /> Run a scenario</Link></div>
        <ForecastChart forecast={forecast} buffer={settings.minCashBuffer} />
      </section>
      <section className="card risk-card">
        <div className="risk-label">{firstRisk ? 'Shortfall warning' : 'Buffer outlook'}</div>
        <div className="risk-date">{firstRisk ? shortDate(firstRisk) : 'No trigger in view'}</div>
        <p>{firstRisk ? 'More than 20% of forecast paths fall below your minimum cash buffer around this date. Decide early which receipt to chase or payment to schedule.' : 'The modeled 60-day paths stay above your minimum cash buffer. This is an estimate, not a guarantee.'}</p>
        <div className="risk-buffer"><span>Lowest P10 balance</span><strong>{compactMoney(lowest.p10)}</strong></div>
        <div className="risk-buffer"><span>Minimum buffer</span><strong>{compactMoney(settings.minCashBuffer)}</strong></div>
        <Link href="/actions" className="button" style={{ width: '100%', marginTop: 15 }} data-testid="button-review-actions">Review cash actions</Link>
      </section>
    </div>
    <div className="two-col" style={{ marginTop: 14 }}>
      <section className="card"><div className="card-head"><div><h2 className="card-title">Receivables to follow up</h2><p className="card-sub">Highest modeled chase priority</p></div><Link href="/actions" className="button ghost">All actions →</Link></div>
        <div style={{ padding: '0 20px 8px' }}>{actions.chase.slice(0, 3).map((a) => <div className="list-row" key={a.invoiceId}><div className="list-row-main"><div className="list-row-title">{a.buyer}</div><div className="list-row-detail">{a.invoiceId} · {a.daysOutstanding} days open · {percent(a.probabilityLate)} late risk</div></div><div className="list-row-right"><div className="list-row-amount">{money(a.amount)}</div><div className="list-row-tag">Expected {shortDate(a.expectedPaymentDate)}</div></div></div>)}
          {!actions.chase.length && <div className="empty-state"><Check size={22} /><strong>Nothing outstanding</strong><p>Open invoices will appear here.</p></div>}</div>
      </section>
      <section className="card"><div className="card-head"><div><h2 className="card-title">Supplier deadlines</h2><p className="card-sub">Payment decisions ranked by urgency</p></div><Link href="/actions" className="button ghost">See queue →</Link></div>
        <div style={{ padding: '0 20px 8px' }}>{actions.pay.slice(0, 3).map((a) => <div className="list-row" key={a.invoiceId}><div className="list-row-main"><div className="list-row-title">{a.vendor}</div><div className="list-row-detail">{a.invoiceId} · appointed day {shortDate(a.appointedDay)}{a.eligibleMse ? ' · registered MSE' : ''}</div></div><div className="list-row-right"><div className="list-row-amount">{money(a.amount)}</div><div className="list-row-tag">{a.daysToDeadline} days to deadline</div></div></div>)}
          {!actions.pay.length && <div className="empty-state"><Check size={22} /><strong>No unpaid supplier bills</strong><p>New payable imports will appear here.</p></div>}</div>
      </section>
    </div>
    <div className="footer-note">Forecasts use historical buyer payment patterns and modeled supplier due dates. P10/P50/P90 are simulated percentiles, not commitments. Indicative interest and tax exposure require accountant verification; this is not legal or tax advice.</div>
  </div>;
}
function ImportCard<T>({ title, kind, parse, onImport, sample, mappingFields }: { title: string; kind: string; parse: (text: string, mapping?: Record<string, string>) => ImportResult<T>; onImport: (rows: T[]) => void; sample: string; mappingFields: { key: string; label: string; required?: boolean }[] }) {
  const [result, setResult] = useState<ImportResult<T> | null>(null);
  const [filename, setFilename] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const processFile = async (file?: File) => {
    if (!file) return;
    setFilename(file.name); setBusy(true);
    try { const text = await file.text(); setSourceText(text); setMapping({}); setResult(parse(text)); } catch { setResult({ rows: [], errors: ['This file could not be read. Save it as a UTF-8 CSV and try again.'], warnings: [] }); }
    setBusy(false);
  };
  const handleImport = () => { if (result?.rows.length) { onImport(result.rows); setResult(null); setFilename(''); } };
  const recheck = () => { if (sourceText) setResult(parse(sourceText, mapping)); };
  return <section className="card">
    <div className="card-head"><div><h2 className="card-title">{title}</h2><p className="card-sub">CSV · parsed and validated locally</p></div><span className="status neutral">{kind}</span></div>
    <div style={{ padding: '0 18px 18px' }}>
      <label className="upload-zone" style={{ display: 'block', cursor: 'pointer' }} data-testid={`upload-zone-${kind.toLowerCase()}`}>
        <input type="file" accept=".csv,text/csv" onChange={(event) => void processFile(event.target.files?.[0])} data-testid={`input-file-${kind.toLowerCase()}`} />
        <span className="upload-icon">{busy ? <Activity size={18} /> : <CloudUpload size={19} />}</span>
        <strong>{filename || `Choose ${kind.toLowerCase()} CSV`}</strong>
        <p>{busy ? 'Reading file in this browser…' : 'Click to choose a file · no upload to a server'}</p>
        <span className="button"><Upload size={13} /> Browse files</span>
      </label>
      <details style={{ marginTop: 11 }}><summary style={{ fontSize: 11, color: '#677875', cursor: 'pointer' }}>Required columns and sample header</summary><code style={{ display: 'block', marginTop: 8, fontSize: 10, color: '#697576', overflowWrap: 'anywhere' }}>{sample}</code></details>
      {result && <div style={{ marginTop: 13 }}>
        {result.headers?.length ? <details style={{ marginBottom: 12 }}>
          <summary style={{ fontSize: 11, color: '#426f59', cursor: 'pointer' }}>Review or manually map CSV columns</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10, marginTop: 11 }}>
            {mappingFields.map((field) => <div className="field" key={field.key}>
              <label htmlFor={`map-${kind}-${field.key}`}>{field.label}{field.required ? ' · required' : ''}</label>
              <select id={`map-${kind}-${field.key}`} value={mapping[field.key] ?? ''} onChange={(event) => setMapping((previous) => ({ ...previous, [field.key]: event.target.value }))} data-testid={`select-map-${kind.toLowerCase()}-${field.key}`}>
                <option value="">Auto-detect / leave blank</option>
                {result.headers?.map((header) => <option key={header} value={header}>{header}</option>)}
              </select>
            </div>)}
          </div>
          <button className="button" style={{ marginTop: 10 }} onClick={recheck} data-testid={`button-recheck-${kind.toLowerCase()}`}>Apply mapping and validate again</button>
        </details> : null}
        {result.rows.length > 0 && <div className="info-box" style={{ marginBottom: 9 }}><strong>{result.rows.length} valid row{result.rows.length === 1 ? '' : 's'} ready.</strong> {result.errors.length ? `${result.errors.length} row-level issue(s) found.` : 'Review then add to your ledger.'}</div>}
        {result.errors.length > 0 && <div className="error-box" style={{ marginBottom: 9 }}><strong>Validation notes</strong><ul style={{ margin: '5px 0 0', paddingLeft: 17 }}>{result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>{result.errors.length > 5 && <div>And {result.errors.length - 5} more issue(s).</div>}</div>}
        {result.warnings.map((w, i) => <div className="alert-box" key={i} style={{ marginBottom: 8 }}>{w}</div>)}
        <div style={{ display: 'flex', gap: 8 }}><button className="button primary" disabled={!result.rows.length} onClick={handleImport} data-testid={`button-apply-${kind.toLowerCase()}`}><Check size={14} /> Add {result.rows.length} rows</button><button className="button" onClick={() => { setResult(null); setFilename(''); }} data-testid={`button-cancel-${kind.toLowerCase()}`}>Cancel</button></div>
      </div>}
    </div>
  </section>;
}
function UploadPage({ ledger, setLedger, settings, setSettings, setSynthetic }: { ledger: Ledger; setLedger: (l: Ledger) => void; settings: AppSettings; setSettings: (s: AppSettings) => void; setSynthetic: (s: boolean) => void }) {
  const [balance, setBalance] = useState(String(settings.openingBalance));
  const [saved, setSaved] = useState(false);
  const replaceOrAppend = <T,>(previous: T[], incoming: T[], key: (item: T) => string) => {
    const ids = new Set(incoming.map(key)); return [...previous.filter((r) => !ids.has(key(r))), ...incoming];
  };
  const updateReceivables = (rows: Receivable[]) => { setLedger({ ...ledger, receivables: replaceOrAppend(ledger.receivables, rows, (r) => r.invoiceId) }); setSynthetic(false); };
  const updatePayables = (rows: Ledger['payables']) => { setLedger({ ...ledger, payables: replaceOrAppend(ledger.payables, rows, (r) => r.invoiceId) }); setSynthetic(false); };
  const saveBalance = () => { const value = Number(balance); if (Number.isFinite(value) && value >= 0) { setSettings({ ...settings, openingBalance: value }); setSaved(true); window.setTimeout(() => setSaved(false), 2200); } };
  const downloadTemplate = () => {
    const csv = 'invoice_id,buyer,amount,invoice_date,acceptance_date,agreed_credit_days,paid_date,paid_amount\nINV-001,Sample buyer,125000,2026-05-10,2026-05-12,30,,';
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'payradar-receivables-template.csv'; link.click(); URL.revokeObjectURL(link.href);
  };
  return <div className="content">
    <PageHead eyebrow="Ledger intake" title="Bring the books into focus." description="Import receivables and payables as CSV. Files are read on this device and never sent to a server." />
    <div className="info-box" style={{ marginBottom: 15 }}><LockKeyhole size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} />CSV files and all calculations stay in this browser. Imports are saved only in this browser’s local storage.</div>
    <div className="two-col">
      <ImportCard title="Customer invoices" kind="Receivables" parse={parseReceivablesCsv} onImport={updateReceivables} sample="invoice_id, buyer, amount, invoice_date, acceptance_date, agreed_credit_days, paid_date, paid_amount" mappingFields={[
        { key: 'invoiceId', label: 'Invoice ID' }, { key: 'buyer', label: 'Buyer', required: true },
        { key: 'amount', label: 'Amount', required: true }, { key: 'invoiceDate', label: 'Invoice date', required: true },
        { key: 'acceptanceDate', label: 'Acceptance date' }, { key: 'agreedCreditDays', label: 'Agreed credit days' },
        { key: 'paidDate', label: 'Paid date' }, { key: 'paidAmount', label: 'Paid amount' },
      ]} />
      <ImportCard title="Supplier bills" kind="Payables" parse={parsePayablesCsv} onImport={updatePayables} sample="invoice_id, vendor, amount, invoice_date, acceptance_date, agreed_credit_days, vendor_category, udyam_registered, paid_date" mappingFields={[
        { key: 'invoiceId', label: 'Invoice ID' }, { key: 'vendor', label: 'Supplier', required: true },
        { key: 'amount', label: 'Amount', required: true }, { key: 'invoiceDate', label: 'Invoice date', required: true },
        { key: 'acceptanceDate', label: 'Acceptance date' }, { key: 'agreedCreditDays', label: 'Agreed credit days' },
        { key: 'vendorCategory', label: 'Supplier category' }, { key: 'udyamRegistered', label: 'Udyam registration' },
        { key: 'paidDate', label: 'Paid date' },
      ]} />
    </div>
    <section className="card" style={{ marginTop: 15 }}>
      <div className="card-head"><div><h2 className="card-title">Set the cash starting point</h2><p className="card-sub">Opening balance anchors every forecast path.</p></div><Landmark size={17} color="#4e8067" /></div>
      <div style={{ padding: '0 20px 19px', display: 'flex', gap: 13, alignItems: 'end', maxWidth: 540 }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor="opening-balance">Opening cash balance · INR</label><input id="opening-balance" type="number" min="0" step="1" value={balance} onChange={(e) => setBalance(e.target.value)} data-testid="input-opening-balance" /></div>
        <button className="button primary" onClick={saveBalance} data-testid="button-save-balance">{saved ? <><Check size={14} /> Saved</> : 'Save balance'}</button>
      </div>
    </section>
    <section className="card" style={{ marginTop: 15 }}>
      <div className="card-head"><div><h2 className="card-title">Current ledger inventory</h2><p className="card-sub">Imported rows are merged by invoice ID. Matching IDs are replaced.</p></div><button className="button" onClick={downloadTemplate} data-testid="button-download-template"><Download size={14} /> Receivables template</button></div>
      <div style={{ padding: '0 20px 18px', display: 'flex', gap: 30, color: '#627174', fontSize: 12 }}><span><strong style={{ color: '#33434a' }}>{ledger.receivables.length}</strong> receivable rows</span><span><strong style={{ color: '#33434a' }}>{ledger.payables.length}</strong> payable rows</span></div>
    </section>
    <div className="footer-note">Dates should use YYYY-MM-DD. Blank credit days use the engine’s statutory appointed-day assumption; verify terms and acceptance dates against source records. CSV parsing uses the calculation engine’s validator.</div>
  </div>;
}
function ActionsPage({ ledger, settings, rates }: { ledger: Ledger; settings: AppSettings; rates: RateChange[] }) {
  const actions = useMemo(() => rankActions(ledger, settings, rates), [ledger, settings, rates]);
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="content">
    <PageHead eyebrow="Decision queue" title="Put attention where cash is at risk." description="Local ranking of customer follow-ups and supplier commitments, based on ledger history and due dates." />
    <div className="alert-box" style={{ marginBottom: 15 }}>Rank is a decision aid, not an instruction to withhold or accelerate payment. Confirm the invoice, relationship and available bank balance before acting.</div>
    <div className="two-col">
      <section className="card"><div className="card-head"><div><h2 className="card-title">Chase receipts <span className="status warn" style={{ marginLeft: 7 }}>{actions.chase.length}</span></h2><p className="card-sub">Sorted by modeled priority · highest first</p></div><Users size={17} color="#55826b" /></div>
        <div style={{ padding: '0 20px 13px' }}>{actions.chase.map((action, i) => <div key={action.invoiceId} className="list-row" style={{ alignItems: 'start' }}><div className="list-row-main"><div className="list-row-title"><span className="mono" style={{ color: '#9aa09c', marginRight: 8 }}>#{i + 1}</span>{action.buyer}</div><div className="list-row-detail">{action.invoiceId} · {action.daysOutstanding} days outstanding<br />Estimated payment {shortDate(action.expectedPaymentDate)} · {percent(action.probabilityLate)} late likelihood</div>
          <button className="button ghost" style={{ padding: '6px 0', color: '#426f59' }} onClick={() => setExpanded(expanded === action.invoiceId ? null : action.invoiceId)} aria-expanded={expanded === action.invoiceId} data-testid={`button-explain-chase-${action.invoiceId}`}><CircleHelp size={13} /> {expanded === action.invoiceId ? 'Hide reasoning' : 'Why this is ranked'}</button>
          {expanded === action.invoiceId && <div className="info-box" style={{ marginTop: 4 }}>{explainChaseAction(action)}</div>}</div><div className="list-row-right"><div className="list-row-amount">{money(action.amount)}</div>{action.accruedInterest > 0 && <div className="list-row-tag">Indicative interest {money(action.accruedInterest)}</div>}</div></div>)}
          {!actions.chase.length && <div className="empty-state"><Check size={22} /><strong>All receivables are settled</strong><p>Unpaid invoices will be prioritized here.</p></div>}</div></section>
      <section className="card"><div className="card-head"><div><h2 className="card-title">Plan supplier payments <span className="status neutral" style={{ marginLeft: 7 }}>{actions.pay.length}</span></h2><p className="card-sub">Due dates, indicative exposures and P10 cash-buffer fit</p></div><BadgeIndianRupee size={18} color="#ae784b" /></div>
        <div style={{ padding: '0 20px 13px' }}>{actions.pay.map((action, i) => <div key={action.invoiceId} className="list-row" style={{ alignItems: 'start' }}><div className="list-row-main"><div className="list-row-title"><span className="mono" style={{ color: '#9aa09c', marginRight: 8 }}>#{i + 1}</span>{action.vendor}</div><div className="list-row-detail">{action.invoiceId} · {action.category} supplier{action.eligibleMse ? ' · Udyam marked' : ''}<br />Appointed day {shortDate(action.appointedDay)} · {action.daysToDeadline} days</div>
          <div className={`status ${action.cashBufferFit === false ? 'warn' : action.cashBufferFit === true ? 'good' : 'neutral'}`} style={{ marginTop: 8 }}>
            {action.cashBufferFit === true ? `P10 buffer fits by ${shortDate(action.recommendedPayDate)}` : action.cashBufferFit === false ? 'P10 cash gap · chase priority receipts' : 'Beyond the 60-day cash check'}
          </div>
          <button className="button ghost" style={{ padding: '6px 0', color: '#426f59' }} onClick={() => setExpanded(expanded === action.invoiceId ? null : action.invoiceId)} aria-expanded={expanded === action.invoiceId} data-testid={`button-explain-pay-${action.invoiceId}`}><CircleHelp size={13} /> {expanded === action.invoiceId ? 'Hide reasoning' : 'Why this is ranked'}</button>
          {expanded === action.invoiceId && <div className="info-box" style={{ marginTop: 4 }}>{explainPayAction(action)}</div>}</div><div className="list-row-right"><div className="list-row-amount">{money(action.amount)}</div>{action.eligibleMse && <div className="list-row-tag">Indicative 43B(h): {money(action.exposure43B)}</div>}</div></div>)}
          {!actions.pay.length && <div className="empty-state"><Check size={22} /><strong>No open payables</strong><p>Supplier payment decisions will appear here.</p></div>}</div></section>
    </div>
    <div className="footer-note">Explanations are deterministic local templates grounded in the calculation engine; they are not AI-generated. Interest and Section 43B(h) figures are indicative only. Verify supplier classification, acceptance dates, applicable rate and statutory treatment with your accountant.</div>
  </div>;
}
function WhatIfPage({ ledger, settings, rates }: { ledger: Ledger; settings: AppSettings; rates: RateChange[] }) {
  const buyers = [...new Set(ledger.receivables.filter((r) => !r.paidDate).map((r) => r.buyer))];
  const [buyer, setBuyer] = useState(buyers[0] ?? '');
  const [delay, setDelay] = useState(15);
  const baseline = useMemo(() => forecastCash(ledger, settings, rates, { horizonDays: 60, paths: 480, seed: 731992 }), [ledger, settings, rates]);
  const scenario = useMemo(() => forecastCash(ledger, settings, rates, { horizonDays: 60, paths: 480, seed: 731992, whatIfBuyer: buyer, delayDays: delay }), [ledger, settings, rates, buyer, delay]);
  const baseLow = baseline.days.reduce((a, b) => b.p10 < a.p10 ? b : a, baseline.days[0]);
  const scenLow = scenario.days.reduce((a, b) => b.p10 < a.p10 ? b : a, scenario.days[0]);
  const peakDifference = scenLow.p10 - baseLow.p10;
  return <div className="content">
    <PageHead eyebrow="Scenario planning" title="What if one buyer pays later?" description="Shift one buyer’s expected payment timing and rerun the same seeded 60-day forecast. No ledger values are changed." />
    <div className="two-col">
      <section className="card" style={{ padding: 20 }}><div className="eyebrow">Scenario controls</div><h2 className="section-title">Move expected timing</h2><p className="section-note">A delay shifts the selected buyer’s learned behavior distribution; it does not alter invoice records.</p>
        <div className="field"><label htmlFor="whatif-buyer">Buyer with open invoices</label><select id="whatif-buyer" value={buyers.includes(buyer) ? buyer : buyers[0] ?? ''} onChange={(e) => setBuyer(e.target.value)} data-testid="select-whatif-buyer">{buyers.map((name) => <option key={name} value={name}>{name}</option>)}</select></div>
        <div className="field" style={{ marginTop: 22 }}><label htmlFor="delay-slider">Expected shift from current behavior</label><div className="range-wrap"><span className="mono">−30d</span><input id="delay-slider" type="range" min="-30" max="90" step="5" value={delay} onChange={(e) => setDelay(Number(e.target.value))} data-testid="input-delay-days" /><strong className="range-value">{delay > 0 ? '+' : ''}{delay} days</strong></div></div>
        <div className="info-box" style={{ marginTop: 20 }}><strong>Fixed inputs.</strong> Identical seed, path count, opening balance, payables and all other buyer behavior. This isolates the selected buyer’s timing shift.</div>
      </section>
      <section className="card" style={{ padding: 20 }}><div className="eyebrow">Change in modeled downside</div><div className="callout-number" style={{ color: peakDifference < 0 ? '#a34e3f' : '#286b55' }}>{peakDifference > 0 ? '+' : ''}{compactMoney(peakDifference)}</div><p className="section-note">Difference in the lowest P10 balance across 60 days versus baseline.</p><div className="list-row"><span className="list-row-detail">Baseline lowest P10</span><strong className="amount">{compactMoney(baseLow.p10)}</strong></div><div className="list-row"><span className="list-row-detail">Scenario lowest P10</span><strong className="amount">{compactMoney(scenLow.p10)}</strong></div><div className="list-row"><span className="list-row-detail">First shortfall warning</span><strong className="amount">{scenario.shortfallDate ? shortDate(scenario.shortfallDate) : 'None in 60 days'}</strong></div></section>
    </div>
    <section className="card" style={{ marginTop: 15 }}><div className="card-head"><div><h2 className="card-title">Baseline and scenario · P10 downside</h2><p className="card-sub">P50 median and P10 lower percentile · deterministic {scenario.paths} path rerun</p></div><span className="status neutral">Buyer: {buyer || 'none'}</span></div>
      <div className="table-wrap"><table><thead><tr><th>Day</th><th>Date</th><th>Base P10</th><th>Scenario P10</th><th>Base P50</th><th>Scenario P50</th></tr></thead><tbody>{[0, 7, 14, 21, 30, 45, 60].map((day) => <tr key={day}><td>{day}</td><td>{shortDate(scenario.days[day]?.date)}</td><td className="amount">{compactMoney(baseline.days[day]?.p10 ?? 0)}</td><td className="amount">{compactMoney(scenario.days[day]?.p10 ?? 0)}</td><td className="amount">{compactMoney(baseline.days[day]?.p50 ?? 0)}</td><td className="amount">{compactMoney(scenario.days[day]?.p50 ?? 0)}</td></tr>)}</tbody></table></div>
    </section><div className="footer-note">Scenario results are modeled distributions, not promises of customer behavior or cash availability. Use the ranked chase queue to decide whether follow-up is appropriate.</div>
  </div>;
}
function NoticePage({ ledger, settings, rates }: { ledger: Ledger; settings: AppSettings; rates: RateChange[] }) {
  const open = ledger.receivables.filter((r) => !r.paidDate);
  const [invoiceId, setInvoiceId] = useState(open[0]?.invoiceId ?? '');
  const [tone, setTone] = useState<'polite' | 'firm'>('polite');
  const [copied, setCopied] = useState(false);
  const invoice = open.find((r) => r.invoiceId === invoiceId);
  const interest = invoice ? section16Interest(invoice.amount, appointedDay(invoice.acceptanceDate, invoice.agreedCreditDays), settings.asOfDate, rates) : 0;
  const draft = invoice ? draftNotice(invoice, interest, tone) : '';
  const copy = async () => { try { await navigator.clipboard.writeText(draft); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([draft], { type: 'text/plain;charset=utf-8' })); a.download = `PayRadar-notice-${invoice?.invoiceId ?? 'draft'}.txt`; a.click(); URL.revokeObjectURL(a.href); };
  return <div className="content">
    <PageHead eyebrow="Customer follow-up" title="A clear nudge, ready to review." description="Draft a respectful payment request with an indicative interest annexure. Always verify contract terms before sending." />
    <div className="two-col">
      <section className="card" style={{ padding: 20 }}><div className="eyebrow">Draft details</div><div className="field"><label htmlFor="notice-invoice">Open receivable</label><select id="notice-invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} data-testid="select-notice-invoice">{open.map((r) => <option key={r.invoiceId} value={r.invoiceId}>{r.invoiceId} · {r.buyer} · {money(r.amount)}</option>)}</select></div>
        <div className="field" style={{ marginTop: 16 }}><label htmlFor="notice-tone">Tone</label><select id="notice-tone" value={tone} onChange={(e) => setTone(e.target.value as 'polite' | 'firm')} data-testid="select-notice-tone"><option value="polite">Polite · relationship-first</option><option value="firm">Firm · overdue follow-up</option></select></div>
        {invoice && <div style={{ marginTop: 19, padding: 15, background: '#f8f7f1', borderRadius: 9 }}><div className="eyebrow">Indicative annexure</div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}><span>Outstanding principal</span><strong className="amount">{money(invoice.amount)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}><span>Appointed day</span><strong>{shortDate(appointedDay(invoice.acceptanceDate, invoice.agreedCreditDays))}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>Interest to {shortDate(settings.asOfDate)}</span><strong className="amount">{money(interest)}</strong></div></div>}
        <div className="alert-box" style={{ marginTop: 14 }}>Interest is indicative and engine-calculated. Have an Indian accountant verify rate dates, contractual terms and statutory treatment before sharing.</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}><button className="button primary" onClick={() => void copy()} disabled={!invoice} data-testid="button-copy-notice">{copied ? <><Check size={14} /> Copied</> : <><Clipboard size={14} /> Copy draft</>}</button><button className="button" onClick={download} disabled={!invoice} data-testid="button-download-notice"><Download size={14} /> Download .txt</button></div>
      </section>
      <section className="card" style={{ padding: 20 }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}><div><div className="eyebrow">Review before sending</div><h2 className="section-title">Draft preview</h2></div><span className="status neutral">{tone}</span></div>
        {invoice ? <div className="notice-preview" data-testid="text-notice-draft">{draft}</div> : <div className="empty-state"><FileText size={23} /><strong>No open invoices</strong><p>Import a receivable to draft a notice.</p></div>}
      </section>
    </div><div className="footer-note">This communication is a draft only; no email is sent. It is not legal or tax advice. Confirm facts, dispute status and the applicable interest calculation before sending.</div>
  </div>;
}
function BacktestPage({ ledger }: { ledger: Ledger }) {
  const result: BacktestResult = useMemo(() => backtest(ledger.receivables), [ledger]);
  const paid = ledger.receivables.filter((r) => r.paidDate).length;
  const modelBetter = result.testedInvoices > 0 && result.modelMaeDays < result.dueDateMaeDays;
  return <div className="content">
    <PageHead eyebrow="Forecast quality" title="Check the model against what happened." description="A time-ordered holdout compares learned buyer behavior with an appointed-day-only baseline." />
    <div className="info-box" style={{ marginBottom: 15 }}><FileCheck2 size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Paid invoices are ordered by invoice date. The earliest 70% train buyer behavior; the latest 30% are held out for testing. No random shuffle.</div>
    {result.testedInvoices > 0 ? <>
      <div className="metric-grid">
        <Metric label="Invoices tested" value={String(result.testedInvoices)} foot={`${paid} paid invoices available`} icon={<FileCheck2 size={17} />} />
        <Metric label="Model MAE" value={`${result.modelMaeDays.toFixed(1)} days`} foot="Absolute error on held-out invoices" icon={<Gauge size={17} />} />
        <Metric label="Due-date baseline MAE" value={`${result.dueDateMaeDays.toFixed(1)} days`} foot="Appointed-day only comparison" icon={<Scale size={17} />} />
        <Metric label="P10–P90 coverage" value={percent(result.p10ToP90Coverage)} foot="Held-out actuals inside model interval" icon={<Activity size={17} />} />
      </div>
      <section className="card" style={{ marginTop: 15, padding: 22 }}><div className="eyebrow">Holdout readout</div><h2 className="section-title">{modelBetter ? 'Behavior model beat the due-date baseline' : 'Baseline performed at least as well on this holdout'}</h2><p className="page-desc" style={{ maxWidth: 700, marginTop: 8 }}>Model MAE is {Math.abs(result.modelMaeDays - result.dueDateMaeDays).toFixed(1)} days {modelBetter ? 'lower' : 'higher'} than the appointed-day baseline across {result.testedInvoices} held-out invoice{result.testedInvoices === 1 ? '' : 's'}. Small samples can move substantially with each new paid invoice.</p><div style={{ display: 'flex', gap: 24, marginTop: 20, flexWrap: 'wrap' }}><div><div className="metric-label">Model MAE</div><strong className="callout-number" style={{ fontSize: 23 }}>{result.modelMaeDays.toFixed(1)}d</strong></div><div><div className="metric-label">Baseline MAE</div><strong className="callout-number" style={{ fontSize: 23 }}>{result.dueDateMaeDays.toFixed(1)}d</strong></div><div><div className="metric-label">Interval coverage</div><strong className="callout-number" style={{ fontSize: 23 }}>{percent(result.p10ToP90Coverage)}</strong></div></div></section>
    </> : <section className="card" style={{ padding: 28, marginTop: 15 }}><div className="empty-state"><Activity size={25} /><strong>Not enough paid invoices to score yet</strong><p>Need at least two paid invoices in the earliest 70% training slice, plus at least one later invoice in the 30% holdout. Paid count here: {paid}.</p></div></section>}
    <div className="footer-note">The engine's validation predicts log-normal median payment days and checks its P10–P90 interval. Historical performance is not a guarantee of future accuracy. Imported or fictional demo data is only as reliable as its inputs.</div>
  </div>;
}
function AssumptionsPage({ settings, setSettings, rates, setRates, synthetic }: { settings: AppSettings; setSettings: (s: AppSettings) => void; rates: RateChange[]; setRates: (r: RateChange[]) => void; synthetic: boolean }) {
  const [date, setDate] = useState(settings.asOfDate);
  const [buffer, setBuffer] = useState(String(settings.minCashBuffer));
  const [tax, setTax] = useState(String(settings.taxRate * 100));
  const [rateNote, setRateNote] = useState('');
  const save = () => {
    const taxNumber = Number(tax), bufferNumber = Number(buffer);
    if (!date || !Number.isFinite(taxNumber) || taxNumber < 0 || taxNumber > 100 || !Number.isFinite(bufferNumber) || bufferNumber < 0) return;
    setSettings({ ...settings, asOfDate: date, minCashBuffer: bufferNumber, taxRate: taxNumber / 100 });
  };
  const addRate = () => {
    const rate = Number(rateNote);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return;
    setRates([...rates, { effectiveFrom: date, bankRatePercent: rate, note: 'User-entered; verify against applicable RBI notification.' }].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)));
    setRateNote('');
  };
  const removeRate = (index: number) => setRates(rates.filter((_, i) => i !== index));
  return <div className="content">
    <PageHead eyebrow="Model settings & disclosures" title="Know what the numbers assume." description="Rates, operating settings and limitations that shape this local cash-flow view." />
    <div className="two-col">
      <section className="card"><div className="card-head"><div><h2 className="card-title">Forecast settings</h2><p className="card-sub">Applied to the next calculation</p></div><SlidersHorizontal size={17} color="#4e8067" /></div>
        <div style={{ padding: '0 19px 19px', display: 'grid', gap: 13 }}>
          <div className="field"><label htmlFor="setting-date">Calculation date</label><input id="setting-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-as-of-date" /></div>
          <div className="field"><label htmlFor="setting-buffer">Minimum cash buffer · INR</label><input id="setting-buffer" type="number" min="0" value={buffer} onChange={(e) => setBuffer(e.target.value)} data-testid="input-min-buffer" /></div>
          <div className="field"><label htmlFor="setting-tax">Tax rate used for modeled Section 43B(h) exposure · %</label><input id="setting-tax" type="number" min="0" max="100" step=".1" value={tax} onChange={(e) => setTax(e.target.value)} data-testid="input-tax-rate" /></div>
          <button className="button primary" style={{ justifySelf: 'start' }} onClick={save} data-testid="button-save-settings"><Check size={14} /> Save settings</button>
        </div>
      </section>
      <section className="card"><div className="card-head"><div><h2 className="card-title">Dated bank rates</h2><p className="card-sub">Engine applies 3× bank rate for its indicative estimate</p></div><Landmark size={17} color="#ae784b" /></div>
        <div style={{ padding: '0 19px 12px' }}>{rates.map((r, i) => <div className="list-row" key={`${r.effectiveFrom}-${i}`}><div><div className="list-row-title">{shortDate(r.effectiveFrom)}</div><div className="list-row-detail">{r.note ?? 'User-entered rate'}{r.sourceUrl && <> · <a href={r.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#286b55', textDecoration: 'underline' }}>RBI source</a></>}</div></div><div className="list-row-right"><div className="list-row-amount">{r.bankRatePercent}%</div><button className="button ghost" style={{ padding: '5px 0', color: '#9a5a4b' }} onClick={() => removeRate(i)} data-testid={`button-remove-rate-${i}`}><X size={13} /> Remove</button></div></div>)}</div>
        <div style={{ padding: '5px 19px 19px', display: 'flex', alignItems: 'end', gap: 9 }}><div className="field" style={{ flex: 1 }}><label htmlFor="new-rate">Add rate effective on calculation date · %</label><input id="new-rate" type="number" min="0" max="100" step=".01" placeholder="e.g. 5.75" value={rateNote} onChange={(e) => setRateNote(e.target.value)} data-testid="input-new-rate" /></div><button className="button" onClick={addRate} disabled={!rateNote} data-testid="button-add-rate">Add rate</button></div>
      </section>
    </div>
    <section className="card" style={{ padding: 21, marginTop: 15 }}><div className="eyebrow">Disclosure register</div><h2 className="section-title">Limitations, privacy and careful use</h2>
      <div className="two-col" style={{ marginTop: 15 }}>
        <div><h3 className="card-title"><ShieldCheck size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Your data stays here</h3><p className="list-row-detail" style={{ lineHeight: 1.7, marginTop: 8 }}>Uploaded files and every calculation stay in this browser’s local storage. No data is sent to a server or AI provider in this build. Clear this browser’s site data to remove locally stored ledger information.</p></div>
        <div><h3 className="card-title"><Sparkles size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Demo data status</h3><p className="list-row-detail" style={{ lineHeight: 1.7, marginTop: 8 }}>{synthetic ? 'The demo ledger is synthetic and reproducibly generated by a fixed seed. It includes eight buyer patterns, one worsening over time, and six fictional suppliers. All names, invoices, dates and amounts displayed are fictional.' : 'A private ledger is loaded. Confirm source accuracy; demo labels no longer apply.'} Demo values are examples, not evidence about any real party.</p></div>
        <div><h3 className="card-title"><Scale size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Indicative statutory calculations</h3><p className="list-row-detail" style={{ lineHeight: 1.7, marginTop: 8 }}>Modeled Section 16 interest assumes 3× dated Bank Rate, monthly rests and pro-rata accrual. Section 43B(h) exposure is a simplified estimate based on supplier category, Udyam flag, due date and selected tax rate. Legal interpretation, notifications and facts may differ. The status and applicability of the 2026 MSMED amendment have not been independently verified.</p></div>
        <div><h3 className="card-title"><CircleHelp size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Behavior and forecast limits</h3><p className="list-row-detail" style={{ lineHeight: 1.7, marginTop: 8 }}>Sparse or changing payment history can make buyer distributions unreliable. Forecasts assume modeled future behavior and scheduled payables; they do not include every operating inflow, payroll, tax, credit facility, dispute or bank delay.</p></div>
      </div>
      <div className="alert-box" style={{ marginTop: 15 }}><strong>Not legal or tax advice.</strong> All interest and tax amounts are indicative. Assumptions and statutory treatments must be verified by a qualified Indian accountant or legal adviser before relying on them.</div>
      <div style={{ marginTop: 15, paddingTop: 13, borderTop: '1px solid #eeeae1', fontSize: 10, color: '#89918e' }}>Financial year end used for modeled exposure: {shortDate(nextFinancialYearEnd(settings.asOfDate))}. Interest-rate assumptions in this local build may be outdated; verify each effective date and bank rate.</div>
    </section>
  </div>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function Router() {
  const [data, setData] = useState<Persisted>(getInitial);
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* Browser may block storage; current session remains usable. */ } }, [data]);
  const setLedger = (ledger: Ledger) => setData((prev) => ({ ...prev, ledger }));
  const setSettings = (settings: AppSettings) => setData((prev) => ({ ...prev, settings }));
  const setRates = (rates: RateChange[]) => setData((prev) => ({ ...prev, rates }));
  const setSynthetic = (synthetic: boolean) => setData((prev) => ({ ...prev, synthetic }));
  const reset = () => {
    const settings = { ...DEFAULT_SETTINGS, asOfDate: today };
    setData({ ledger: generateDemoLedger(settings.asOfDate), settings, rates: DEFAULT_RATES.map((r) => ({ ...r })), synthetic: true });
  };
  return <Shell synthetic={data.synthetic} asOfDate={data.settings.asOfDate} onReset={reset}>
    <RoutedErrorBoundary><Switch>
      <Route path="/" component={() => <Dashboard ledger={data.ledger} settings={data.settings} rates={data.rates} synthetic={data.synthetic} />} />
      <Route path="/upload" component={() => <UploadPage ledger={data.ledger} setLedger={setLedger} settings={data.settings} setSettings={setSettings} setSynthetic={setSynthetic} />} />
      <Route path="/actions" component={() => <ActionsPage ledger={data.ledger} settings={data.settings} rates={data.rates} />} />
      <Route path="/what-if" component={() => <WhatIfPage ledger={data.ledger} settings={data.settings} rates={data.rates} />} />
      <Route path="/notice" component={() => <NoticePage ledger={data.ledger} settings={data.settings} rates={data.rates} />} />
      <Route path="/backtest" component={() => <BacktestPage ledger={data.ledger} />} />
      <Route path="/assumptions" component={() => <AssumptionsPage settings={data.settings} setSettings={setSettings} rates={data.rates} setRates={setRates} synthetic={data.synthetic} />} />
      <Route component={NotFound} />
    </Switch></RoutedErrorBoundary>
  </Shell>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
