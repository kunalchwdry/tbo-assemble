import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {extractTextFromPDF} from '../src/lib/local-parser.ts';

test('PDF extraction respects nonzero byte offsets and unrelated backing bytes',async()=>{
 const pdf=await readFile('final-demo-docs/Hotel_Contract_Sample.pdf');
 const storage=Buffer.alloc(pdf.length+200,0x78);pdf.copy(storage,100);
 const sliced=storage.subarray(100,100+pdf.length);assert.equal(sliced.byteOffset,100);
 const text=await extractTextFromPDF(sliced);assert.match(text,/Grand Horizon/i);assert.match(text,/Mumbai/i);
});
