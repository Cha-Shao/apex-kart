import * as THREE from 'three';

const prepared=new WeakMap<THREE.Texture,Map<number,THREE.DataTexture>>();
const toLinear=Float32Array.from({length:256},(_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
const toSRGB=Uint8Array.from({length:4097},(_,i)=>{const v=i/4096;return Math.round(255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055));});

/** Shared by grass and tree leaves. Bound the derivative ramp so empty atlas
 * texels never acquire coverage when a card is small or viewed edge-on. */
export const foliageAlphaTestGLSL=`
  #ifdef USE_ALPHATEST
  #ifdef ALPHA_TO_COVERAGE
  float foliageAlpha=diffuseColor.a;
  float foliageWidth=clamp(fwidth(foliageAlpha),1.0/255.0,min(alphaTest,1.0-alphaTest));
  diffuseColor.a=smoothstep(alphaTest-foliageWidth*.5,alphaTest+foliageWidth*.5,foliageAlpha);
  if(foliageAlpha<=0.0||diffuseColor.a<=0.0)discard;
  #else
  if(diffuseColor.a<alphaTest)discard;
  #endif
  #endif
`;

/** Preserve leaf colour throughout the transparent atlas background. Canvas-backed
 * textures cannot retain RGB at alpha zero, so upload the final pixels raw. */
function bleed(pixels:Uint8Array,width:number,height:number){
  const count=width*height,visited=new Uint8Array(count),queue=new Int32Array(count);let head=0,tail=0;
  for(let i=0;i<count;i++)if(pixels[i*4+3]>=192){visited[i]=1;queue[tail++]=i;}
  if(!tail){
    let peak=0;for(let i=3;i<pixels.length;i+=4)peak=Math.max(peak,pixels[i]);
    if(!peak)return;
    for(let i=0;i<count;i++)if(pixels[i*4+3]===peak){visited[i]=1;queue[tail++]=i;}
  }
  while(head<tail){
    // Fill the entire transparent background, including pale RGB more than
    // eight pixels from a leaf. Coarse mips can sample that whole region.
    const index=queue[head++];
    const x=index%width,y=Math.floor(index/width);
    for(let direction=0;direction<4;direction++){
      const nx=x+(direction===0?-1:direction===1?1:0),ny=y+(direction===2?-1:direction===3?1:0);
      if(nx<0||nx>=width||ny<0||ny>=height)continue;
      const next=ny*width+nx;if(visited[next])continue;
      visited[next]=1;queue[tail++]=next;
      pixels[next*4]=pixels[index*4];pixels[next*4+1]=pixels[index*4+1];pixels[next*4+2]=pixels[index*4+2];
    }
  }
}

/** Premultiplied linear-light filtering, stored as ordinary unpremultiplied
 * RGBA for alpha-tested PBR. Fully transparent black never darkens the leaf. */
function downsample(source:Uint8Array,width:number,height:number){
  const w=Math.max(1,Math.floor(width/2)),h=Math.max(1,Math.floor(height/2)),pixels=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let alpha=0,r=0,g=0,b=0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const offset=(Math.min(height-1,y*2+dy)*width+Math.min(width-1,x*2+dx))*4,a=source[offset+3]/255;
      alpha+=a;r+=toLinear[source[offset]]*a;g+=toLinear[source[offset+1]]*a;b+=toLinear[source[offset+2]]*a;
    }
    const offset=(y*w+x)*4;pixels[offset+3]=Math.round(alpha*255/4);
    if(alpha>0){pixels[offset]=toSRGB[Math.min(4096,Math.round(r/alpha*4096))];pixels[offset+1]=toSRGB[Math.min(4096,Math.round(g/alpha*4096))];pixels[offset+2]=toSRGB[Math.min(4096,Math.round(b/alpha*4096))];}
  }
  return {pixels,width:w,height:h};
}

/** Import-time edge padding + coverage-preserving mip chain. Shared by all
 * instances; it adds no texture processing to the driving frame loop. */
export function foliageCutoutTexture(texture:THREE.Texture,cutoff:number):THREE.Texture{
  if(texture.userData.foliageEdgeBleed)return texture;
  const cached=prepared.get(texture)?.get(cutoff);if(cached)return cached;
  const image=texture.image as CanvasImageSource&{width:number;height:number};if(!image?.width||!image.height)return texture;
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(image,0,0);
  const base=new Uint8Array(context.getImageData(0,0,image.width,image.height).data),threshold=Math.ceil(cutoff*255);
  let covered=0;for(let i=3;i<base.length;i+=4)if(base[i]>=threshold)covered++;
  const coverage=covered/(image.width*image.height);bleed(base,image.width,image.height);
  const levels=[{data:base,width:image.width,height:image.height}];let current=levels[0];
  while(current.width>1||current.height>1){
    const next=downsample(current.data,current.width,current.height),histogram=new Uint32Array(256);
    for(let i=3;i<next.pixels.length;i+=4)histogram[next.pixels[i]]++;
    const target=Math.round(coverage*next.width*next.height);let count=0,quantile=255;
    while(quantile>0&&count+histogram[quantile]<target){count+=histogram[quantile];quantile--;}
    // Do not force even a nearly empty atlas's final 1x1 mip to become opaque.
    const scale=target>0?THREE.MathUtils.clamp(threshold/Math.max(quantile,1),.85,4):1;
    // Coverage correction belongs to the uploaded level only. Feeding it
    // back into filtering progressively inflates low-alpha fringes and holes.
    current={data:next.pixels,width:next.width,height:next.height};
    const corrected=new Uint8Array(next.pixels);
    for(let i=3;i<corrected.length;i+=4)corrected[i]=Math.min(255,Math.round(corrected[i]*scale));
    bleed(corrected,next.width,next.height);levels.push({data:corrected,width:next.width,height:next.height});
  }
  const result=new THREE.DataTexture(base,image.width,image.height,THREE.RGBAFormat,THREE.UnsignedByteType);
  result.name=`${texture.name}-leaf-edge-padding`;result.colorSpace=texture.colorSpace;result.mapping=texture.mapping;result.channel=texture.channel;
  result.wrapS=texture.wrapS;result.wrapT=texture.wrapT;result.flipY=texture.flipY;result.anisotropy=texture.anisotropy;
  result.offset.copy(texture.offset);result.repeat.copy(texture.repeat);result.center.copy(texture.center);result.rotation=texture.rotation;
  result.matrixAutoUpdate=texture.matrixAutoUpdate;result.matrix.copy(texture.matrix);
  result.mipmaps=levels;result.generateMipmaps=false;result.minFilter=THREE.LinearMipmapLinearFilter;result.magFilter=THREE.LinearFilter;
  result.userData={...texture.userData,foliageMipmaps:true,foliageEdgeBleed:true};result.needsUpdate=true;
  const variants=prepared.get(texture)??new Map<number,THREE.DataTexture>();variants.set(cutoff,result);prepared.set(texture,variants);return result;
}
