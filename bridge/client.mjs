import net from 'node:net';
import { WebSocket, createWebSocketStream } from 'ws';
import { status } from './minecraft.mjs';

export function startBridge({server,ticket,onState=()=>{}}) {
  const url=new URL(server);
  const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('服务地址必须是 HTTPS；仅本机测试允许 HTTP');
  if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(ticket))throw Error('连接凭据格式不正确');
  const base=url.origin.replace(/^http/,'ws'),headers={Authorization:`Bearer ${ticket}`};
  const open=path=>new WebSocket(base+path,{headers,perMessageDeflate:false,maxPayload:65536,handshakeTimeout:8000,followRedirects:false});
  return new Promise((resolve,reject)=>{
    const control=open('/bridge/control'),sockets=new Set(),streams=new Set();
    let listener,heartbeat,probe,stopped=false,settled=false,role='',gamePort=0,lastPing=Date.now(),busyProbe=false;
    const send=m=>{if(control.readyState===WebSocket.OPEN)control.send(JSON.stringify(m));};
    const close=()=>{if(stopped)return;stopped=true;clearInterval(heartbeat);clearInterval(probe);listener?.close();for(const s of sockets)s.destroy();for(const s of streams)s.destroy();control.terminate();};
    const failed=message=>{if(stopped)return;send({type:'error',message});onState({status:'error',message});if(!settled){settled=true;reject(Error(message));}setTimeout(close,100).unref();};
    const ready=address=>{if(stopped)return;send({type:'ready',...(role==='host'?{version:address}:{port:Number(address.split(':').at(-1))})});onState({status:'ready',role,address:role==='guest'?address:undefined,version:role==='host'?address:undefined});if(!settled){settled=true;resolve({role,address:role==='guest'?address:undefined,close});}};
    const connect=(socket,path)=>{
      if(stopped){socket.destroy();return;}
      sockets.add(socket);socket.pause();socket.setNoDelay(true);
      const ws=open(path),stream=createWebSocketStream(ws,{highWaterMark:65536});streams.add(stream);
      const cleanup=()=>{sockets.delete(socket);streams.delete(stream);socket.destroy();stream.destroy();};
      socket.on('error',cleanup);stream.on('error',cleanup);socket.on('close',cleanup);stream.on('close',cleanup);
      ws.on('open',()=>{socket.pipe(stream);stream.pipe(socket);});
    };
    control.on('ping',()=>lastPing=Date.now());
    control.on('open',()=>{
      onState({status:'checking'});
      heartbeat=setInterval(()=>{if(Date.now()-lastPing>45000){failed('与联机服务失去连接，请回到网页重新连接');}},5000).unref();
    });
    control.on('error',()=>failed('连接服务失败，凭据可能已过期或已使用，请回到网页重新生成'));
    control.on('close',()=>{if(stopped)return;close();if(!settled){settled=true;reject(Error('连接已关闭，请重新生成连接指令'));}else onState({status:'closed',message:'联机连接已结束'});});
    control.on('message',async raw=>{
      try{
        const m=JSON.parse(raw.toString());
        if(m.type==='welcome'&&!role){
          if(m.role!=='host'&&m.role!=='guest')throw Error('服务端角色无效');role=m.role;
          if(role==='host'){
            if(!Number.isInteger(m.port)||m.port<1024||m.port>65535)throw Error('游戏端口无效');gamePort=m.port;
            const result=await status(gamePort);if(stopped)return;ready(result.version);
            probe=setInterval(async()=>{if(busyProbe||stopped)return;busyProbe=true;try{await status(gamePort);}catch(e){failed(e.message);}finally{busyProbe=false;}},10000).unref();
          }else{
            listener=net.createServer({pauseOnConnect:true},socket=>{
              if(sockets.size>=8){socket.destroy();return;}connect(socket,'/bridge/data/new');
            });
            listener.on('error',()=>failed('无法创建本地游戏入口，请关闭连接程序后重试'));
            listener.listen(0,'127.0.0.1',()=>{const address=listener.address();if(typeof address==='object'&&address)ready(`127.0.0.1:${address.port}`);});
          }
        }else if(m.type==='incoming'&&role==='host'&&/^[0-9a-f-]{36}$/.test(m.id)){
          if(sockets.size>=128){send({type:'failed',id:m.id});return;}
          const socket=net.createConnection({host:'127.0.0.1',port:gamePort});sockets.add(socket);
          const timer=setTimeout(()=>socket.destroy(),5000).unref();
          socket.once('connect',()=>{clearTimeout(timer);if(stopped){socket.destroy();return;}connect(socket,`/bridge/data/${m.id}`);});
          socket.once('error',()=>{clearTimeout(timer);send({type:'failed',id:m.id});sockets.delete(socket);});
          socket.once('close',()=>{clearTimeout(timer);sockets.delete(socket);});
        }else throw Error('连接协议不匹配，请下载新版连接程序');
      }catch(e){failed(e.message);}
    });
  });
}
