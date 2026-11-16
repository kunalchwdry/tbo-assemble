/* eslint-disable @typescript-eslint/no-require-imports */
// Run against a local preview with TEST_BASE and Playwright available.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_BASE || 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    const response = await page.goto(base);
    if (!response.ok()) throw Error('Homepage HTTP ' + response.status());
    await page.getByRole('heading', { level: 1, name: /Make every inventory decision count/ }).waitFor();
    await page.getByText(/Starts with synthetic data. No purchases are made/).waitFor();
    await page.getByText(/Illustration only—not a forecast of actual profit/).waitFor();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const d = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, width: innerWidth }));
      if (d.doc > d.width) throw Error('Horizontal overflow at ' + width + ': ' + JSON.stringify(d));
      console.log('PASS homepage viewport', width);
    }
    await page.getByTitle('Switch to dark mode').click();
    if (!await page.evaluate(() => document.documentElement.classList.contains('dark'))) throw Error('Dark mode did not activate');
    await page.getByTitle('Switch to light mode').click();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
    await page.getByRole('link', { name: 'Flight intelligence' }).last().waitFor();
    await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
    const research = await page.request.get(base + '/research/risk-engine.md');
    if (!research.ok()) throw Error('Research link HTTP ' + research.status());
    await page.getByRole('link', { name: 'Explore the planner' }).click();
    await page.waitForURL('**/inventory');
    await page.getByRole('heading', { level: 1, name: 'Inventory decision workspace' }).waitFor();
    if (errors.length) throw Error('Browser errors: ' + errors.join('; '));
    console.log('PASS planner and research links, mobile navigation, dark mode and demo caveats');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
