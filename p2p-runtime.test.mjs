import test from 'node:test';
import assert from 'node:assert/strict';
import {RtcStream,trustedTransportEvent,P2P_PAGE} from './desktop/p2p-runtime.mjs';
import {once} from 'node:events';

test('transport IPC accepts only the packaged renderer main frame',()=>{
 const frame={url:P2P_PAGE},webContents={isDestroyed:()=>false,mainFrame:frame},view={webContents},event={sender:webContents,senderFrame:frame};
 assert.equal(trustedTransportEvent(event,view),true);
 assert.equal(trustedTransportEvent({...event,senderFrame:{url:P2P_PAGE}},view),false);
 assert.equal(trustedTransportEvent({...event,sender:{}},view),false);
 frame.url='https://www.joincraft.top/app/';assert.equal(trustedTransportEvent(event,view),false);
});
test('a stalled peer bounds outstanding game data and cancellation releases its writer',async()=>{
 const peer={id:'peer',closed:false,streams:new Map(),runtime:{request:async()=>{}}},stream=new RtcStream(peer,'channel');peer.streams.set('channel',stream);stream.receive({kind:'open'});
 let result;stream.write(Buffer.alloc(2*1024*1024),error=>result=error||'done');
 for(let n=0;n<100;n++){await new Promise(r=>setImmediate(r));if(stream.inFlight>=524288)break;}
 assert.equal(stream.inFlight,524288);assert.equal(result,undefined);
 const closed=once(stream,'close');stream.destroy();await closed;
 await new Promise(r=>setImmediate(r));assert.ok(result instanceof Error);assert.equal(peer.streams.size,0);
});
test('a peer cannot fabricate receive credit to exceed the bounded flow window',async()=>{
 const peer={id:'peer',closed:false,streams:new Map(),runtime:{request:async()=>{}}},stream=new RtcStream(peer,'channel');stream.receive({kind:'open'});
 const error=once(stream,'error');stream.receive({kind:'credit',size:1});assert.match((await error)[0].message,/确认无效/);assert.equal(stream.destroyed,true);
});
