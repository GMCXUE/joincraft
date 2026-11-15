import test from 'node:test';import assert from 'node:assert/strict';
import {inboxTarget,inboxReadBody,newInboxItems,inboxRows} from './public/inbox.js';
const state={rooms:[{id:'room',closed:false},{id:'closed',closed:true}],social:{friends:[{id:'friend',name:'好友',avatarId:'cat'}],requests:[]}};
const chat={id:'chat:friend:40',kind:'chat.message',category:'friend',peerId:'friend',title:'好友',body:'hello',unread:2,at:1};
test('inbox targets current friends, pending requests and accessible rooms only',()=>{
 assert.equal(inboxTarget(chat,state),'#chat/friend');assert.equal(inboxTarget({kind:'friend.request',pending:true,category:'friend'},state),'#friends/requests');
 assert.equal(inboxTarget({roomId:'room'},state),'#room/room/overview');assert.equal(inboxTarget({roomId:'closed'},state),'');assert.equal(inboxTarget({roomId:'other'},state),'');assert.equal(inboxTarget({kind:'room.closed',roomId:'room'},state),'');
});
test('read actions bind to displayed snapshot cursors and preserve unrelated receipts',()=>{
 const snapshot={throughId:7,chatReads:[{peerId:'friend',uptoId:40}]};assert.deepEqual(inboxReadBody(snapshot),{throughId:7,chats:snapshot.chatReads});assert.deepEqual(inboxReadBody(snapshot,chat),{chats:[{peerId:'friend',uptoId:40}]});assert.deepEqual(inboxReadBody(snapshot,{id:'notice:7'}),{ids:[7]});
});
test('initial sync and own replies do not notify again; additional incoming messages do',()=>{
 assert.deepEqual(newInboxItems(null,{items:[chat]}),[]);const previous={items:[chat]};assert.deepEqual(newInboxItems(previous,{items:[{...chat,id:'chat:friend:41'}]}),[]);
 assert.equal(newInboxItems(previous,{items:[{...chat,id:'chat:friend:42',unread:3}]}).length,1);assert.deepEqual(newInboxItems(previous,{items:[{...chat,unread:0}]}),[]);
 const notice={id:'notice:3',kind:'room.pack',unread:1};assert.equal(newInboxItems(previous,{items:[chat,notice]}).length,1);assert.deepEqual(newInboxItems({items:[notice]},{items:[notice]}),[]);
});
test('notification copy is escaped, read controls are explicit, and resolved requests are clear',()=>{
 const html=inboxRows([{...chat,title:'<script>bad</script>',body:'<img src=x onerror=bad>'},{id:'notice:3',kind:'friend.request',category:'friend',pending:false,title:'旧申请',body:'已处理',at:1,unread:0}],state);
 assert(!html.includes('<script>'));assert(!html.includes('<img src=x'));assert(html.includes('&lt;script&gt;'));assert(html.includes('data-inbox-read="chat:friend:40"'));assert(html.includes('好友申请已处理'));assert(html.includes('打开聊天'));
});
