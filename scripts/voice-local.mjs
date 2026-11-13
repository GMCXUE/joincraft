import {spawnSync} from 'node:child_process';
const name='joincraft-voice-local',image='livekit/livekit-server:v1.13.11';
function docker(args,options={}){return spawnSync('docker',args,{encoding:'utf8',...options});}
const probe=docker(['info','--format','{{.ServerVersion}}']);
if(probe.error||probe.status!==0){console.error('请先安装并启动 Docker Desktop。');process.exit(1);}
const existing=docker(['inspect','--format','{{.Config.Image}}',name]);
let result;
if(existing.status===0){
 if(existing.stdout.trim()!==image){console.error('同名容器不是预期版本，请手动检查后重试。');process.exit(1);}
 result=docker(['start',name],{stdio:'inherit'});
}else result=docker(['run','-d','--name',name,'-p','127.0.0.1:7880:7880','-p','127.0.0.1:7881:7881','-p','127.0.0.1:7882:7882/udp',image,'--dev','--bind','0.0.0.0','--node-ip','127.0.0.1'],{stdio:'inherit'});
if(result.status!==0)process.exit(1);
console.log('本机语音服务已启动。应用配置见 .env.example。停止：npm run voice:down');
