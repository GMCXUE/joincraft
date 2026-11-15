const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
export const voiceLevel=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(1,Number(value))):1;
export function createVoiceLevels({getUserId,storage}={}){
 let owner=null,settings={input:1,peers:new Map()};
 try{storage??=globalThis.localStorage;}catch{/* Session-only controls remain available. */}
 function load(){const id=String(getUserId?.()||'');if(owner===id)return;owner=id;settings={input:1,peers:new Map()};if(!id)return;
  try{const raw=storage?.getItem('joincraft-voice-levels-v1:'+id);if(!raw||raw.length>30000)return;const value=JSON.parse(raw);if(valid(value.input))settings.input=value.input;
   if(Array.isArray(value.peers))for(const row of value.peers.slice(-200))if(Array.isArray(row)&&typeof row[0]==='string'&&row[0].length>0&&row[0].length<=100&&valid(row[1]))settings.peers.set(row[0],row[1]);
  }catch{/* Ignore damaged preferences without affecting voice. */}
 }
 function save(){if(!owner)return;try{storage?.setItem('joincraft-voice-levels-v1:'+owner,JSON.stringify({input:settings.input,peers:[...settings.peers]}));}catch{/* Storage failure must not interrupt an active conversation. */}}
 return {input(){load();return settings.input;},peer(id){load();return settings.peers.get(id)??1;},setInput(value){load();settings.input=voiceLevel(value);save();return settings.input;},setPeer(id,value){load();if(typeof id!=='string'||!id||id.length>100)return 1;const level=voiceLevel(value);settings.peers.delete(id);settings.peers.set(id,level);while(settings.peers.size>200)settings.peers.delete(settings.peers.keys().next().value);save();return level;}};
}
