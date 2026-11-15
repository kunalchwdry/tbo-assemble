// Exercises the actual HTTP route + PostgreSQL + live public source with a LOCAL
// authentication double, not real Supabase authentication. See the companion
// setup guide. This test intentionally modifies ONLY a dedicated local database.
const assert = require('node:assert/strict');
const {Client} = require('pg');
const base = 'http://127.0.0.1:3173', path = '/api/india-market/evidence';
const connectionString = process.env.TEST_EVIDENCE_DATABASE_URL;
if (!connectionString) throw Error('Set TEST_EVIDENCE_DATABASE_URL to the dedicated local database.');
const dbUrl = new URL(connectionString);
if (dbUrl.hostname !== '127.0.0.1' || dbUrl.port !== '5548' || dbUrl.pathname !== '/evidence_local_test') throw Error('Refusing to run against a non-test database.');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
function cookie(id) {
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const expires_at = Math.floor(Date.now()/1000)+3600;
  const token = encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:id,exp:expires_at})+'.fake';
  return 'sb-127-auth-token=base64-'+encode({access_token:token,refresh_token:'local-test',expires_at,expires_in:3600,token_type:'bearer',user:{id}});
}
async function get(id, origin='DEL', destination='PNQ') {
  const r = await fetch(`${base}${path}?origin=${origin}&destination=${destination}`, {headers:id?{cookie:cookie(id)}:{}});
  return {status:r.status, body:await r.json()};
}
async function post(id, origin='DEL', destination='PNQ', extra={}) {
  const r = await fetch(base+path, {method:'POST', headers:{'content-type':'application/json',origin:base,...(id?{cookie:cookie(id)}:{}),...extra.headers}, body:JSON.stringify({origin,destination,clientTime:extra.clientTime||new Date().toISOString()})});
  return {status:r.status,body:await r.json()};
}
async function remove(id, snapshotId, extra={}) {
 const r=await fetch(base+path,{method:'DELETE',headers:{'content-type':'application/json',origin:base,...(id?{cookie:cookie(id)}:{}),...extra.headers},body:JSON.stringify({id:snapshotId})});
 return {status:r.status,body:await r.json()};
}
(async () => {
 const db = new Client({connectionString}); await db.connect();
 try {
  // This test's database is explicitly disposable. Refuse to touch any other owner.
  const foreign = await db.query('SELECT count(*)::int AS n FROM public.route_forecast_evidence WHERE owner_id <> ALL($1::uuid[])', [[A,B]]);
  assert.equal(foreign.rows[0].n,0,'test database contains non-test records');
  await db.query('DELETE FROM public.route_forecast_evidence WHERE owner_id = ANY($1::uuid[])',[[A,B]]);
  assert.equal((await get()).status,401);
  assert.equal((await post(A,'DEL','PNQ',{headers:{origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await post(A,'DEL','PNQ',{clientTime:'2000-01-01T00:00:00Z'})).status,409);
  assert.equal((await get(A,'BAD','PNQ')).status,400);
  console.log('PASS unsigned, cross-origin, unsupported route and client-clock gates');
  const sameRoute = await Promise.all([post(A),post(A)]);
  assert.deepEqual(sameRoute.map(x=>x.status).sort(),[200,409]);
  const saved=await get(A),hidden=await get(B);
  assert.equal(saved.status,200); assert.equal(saved.body.records.length,1);
  assert.match(saved.body.records[0].sourceSha256,/^[a-f0-9]{64}$/);
  assert.ok(saved.body.records[0].rows.length>0); assert.deepEqual(hidden.body.records,[]);
  const ownB=await post(B); assert.equal(ownB.status,200);
  const bRecords=(await get(B)).body.records;
  assert.equal(bRecords.length,1); assert.notEqual(bRecords[0].id,saved.body.records[0].id);
  assert.equal((await get(A)).body.records[0].id,saved.body.records[0].id);
  console.log('PASS real source save/read, concurrent daily limit and account isolation (fake auth)');
  assert.equal((await remove(null,bRecords[0].id)).status,401);
  assert.equal((await remove(B,bRecords[0].id,{headers:{origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await remove(B,'not-a-uuid')).status,400);
  assert.equal((await remove(A,bRecords[0].id)).status,404);
  assert.equal((await get(B)).body.records.length,1);
  assert.equal((await remove(B,bRecords[0].id)).status,200);
  assert.equal((await get(B)).body.records.length,0);
  assert.equal((await post(B)).status,200);
  console.log('PASS owner-only delete, origin/auth gates and same-day recapture after deletion');
  await db.query(`INSERT INTO public.route_forecast_evidence(owner_id,origin,destination,captured_at,source_sha256,snapshot)
    SELECT $1::uuid,'DEL','PNQ',now() - (n * interval '1 day'),repeat('a',64),'[]'::jsonb FROM generate_series(1,98) AS n`,[A]);
  const quotaRace = await Promise.all([post(A,'BOM','DEL'),post(A,'DEL','BOM')]);
  assert.deepEqual(quotaRace.map(x=>x.status).sort(),[200,429]);
  const count=await db.query('SELECT count(*)::int AS n FROM public.route_forecast_evidence WHERE owner_id=$1::uuid',[A]);
  assert.equal(count.rows[0].n,100); assert.equal((await post(A,'DEL','BLR')).status,429);
  console.log('PASS concurrent account quota and exact 100-record cap');
  for (const role of ['anon','authenticated']) {
    await db.query(`SET ROLE ${role}`);
    try { await assert.rejects(db.query('SELECT * FROM public.route_forecast_evidence'),/permission denied/i); }
    finally { await db.query('RESET ROLE'); }
  }
  console.log('PASS direct client-role access denied');
 } finally {
  await db.query('DELETE FROM public.route_forecast_evidence WHERE owner_id = ANY($1::uuid[])',[[A,B]]);
  await db.end();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
