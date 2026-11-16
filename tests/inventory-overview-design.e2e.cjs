/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic demo only. Run against a local app with TEST_BASE and Playwright installed.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_BASE || 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base + '/inventory');
    await page.getByRole('heading', { name: 'Procurement opportunities' }).waitFor();
    await page.getByText(/Decision support only; verify supplier terms. No purchase is made/).waitFor();
    for (const id of ['risk-detail', 'budget-detail', 'review-detail', 'charts-detail']) {
      const details = page.locator('#' + id);
      if (await details.evaluate(el => el.open)) throw Error(id + ' should start collapsed');
      await details.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      if (!await details.evaluate(el => el.open)) throw Error(id + ' keyboard disclosure failed');
    }
    await page.getByRole('heading', { name: 'Season risk profile' }).waitFor();
    await page.getByRole('heading', { name: 'What if your budget changes?' }).waitFor();
    await page.getByRole('heading', { name: 'Decision readiness checks' }).waitFor();
    await page.getByRole('heading', { name: 'Demand by opportunity' }).waitFor();
    await page.locator('#availability-target').selectOption('0.85');
    if (!await page.locator('#risk-detail > summary').innerText().then(t => t.includes('85%'))) throw Error('Availability target was not surfaced in summary');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const d = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, width: innerWidth, main: document.querySelector('main').scrollWidth, mainWidth: document.querySelector('main').clientWidth }));
      if (d.doc > d.width || d.main > d.mainWidth) throw Error('Overflow ' + width + ': ' + JSON.stringify(d));
      console.log('PASS expanded disclosures at', width);
    }
    await page.goto(base + '/inventory#forecast');
    await page.locator('#charts-detail[open]').waitFor();
    if (!await page.locator('#forecast').isVisible()) throw Error('Direct forecast link is hidden');
    await page.goto(base + '/inventory');
    await page.locator('.workspace-menu > summary').click();
    const menu = page.getByRole('navigation', { name: 'Inventory workspace pages' });
    await menu.getByRole('link', { name: /^Landed cost/ }).click();
    await page.waitForURL('**/inventory/landed-cost');
    await page.getByRole('heading', { level: 1, name: 'Landed cost' }).waitFor();
    if (errors.length) throw Error('Browser errors: ' + errors.join('; '));
    console.log('PASS safety caveat, keyboard disclosures, target summary, forecast anchor and grouped tool navigation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
