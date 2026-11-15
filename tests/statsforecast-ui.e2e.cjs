/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:3173';
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
 for(const width of [320,390,768,1440]){
  console.log('Checking width',width);const page=await browser.newPage({viewport:{width,height:900}}),errors=[]; page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('tbo-auth',JSON.stringify({name:'Demo',email:'demo@example.com',role:'Demo'})));
  await page.goto(base+'/dashboard/india-market',{waitUntil:'domcontentloaded'});
  const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'StatsForecast model comparison'})});
  await panel.waitFor({timeout:60000});
  await panel.getByRole('heading',{name:'Against the current route policy'}).waitFor();
  await panel.getByText('Research, not an allocation input.').waitFor();
  await panel.getByText('How the model was tested').click();
  await panel.getByText(/Source API reported retrieval at/).waitFor();
  const result=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth,main:document.querySelector('main').scrollWidth,client:document.querySelector('main').clientWidth}));
  if(result.document>result.viewport||result.main>result.client)throw Error('overflow '+JSON.stringify(result));
  if(errors.length)throw Error(errors.join('; '));console.log('PASS StatsForecast research panel, paired policy, disclosures and layout',width);await page.close();
 }
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
