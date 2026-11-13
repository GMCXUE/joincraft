import {clientFetch} from './http.mjs';

// Fixed public artifact origins only. Account services and signed/query URLs
// never enter the shared cache, and no renderer can choose an upstream host.
export const DOWNLOAD_SOURCES=Object.freeze({
  "forge": "maven.minecraftforge.net",
  "forge-files": "files.minecraftforge.net",
  "neoforge": "maven.neoforged.net",
  "minecraft-meta": "piston-meta.mojang.com",
  "minecraft-data": "piston-data.mojang.com",
  "minecraft-launcher": "launcher.mojang.com",
  "minecraft-runtime": "launchermeta.mojang.com",
  "minecraft-assets": "resources.download.minecraft.net",
  "minecraft-libraries": "libraries.minecraft.net",
  "fabric-meta": "meta.fabricmc.net",
  "fabric-maven": "maven.fabricmc.net",
  "quilt-meta": "meta.quiltmc.org",
  "quilt-maven": "maven.quiltmc.org",
  "maven-central": "repo1.maven.org",
  "modrinth": "cdn.modrinth.com",
  "curseforge": "mediafilez.forgecdn.net",
  "curseforge-files": "mediafiles.forgecdn.net",
  "curseforge-edge": "edge.forgecdn.net"
});
const sourceByHost=new Map(Object.entries(DOWNLOAD_SOURCES).map(([id,host])=>[host,id]));
export function gatewayURL(value,origin){
  if(!origin)return null;
  const gateway=new URL(origin),url=new URL(value);
  if(gateway.protocol!=='https:'&&!(gateway.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(gateway.hostname)))throw Error('下载加速地址必须使用 HTTPS');
  if(gateway.username||gateway.password)throw Error('下载加速地址不可包含凭证');
  const source=sourceByHost.get(url.hostname);
  if(!source||!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||(url.port&&url.port!=='443'))return null;
  return gateway.origin+'/game-downloads/'+source+url.pathname;
}
export function acceleratedURLs(urls,origin){
  return [...new Set([...urls.map(url=>gatewayURL(url,origin)).filter(Boolean),...urls])];
}
export function createDownloadFetch({origin,fetchImpl=clientFetch}={}){
  let unavailableUntil=0;
  return async (input,options={})=>{
    const method=(options.method||'GET').toUpperCase(),cached=['GET','HEAD'].includes(method)?gatewayURL(String(input),origin):null;
    if(!cached||Date.now()<unavailableUntil)return fetchImpl(input,options);
    const headers=new Headers();
    for(const name of ['range','if-range','accept']){const value=new Headers(options.headers).get(name);if(value)headers.set(name,value);}
    const clean={...options,headers,credentials:'omit'};
    try{
      const response=await fetchImpl(cached,{...clean,redirect:'manual'});
      if(response.ok)return response;
      await response.body?.cancel();
      if(response.status===429||response.status>=500)unavailableUntil=Date.now()+15000;
    }catch(error){if(options.signal?.aborted)throw options.signal.reason;unavailableUntil=Date.now()+15000;}
    return fetchImpl(input,clean);
  };
}
