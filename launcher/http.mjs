import {fetch as stableFetch,Agent} from 'undici';

// Supplying our own dispatcher is essential: the global dispatcher can still be
// the older parser embedded in Electron/Node or installed by another dependency.
const dispatcher=new Agent({connections:32,pipelining:1});
export function clientFetch(input,options={}){
  return stableFetch(input,{...options,dispatcher});
}
