/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:3173';
const empty={state:'available',job:null,lastRun:null,route:{captureCount:0,lastCapture:null,comparison:{count:0,pending:0,mae:{'last-observed':null,'last-year':null,'ses-optimized':null,'seasonal-auto-ets':null,selectedPolicy:null}}}};
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
for(const width of [320,390,768,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.addInitScript(()=>localStorage.setItem('tbo-auth',JSON.stringify({name:'Demo',email:'demo@example.com',role:'Demo'})));
 await page.route('**/api/india-market/forecast-monitor?*',async route=>{
  const u=new URL(route.request().url()),key=u.searchParams.get('origin')+'-'+u.searchParams.get('destination');
  if(key==='DEL-PNQ')return route.fulfill({json:empty});
  if(key==='PNQ-DEL')return route.fulfill({json:{...empty,job:{status:'completed',conclusion:'failure',startedAt:'2026-01-01T00:00:00Z'},lastRun:{startedAt:'2026-01-01T00:00:00Z',status:'source-error'},route:{...empty.route,captureCount:1,lastCapture:{recordedAt:'2026-01-01T00:00:00Z',latestUsableMonth:'2025-11',forecastStatus:'stale-or-missing',rowsSha256:'a'.repeat(64)}}}});
  return route.fulfill({json:{state:'unavailable',job:null}});
 });
 await page.goto(base+'/dashboard/india-market',{waitUntil:'domcontentloaded'});
 const box=page.getByRole('heading',{name:'Automatic StatsForecast check'}).locator('..').locator('..').locator('..').locator('..');
 await box.getByText('No scored future targets yet.',{exact:false}).waitFor();
 await page.locator('#india-route').selectOption('PNQ-DEL');
 await box.getByText('Data is stale or missing; forecast withheld').waitFor();await box.getByText(/latest job reported failure/).waitFor();await box.getByText(/more than 10 days old/).waitFor();
 await page.locator('#india-route').selectOption('DEL-BOM');await box.getByText(/Research archive unavailable/).waitFor();
 const result=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth,main:document.querySelector('main').scrollWidth,client:document.querySelector('main').clientWidth}));
 if(result.document>result.viewport||result.main>result.client)throw Error('overflow '+JSON.stringify(result));
 if(errors.length)throw Error(errors.join('; '));console.log('PASS forward monitor empty, stale, failed, overdue, unavailable and route switching',width);await page.close();
}
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
