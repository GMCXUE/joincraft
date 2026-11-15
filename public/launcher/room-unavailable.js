import '../focus.js';
import {mountDesktopUpdates} from '../desktop-notifications.js';
mountDesktopUpdates();
document.querySelector('#retry').onclick=async event=>{event.currentTarget.disabled=true;event.currentTarget.textContent='正在连接…';try{await window.blockroomDesktop.retryRooms();}finally{const button=document.querySelector('#retry');if(button){button.disabled=false;button.textContent='重新连接';}}};
document.querySelector('#library').onclick=()=>window.blockroomDesktop.openLibrary();
