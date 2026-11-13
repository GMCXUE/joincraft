import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DesktopSurfaces,trustedFrame} from './desktop/surfaces.mjs';
function fixture(load=async()=>{}){
  const children=[];const create=()=>{let dead=false;const messages=[];return {messages,mainFrame:{url:''},isDestroyed:()=>dead,close:()=>{dead=true;},focus(){},send(...args){messages.push(args);},loadURL:load};};
  const main=Object.assign(new EventEmitter(),{webContents:create(),isDestroyed:()=>false,isFocused:()=>true,isVisible:()=>true,isMinimized:()=>false,show(){},focus(){},getContentSize:()=>[1180,800],contentView:{addChildView(view){const index=children.indexOf(view);if(index>=0)children.splice(index,1);children.push(view);},removeChildView(view){const index=children.indexOf(view);if(index>=0)children.splice(index,1);}}});
  let closed=0,created=0;
  const shell=new DesktopSurfaces({main,urls:{library:'file:///library.html',notifications:'file:///notifications.html'},onModalClosed:()=>closed++,createView:()=>{created++;return {webContents:create(),setVisible(value){this.visible=value;},setBounds(value){this.bounds=value;}};}});
  return {shell,main,children,created:()=>created,closed:()=>closed};
}
test('library and notification surfaces reuse one main window and keep rooms alive',async()=>{
  const f=fixture();await f.shell.showLibrary();const library=f.shell.library;
  assert.equal(library.visible,true);assert.equal(f.shell.active,'library');assert.equal(f.shell.canNotify(library),true);assert.equal(f.shell.canNotify(f.main),false);
  await f.shell.showNotifications();assert.equal(f.shell.modal,true);assert.equal(f.shell.canNotify(library),false);assert.equal(f.children.at(-1),f.shell.notifications);
  assert.deepEqual(library.webContents.messages.filter(x=>x[0]==='shell:covered').at(-1),['shell:covered',true]);
  assert.deepEqual(f.shell.notifications.webContents.messages.filter(x=>x[0]==='shell:covered').at(-1),['shell:covered',false]);
  f.shell.closeNotifications();assert.equal(f.shell.notifications.visible,false);assert.equal(f.shell.active,'library');assert.equal(f.closed(),1);
  f.shell.showRooms();assert.equal(library.visible,false);assert.equal(f.main.webContents.isDestroyed(),false);assert.equal(f.shell.canNotify(f.main),true);
  await f.shell.showLibrary();await f.shell.showNotifications();assert.equal(f.created(),2);
  f.main.getContentSize=()=>[850,600];f.main.emit('resize');assert.deepEqual(library.bounds,{x:0,y:0,width:850,height:600});
  f.main.emit('closed');assert.equal(library.webContents.isDestroyed(),true);assert.equal(f.shell.disposed,true);
});
test('late loading library cannot replace a newer navigation choice',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));const loading=f.shell.showLibrary();
  f.shell.showRooms();finish();await loading;assert.equal(f.shell.active,'rooms');assert.equal(f.shell.library.visible,false);
});
test('failed local surface loading can be retried without destroying room state',async()=>{
  let first=true;const f=fixture(async()=>{if(first){first=false;throw Error('load failed');}});
  await assert.rejects(f.shell.showLibrary(),/load failed/);assert.equal(f.children.length,0);assert.equal(f.main.webContents.isDestroyed(),false);
  await f.shell.showLibrary();assert.equal(f.shell.library.visible,true);
});
test('privileged IPC accepts only the exact local main frame, never room or child frames',async()=>{
  const f=fixture();await f.shell.showNotifications();const view=f.shell.notifications,url='file:///notifications.html';view.webContents.mainFrame.url=url;
  assert.equal(trustedFrame({sender:view.webContents,senderFrame:view.webContents.mainFrame},view,url),true);
  assert.equal(trustedFrame({sender:f.main.webContents,senderFrame:f.main.webContents.mainFrame},view,url),false);
  assert.equal(trustedFrame({sender:view.webContents,senderFrame:{url}},view,url),false);
  view.webContents.mainFrame.url='https://www.joincraft.top/';assert.equal(trustedFrame({sender:view.webContents,senderFrame:view.webContents.mainFrame},view,url),false);
});

test('desktop room URL skips the official homepage and preserves explicit paths and queries',async()=>{
 const {roomPageURL}=await import('./desktop/room-url.mjs');assert.equal(roomPageURL('https://www.joincraft.top/'),'https://www.joincraft.top/app/');assert.equal(roomPageURL('http://127.0.0.1:4180/'),'http://127.0.0.1:4180/app/');assert.equal(roomPageURL('https://www.joincraft.top/app'),'https://www.joincraft.top/app/');assert.equal(roomPageURL('https://www.joincraft.top/app/?a=1#friends'),'https://www.joincraft.top/app/?a=1#friends');assert.equal(roomPageURL('https://example.com/custom/'),'https://example.com/custom/');
});

test('room pack IPC permits room navigation hashes but rejects other pages, origins and frames',async()=>{
 const {trustedRoomFrame}=await import('./desktop/surfaces.mjs');const frame={url:'https://www.joincraft.top/app/#room/local/overview'},webContents={isDestroyed:()=>false,mainFrame:frame},view={webContents},event={sender:webContents,senderFrame:frame};
 assert.equal(trustedRoomFrame(event,view,'https://www.joincraft.top/app/'),true);
 for(const url of ['https://evil.invalid/app/#room','https://www.joincraft.top/login','https://www.joincraft.top/app/?different=1','https://www.joincraft.top:444/app/']){frame.url=url;assert.equal(trustedRoomFrame(event,view,'https://www.joincraft.top/app/'),false);}
 frame.url='https://www.joincraft.top/app/#room';assert.equal(trustedRoomFrame({...event,senderFrame:{...frame}},view,'https://www.joincraft.top/app/'),false);assert.equal(trustedRoomFrame({...event,sender:{}},view,'https://www.joincraft.top/app/'),false);
});
