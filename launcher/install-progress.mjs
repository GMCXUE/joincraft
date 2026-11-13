export class InstallProgress {
  constructor(notify=()=>{},now=Date.now){this.notify=notify;this.now=now;this.value={type:'pack-install',state:'idle'};this.lastEmit=0;}
  begin(name){this.name=name;this.started=this.now();this.phase('inspect','读取整合包',1);}
  phase(phase,label,stage,files=[]){this.files=new Map(files.map(f=>[f.path,{size:f.size,done:0,complete:false,reused:false}]));this.knownFiles=0;this.totalKnownBytes=0;this.completedBytes=0;this.completedFiles=0;this.reusedFiles=0;this.reusedBytes=0;for(const row of this.files.values())if(Number.isFinite(row.size)&&row.size>0){this.knownFiles++;this.totalKnownBytes+=row.size;}this.samples=[];this.value={type:'pack-install',state:'installing',name:this.name,operation:this.operation||'install',sha512:this.sha512,phase,label,stage,stages:6,file:'',fileCompleted:0,fileTotal:null,completedFiles:0,reusedFiles:0,reusedBytes:0,totalFiles:files.length,completedBytes:0,totalBytes:files.length&&files.every(f=>Number.isFinite(f.size))?files.reduce((n,f)=>n+f.size,0):null,percent:null,speedBps:0,etaSeconds:null};this.flush(true);}
  update(file,written,total,{networkBytes=0,done=false,reused=false}={}){
    let row=this.files.get(file);if(!row){row={size:undefined,done:0,complete:false,reused:false};this.files.set(file,row);}
    const bytes=row=>Math.max(0,Math.min(row.done,row.size??row.done));
    if(Number.isFinite(row.size)&&row.size>0){this.knownFiles--;this.totalKnownBytes-=row.size;}
    this.completedBytes-=bytes(row);this.completedFiles-=Number(row.complete);this.reusedFiles-=Number(row.reused);if(row.reused)this.reusedBytes-=bytes(row);
    if(Number.isFinite(total)&&total>0)row.size=total;
    row.done=written;row.complete ||= done;row.reused ||= reused;
    if(Number.isFinite(row.size)&&row.size>0){this.knownFiles++;this.totalKnownBytes+=row.size;}
    this.completedBytes+=bytes(row);this.completedFiles+=Number(row.complete);this.reusedFiles+=Number(row.reused);if(row.reused)this.reusedBytes+=bytes(row);
    const now=this.now();if(networkBytes>0){const last=this.samples.at(-1);if(last&&now-last.at<100)last.bytes+=networkBytes;else this.samples.push({at:now,bytes:networkBytes});}this.samples=this.samples.filter(s=>now-s.at<6000);
    const elapsed=this.samples.length?(now-this.samples[0].at)/1000:0;
    const speedBps=elapsed>=1.5?this.samples.reduce((n,s)=>n+s.bytes,0)/Math.max(1,elapsed):0;
    const totalBytes=this.knownFiles===this.files.size?this.totalKnownBytes:null,completedBytes=this.completedBytes;
    Object.assign(this.value,{file,fileCompleted:written,fileTotal:total||null,completedBytes,totalBytes,completedFiles:this.completedFiles,reusedFiles:this.reusedFiles,reusedBytes:this.reusedBytes,totalFiles:this.files.size,speedBps,percent:totalBytes?Math.min(100,completedBytes/totalBytes*100):null,etaSeconds:totalBytes&&speedBps?Math.ceil(Math.max(0,totalBytes-completedBytes)/speedBps):null});this.flush(done&&this.completedFiles===this.files.size);
  }
  detail(file){Object.assign(this.value,{file,percent:null,etaSeconds:null,speedBps:0});this.flush(true);}
  end(state,message){Object.assign(this.value,{state,message,etaSeconds:null,speedBps:0,...(state==='done'?{percent:100}:{})});this.flush(true);}
  flush(force=false){if(force||this.now()-this.lastEmit>=160){this.lastEmit=this.now();this.notify({...this.value});}}
  state(){return {...this.value};}
}
