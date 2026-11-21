import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Normalizes the four user-supplied transparent grass tufts to the atlas
 * actually sampled by grass-blade.ts. Do not recreate the older OpenGameArt
 * atlas or overwrite the preserved original image.
 *
 * The source has a large transparent margin under the roots (about 30% of
 * total height), which previously made the grass appear tiny and floating.
 */
const dir=path.resolve('public/assets/vegetation');
const source=path.join(dir,'grass-tufts-user-original.png');
const output=path.join(dir,'grass-tufts-cc0.png'); // legacy runtime filename
const image=sharp(await readFile(source));
const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
if(info.channels!==4)throw new Error('Expected RGBA input');
if(info.width<256||info.height<256)throw new Error('Grass atlas source is too small');

const ATLAS_WIDTH=1024,ATLAS_HEIGHT=512,COL_WIDTH=256;
const tiles=[];
const records=[];
for(let i=0;i<4;i++){
  const x0=Math.floor(i*info.width/4),x1=Math.floor((i+1)*info.width/4);
  let left=x1,top=info.height,right=x0,bottom=0,opaque=0;
  for(let y=0;y<info.height;y++){
    for(let x=x0;x<x1;x++){
      const a=data[(y*info.width+x)*4+3];
      if(a<120)continue;
      left=Math.min(left,x);right=Math.max(right,x);
      top=Math.min(top,y);bottom=Math.max(bottom,y);
      opaque++;
    }
  }
  if(opaque<500)throw new Error('Grass variant '+i+' has no usable alpha content');
  // Leave a little air around the thin tips while moving the LAST visible
  // root pixel to within ~2px of the bottom of the output texture.
  const cropLeft=Math.max(x0,left-12),cropTop=Math.max(0,top-7);
  const cropRight=Math.min(x1,right+13),cropBottom=Math.min(info.height,bottom+2);
  const w=cropRight-cropLeft,h=cropBottom-cropTop;
  const cut=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}})
    .extract({left:cropLeft,top:cropTop,width:w,height:h})
    .resize(250,512,{fit:'fill',kernel:'lanczos3'})
    .png().toBuffer();
  tiles.push({input:cut,left:i*COL_WIDTH+3,top:0});
  records.push({variant:i,sourceBBox:[left,top,right,bottom],crop:[cropLeft,cropTop,w,h],visibleHeightRatio:Number(((bottom-top+1)/info.height).toFixed(3))});
}
await sharp({create:{width:ATLAS_WIDTH,height:ATLAS_HEIGHT,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
  .composite(tiles).png({compressionLevel:9}).toFile(output);
const metadata={
  artwork:'User-supplied four sparse grey-olive tufts (AI-generated artwork)',
  sourceFile:'grass-tufts-user-original.png',
  outputFile:'grass-tufts-cc0.png',
  filenameNote:'cc0 is a legacy code-facing filename, not a declaration of the artwork licence',
  transforms:'Per-column alpha bounding crop; 4 columns each 256x512, roots moved to ground-contact bottom, tips preserved',
  outputDimensions:[ATLAS_WIDTH,ATLAS_HEIGHT],
  variants:records
};
await writeFile(path.join(dir,'grass-tufts-cc0.json'),JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({sourceDimensions:[info.width,info.height],outputDimensions:[ATLAS_WIDTH,ATLAS_HEIGHT],variants:records}));
