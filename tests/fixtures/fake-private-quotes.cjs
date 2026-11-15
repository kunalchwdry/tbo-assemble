// Local fake auth/database for UI tests only. Does not validate JWTs or prove real Supabase security.
const http=require('http'),{randomUUID}=require('crypto');const store=[];const allowed=['a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002'];
http.createServer(async(req,res)=>{res.setHeader('access-control-allow-origin','*');res.setHeader('access-control-allow-headers','authorization,apikey,content-type,x-client-info,prefer,x-supabase-api-version,accept-profile,content-profile,x-retry-count');res.setHeader('access-control-allow-methods','GET,POST,DELETE,OPTIONS');res.setHeader('content-type','application/json');if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
 let id;try{id=JSON.parse(Buffer.from((req.headers.authorization||'').split(' ')[1].split('.')[1],'base64url')).sub}catch{}if(!allowed.includes(id)){res.statusCode=401;return res.end(JSON.stringify({message:'invalid fake token'}))}
 const url=new URL(req.url,'http://fake');if(url.pathname==='/auth/v1/user')return res.end(JSON.stringify({id,aud:'authenticated',role:'authenticated',email:'local@example.invalid',app_metadata:{},user_metadata:{},created_at:'2020-01-01T00:00:00Z'}));
 if(url.pathname!=='/rest/v1/private_quote_reviews'){res.statusCode=404;return res.end('{}')}
 const filter=row=>row.owner_id===id&&(!url.searchParams.has('owner_id')||url.searchParams.get('owner_id')===`eq.${row.owner_id}`)&&(!url.searchParams.has('id')||url.searchParams.get('id')===`eq.${row.id}`);
 if(req.method==='GET')return res.end(JSON.stringify(store.filter(filter).slice(-20).reverse()));
 if(req.method==='POST'){let body='';for await(const c of req)body+=c;const row={...JSON.parse(body),owner_id:id,id:randomUUID(),created_at:new Date().toISOString()};store.push(row);res.statusCode=201;return res.end('')}
 if(req.method==='DELETE'){const selected=store.filter(filter);for(const row of selected)store.splice(store.indexOf(row),1);return res.end(JSON.stringify(selected.map(({id})=>({id}))))}
 res.statusCode=405;return res.end('{}')
}).listen(54329,'127.0.0.1',()=>console.log('Local fake Supabase quote UI ready'));
