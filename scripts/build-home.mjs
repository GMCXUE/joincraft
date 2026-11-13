import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const source=new URL('../design/homepage/world-v1.png',import.meta.url),output=new URL('../public/home/world-v1.webp',import.meta.url);
await mkdir(new URL('../public/home/',import.meta.url),{recursive:true});
const result=await sharp(fileURLToPath(source)).webp({quality:87,effort:5}).toFile(fileURLToPath(output));
console.log('Homepage scene:',result.width+'×'+result.height,result.size+' bytes');
