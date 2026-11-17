import * as THREE from 'three';

export const TREE_ASSET_BASE='/assets/vegetation/';
export const TREE_MODELS=['oak','ash','pine'] as const;

/** Keep cutout coverage when small leaves collapse into the mip chain. */
export function foliageMipmaps(texture:THREE.Texture,cutoff:number){
  if(texture.userData.foliageMipmaps)return;
  const image=texture.image as CanvasImageSource&{width:number;height:number};
  if(!image?.width||!image.height)return;
  const canvas=(width:number,height:number)=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};
  let level=canvas(image.width,image.height),context=level.getContext('2d',{willReadFrequently:true})!;
  context.drawImage(image,0,0);
  const threshold=Math.ceil(cutoff*255),base=context.getImageData(0,0,level.width,level.height).data;
  let covered=0;for(let i=3;i<base.length;i+=4)if(base[i]>=threshold)covered++;
  const coverage=covered/(level.width*level.height),mipmaps:HTMLCanvasElement[]=[level];
  while(level.width>1||level.height>1){
    const next=canvas(Math.max(1,Math.floor(level.width/2)),Math.max(1,Math.floor(level.height/2))),ctx=next.getContext('2d',{willReadFrequently:true})!;
    ctx.drawImage(level,0,0,next.width,next.height);
    const pixels=ctx.getImageData(0,0,next.width,next.height),histogram=new Uint32Array(256);
    for(let i=3;i<pixels.data.length;i+=4)histogram[pixels.data[i]]++;
    const target=Math.ceil(coverage*next.width*next.height);let count=0,quantile=255;
    while(quantile>0&&count+histogram[quantile]<target){count+=histogram[quantile];quantile--;}
    // Bounded correction retains holes instead of filling a whole distant tile.
    const scale=THREE.MathUtils.clamp(threshold/Math.max(quantile,1),.85,1.85);
    for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=Math.min(255,Math.round(pixels.data[i]*scale));
    ctx.putImageData(pixels,0,0);mipmaps.push(next);level=next;
  }
  // The explicit chain includes level zero for ordinary Three.js textures.
  texture.mipmaps=mipmaps;texture.generateMipmaps=false;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.userData.foliageMipmaps=true;texture.needsUpdate=true;
}
