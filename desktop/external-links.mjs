export const REPOSITORY_URL = 'https://github.com/GMCXUE/joincraft';

/** Remote rooms can open only our repository. Trusted local descriptions may open
 * Modrinth project and GitHub source pages in the system browser, never a new app window. */
export function localModLink(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='modrinth.com'&&/^\/mod\/[A-Za-z0-9_-]+(?:\/.*)?$/.test(u.pathname)||u.hostname==='github.com'&&/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/.*)?$/.test(u.pathname));}catch{return false;}}
export function repositoryLinkHandler({webContents,pageURL,openExternal,onError=()=>{}}){
  return ({url})=>{
    if(webContents.getURL().split('#')[0]===pageURL.split('#')[0]&&(url===REPOSITORY_URL||pageURL.startsWith('file:')&&localModLink(url))){
      void Promise.resolve().then(()=>openExternal(url)).catch(onError);
    }
    return {action:'deny'};
  };
}
