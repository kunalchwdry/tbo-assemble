/* eslint-disable @typescript-eslint/no-require-imports */
// Opt-in, real Supabase auth + RLS smoke test. Creates only synthetic records,
// never creates users, reads only those IDs and attempts to delete them in finally.
// It does NOT test the site's browser session, server actions or legacy APIs.
const {createClient}=require('@supabase/supabase-js');
const {randomUUID}=require('node:crypto');
const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','TEST_A_EMAIL','TEST_A_PASSWORD','TEST_B_EMAIL','TEST_B_PASSWORD'];
if(process.env.CONFIRM_SYNTHETIC_ACCOUNT_TEST!=='yes' || required.some(k=>!process.env[k])){
 console.error('Not run. Supply two dedicated test accounts and the project public configuration, and set CONFIRM_SYNTHETIC_ACCOUNT_TEST=yes. See docs/security/real-account-testing.md.');process.exit(2);
}
const endpoint=new URL(process.env.SUPABASE_URL);
if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.supabase.co')||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw Error('Use the HTTPS Supabase project URL.');
const key=process.env.SUPABASE_PUBLISHABLE_KEY;
if(!key.startsWith('sb_publishable_')){
 try{const role=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role;if(role!=='anon')throw Error('wrong role')}catch{throw Error('Supply only a publishable or legacy anon key, never a secret or service-role key.')}
}
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const client=()=>createClient(endpoint.origin,process.env.SUPABASE_PUBLISHABLE_KEY,options);
const a=client(),b=client(),anonymous=client();const mark='Synthetic isolation test '+randomUUID();const made=[];
function ok(result,label){if(result.error)throw Error(label+' failed');return result.data}
async function main(){
 try{
  const A=ok(await a.auth.signInWithPassword({email:process.env.TEST_A_EMAIL,password:process.env.TEST_A_PASSWORD}),'Account A sign-in');
  const B=ok(await b.auth.signInWithPassword({email:process.env.TEST_B_EMAIL,password:process.env.TEST_B_PASSWORD}),'Account B sign-in');
  if(!A.user?.id||!B.user?.id||A.user.id===B.user.id)throw Error('Two distinct test accounts are required.');
  const draft=ok(await a.from('private_event_drafts').insert({title:mark,location:'Synthetic',starts_on:'2030-01-01',ends_on:'2030-01-02'}).select('id,title').single(),'Create synthetic private event');made.push(['private_event_drafts',draft.id]);
  const guest=ok(await a.from('private_event_guests').insert({event_id:draft.id,name:mark,email:'',phone:'',status:'invited'}).select('id,name').single(),'Create synthetic guest');made.push(['private_event_guests',guest.id]);
  const room=ok(await a.from('private_event_room_blocks').insert({event_id:draft.id,hotel_name:mark,room_type:'Synthetic',total_qty:1,rate:100}).select('id,hotel_name').single(),'Create synthetic room');made.push(['private_event_room_blocks',room.id]);
  const quote=ok(await a.from('private_quote_reviews').insert({title:mark,snapshot:{synthetic:true,notice:'isolation test only'}}).select('id,title').single(),'Create synthetic quote review');made.push(['private_quote_reviews',quote.id]);
  const plan=ok(await a.from('private_inventory_plans').insert({name:mark,source:'synthetic',items:[{id:'synthetic-test'}],budget:0,risk:0,as_of:'2030-01-01',model_version:'scenario-grid-v4'}).select('id,name').single(),'Create synthetic plan');made.push(['private_inventory_plans',plan.id]);
  for(const [table,id] of made){
   const own=ok(await a.from(table).select('id').eq('id',id),'Read own synthetic record');if(own.length!==1)throw Error('Owner cannot read its own '+table+' test record.');
   const other=await b.from(table).select('id').eq('id',id);if(other.error)throw Error('Cross-account read could not be tested: '+table);if(other.data?.length)throw Error('Cross-account record visible: '+table);
   const publicResult=await anonymous.from(table).select('id').eq('id',id);if(publicResult.error&&publicResult.error.code!=='42501')throw Error('Anonymous denial could not be tested: '+table);if(publicResult.data?.length)throw Error('Anonymous record visible: '+table);
  }
  console.log('PASS: sign-in, synthetic owner reads, cross-account and anonymous read denial for event, room, guest, quote review and plan.');
 }finally{
  const failed=[];
  for(const [table,id] of made.reverse()){
   const r=await a.from(table).delete().eq('id',id).select('id');if(r.error||r.data?.length!==1)failed.push(table+':'+id);
  }
  if(failed.length){console.error('CLEANUP REQUIRED: delete only these synthetic records via account A:',failed.join(', '));process.exitCode=1}
  await Promise.allSettled([a.auth.signOut({scope:'local'}),b.auth.signOut({scope:'local'})]);
 }
}
main().catch(()=>{console.error('Test failed. No credentials or account data were printed. A network failure may leave a synthetic record with this exact title/name: '+mark+'. Inspect and remove only that test record in account A. Inspect configuration, auth and RLS.');process.exitCode=1});
