/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:3102';
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));try{
 await page.goto(base+'/inventory');const s=page.locator('.budget-compare');await s.getByRole('heading',{name:'What if your budget changes?'}).waitFor();
 const input=s.locator('#comparison-budget'),compare=s.getByRole('button',{name:'Compare allocations'});await input.fill('0');await compare.click();await s.getByRole('heading',{name:/Alternative:/}).waitFor();
 if(!await s.getByText('Hotel room-nights').isVisible()||!await s.getByText('Flight seats').isVisible()||await page.locator('#budget').inputValue()!=='5000000')throw Error('Scenario preview or non-application failed');
 await s.locator('summary').click();if(!await s.getByText(/room-nights|seats/).first().isVisible())throw Error('Allocation changes not visible');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});const d=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,inner:innerWidth,main:document.querySelector('main').scrollWidth,client:document.querySelector('main').clientWidth}));if(d.doc>d.inner||d.main>d.client)throw Error('Horizontal overflow at '+width+': '+JSON.stringify(d));console.log('PASS viewport',width)}
 await page.setViewportSize({width:390,height:900});await s.screenshot({path:'/home/user/login-debug/budget-comparison-mobile.png'});
 await input.fill('2000000');if(await s.getByRole('heading',{name:/Alternative:/}).count())throw Error('Edited what-if remains visible');await compare.click();await page.locator('#budget').fill('1');if(!await compare.isDisabled()||await s.getByRole('heading',{name:/Alternative:/}).count())throw Error('Pending budget not gated');await page.locator('#budget').fill('5000000');await input.fill('2000000');await compare.click();await s.getByRole('button',{name:'Use this budget in my plan'}).click();if(await page.locator('#budget').inputValue()!=='2000000')throw Error('Explicit apply failed');if(!await s.getByText('Alternative budget applied to the plan. No purchase was made.').isVisible())throw Error('Apply notice missing');
 await input.fill('1000000001');await compare.click();if(!await s.getByRole('alert').isVisible())throw Error('Invalid comparison budget accepted');
 if(errors.length)throw Error(errors.join('; '));console.log('PASS comparison preview, stale/pending gates, explicit apply, invalid input');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
