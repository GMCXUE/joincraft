import '/focus.js';
import {createMiningFeedback,mountNavigationMotion} from '/motion.js';
const $=s=>document.querySelector(s),feedback=createMiningFeedback();
const navigation=mountNavigationMotion({rail:$('.room-rail'),sidebar:$('.room-sidebar'),content:$('#main')});
let task=null,resultTimer=0,route='',quiet=false;
const roomName=()=>location.hash.startsWith('#workshop')?'建筑工坊':'周末生存';
function mark(mode){document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));$('#preview-step').textContent={pending:'挥镐 · 等待',success:'收获 · 完成',error:'停下 · 重试'}[mode];}
function mine(){
 clearTimeout(resultTimer);task?.cancel();$('#preview-stage').replaceChildren();
 task=feedback.start('正在加入房间',{host:$('#preview-stage'),delay:0,hold:true,success:'已加入房间',error:'连接没有完成',retry:()=>{mine();resultTimer=setTimeout(()=>finish(),1700);}});mark('pending');
}
function finish(){if(!task)return;task.done();mark('success');}
function fail(){if(!task)return;task.fail(new Error('连接暂时中断，再试一次。'));mark('error');}
function room(){return `<div class="preview-layout"><div class="preview-heading"><div><h2>挖一颗钻石。</h2><p>加载时挥镐，完成后收起钻石。</p></div><span class="preview-step" id="preview-step">挥镐 · 等待</span></div><div class="preview-stage" id="preview-stage"></div><div class="preview-controls" role="group" aria-label="播放动效状态"><button class="button" data-mode="pending" aria-pressed="true">挖矿中</button><button class="button" data-mode="success" aria-pressed="false">完成</button><button class="button" data-mode="error" aria-pressed="false">失败重试</button></div><div class="preview-settings"><label><input type="checkbox" id="reduce-motion" ${quiet?'checked':''}>减少动态效果</label><button class="text-button" id="quick-task">试试瞬间完成</button></div></div>`;}
function render(){
 const next=location.hash.split('/')[0]||'#room';clearTimeout(resultTimer);task?.cancel();task=null;route=next;
 const friends=next==='#friends',profile=next==='#profile',name=roomName();
 document.querySelectorAll('.room-rail a').forEach(a=>{const active=a.hash===next;a.setAttribute('aria-current',active?'page':'false');a.classList.toggle('selected',active);});
 $('#room-heading').innerHTML=`<div class="room-heading-line"><h2>${friends?'好友与聊天':profile?'个人中心':name}</h2></div>${!friends&&!profile?'<span class="room-number">动效预览</span>':''}`;
 $('#room-nav').innerHTML=friends?'<a class="channel active" aria-current="page" href="#friends">全部好友 <span class="channel-count">2</span></a><a class="channel" href="#room">返回房间</a>':profile?'<a class="channel active" aria-current="page" href="#profile">个人主页</a><a class="channel" href="#room">返回房间</a>':`<a class="channel active" aria-current="page" href="${next}">房间概览</a><a class="channel" href="#friends">好友与聊天</a>`;
 $('#sidebar-info').innerHTML='';$('#view-title').textContent=friends?'好友列表':profile?'个人主页':name;
 $('#main').innerHTML=friends?`<div class="preview-layout"><div class="preview-heading"><div><h2>好友列表</h2><p>点击左侧入口，看看选框怎样跟随。</p></div><span class="preview-tag">示例资料</span></div><div class="preview-people">${[['fox','雾里','一起去挖矿。'],['skeleton','小白','山顶的小屋还差一个屋顶。']].map(([avatar,name,bio])=>`<div class="preview-person"><img src="/avatars/${avatar}-v1.svg" alt=""><div><strong>${name}</strong><small>${bio}</small></div><a class="text-button" href="#room">一起玩</a></div>`).join('')}</div></div>`:profile?`<div class="preview-layout"><div class="preview-profile"><img src="/avatars/fox-v1.svg" alt="狐狸头像"><div><h2>林间旅人</h2><p>一起上线，一起造。</p><span class="preview-tag">示例资料</span></div></div><div class="preview-settings"><span>个人主页切换预览</span><a class="text-button" href="#room">回去挖矿</a></div></div>`:room();
 navigation.transition();
 if(!friends&&!profile){
  document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{mine();if(button.dataset.mode==='success')resultTimer=setTimeout(finish,450);if(button.dataset.mode==='error')resultTimer=setTimeout(fail,450);});
  $('#reduce-motion').onchange=e=>{quiet=e.target.checked;document.documentElement.classList.toggle('motion-reduced',quiet);document.dispatchEvent(new Event('joincraft:motion-preference')); };
  $('#quick-task').onclick=()=>{clearTimeout(resultTimer);task?.cancel();task=null;$('#preview-stage').innerHTML='<p class="preview-stage-empty">已完成，未播放加载动画。</p>';const quick=feedback.start('正在加入房间',{success:'已加入房间'});quick.done();mark('success');$('#preview-step').textContent='瞬间完成 · 无需等待';};
  mine();
 }
}
$('#play-notice').onclick=()=>{const notice=feedback.start('正在加入房间',{success:'已加入房间',delay:400});setTimeout(()=>notice.done(),2400);};
window.addEventListener('hashchange',render);window.addEventListener('beforeunload',()=>feedback.dispose());
if(!location.hash)history.replaceState(null,'','#room');render();
