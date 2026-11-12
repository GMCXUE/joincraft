// Deterministic, code-native voxel geometry. Decorative; never a game screenshot.
export function drawTerrain(canvas,small=false) {
 if(!canvas)return;
 const W=680,H=380,scale=window.devicePixelRatio||1;canvas.width=W*scale;canvas.height=H*scale;
 const c=canvas.getContext('2d');c.scale(scale,scale);c.clearRect(0,0,W,H);
 const origin={x:375,y:140},sx=21,sy=10.5,sz=17;
 const p=(x,y,z)=>[origin.x+(x-y)*sx,origin.y+(x+y)*sy-z*sz];
 const polygon=(points,color)=>{c.fillStyle=color;c.beginPath();points.forEach((a,i)=>i?c.lineTo(...a):c.moveTo(...a));c.closePath();c.fill();};
 const block=(x,y,z,colors,height=1)=>{
  polygon([p(x,y,z),p(x+1,y,z),p(x+1,y,z+height),p(x,y,z+height)],colors[1]);
  polygon([p(x+1,y,z),p(x+1,y+1,z),p(x+1,y+1,z+height),p(x+1,y,z+height)],colors[2]);
  polygon([p(x,y,z+height),p(x+1,y,z+height),p(x+1,y+1,z+height),p(x,y+1,z+height)],colors[0]);
 };
 const grass=[['#91aa75','#788666','#5c7560'],['#a0b583','#7c8c6a','#617e65'],['#b1c28d','#8b9b73','#6b876b']];
 const stone=['#a6aaa0','#7d867f','#68776f'],dirt=['#aa9680','#95836e','#7d7668'];
 const heights=new Map();
 for(let x=-6;x<=5;x++)for(let y=-5;y<=5;y++){
  const d=((x+0.5)/6)**2+(y/5.5)**2;
  if(d<1.03){const z= Math.max(0,Math.round(1.8-Math.abs(x+1)/3-Math.abs(y)/4));heights.set(`${x},${y}`,z);}
 }
 // Soft ground shadow, offset from the floating terrain.
 c.fillStyle='#b2bfb333';c.beginPath();c.ellipse(375,325,181,27,0,0,Math.PI*2);c.fill();
 const tiles=[...heights].map(([k,z])=>({xy:k.split(',').map(Number),z})).sort((a,b)=>a.xy[0]+a.xy[1]-b.xy[0]-b.xy[1]);
 for(const {xy:[x,y],z}of tiles){
  const depth=2+((x*x+y*y)%3);block(x,y,-depth,stone,depth);block(x,y,0,dirt,z+1);block(x,y,z+1,grass[Math.abs(x*3+y)%3],0.45);
  if(x>=0&&x<=1&&y>-4&&y<4)block(x,y,z+1.45,['#91bdc3','#6a9ca9','#588895'],0.08);
 }
 const tree=(x,y)=>{const z=(heights.get(`${x},${y}`)||0)+1.45;block(x+.34,y+.34,z,['#a59c7d','#80745b','#665e4e'],2.3);for(let n=0;n<3;n++){const width=2.4-n*.5;const tx=x+.5-width/2,ty=y+.5-width/2;const zz=z+1.6+n*.8;polygon([p(tx,ty,zz),p(tx+width,ty,zz),p(tx+width,ty+width,zz),p(tx,ty+width,zz)],'#55755d');polygon([p(tx,ty,zz+.7),p(tx+width,ty,zz+.7),p(tx+width,ty+width,zz+.7),p(tx,ty+width,zz+.7)],n===2?'#83a077':'#6d8c68');polygon([p(tx+width,ty,zz),p(tx+width,ty+width,zz),p(tx+width,ty+width,zz+.7),p(tx+width,ty,zz+.7)],'#466850');polygon([p(tx,ty+width,zz),p(tx+width,ty+width,zz),p(tx+width,ty+width,zz+.7),p(tx,ty+width,zz+.7)],'#5c7a58');}};
 tree(-3,-3);tree(2,-3);tree(4,-1);
 // Cabin built from exactly specified voxels.
 for(let x=-4;x<-1;x++)for(let y=-1;y<1;y++){block(x,y,2.5,['#d8cfb0','#c2b18e','#ac987d'],2);block(x,y,4.5,['#788992','#5e747d','#4a646d'],.65);}
 for(let x=-4;x<-1;x++)block(x,-.5,5.15,['#94a3a6','#768c91','#5c747b'],.55);
 block(-2.8,1.02,2.5,['#627476','#6a7873','#5a695f'],1.45);
 block(-3.8,1.03,3.15,['#f7dba5','#ebcb8a','#d9b97e'],.65);
 for(let x=-1;x<3;x++)block(x,2,2.7,['#cbb795','#b59b76','#968265'],.2);
 tree(-3,3);tree(3,3);
 // Two small players on either side of the bridge.
 const person=(x,y,color)=>{const z=3;block(x,y,z,[color,color,'#5c6c71'],.8);block(x,y,z+.8,['#e4c6a0','#d1ae88','#ba9671'],.55);};
 person(-.9,2,'#8d9cae');person(2.2,2,'#b58c70');
}
