/* eslint-disable @typescript-eslint/no-require-imports */
// Only synthetic inputs, no auth or live procurement.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_BASE || 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; let tileRequests = 0;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://tile.openstreetmap.org/**', async route => { tileRequests++; await route.abort(); });
  try {
    await page.goto(base + '/inventory');
    if (tileRequests) throw Error('Tiles loaded before opting into map view');
    await page.getByRole('button', { name: /Explore map/ }).click();
    await page.locator('.destination-map').waitFor();
    await page.locator('.map-error').waitFor();
    if (await page.locator('.destination-pin').count() !== 7) throw Error('Expected seven synthetic destination pins');
    await page.locator('.destination-list').getByRole('button', { name: /Goa/ }).click();
    await page.locator('.destination-selected').getByRole('heading', { name: 'Goa', exact: true }).waitFor();
    await page.locator('.destination-selected').getByText('North Goa beach hotels').waitFor();
    await page.getByLabel('Filter inventory type').selectOption('Flight');
    if (await page.locator('.destination-pin').count() !== 2) throw Error('Map not filtered to flights');
    await page.locator('.destination-side-head').getByText('2 destinations').waitFor();
    await page.getByRole('button', { name: 'List view' }).click();
    await page.locator('.opportunities').getByText('Delhi → Dubai').filter({ visible: true }).first().waitFor();
    await page.getByLabel('Filter inventory type').selectOption('All inventory');
    await page.getByRole('button', { name: /Explore map/ }).click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const size = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, width: innerWidth, main: document.querySelector('main').scrollWidth, available: document.querySelector('main').clientWidth }));
      if (size.doc > size.width || size.main > size.available) throw Error('Overflow at ' + width + ': ' + JSON.stringify(size));
      console.log('PASS responsive map', width);
    }
    // Import an unknown destination; it must remain visible without a false pin.
    await page.getByRole('link', { name: 'Inventory data', exact: true }).click();
    const csv = 'id,name,destination,kind,period,buy,referencePrice,capacity,bookings,searches,conversion,seasonal,signal,cancellations,volatility,soldOut,integration,timing\ncase1,Synthetic Hotel,Atlantis,Hotel,Dec 2026,100,500,8,100,5000,0.05,1,1,0,0,0,Manual,Verify';
    await page.locator('section.import-panel input[type=file]').setInputFiles({ name: 'synthetic-unknown.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByText(/Inventory inputs: synthetic-unknown.csv/).waitFor();
    await page.getByRole('link', { name: 'Overview', exact: true }).first().click();
    await page.locator('.destination-list').getByRole('button', { name: /Atlantis/ }).waitFor();
    await page.getByText(/1 destination is not mapped/).waitFor();
    if (await page.locator('.destination-pin').count()) throw Error('Unknown destination received a fabricated pin');
    await page.locator('.destination-selected').getByText('Synthetic Hotel').waitFor();
    if (errors.length) throw Error('Browser errors: ' + errors.join('; '));
    console.log('PASS lazy loading, tile fallback, selection, filters, list view and unmapped import');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
