import {createRequire} from 'node:module';
import {installForgeTask,installNeoForgedTask} from '@xmcl/installer';

// XMCL 6.1.2 removes the old success-path instanceof check. Its downloader
// still references a removed error constructor for failed HTTP responses.
// Reject those responses before its body handler, using the matching patched
// Undici transport without mutating dependency exports or a global dispatcher.
class LoaderHttpError extends Error {
  constructor(statusCode,headers,url){super('下载请求失败（HTTP '+statusCode+'）');this.name='LoaderHttpError';this.statusCode=statusCode;this.headers=headers;this.url=url;}
}
let transport,retryInterceptor;
function loaderTransport(){
  if(!transport){
    const installerRequire=createRequire(import.meta.resolve('@xmcl/installer'));
    const transferRequire=createRequire(installerRequire.resolve('@xmcl/file-transfer'));
    const {Agent,interceptors}=transferRequire('undici');
    transport=new Agent({connections:16}).compose(interceptors.redirect({maxRedirections:5}));
  }
  return transport;
}
function retryDownloads(dispatcher){
  if(!retryInterceptor){
    const installerRequire=createRequire(import.meta.resolve('@xmcl/installer'));
    const transferRequire=createRequire(installerRequire.resolve('@xmcl/file-transfer'));
    const {interceptors}=transferRequire('undici');
    retryInterceptor=interceptors.retry({maxRetries:3,minTimeout:250,maxTimeout:2000,timeoutFactor:2,methods:['GET','HEAD'],statusCodes:[408,429,500,502,503,504],errorCodes:['ECONNRESET','ECONNREFUSED','ENOTFOUND','ENETDOWN','ENETUNREACH','EHOSTDOWN','EHOSTUNREACH','EPIPE','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']});
  }
  return retryInterceptor((options,handler)=>dispatcher.dispatch(options,handler));
}
function requestFile(url){try{return decodeURIComponent(new URL(url).pathname.split('/').at(-1));}catch{return '';}}
function checkedStatus(dispatcher,onFile){
  const dispatch=retryDownloads(dispatcher);
  return {dispatch(options,handler){
    const url=new URL(options.path,options.origin).href,file=requestFile(url);if(file)onFile?.(file);
    const guarded=new Proxy(handler,{get(target,key){
      if(key==='onHeaders')return (statusCode,headers,...args)=>{
        if(statusCode===203||statusCode>=300)throw new LoaderHttpError(statusCode,headers,url);
        return target.onHeaders(statusCode,headers,...args);
      };
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    return dispatch(options,guarded);
  }};
}
export function loaderInstallTask(pack,game,options={}){
  const configured={...options,dispatcher:checkedStatus(options.dispatcher||loaderTransport(),options.onFile)};
  if(pack.loaderKey==='forge')return installForgeTask({mcversion:pack.minecraft,version:pack.loaderVersion},game,{mavenHost:'https://maven.minecraftforge.net',...configured});
  if(pack.loaderKey==='neoforge')return installNeoForgedTask('neoforge',pack.loaderVersion,game,configured);
  throw Error('不支持的加载器安装任务');
}
function primaryFailure(error){
  const leaves=[],seen=new Set();
  function visit(value,depth=0){if(!value||depth>8||seen.has(value))return;seen.add(value);if(Array.isArray(value.errors)&&value.errors.length){for(const child of value.errors)visit(child,depth+1);}else if(value.cause){visit(value.cause,depth+1);}else leaves.push(value);}
  visit(error);
  // A failed official request may be followed by a predictable Maven Central
  // 404 and empty-file checksum errors. Preserve the first real source failure.
  return leaves.find(value=>!['ChecksumNotMatchError','InvalidZipError'].includes(value.name))||leaves[0]||error;
}
export function loaderErrorFile(error){
  const failure=primaryFailure(error);
  return failure?.destination?.split(/[\\/]/).at(-1)||requestFile(failure?.url)||'';
}
export function loaderErrorMessage(error){
  const failure=primaryFailure(error),file=loaderErrorFile(error),prefix=file?file+'：':'';
  if(Number.isInteger(failure?.statusCode))return prefix+'加载器文件下载失败（HTTP '+failure.statusCode+'），请重试';
  if(['UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','ETIMEDOUT'].includes(failure?.code))return prefix+'加载器文件下载连接中断，请检查网络后重试';
  return prefix+(failure?.message?'加载器安装失败：'+failure.message:'加载器安装失败，请重试');
}
