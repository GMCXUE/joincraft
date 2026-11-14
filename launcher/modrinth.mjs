import {clientFetch} from './http.mjs';
const ORIGIN='https://api.modrinth.com/v2';
const identity=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(v))throw Error('Modrinth 标识无效');return v;};
const label=(v,max=400)=>typeof v==='string'?v.slice(0,max):'';
const count=v=>Number.isFinite(v)&&v>=0?Math.floor(v):0;
const labels=v=>Array.isArray(v)?v.slice(0,100).filter(x=>typeof x==='string').map(x=>label(x,100)):[];
export function modrinthImage(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='cdn.modrinth.com'&&!u.username&&!u.password&&!u.port?u.href:'';}catch{return '';}}
const presentation=p=>({iconUrl:modrinthImage(p.icon_url),downloads:count(p.downloads),followers:count(p.followers??p.follows),categories:labels(p.display_categories?.length?p.display_categories:p.categories),environment:labels(p.environment),clientSide:label(p.client_side,40),serverSide:label(p.server_side,40),updated:label(p.updated||p.date_modified,60)});
export function compatibleVersion(v,instance){return Array.isArray(v.game_versions)&&v.game_versions.includes(instance.minecraft)&&Array.isArray(v.loaders)&&v.loaders.includes(instance.loader.toLowerCase());}
export class Modrinth {
 constructor({fetchImpl=clientFetch,now=Date.now}={}){Object.assign(this,{fetchImpl,now});this.cache=new Map();this.blockedUntil=0;}
 async request(route,{body,signal,ttl=60000}={}){
  const key=route+JSON.stringify(body??''),cached=this.cache.get(key);if(cached?.until>this.now())return structuredClone(cached.value);if(this.blockedUntil>this.now())throw Error('Modrinth 请求较多，请在 '+Math.ceil((this.blockedUntil-this.now())/1000)+' 秒后重试');
  const response=await this.fetchImpl(ORIGIN+route,{method:body?'POST':'GET',headers:{'User-Agent':'GMCXUE/joincraft (https://github.com/GMCXUE/joincraft)',Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]),redirect:'error'});
  if(response.status===429||response.headers.get('x-ratelimit-remaining')==='0')this.blockedUntil=this.now()+Math.max(1,Math.min(300,Number(response.headers.get('retry-after')||response.headers.get('x-ratelimit-reset'))||60))*1000;
  if(!response.ok){await response.body?.cancel();throw Error(response.status===429?'Modrinth 请求较多，请稍后重试':response.status===404?'Modrinth 项目或版本不存在':'Modrinth 请求失败（HTTP '+response.status+'）');}
  let size=0;const chunks=[];for await(const chunk of response.body){if((size+=chunk.length)>8*1024*1024){await response.body?.cancel().catch(()=>{});throw Error('Modrinth 返回内容过大');}chunks.push(chunk);}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(this.cache.size>=128)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{value,until:this.now()+ttl});return structuredClone(value);
 }
 async search({query='',category='',offset=0},instance,options={}){
  if(typeof query!=='string'||query.length>120||!Number.isInteger(offset)||offset<0||offset>10000)throw Error('搜索条件无效');const loader=instance.loader.toLowerCase();if(!['forge','fabric','neoforge','quilt'].includes(loader))return {hits:[],total:0};
  const facets=[['project_type:mod'],['versions:'+instance.minecraft],['categories:'+loader]];if(category){identity(category);facets.push(['categories:'+category]);}const params=new URLSearchParams({query,facets:JSON.stringify(facets),offset:String(offset),limit:'20',index:'relevance'});const data=await this.request('/search?'+params,options);return {hits:(data.hits||[]).map(p=>({id:identity(p.project_id),title:label(p.title),description:label(p.description,2000),author:label(p.author),...presentation(p),gameVersions:labels(p.versions)})),total:data.total_hits||0};
 }
 async project(id,options){
  const p=await this.request('/project/'+identity(id),options);
  let authors=[];
  if(typeof p.team==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(p.team))try{const members=await this.request('/team/'+p.team+'/members',options);authors=Array.isArray(members)?members.slice(0,24).map(m=>({name:label(m.user?.name||m.user?.username,100),username:label(m.user?.username,100),role:label(m.role,100)})).filter(m=>m.name):[];}catch{/* A team request must not hide project details. */}
  return {id:identity(p.id),title:label(p.title),description:label(p.description,2000),body:label(p.body,64000),license:label(p.license?.name||p.license?.id),slug:label(p.slug),...presentation(p),authors,loaders:labels(p.loaders),gameVersions:labels(p.game_versions),published:label(p.published,60),gallery:(Array.isArray(p.gallery)?p.gallery:[]).slice(0,12).map(g=>({url:modrinthImage(g.url),title:label(g.title,200),description:label(g.description,1000)})).filter(g=>g.url)};
 }
 async versions(id,instance,options){const params=new URLSearchParams({game_versions:JSON.stringify([instance.minecraft]),loaders:JSON.stringify([instance.loader.toLowerCase()])});return (await this.request('/project/'+identity(id)+'/version?'+params,options)).filter(v=>compatibleVersion(v,instance)).sort((a,b)=>Date.parse(b.date_published)-Date.parse(a.date_published));}
 async version(id,options){return this.request('/version/'+identity(id),options);}
 async hashes(hashes,options){const result={};for(let i=0;i<hashes.length;i+=100){const batch=hashes.slice(i,i+100);if(batch.some(h=>!/^[a-f0-9]{128}$/.test(h)))throw Error('模组哈希无效');Object.assign(result,await this.request('/version_files',{...options,body:{hashes:batch,algorithm:'sha512'}}));}return result;}
}
