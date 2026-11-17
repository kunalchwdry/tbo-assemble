/**
 * Planner benchmark on deterministic synthetic portfolios (invented numbers; src/lib/synthetic-portfolio.ts).
 *
 *   npx tsx scripts/benchmark-optimizer.ts [--sizes 100,250,500,1000,2000] [--repeats 3] [--out file.json] [--md file.md]
 *
 * Each size runs in a fresh child process so peak memory (max RSS) belongs to that size alone. Settings match the
 * app's 1,000-product scale test: risk-cvar-v5 defaults (500 optimisation + 2,000 evaluation scenarios, decomposition
 * solver), risk 0.35, budget 35% of the full-capacity cost (rounded to ₹1 lakh), cash basis, asOf 2026-11-16. The
 * first run in each process is cold (includes JIT warm-up); later runs reuse the process. For 1,000 products the plan
 * API POST handler is also timed in-process (JSON parsing and validation included, no network).
 */
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, release, platform } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const asOf = '2026-11-16', risk = 0.35;

async function child(n: number, repeats: number) {
  const { syntheticPortfolio, fullCapacityCost } = await import('../src/lib/synthetic-portfolio');
  const { optimizePortfolio } = await import('../src/lib/portfolio-optimizer');
  const items = syntheticPortfolio(n);
  const budget = Math.min(1e9, Math.round(fullCapacityCost(items) * 0.35 / 1e5) * 1e5);
  const rssBefore = process.memoryUsage().rss;
  const runs: { ms: number; objective: number; upperBound: number; gap: number; spend: number; units: number }[] = [];
  for (let r = 0; r < repeats; r++) {
    const t = performance.now();
    const plan = optimizePortfolio(items, budget, risk, { asOf, engine: 'risk-cvar-v5' });
    const ms = performance.now() - t;
    runs.push({ ms, objective: plan.objective, upperBound: plan.upperBound, gap: plan.gap, spend: plan.rows.reduce((s, x) => s + x.spend, 0), units: plan.rows.reduce((s, x) => s + x.qty, 0) });
  }
  let api: { ms: number; status: number; bytes: number } | undefined;
  if (n === 1000) {
    const { POST } = await import('../src/app/api/procurement/plan/route');
    const body = JSON.stringify({ items: items.map(({ id, name, destination, kind, period, buy, referencePrice, capacity, bookings, searches, conversion, seasonal, signal, cancellations, volatility, soldOut, integration, timing, quoteExpiry, minOrderUnits, fixedOrderFee, allotmentBuy, allotmentDepositPct, allotmentCapacity, existingStock, recoveryPct }) => ({ id, name, destination, kind, period, buy, referencePrice, capacity, bookings, searches, conversion, seasonal, signal, cancellations, volatility, soldOut, integration, timing, quoteExpiry, minOrderUnits, fixedOrderFee, allotmentBuy, allotmentDepositPct, allotmentCapacity, existingStock, recoveryPct })), budget, risk, asOf, engine: 'risk-cvar-v5' });
    const t = performance.now();
    const res = await POST(new Request('http://localhost/api/procurement/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
    const text = await res.text();
    api = { ms: performance.now() - t, status: res.status, bytes: text.length };
  }
  const usage = process.resourceUsage();
  process.stdout.write(JSON.stringify({ n, budget, repeats, runs, api, rssBeforeMB: rssBefore / 2 ** 20, maxRssMB: usage.maxRSS / 1024, heapUsedMB: process.memoryUsage().heapUsed / 2 ** 20 }));
}

function parent() {
  const args = process.argv.slice(2), arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const sizes = (arg('--sizes') ?? '100,250,500,1000,2000').split(',').map(Number);
  const repeats = Number(arg('--repeats') ?? 3);
  const results = sizes.map(n => {
    const out = execFileSync(process.execPath, [...process.execArgv, new URL(import.meta.url).pathname, '--child', String(n), String(repeats)], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const r = JSON.parse(out);
    console.error(`n=${n} cold ${r.runs[0].ms.toFixed(0)} ms, warm ${r.runs.slice(1).map((x: { ms: number }) => x.ms.toFixed(0)).join('/')} ms, peak RSS ${r.maxRssMB.toFixed(0)} MB`);
    return r;
  });
  const environment = { node: process.version, v8: process.versions.v8, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, totalMemMB: Math.round(totalmem() / 2 ** 20), command: `npx tsx scripts/benchmark-optimizer.ts --sizes ${sizes.join(',')} --repeats ${repeats}`, date: new Date().toISOString() };
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const md = [
    '# Planner benchmark (synthetic portfolios)', '',
    `Environment: Node ${environment.node} on ${environment.platform}, ${environment.cpu}, ${environment.logicalCpus} logical CPUs, ${environment.totalMemMB} MB RAM. Command: \`${environment.command}\`.`, '',
    'risk-cvar-v5 defaults (500 optimisation + 2,000 evaluation scenarios, decomposition solver), risk 0.35, budget 35% of full-capacity cost. Invented numbers; this measures speed and memory, not plan quality.', '',
    '| Products | Cold run | Warm runs (median) | Peak RSS (process) | RSS before planning | Relative gap (bound − objective) / bound | Spend / budget |', '|---|---|---|---|---|---|---|',
    ...results.map(r => {
      const warm = r.runs.slice(1).map((x: { ms: number }) => x.ms), last = r.runs.at(-1);
      return `| ${r.n.toLocaleString('en-IN')} | ${(r.runs[0].ms / 1000).toFixed(2)} s | ${warm.length ? (median(warm) / 1000).toFixed(2) + ' s' : 'n/a'} | ${r.maxRssMB.toFixed(0)} MB | ${r.rssBeforeMB.toFixed(0)} MB | ${(100 * last.gap / Math.max(1, Math.abs(last.upperBound))).toFixed(3)}% | ${(100 * last.spend / r.budget).toFixed(1)}% |`;
    }), '',
    ...results.filter(r => r.api).map(r => `Plan API POST handler, ${r.n.toLocaleString('en-IN')} products, in-process (after the library runs above in the same process): HTTP ${r.api.status} in ${(r.api.ms / 1000).toFixed(2)} s, response ${(r.api.bytes / 1e6).toFixed(1)} MB.`), '',
    'Cold = first plan in a fresh process (includes JIT warm-up). Peak RSS is the whole Node process (tsx loader included). Single run per row on a shared sandbox: expect variance between runs.', '',
  ].join('\n');
  const out = arg('--out'), mdOut = arg('--md');
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ environment, settings: { asOf, risk, budget: '35% of full-capacity cost', engine: 'risk-cvar-v5 defaults' }, results }, null, 2) + '\n'); }
  if (mdOut) { mkdirSync(dirname(mdOut), { recursive: true }); writeFileSync(mdOut, md); }
  console.log(md);
}

const i = process.argv.indexOf('--child');
if (i >= 0) child(Number(process.argv[i + 1]), Number(process.argv[i + 2])).catch(e => { console.error(e); process.exit(1); });
else parent();
