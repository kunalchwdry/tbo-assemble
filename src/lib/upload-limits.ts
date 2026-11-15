// Request and file caps are enforced server-side; never trust Content-Length alone.
export const MAX_DOCUMENT_BYTES=2*1024*1024;
export const MAX_MULTIPART_BYTES=4_300_000; // fits within Vercel's request limit with room for boundaries
export class UploadTooLarge extends Error {}
export async function readLimitedBody(request:Request,limit=MAX_MULTIPART_BYTES):Promise<Uint8Array>{
 const length=request.headers.get('content-length');
 if(length&&/^\d+$/.test(length)&&Number(length)>limit)throw new UploadTooLarge();
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader();const parts:Uint8Array[]=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){void reader.cancel().catch(()=>{});throw new UploadTooLarge()}parts.push(value)}
 }finally{reader.releaseLock()}
 const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.byteLength}return body;
}
