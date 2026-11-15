const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:3173';
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});try{
 for(const width of [320,390,768,1440]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));let requests=0;
 await p.route('**/api/market/search-trends',async route=>{requests++;const now=Date.now();const today=Math.floor(now/86400000)*86400000;const days=Array.from({length:28},(_,i)=>({date:new Date(today-(28-i)*86400000).toISOString().slice(0,10),value:i<21?20:40}));await route.fulfill({status:200,json:{presetId:'goa-hotels',query:'Goa hotels',geo:'IN',source:'Google Trends via SerpApi',fetchedAt:new Date(now).toISOString(),days}})});
 await p.goto(base+'/inventory/market');const panel=p.locator('.trends-panel');await panel.getByRole('heading',{name:'Travel search interest'}).waitFor();if(requests)throw Error('automatic request');
 await panel.getByRole('button',{name:'Fetch search interest'}).click();await panel.getByText('Previous seven-day average').waitFor();if(requests!==1)throw Error('expected one request');
 p.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Compare with current plan'}).click();await panel.getByText('Experimental comparison').waitFor();
 await p.locator('.attention-panel').getByRole('button',{name:'Enable live scenario'}).click();await panel.getByText('Comparison paused:',{exact:false}).waitFor();await panel.getByText('Turn off the Wikipedia live attention scenario',{exact:false}).waitFor();
 const v=await p.evaluate(()=>({doc:document.documentElement.scrollWidth,inner:innerWidth,main:document.querySelector('main').scrollWidth,client:document.querySelector('main').clientWidth}));if(v.doc>v.inner||v.main>v.client)throw Error('overflow '+JSON.stringify(v));if(errors.length)throw Error(errors.join('; '));console.log('PASS mocked fetch, comparison isolation, no automatic calls, responsive',width);await p.close();
 }
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
