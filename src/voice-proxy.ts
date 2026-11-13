import {WebSocket,WebSocketServer,createWebSocketStream} from 'ws';
import type {Server} from 'node:http';
import type {Duplex} from 'node:stream';
import {pipeline} from 'node:stream';
import {Voice} from './voice.js';
import {digest} from './service.js';
// Expose only this gate publicly. LiveKit's signalling/API port stays on loopback/private network.
// Every connection, including SDK reconnects and refreshed tokens, must have an active room lease.
export class VoiceProxy {
 private wss=new WebSocketServer({noServer:true,maxPayload:1024*1024,perMessageDeflate:false});
 private connections=new Map<string,{client?:WebSocket;upstream:WebSocket}>();
 constructor(readonly voice:Voice,server:Server,origins:()=>string[]){
  voice.disconnectSignal=identity=>{const c=this.connections.get(identity);if(c){c.client?.close(4003,'Voice session ended');c.upstream.close();this.connections.delete(identity);}};
  server.on('upgrade',(req,socket,head)=>{
   if(!req.url?.startsWith('/voice/'))return;
   socket.on('error',()=>{});
   const reject=(status=403)=>{if(!socket.destroyed)socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);};
   void (async()=>{
    if(!origins().some(o=>new URL(o).host===req.headers.host)||req.headers.origin&&!origins().includes(req.headers.origin)){reject();return;}
    const incoming=new URL(req.url!,'http://localhost');if(!['/voice/rtc','/voice/rtc/v1'].includes(incoming.pathname)){reject(404);return;}
    voice.community.rooms.consume(`voice-signal:${digest(req.socket.remoteAddress||'')}`,120,60000);
    const token=incoming.searchParams.get('access_token')||req.headers.authorization?.replace(/^Bearer /,'')||'';
    const {identity,upstreamToken}=await voice.authorize(token);
    const upstreamUrl=new URL(voice.config!.url);upstreamUrl.pathname=upstreamUrl.pathname.replace(/\/$/,'')+incoming.pathname.slice('/voice'.length);upstreamUrl.search=incoming.search;upstreamUrl.searchParams.set('access_token',upstreamToken);
    const previous=this.connections.get(identity);previous?.client?.close(4000,'Reconnecting');previous?.upstream.close();
    const upstream=new WebSocket(upstreamUrl,{handshakeTimeout:5000,maxPayload:1024*1024,perMessageDeflate:false});
    const connection:{client?:WebSocket;upstream:WebSocket}={upstream};this.connections.set(identity,connection);
    const cleanup=()=>{if(this.connections.get(identity)===connection)this.connections.delete(identity);};
    const abort=()=>{upstream.terminate();cleanup();};socket.once('close',abort);
    upstream.once('error',()=>{reject(502);connection.client?.terminate();cleanup();});
    // Pause until the downstream handshake completes, preserving the initial protobuf JoinResponse.
    upstream.once('open',()=>{
     if(socket.destroyed||!voice.identityValid(identity)){upstream.close();reject();return;}
     this.wss.handleUpgrade(req,socket,head,client=>{
      connection.client=client;socket.removeListener('close',abort);
      const a=createWebSocketStream(client),b=createWebSocketStream(upstream);
      pipeline(a,b,()=>{client.terminate();upstream.terminate();cleanup();});
      pipeline(b,a,()=>{client.terminate();upstream.terminate();cleanup();});
      client.on('error',()=>{});upstream.on('error',()=>{});
     });
    });
   })().catch(()=>reject());
  });
 }
 close(){for(const c of this.connections.values()){c.client?.terminate();c.upstream.terminate();}this.connections.clear();this.wss.close();}
}
