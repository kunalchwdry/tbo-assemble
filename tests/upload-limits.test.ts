import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readLimitedBody,UploadTooLarge} from '../src/lib/upload-limits';

test('request body accepts bytes at the cap and rejects an announced oversized body',async()=>{
 const r=new Request('http://example.test/',{method:'POST',body:'abcd'});assert.deepEqual([...await readLimitedBody(r,4)],[97,98,99,100]);
 const big=new Request('http://example.test/',{method:'POST',headers:{'content-length':'9999'},body:'x'});await assert.rejects(readLimitedBody(big,4),UploadTooLarge);
});
test('actual stream size is enforced when content length is absent or false',async()=>{
 for(const length of [null,'1']){
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(3));c.enqueue(new Uint8Array(3));c.close()}});
  const r=new Request('http://example.test/',{method:'POST',headers:length?{'content-length':length}:{},body:stream,duplex:'half'} as RequestInit);
  await assert.rejects(readLimitedBody(r,4),UploadTooLarge);
 }
});
