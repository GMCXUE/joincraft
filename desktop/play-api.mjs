import {clientFetch} from '../launcher/http.mjs';
export function createPlayAPI({serverURL,getHeaders,fetchImpl=clientFetch}){
 const origin=new URL(serverURL).origin;
 if(!origin.startsWith('https://')&&!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::|$)/.test(origin))throw Error('联机服务地址无效');
 return async(route,body,{signal}={})=>{
  if(!(route==='/api/state'&&body===undefined)&&!/^\/api\/rooms\/[a-f0-9-]{36}\/play\/(start|connect|stop|disconnect)$/.test(route))throw Error('不允许的联机请求');
  const result=await fetchImpl(origin+route,{method:body===undefined?'GET':'POST',headers:{...await getHeaders(),Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)])});
  const data=await result.json().catch(()=>null);if(!result.ok)throw Object.assign(Error(data?.error||'联机请求失败（'+result.status+'）'),{status:result.status});if(!data)throw Error('联机服务返回异常');return data;
 };
}
