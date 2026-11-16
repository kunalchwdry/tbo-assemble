/* eslint-disable @typescript-eslint/no-require-imports */
// Local or synthetic-demo browser test. Never upload real data.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises');
const base=process.env.TEST_BASE||'http://127.0.0.1:3102';
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});const p=await browser.newPage({viewport:{width:390,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));try{
 await p.goto(base+'/inventory');await p.locator('#review-detail > summary').click();const section=p.locator('.decision-export');await section.getByRole('button',{name:'Download review'}).waitFor();
 const initial=await Promise.all([p.waitForEvent('download'),section.getByRole('button',{name:'Download review'}).click()]);const initialRecord=JSON.parse(await fs.readFile(await initial[0].path(),'utf8'));
 if(initialRecord.source!=='synthetic'||initialRecord.originalInventory.length!==initialRecord.result.rows.length||initialRecord.settings.budgetInr!==5000000)throw Error('Initial review does not match the model');
 await p.locator('#budget').fill('0');if(!await section.getByRole('button',{name:'Download review'}).isDisabled())throw Error('Unapplied budget export was not blocked');await p.locator('.budget-input').getByRole('button',{name:'Apply'}).click();
 const zero=await Promise.all([p.waitForEvent('download'),section.getByRole('button',{name:'Download review'}).click()]);const record=JSON.parse(await fs.readFile(await zero[0].path(),'utf8'));if(record.settings.budgetInr!==0||record.result.rows.some(r=>r.qty!==0))throw Error('Zero-budget snapshot incorrect');
 for(const width of [320,390,768,1440]){await p.setViewportSize({width,height:900});const dims=await p.evaluate(()=>({doc:document.documentElement.scrollWidth,inner:innerWidth,main:document.querySelector('main').scrollWidth,client:document.querySelector('main').clientWidth}));if(dims.doc>dims.inner||dims.main>dims.client)throw Error('Horizontal overflow at '+width);console.log('PASS viewport',width)}
 if(errors.length)throw Error('Browser errors: '+errors.join('; '));console.log('PASS exported synthetic review, unapplied-budget gate and zero-budget snapshot');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
