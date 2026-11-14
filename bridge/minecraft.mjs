import net from 'node:net';
export function varint(value) {
  const bytes=[];let n=value>>>0;
  do {let b=n&127;n>>>=7;if(n)b|=128;bytes.push(b);} while(n);
  return Buffer.from(bytes);
}
export function readVarint(buffer, offset=0) {
  let value=0;
  for(let i=0;i<5;i++){if(offset+i>=buffer.length)return null;const b=buffer[offset+i];value|=(b&127)<<(7*i);if(!(b&128))return{value:value>>>0,bytes:i+1};}
  throw Error('无效的 MC 数据包');
}
export const packet=body=>Buffer.concat([varint(body.length),body]);
export function status(port, timeout=4000, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port});let buffer=Buffer.alloc(0),done=false;
    const finish=(error,result)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(result);};
    const abort=()=>finish(signal.reason||Error('已取消连接'));signal?.addEventListener('abort',abort,{once:true});
    socket.setTimeout(timeout,()=>finish(Error('MC 没有响应，请确认已开放局域网并填写正确端口')));
    socket.on('error',()=>finish(Error('无法连接 MC，请检查世界是否已开放局域网')));
    socket.on('end',()=>finish(Error('该端口没有返回 Java 版 MC 状态')));
    socket.on('connect',()=>{const address=Buffer.from('localhost'),p=Buffer.alloc(2);p.writeUInt16BE(port);socket.write(Buffer.concat([packet(Buffer.concat([varint(0),varint(-1),varint(address.length),address,p,varint(1)])),packet(varint(0))]));});
    socket.on('data',chunk=>{
      try{
        buffer=Buffer.concat([buffer,chunk]);if(buffer.length>1024*1024)throw Error('MC 状态响应过大');
        const size=readVarint(buffer);if(!size)return;if(size.value>1024*1024)throw Error('MC 状态响应过大');if(buffer.length<size.bytes+size.value)return;
        const body=buffer.subarray(size.bytes,size.bytes+size.value),id=readVarint(body);if(!id||id.value!==0)throw Error('不是 Java 版 MC 服务');
        const len=readVarint(body,id.bytes);if(!len||id.bytes+len.bytes+len.value!==body.length)throw Error('无效的 MC 状态响应');
        const result=JSON.parse(body.subarray(id.bytes+len.bytes).toString());
        if(typeof result.version?.name!=='string'||!Number.isInteger(result.version?.protocol))throw Error('不是 Java 版 MC 服务');
        finish(null,{version:result.version.name.slice(0,80)});
      }catch(e){finish(e);}
    });
  });
}
