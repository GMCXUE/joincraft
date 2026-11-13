// Shared high-detail atlas: eight mining poses and four collection poses.
let atlas=null,loading=null;
export function loadMinerArt(){
 if(loading)return loading;
 loading=new Promise((resolve,reject)=>{
  const image=new Image();image.decoding='async';image.src=new URL('./brand/mining-atlas-v2.png',import.meta.url).href;
  image.onload=()=>{atlas=image;resolve();};image.onerror=()=>{loading=null;reject(new Error('Mining artwork unavailable'));};
 });return loading;
}
export function minerFrame({phase='pending',elapsed=0,reduced=false}={}){
 if(reduced)return phase==='success'?11:0;
 if(phase==='error')return 0;
 if(phase==='success')return elapsed<180?[4,5,6][Math.min(2,Math.floor(elapsed/60))]:Math.min(11,8+Math.floor((elapsed-180)/180));
 return [0,1,2,3,3,4,5,6,7,7][Math.floor(Math.max(0,elapsed)/100)%10];
}
export function drawMiner(canvas,state){
 const context=canvas.getContext('2d');if(!context)return;
 context.clearRect(0,0,canvas.width,canvas.height);if(!atlas)return;
 const cellWidth=atlas.naturalWidth/4,cellHeight=atlas.naturalHeight/3,index=minerFrame(state);
 context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
 context.drawImage(atlas,(index%4)*cellWidth,Math.floor(index/4)*cellHeight,cellWidth,cellHeight,0,0,canvas.width,canvas.height);
}
