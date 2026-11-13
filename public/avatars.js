export const AVATARS=[{id:'zombie',name:'僵尸'},{id:'skeleton',name:'骷髅'},{id:'creeper',name:'苦力怕'},{id:'enderman',name:'末影人'},{id:'pig',name:'小猪'},{id:'cow',name:'奶牛'},{id:'fox',name:'狐狸'},{id:'wolf',name:'狼'},{id:'cat',name:'猫'},{id:'chicken',name:'小鸡'}];
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const avatarURL=id=>'/avatars/'+(AVATARS.some(a=>a.id===id)?id:'creeper')+'-v1.svg';
export const avatarName=id=>AVATARS.find(a=>a.id===id)?.name||'苦力怕';
export function avatarHTML(person,{link=false,className=''}={}){
 const image=`<span class="member-avatar mob-avatar ${className}"><img src="${avatarURL(person?.avatarId)}" alt="" width="32" height="32" draggable="false"></span>`;
 const id=person?.userId||person?.id;
 return link&&id?`<a class="profile-avatar-link" href="#profile/${encodeURIComponent(id)}" aria-label="查看${escape(person?.name||'玩家')}的个人主页">${image}</a>`:image;
}
