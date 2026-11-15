import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {parsePrivateGuest} from '../src/lib/private-event-workspace';
function form(values:Record<string,string>={}){const f=new FormData();for(const [k,v] of Object.entries({name:'  Jane Doe  ',email:' jane@example.test ',phone:' +91 98765 ',status:'invited',...values}))f.set(k,v);return f}
test('guest input is normalized and preserves permitted statuses',()=>{const result=parsePrivateGuest(form());assert.deepEqual(result.value,{name:'Jane Doe',email:'jane@example.test',phone:'+91 98765',status:'invited'});assert.equal(parsePrivateGuest(form({email:'',phone:'',status:'confirmed'})).value?.status,'confirmed')});
test('guest input rejects invalid or excessive data',()=>{for(const values of ([{name:''},{name:'x'.repeat(121)},{email:'broken'},{email:'x'.repeat(255)},{phone:'abc'},{phone:'1'.repeat(41)},{status:'admin'}] as Record<string,string>[]))assert.equal(parsePrivateGuest(form(values)).value,null,JSON.stringify(values));});
