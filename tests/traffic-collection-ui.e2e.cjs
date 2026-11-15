/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:3174';
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
 for(const width of [320,390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('tbo-auth',JSON.stringify({name:'Demo',email:'demo@example.com',role:'Demo'})));
  await page.goto(base+'/dashboard/india-market',{waitUntil:'domcontentloaded'});
  const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Ongoing traffic evidence'})});await panel.waitFor({timeout:30000});
  await panel.getByText('Saved snapshots').waitFor();await panel.getByText('No comparable future outcomes yet.',{exact:false}).waitFor();
  await panel.getByText('The scheduler can miss or delay runs',{exact:false}).waitFor();
  const layout=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth,main:document.querySelector('main').scrollWidth,client:document.querySelector('main').clientWidth}));
  if(layout.document>layout.viewport||layout.main>layout.client)throw Error('overflow '+JSON.stringify(layout));if(errors.length)throw Error(errors.join('; '));
  console.log('PASS collection status, empty future test and layout',width);await page.close();
 }
 const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('tbo-auth',JSON.stringify({name:'Demo',email:'demo@example.com',role:'Demo'})));
 await page.route('**/api/india-market/collection?*',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 await page.goto(base+'/dashboard/india-market');await page.getByText('Collection status is unavailable.',{exact:false}).waitFor({timeout:30000});console.log('PASS collection failure is disclosed');await page.close();
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
