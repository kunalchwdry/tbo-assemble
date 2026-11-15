/* eslint-disable @typescript-eslint/no-require-imports */
// Only use against the dedicated local test deployment and disposable DB.
const assert=require('node:assert/strict');
const {Client}=require('pg');
const base=process.env.TEST_BASE||'http://127.0.0.1:3174';
const database=process.env.TEST_TRAFFIC_DATABASE_URL;
if(base!=='http://127.0.0.1:3174'||database!=='postgresql://user@127.0.0.1:55441/traffic_research_test')throw Error('Refusing to run outside the isolated local test environment');
const secret='local-traffic-research-test-secret';
(async()=>{const db=new Client({connectionString:database});await db.connect();try{
 const before=await db.query('SELECT count(*)::int AS n FROM public.traffic_research_snapshots');assert.equal(before.rows[0].n,6,'run a successful local capture before this test');
 let r=await fetch(base+'/api/cron/collect-traffic');assert.equal(r.status,401);
 r=await fetch(base+'/api/cron/collect-traffic',{headers:{authorization:`Bearer ${secret}`}});assert.equal(r.status,200);assert.equal((await r.json()).status,'already-complete-or-running');
 r=await fetch(base+'/api/india-market/collection?origin=AAA&destination=BBB');assert.equal(r.status,400);
 r=await fetch(base+'/api/india-market/collection?origin=DEL&destination=PNQ');assert.equal(r.status,200);const body=await r.json();assert.equal(body.captureCount,1);assert.equal(body.invalidCount,0);assert.equal(body.comparison.count,0);assert.ok(body.lastCapture.rowsSha256);assert.ok(body.lastCapture.sourceSha256);
 const after=await db.query('SELECT count(*)::int AS n FROM public.traffic_research_snapshots');assert.equal(after.rows[0].n,6);
 console.log('PASS cron authentication, idempotence, route validation, status and frozen comparison');
 }finally{await db.end()}})().catch(e=>{console.error(e);process.exitCode=1});
