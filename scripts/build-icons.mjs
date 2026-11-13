import {Resvg} from '@resvg/resvg-js';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(import.meta.dirname,'..'),brand=path.join(root,'public/brand'),build=path.join(root,'build-resources');
const app=await readFile(path.join(brand,'icon.svg'),'utf8');
const shapes=(await readFile(path.join(brand,'mark.svg'),'utf8')).replace(/<svg[^>]*>|<\/svg>/g,'').replaceAll('fill="#94CC56"','');
const tile=(maskable=false)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none"><rect width="512" height="512" rx="${maskable?0:120}" fill="#94CC56"/><g transform="translate(32 60) scale(7)" fill="#1B2418">${shapes}</g></svg>`;
await mkdir(build,{recursive:true});
await writeFile(path.join(brand,'favicon.svg'),tile());
const png=(svg,size)=>new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng();
await writeFile(path.join(brand,'app-1024.png'),png(app,1024));
await writeFile(path.join(brand,'app-192.png'),png(app,192));
await writeFile(path.join(brand,'app-512.png'),png(app,512));
await writeFile(path.join(brand,'maskable-512.png'),png(tile(true),512));
await writeFile(path.join(brand,'favicon-32.png'),png(tile(),32));
await writeFile(path.join(root,'public/apple-touch-icon.png'),png(tile(true),180));
function ico(images){const header=Buffer.alloc(6);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=6+images.length*16;const entries=[];for(const [size,data]of images){const entry=Buffer.alloc(16);entry[0]=entry[1]=size===256?0:size;entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(data.length,8);entry.writeUInt32LE(offset,12);offset+=data.length;entries.push(entry);}return Buffer.concat([header,...entries,...images.map(([,data])=>data)]);}
await writeFile(path.join(root,'public/favicon.ico'),ico([16,32,48].map(size=>[size,png(tile(),size)])));
await writeFile(path.join(build,'joincraft.ico'),ico([16,24,32,48,64,128,256].map(size=>[size,png(size<=48?tile():app,size)])));
if(process.platform==='darwin'){
 const temp=await mkdtemp(path.join(os.tmpdir(),'joincraft-icon-')),set=path.join(temp,'joincraft.iconset');await mkdir(set);
 try{for(const size of [16,32,128,256,512])for(const scale of [1,2])await writeFile(path.join(set,`icon_${size}x${size}${scale===2?'@2x':''}.png`),png(app,size*scale));const result=spawnSync('/usr/bin/iconutil',['-c','icns',set,'-o',path.join(build,'joincraft.icns')],{stdio:'inherit'});if(result.status!==0)throw Error('ICNS generation failed');}finally{await rm(temp,{recursive:true,force:true});}
}
// A review sheet uses the exact exported artwork at large and native small sizes.
const embed=(svg,x,y,w,h)=>`<image x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"/>`;
const text=(value,x,y,size=14,color='#929A96')=>`<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="${color}">${value}</text>`;
const sizes=[16,24,32,48,64];
const preview=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="#171A18"/>${text('joincraft',64,78,30,'#E9ECE6')}${text('APP / WEB ICON',64,112,12)}<path d="M64 145H1136" stroke="#FFFFFF18"/>${embed(app,88,205,400,400)}${text('J + C',208,651,16,'#CAD4C5')}${text('CONNECTED BY DESIGN',168,680,11)}<path d="M566 185V676" stroke="#FFFFFF18"/>${text('DESKTOP',640,222,12)}${embed(app,638,252,112,112)}${embed(app,800,264,88,88)}${embed(app,940,276,64,64)}${text('WEB',640,426,12)}<rect x="640" y="452" width="430" height="62" rx="12" fill="#252A26"/>${embed(tile(),660,473,20,20)}${text('joincraft',692,488,15,'#E9ECE6')}${text('×',1040,488,18)}${sizes.map((size,i)=>`${embed(tile(),640+i*90,560, size,size)}${text(size+' px',640+i*90,650,11)}`).join('')}</svg>`;
await writeFile(path.join(brand,'preview.png'),png(preview,1200));
console.log('Generated SVG, PNG, ICO, website and macOS icon assets.');
