/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only, anonymous browser checks. They do not exercise a real signed-in
// session, prove RLS isolation, or secure the separate legacy dashboard.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:3178';
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']}),page=await browser.newPage();try{
 await page.addInitScript(()=>localStorage.setItem('tbo-auth',JSON.stringify({name:'Demo',email:'demo@example.com',role:'Demo'})));
 await page.goto(base+'/dashboard/private-events',{waitUntil:'domcontentloaded'});
 await page.getByText(/Private events require a Supabase account/).waitFor();
 if(await page.getByRole('heading',{name:'Create an event',exact:true}).count())throw Error('Anonymous user saw the private event form');
 await page.goto(base+'/secure-account',{waitUntil:'domcontentloaded'});
 await page.waitForURL(u=>u.pathname==='/login');
 if(await page.getByRole('heading',{name:'Your private drafts'}).count())throw Error('Anonymous user saw private drafts');
 const r=await page.request.get(base+'/api/india-market/evidence?origin=DEL&destination=PNQ');
 if(r.status()!==401)throw Error('Anonymous evidence did not return 401');
 console.log('PASS anonymous private event page, account redirect and route-evidence API');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
