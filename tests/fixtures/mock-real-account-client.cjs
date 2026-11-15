/* eslint-disable @typescript-eslint/no-require-imports */
// In-memory test double for the opt-in test harness itself. No network.
const Module=require('node:module'),original=Module._load,rows=new Map();let next=0;
function createClient(){let identity='anonymous';return {auth:{async signInWithPassword({email}){identity=email;return {data:{user:{id:email}},error:null}},async signOut(){return {error:null}}},from(table){return {
 insert(payload){return {select(){return {async single(){const id='mock-'+(++next);const value={...payload,id,owner:identity,table};rows.set(id,value);return {data:value,error:null}}}}}},
 select(){return {async eq(_key,id){const r=rows.get(id);if(identity==='anonymous')return {data:null,error:{code:'42501'}};return {data:r&&r.table===table&&(r.owner===identity||process.env.MOCK_LEAK==='yes')?[{id}]:[],error:null}}}},
 delete(){return {eq(_key,id){return {async select(){const r=rows.get(id);if(!r||r.table!==table||r.owner!==identity)return {data:[],error:null};rows.delete(id);return {data:[{id}],error:null}}}}}},
 }}}}
Module._load=function(request,...args){if(request==='@supabase/supabase-js')return {createClient};return original.call(this,request,...args)};
process.on('exit',()=>console.log('MOCK_REMAINING='+rows.size));
