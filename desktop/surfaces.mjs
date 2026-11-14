export const alive = view => Boolean(view && !view.webContents.isDestroyed());
export function trustedFrame(event,view,url){
  return alive(view)&&event.sender===view.webContents&&event.senderFrame===view.webContents.mainFrame&&event.senderFrame.url===url;
}

export function trustedRoomFrame(event,view,url){
  if(typeof event.senderFrame?.url!=='string'||!trustedFrame(event,view,event.senderFrame.url))return false;
  try{return event.senderFrame.url.split('#')[0]===new URL(url).href.split('#')[0];}catch{return false;}
}

// Local privileged surfaces live above the remote room page in one native window.
// Hiding a surface never navigates or destroys the room, so voice stays connected.
export class DesktopSurfaces {
  constructor({main,createView,urls,prepare=()=>{},onModalClosed=()=>{}}){
    Object.assign(this,{main,createView,urls,prepare,onModalClosed});
    this.views={};this.loads={};this.active='rooms';this.modal=false;this.sequence=0;this.disposed=false;
    main.on('resize',()=>this.layout());main.on('closed',()=>this.dispose());
    main.on('focus',()=>this.notifyFocus());
  }
  get library(){return this.views.library;}
  get notifications(){return this.views.notifications;}
  layout(){
    if(this.main.isDestroyed())return;
    const [width,height]=this.main.getContentSize();
    for(const view of Object.values(this.views))if(alive(view))view.setBounds({x:0,y:0,width,height});
  }
  async ensure(name){
    if(!this.urls[name])throw new Error('Unknown desktop surface');
    if(!alive(this.views[name])){
      const view=this.createView(name);this.views[name]=view;view.setVisible(false);
      this.prepare(view,this.urls[name]);this.main.contentView.addChildView(view);this.layout();
      this.loads[name]=view.webContents.loadURL(this.urls[name]).catch(error=>{
        this.main.contentView.removeChildView(view);if(alive(view))view.webContents.close();delete this.views[name];delete this.loads[name];throw error;
      });
    }
    await this.loads[name];return this.views[name];
  }
  focus(view){
    if(this.main.isDestroyed())return;
    if(this.main.isMinimized())this.main.restore();this.main.show();this.main.focus();
    if(alive(view))view.webContents.focus();
  }
  notifyFocus(){
    for(const [view,covered] of [[this.main,this.active!=='rooms'||this.modal],[this.library,this.active!=='library'||this.modal],[this.notifications,!this.modal]])if(alive(view))view.webContents.send('shell:covered',covered);
    for(const view of [this.main,this.library])if(alive(view))view.webContents.send('notifications:changed');
  }
  canNotify(view){
    return !this.modal&&this.main.isFocused()&&this.main.isVisible()&&alive(view)&&view===(this.active==='library'?this.library:this.main);
  }
  showRooms(){
    this.sequence++;this.closeNotifications();if(alive(this.library)){this.library.setVisible(false);this.main.contentView.removeChildView(this.library);}this.active='rooms';this.focus(this.main);this.notifyFocus();
  }
  async showLibrary(){
    if(this.modal){this.focus(this.notifications);return;}
    const sequence=++this.sequence;const view=await this.ensure('library');
    if(this.disposed||sequence!==this.sequence)return;
    this.active='library';this.main.contentView.addChildView(view);view.setVisible(true);this.layout();this.focus(view);
    view.webContents.send('launcher:event',{type:'surface-shown'});this.notifyFocus();
  }
  async showNotifications(){
    const sequence=++this.sequence;const view=await this.ensure('notifications');
    if(this.disposed||sequence!==this.sequence)return;
    this.modal=true;this.main.contentView.addChildView(view);view.setVisible(true);this.layout();this.focus(view);
    view.webContents.send('launcher:event',{type:'surface-shown'});this.notifyFocus();
  }
  closeNotifications(){
    if(!this.modal)return;
    this.modal=false;if(alive(this.notifications)){this.notifications.setVisible(false);this.main.contentView.removeChildView(this.notifications);}this.onModalClosed();
    this.focus(this.active==='library'?this.library:this.main);this.notifyFocus();
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.sequence++;this.onModalClosed();
    for(const view of Object.values(this.views))if(alive(view))view.webContents.close();
    this.views={};this.loads={};
  }
}
