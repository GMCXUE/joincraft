export const REPOSITORY_URL = 'https://github.com/GMCXUE/joincraft';

/** Keep remote pages out of native windows; only our repository may open externally. */
export function repositoryLinkHandler({webContents,pageURL,openExternal,onError=()=>{}}){
  return ({url})=>{
    if(webContents.getURL().split('#')[0]===pageURL.split('#')[0]&&url===REPOSITORY_URL){
      void Promise.resolve().then(()=>openExternal(REPOSITORY_URL)).catch(onError);
    }
    return {action:'deny'};
  };
}
