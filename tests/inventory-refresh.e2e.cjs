/* eslint-disable @typescript-eslint/no-require-imports */
// Local synthetic-demo test; no authentication or real user data required.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_BASE || 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/inventory');
    const summary = page.locator('.plan-overview');
    await summary.getByRole('heading', { name: /Your plan, at a glance/ }).waitFor();
    await summary.getByText('SYNTHETIC DEMO').waitFor();
    await page.getByText(/Decision support only; verify supplier terms. No purchase is made/).waitFor();
    await page.locator('#budget').fill('0');
    await summary.getByText(/Unapplied budget edits/).waitFor();
    await page.locator('.budget-input').getByRole('button', { name: 'Apply' }).click();
    if (!await summary.getByText('₹0', { exact: true }).count()) throw Error('Updated budget not shown');
    await page.locator('#budget').fill('5000000');
    await page.locator('.budget-input').getByRole('button', { name: 'Apply' }).click();
    const carousel = page.locator('.opportunity-cards');
    const second = carousel.locator('.opportunity-card').nth(1);
    await second.getByRole('button', { name: 'View details' }).click();
    await second.locator('.opportunity-details').waitFor();
    if (!await page.getByText(/Swipe to explore opportunities/).isVisible()) throw Error('Missing mobile swipe hint');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const d = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, width: innerWidth, main: document.querySelector('main').scrollWidth, mainWidth: document.querySelector('main').clientWidth }));
      if (d.doc > d.width || d.main > d.mainWidth) throw Error('Overflow at ' + width + ': ' + JSON.stringify(d));
      console.log('PASS decision snapshot and opportunities at', width);
    }
    if (errors.length) throw Error('Browser errors: ' + errors.join('; '));
    console.log('PASS budget status, model caveats and mobile opportunity details');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
