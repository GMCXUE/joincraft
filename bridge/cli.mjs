import { startBridge } from './client.mjs';
async function main(){
  const [flag,value]=process.argv.slice(2);
  if(flag!=='--connect'||!value){console.log('joincraft Java 联机连接程序\n在网页房间中点击「开始联机」或「连接游戏」，复制生成的运行指令。\n需要 Node.js 22.13 或更高版本。');return;}
  let config;try{config=JSON.parse(Buffer.from(value,'base64url').toString());}catch{throw Error('连接指令无效，请重新复制完整指令');}
  console.log('正在连接joincraft…');
  const bridge=await startBridge({...config,onState:state=>{
    if(state.status==='ready')console.log(state.role==='host'?`开房成功 · ${state.version}\n保持 MC 世界和本窗口打开，朋友现在可以连接。`:`连接已就绪\n在 MC「多人游戏 → 直接连接」输入：${state.address}\n保持本窗口打开。`);
    else if(state.message)console.log(state.message);
  }});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{bridge.close();process.exit(0);});
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
