import path from 'node:path';
import sharp from 'sharp';

const PATCH_SIZE=2.4;
const seeded=initial=>{let seed=initial;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
const accessor=(document,buffer,type,array)=>document.createAccessor().setType(type).setArray(array).setBuffer(buffer);

/** Progressive best-candidate blue noise; the distant LOD shares a prefix of
 * the near clump anchors instead of introducing a second regular lattice. */
function clusterLayout(seed,count){
  const random=seeded(seed),points=[];
  for(let i=0;i<count;i++){
    let best,score=-1;
    for(let attempt=0;attempt<32;attempt++){
      const candidate={x:(random()-.5)*PATCH_SIZE,z:(random()-.5)*PATCH_SIZE};let distance=Infinity;
      for(const point of points){const dx=Math.abs(point.x-candidate.x),dz=Math.abs(point.z-candidate.z);distance=Math.min(distance,Math.min(dx,PATCH_SIZE-dx)**2+Math.min(dz,PATCH_SIZE-dz)**2);}
      if(distance>score){score=distance;best=candidate;}
    }
    points.push(best);
  }
  return points;
}

// Pack alpha explicitly: removeAlpha() is a deferred Sharp operation and can
// otherwise strip a channel that joinChannel() just appended in the pipeline.
export function rgbaPixels(rgb,alpha){
  if(rgb.length!==alpha.length*3)throw Error('RGB/alpha pixel dimensions differ');
  const pixels=Buffer.alloc(alpha.length*4);
  for(let i=0;i<alpha.length;i++){pixels[i*4]=rgb[i*3];pixels[i*4+1]=rgb[i*3+1];pixels[i*4+2]=rgb[i*3+2];pixels[i*4+3]=alpha[i];}
  return pixels;
}

// An atlas crop can include neighbouring loose blades. Keep the connected
// grass clump itself so those neighbours never turn into floating strips.
function isolateCluster(mask,width,height){
  const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let largest=new Int32Array(0);
  for(let seed=0;seed<mask.length;seed++){
    if(seen[seed]||mask[seed]<=16)continue;
    let head=0,tail=1;queue[0]=seed;seen[seed]=1;
    while(head<tail){
      const index=queue[head++],x=index%width,y=Math.floor(index/width);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        const px=x+dx,py=y+dz;if(px<0||px>=width||py<0||py>=height)continue;
        const next=py*width+px;if(seen[next]||mask[next]<=16)continue;
        seen[next]=1;queue[tail++]=next;
      }
    }
    if(tail>largest.length)largest=queue.slice(0,tail);
  }
  if(!largest.length)throw Error('Grass-cluster crop contains no opaque leaves');
  const isolated=Buffer.alloc(mask.length);let minX=width,minY=height,maxX=0,maxY=0;
  for(const index of largest){const x=index%width,y=Math.floor(index/width);isolated[index]=mask[index];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  return {isolated,crop:{left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1}};
}

/** Reuse the artist's finished grass-cluster atlas, not enlarged single blades. */
export async function groundcoverPatches({document,buffer,scene,metadata,cache,cached,resources}){
  const id='grass_medium_01',colorFile=metadata.Diffuse['4k'].jpg,alphaFile=metadata.Alpha['4k'].png;
  const color=await cached(path.join(cache,id,'patch-diff-4k.jpg'),colorFile),alpha=await cached(path.join(cache,id,'patch-alpha-4k.png'),alphaFile);
  const colorInfo=await sharp(color).metadata(),factor=colorInfo.width/1024;
  // The lower part of this source atlas contains two complete grass clumps.
  // Trim only transparent margins, keeping their original photographic leaf
  // shapes. The rectangles exclude the neighbouring individual blade maps.
  const regions=[{left:180,top:740,width:320,height:188},{left:576,top:744,width:288,height:168}],ratios=[],colors=[],normals=[];
  for(const [i,region] of regions.entries()){
    const box=Object.fromEntries(Object.entries(region).map(([key,value])=>[key,Math.round(value*factor)]));
    const mask=await sharp(alpha).extract(box).removeAlpha().greyscale().raw().toBuffer();
    const cluster=isolateCluster(mask,box.width,box.height),crop={...cluster.crop,left:box.left+cluster.crop.left,top:box.top+cluster.crop.top};ratios.push(crop.height/crop.width);
    const cutout=await sharp(cluster.isolated,{raw:{width:box.width,height:box.height,channels:1}}).extract(cluster.crop).resize(488,488).toColourspace('b-w').raw().toBuffer();
    const rgb=await sharp(color).extract(crop).resize(488,488).removeAlpha().raw().toBuffer();
    colors.push({input:await sharp(rgbaPixels(rgb,cutout),{raw:{width:488,height:488,channels:4}}).png().toBuffer(),left:i*512+12,top:12});
    const normalCrop=Object.fromEntries(Object.entries(crop).map(([key,value])=>[key,Math.max(key==='width'||key==='height'?1:0,Math.round(value/factor))]));
    normals.push({input:await sharp(resources[`textures/${id}_nor_gl_1k.jpg`]).extract(normalCrop).resize(488,488).png().toBuffer(),left:i*512+12,top:12});
  }
  const rgba=await sharp({create:{width:1024,height:512,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(colors).webp({quality:91,alphaQuality:100}).toBuffer();
  const normal=await sharp({create:{width:1024,height:512,channels:3,background:{r:128,g:128,b:255}}}).composite(normals).webp({quality:94}).toBuffer();
  const material=document.createMaterial('meadow-patches-groundcover').setBaseColorTexture(document.createTexture('meadow-clusters-rgba').setImage(rgba).setMimeType('image/webp'))
    .setNormalTexture(document.createTexture('meadow-clusters-normal').setImage(normal).setMimeType('image/webp')).setNormalScale(.35)
    .setMetallicFactor(0).setRoughnessFactor(.96).setAlphaMode('MASK').setAlphaCutoff(.4).setDoubleSided(true);
  const variants=[];
  for(let variant=0;variant<2;variant++)for(let level=0;level<2;level++){
    const layout=clusterLayout(2191+variant*367,36),count=level===0?36:24,segments=level===0?2:1,positions=[],uvs=[],indices=[],roots=[],heights=[],vertexNormals=[],colors=[];
    for(let i=0;i<count;i++){
      const random=seeded(7193+variant*367+i*9187),atlas=Math.floor(random()*2),rx=layout[i].x,rz=layout[i].z;
      const baseWidth=.63+random()*.19,width=baseWidth*(level===0?1:1.2),height=baseWidth*ratios[atlas]*(.8+random()*.3),rotation=random()*Math.PI*2,mirror=random()<.5,tint=.9+random()*.1;
      const u0=(atlas*512+12)/1024,u1=(atlas*512+500)/1024,v0=12/512,v1=500/512;
      for(let card=0;card<3;card++){
        const angle=rotation+card*Math.PI/3+(random()-.5)*.35,c=Math.cos(angle),s=Math.sin(angle),base=positions.length/3,length=Math.hypot(1,.3);
        for(let row=0;row<=segments;row++)for(const side of [-1,1]){
          const t=row/segments,lean=t*t*.025;
          positions.push(rx+c*side*width*.5-s*lean,height*t,rz+s*side*width*.5+c*lean);roots.push(rx,rz);heights.push(t);
          vertexNormals.push(-s/length,.3/length,c/length);
          colors.push(tint*.99,tint,tint*.96);
          uvs.push((side<0)!==mirror?u0:u1,v1-(v1-v0)*t);
        }
        for(let row=0;row<segments;row++){const a=base+row*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
      }
    }
    const geometry=document.createPrimitive().setMaterial(material)
      .setAttribute('POSITION',accessor(document,buffer,'VEC3',new Float32Array(positions)))
      .setAttribute('NORMAL',accessor(document,buffer,'VEC3',new Float32Array(vertexNormals)))
      .setAttribute('TEXCOORD_0',accessor(document,buffer,'VEC2',new Float32Array(uvs)))
      .setAttribute('COLOR_0',accessor(document,buffer,'VEC3',new Float32Array(colors)))
      .setAttribute('_PLANT_ROOT',accessor(document,buffer,'VEC2',new Float32Array(roots)))
      .setAttribute('_PLANT_HEIGHT',accessor(document,buffer,'SCALAR',new Float32Array(heights)))
      .setIndices(accessor(document,buffer,'SCALAR',new Uint16Array(indices)));
    const name=`meadow-${variant===0?'a':'b'}-${level===0?'near':'far'}`;
    scene.addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(geometry)));
    variants.push({name,patchSize:PATCH_SIZE,clusters:count,triangles:indices.length/3,distribution:'progressive best-candidate blue noise; shared anchors across LODs'});
  }
  return {source:id,sourceFiles:[colorFile,alphaFile].map(({url,md5})=>({url,md5})),atlas:'Photographic complete-cluster cutouts from the original artist atlas; 4K source crops, 1024x512 shared RGBA and normal atlas.',variants};
}
