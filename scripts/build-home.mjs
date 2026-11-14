import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const scenes=[
  ['design/homepage/camp-v2.png','public/home/camp-v2.webp'],
  ['design/login/mine-v2.png','public/auth/mine-v2.webp'],
];
for(const [input,output] of scenes){
  const source=new URL('../'+input,import.meta.url),target=new URL('../'+output,import.meta.url);
  await mkdir(new URL('./',target),{recursive:true});
  const result=await sharp(fileURLToPath(source)).webp({quality:87,effort:5}).toFile(fileURLToPath(target));
  console.log(output+': '+result.width+'×'+result.height+', '+result.size+' bytes');
}
