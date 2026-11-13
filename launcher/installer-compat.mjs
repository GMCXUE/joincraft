import {createRequire} from 'node:module';
import {installForgeTask,installNeoForgedTask} from '@xmcl/installer';

// XMCL 6.1.2 removes the old success-path instanceof check. Its downloader
// still references a removed error constructor for failed HTTP responses.
// Reject those responses before its body handler, using the matching patched
// Undici transport without mutating dependency exports or a global dispatcher.
class LoaderHttpError extends Error {
  constructor(statusCode,headers){super('下载请求失败（HTTP '+statusCode+'）');this.name='LoaderHttpError';this.statusCode=statusCode;this.headers=headers;}
}
let transport;
function loaderTransport(){
  if(!transport){
    const installerRequire=createRequire(import.meta.resolve('@xmcl/installer'));
    const transferRequire=createRequire(installerRequire.resolve('@xmcl/file-transfer'));
    const {Agent,interceptors}=transferRequire('undici');
    transport=new Agent({connections:16}).compose(interceptors.redirect({maxRedirections:5}));
  }
  return transport;
}
function checkedStatus(dispatcher){
  return {dispatch(options,handler){
    const guarded=new Proxy(handler,{get(target,key){
      if(key==='onHeaders')return (statusCode,headers,...args)=>{
        if(statusCode===203||statusCode>=300)throw new LoaderHttpError(statusCode,headers);
        return target.onHeaders(statusCode,headers,...args);
      };
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    return dispatcher.dispatch(options,guarded);
  }};
}
export function loaderInstallTask(pack,game,options={}){
  const configured={...options,dispatcher:checkedStatus(options.dispatcher||loaderTransport())};
  if(pack.loaderKey==='forge')return installForgeTask({mcversion:pack.minecraft,version:pack.loaderVersion},game,{mavenHost:'https://maven.minecraftforge.net',...configured});
  if(pack.loaderKey==='neoforge')return installNeoForgedTask('neoforge',pack.loaderVersion,game,configured);
  throw Error('不支持的加载器安装任务');
}
export function loaderErrorMessage(error){
  const leaves=[];
  function visit(value,depth=0){if(!value||depth>8)return;if(Array.isArray(value.errors)&&value.errors.length){for(const child of value.errors)visit(child,depth+1);}else leaves.push(value);}
  visit(error);
  const http=leaves.find(value=>Number.isInteger(value.statusCode));
  if(http)return '加载器文件下载失败（HTTP '+http.statusCode+'），请重试';
  if(leaves.some(value=>['UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ECONNRESET','ENOTFOUND'].includes(value.code)))return '加载器文件下载连接中断，请检查网络后重试';
  const detail=leaves.find(value=>typeof value.message==='string'&&value.message.trim());
  return detail?'加载器安装失败：'+detail.message:'加载器安装失败，请重试';
}
