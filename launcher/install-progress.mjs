export class InstallProgress {
  constructor(notify=()=>{},now=Date.now){this.notify=notify;this.now=now;this.value={type:'pack-install',state:'idle'};this.lastEmit=0;}
  begin(name){this.name=name;this.started=this.now();this.phase('inspect','读取整合包',1);}
  phase(phase,label,stage,files=[]){this.files=new Map(files.map(f=>[f.path,{size:f.size,done:0,complete:false}]));this.samples=[];this.value={type:'pack-install',state:'installing',name:this.name,sha512:this.sha512,phase,label,stage,stages:6,file:'',fileCompleted:0,fileTotal:null,completedFiles:0,totalFiles:files.length,completedBytes:0,totalBytes:files.length&&files.every(f=>Number.isFinite(f.size))?files.reduce((n,f)=>n+f.size,0):null,percent:null,speedBps:0,etaSeconds:null};this.flush(true);}
  update(file,written,total,{networkBytes=0,done=false}={}){
    let row=this.files.get(file);if(!row){row={size:total,done:0,complete:false};this.files.set(file,row);}
    if(Number.isFinite(total)&&total>0)row.size=total;
    row.done=written;row.complete ||= done;
    const now=this.now();if(networkBytes>0)this.samples.push({at:now,bytes:networkBytes});this.samples=this.samples.filter(s=>now-s.at<6000);
    const elapsed=this.samples.length?(now-this.samples[0].at)/1000:0;
    const speedBps=elapsed>=1.5?this.samples.reduce((n,s)=>n+s.bytes,0)/Math.max(1,elapsed):0;
    const rows=[...this.files.values()],known=rows.every(f=>Number.isFinite(f.size)&&f.size>0);
    const totalBytes=known?rows.reduce((n,f)=>n+f.size,0):null,completedBytes=rows.reduce((n,f)=>n+Math.max(0,Math.min(f.done,f.size??f.done)),0);
    Object.assign(this.value,{file,fileCompleted:written,fileTotal:total||null,completedBytes,totalBytes,completedFiles:rows.filter(f=>f.complete).length,totalFiles:rows.length,speedBps,percent:totalBytes?Math.min(100,completedBytes/totalBytes*100):null,etaSeconds:totalBytes&&speedBps?Math.ceil(Math.max(0,totalBytes-completedBytes)/speedBps):null});this.flush();
  }
  detail(file){Object.assign(this.value,{file,percent:null,etaSeconds:null,speedBps:0});this.flush(true);}
  end(state,message){Object.assign(this.value,{state,message,etaSeconds:null,speedBps:0,...(state==='done'?{percent:100}:{})});this.flush(true);}
  flush(force=false){if(force||this.now()-this.lastEmit>=160){this.lastEmit=this.now();this.notify({...this.value});}}
  state(){return {...this.value};}
}
