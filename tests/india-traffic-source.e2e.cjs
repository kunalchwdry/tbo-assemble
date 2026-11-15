const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:3173';
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
 for(const width of [320,390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('tbo-auth',JSON.stringify({name:'Demo',email:'demo@example.com',role:'Demo'})));
  await page.goto(base+'/dashboard/india-market');
  await page.getByText('View original source files and hashes').waitFor({timeout:30000});
  await page.getByText('View original source files and hashes').click();
  await page.getByRole('link',{name:'DGCA 2026-09 workbook'}).waitFor();
  await page.getByText('1,07,712',{exact:true}).first().waitFor();
  await page.getByText('Current estimate withheld').waitFor();
  const result=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth,main:document.querySelector('main').scrollWidth,client:document.querySelector('main').clientWidth}));
  if(result.document>result.viewport||result.main>result.client)throw Error('overflow '+JSON.stringify(result));
  if(errors.length)throw Error(errors.join('; '));console.log('PASS live DGCA source disclosure, Sep data, stale gate and layout',width);await page.close();
 }
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
