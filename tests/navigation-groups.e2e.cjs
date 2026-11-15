/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:3102';
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));try{
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await page.goto(base+'/inventory');await page.getByRole('heading',{name:'Inventory decision workspace'}).waitFor();
  await page.locator('.workspace-menu summary').click();const menu=page.getByRole('navigation',{name:'Inventory workspace pages'});
  const expected={'Plan':['Overview','Saved plans'],'Data & demand':['Inventory data','Demand inputs','Demand coverage','Demand validation'],'Supplier review':['Supplier quotes','Supplier terms','Landed cost'],'Risk analysis':['Stress test','Cancellation risk'],'Advanced & market':['Market context','Allocation check']};
  for(const [group,names] of Object.entries(expected)){const section=menu.getByRole('region',{name:group});for(const name of names){const link=section.getByRole('link',{name:new RegExp('^'+name+'(?: |$)')});if(await link.count()!==1||!await link.isVisible())throw Error(`${width} missing ${name} in ${group}`)}}
  if(await menu.getByRole('link').count()!==13)throw Error('Expected all 13 workspace links once');
  const dim=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,inner:innerWidth,main:document.querySelector('main').scrollWidth,client:document.querySelector('main').clientWidth}));if(dim.doc>dim.inner||dim.main>dim.client)throw Error('overflow '+width+' '+JSON.stringify(dim));
  await page.locator('.workspace-menu summary').click();
  let sidebar;if(width<1024){await page.getByRole('button',{name:'Open navigation menu'}).click();sidebar=page.locator('#mobile-navigation')}else sidebar=page.locator('aside[data-tour=sidebar]');
  for(const label of ['Dashboard','Calendar','Analytics','Inventory Decisions','Flight Predictions'])if(!await sidebar.getByRole('link',{name:new RegExp('^'+label+'(?:\\s|$)')}).isVisible())throw Error('Missing primary '+label+' at '+width);
  const more=sidebar.locator('details.group\\/travel');if(await more.getAttribute('open')!==null)throw Error('More tools should start collapsed');
  const summary=more.locator('summary');await summary.focus();await page.keyboard.press('Enter');for(const label of ['Fare Forecast','Hotel Demand','India Travel Data','Travel Prediction Lab','Cancellation & Risk'])if(!await more.getByRole('link',{name:label,exact:true}).isVisible())throw Error('Missing secondary '+label);
  await page.keyboard.press('Enter');if(await more.getAttribute('open')!==null)throw Error('Keyboard cannot close travel tools');
  if(width===390){await page.screenshot({path:'/home/user/login-debug/navigation-mobile.png'});await page.getByRole('button',{name:'Close navigation menu'}).click();await page.locator('.workspace-menu summary').click();await page.locator('.workspace-menu').screenshot({path:'/home/user/login-debug/navigation-grouped.png'});}
  console.log('PASS grouped navigation and sidebar',width);
 }
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/inventory/landed-cost');await page.locator('.workspace-menu summary').click();const selected=page.getByRole('navigation',{name:'Inventory workspace pages'}).getByRole('link',{name:/^Landed cost/});if(await selected.getAttribute('aria-current')!=='page')throw Error('current page not identified');
 if(errors.length)throw Error('Browser errors: '+errors.join('; '));console.log('PASS active page');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
